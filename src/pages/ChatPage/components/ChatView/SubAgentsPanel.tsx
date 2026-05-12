import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { Button, Card, Dropdown, Flex, Tag, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";

import { selectChildren, useAppStore } from "../../store";
import { openSession } from "../../utils/openSession";
import { toolService } from "../../../../services/tool/ToolService";
import { useSubagentProfiles } from "../../../../hooks/useSubagentProfiles";
import { renderSubagentTypeTag } from "./renderSubagentTypeTag";
import InlineMetaText from "../../../../shared/components/InlineMetaText";

const { Text } = Typography;
const { useToken } = theme;
const SUB_AGENTS_COLLAPSE_STORAGE_KEY_PREFIX = "chat-session-sub-agents-collapsed:";
const AUTO_COLLAPSE_CHILD_THRESHOLD = 3;
const SUB_AGENTS_LIST_MAX_HEIGHT_PX = 600;

const normalizeSubAgentStatus = (status?: string): string => {
  const value = (status || "").trim().toLowerCase();
  if (!value) return "pending";
  if (value === "started" || value === "already_running") return "running";
  if (value === "success" || value === "done") return "completed";
  if (value === "canceled") return "cancelled";
  if (value === "queued" || value === "created") return "pending";
  return value;
};

const deriveFallbackStatus = (
  child: { isRunning?: boolean; messageCount?: number; lastRunStatus?: string },
  currentStatus?: string,
): string | undefined => {
  if (currentStatus && currentStatus.trim()) {
    return currentStatus;
  }
  if (child.isRunning) {
    return "running";
  }
  if (child.lastRunStatus && child.lastRunStatus.trim()) {
    return child.lastRunStatus;
  }
  const messageCount = child.messageCount ?? 0;
  if (messageCount > 2) {
    return "completed";
  }
  if (messageCount > 0) {
    return "pending";
  }
  return "pending";
};

const getSubAgentsCollapseStorageKey = (parentSessionId: string) =>
  `${SUB_AGENTS_COLLAPSE_STORAGE_KEY_PREFIX}${parentSessionId}`;

const readCollapsedState = (parentSessionId: string): boolean | null => {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(getSubAgentsCollapseStorageKey(parentSessionId));
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
};

const persistCollapsedState = (parentSessionId: string, isCollapsed: boolean) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      getSubAgentsCollapseStorageKey(parentSessionId),
      isCollapsed ? "1" : "0",
    );
  } catch {}
};

export interface SubAgentsPanelProps {
  parentSessionId: string;
  compact?: boolean;
}

type SubAgentRetryMode = "regenerate" | "error_retry";

export const SubAgentsPanel: React.FC<SubAgentsPanelProps> = ({
  parentSessionId,
  compact = false,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    () => readCollapsedState(parentSessionId) ?? false,
  );
  const [retryingChildId, setRetryingChildId] = useState<string | null>(null);
  const [continuingChildId, setContinuingChildId] = useState<string | null>(null);
  const [deletingChildId, setDeletingChildId] = useState<string | null>(null);

  const childrenById = useAppStore((s) => selectChildren(parentSessionId)(s));
  const chats = useAppStore((s) => s.chats);
  const loadChatHistory = useAppStore((s) => s.loadChatHistory);
  const refreshChats = useAppStore((s) => s.refreshChats);
  const markOptimisticStart = useAppStore((s) => s.markOptimisticStart);
  const markRetryStart = useAppStore((s) => s.markRetryStart);
  const markSettleTimeout = useAppStore((s) => s.markSettleTimeout);
  const pinSession = useAppStore((s) => s.pinSession);
  const unpinSession = useAppStore((s) => s.unpinSession);
  const applyChildProgress = useAppStore((s) => s.applyChildProgress);
  const clearChildProgress = useAppStore((s) => s.clearChildProgress);

  // Lazy-loaded subagent profile catalogue. Used to resolve a child's
  // `subagent_type` id (e.g. "plan") into a display name + ui hints
  // (icon/color). Failures are silent — we just fall back to the raw id.
  const { byId: subagentProfilesById } = useSubagentProfiles();

  // In-memory progress (lost on restart).
  const progressItems = useMemo(() => {
    return Object.entries(childrenById).map(([childSessionId, v]) => ({
      childSessionId,
      ...v,
    }));
  }, [childrenById]);

  // Persisted children (reconstructable after restart from backend index).
  const persistedChildren = useMemo(() => {
    return chats
      .filter((c) => c.kind === "child" && c.parentSessionId === parentSessionId)
      .sort((a, b) => {
        const aTime = Date.parse(a.updatedAt || "") || 0;
        const bTime = Date.parse(b.updatedAt || "") || 0;
        return bTime - aTime;
      });
  }, [chats, parentSessionId]);

  const mergedItems = useMemo(() => {
    const progressById = new Map(progressItems.map((x) => [x.childSessionId, x]));
    const out: Array<{
      childSessionId: string;
      title?: string;
      status?: string;
      error?: string;
      lastHeartbeatAt?: string;
      lastEventAt?: string;
      outputPreview?: string;
      pinned?: boolean;
      updatedAt?: string;
      isRunning?: boolean;
      messageCount?: number;
      lastRunStatus?: string;
      lastRunError?: string;
      subagentType?: string | null;
      roundCount?: number;
    }> = [];

    for (const child of persistedChildren) {
      const p = progressById.get(child.id);
      out.push({
        childSessionId: child.id,
        title: child.title || p?.title,
        status: normalizeSubAgentStatus(deriveFallbackStatus(child, p?.status)),
        error: p?.error || child.lastRunError,
        lastHeartbeatAt: p?.lastHeartbeatAt,
        lastEventAt: p?.lastEventAt,
        outputPreview: p?.outputPreview,
        roundCount: p?.roundCount,
        pinned: child.pinned,
        updatedAt: child.updatedAt,
        isRunning: child.isRunning,
        messageCount: child.messageCount,
        lastRunStatus: child.lastRunStatus,
        lastRunError: child.lastRunError,
        subagentType: child.subagentType ?? null,
      });
      progressById.delete(child.id);
    }

    // Include progress-only entries (rare; e.g. list hasn't refreshed yet).
    for (const p of progressById.values()) {
      out.push({
        childSessionId: p.childSessionId,
        title: p.title,
        status: normalizeSubAgentStatus(p.status),
        error: p.error,
        lastHeartbeatAt: p.lastHeartbeatAt,
        lastEventAt: p.lastEventAt,
        outputPreview: p.outputPreview,
        roundCount: p.roundCount,
      });
    }

    return out;
  }, [persistedChildren, progressItems]);

  useEffect(() => {
    setIsCollapsed(readCollapsedState(parentSessionId) ?? false);
  }, [parentSessionId]);

  useEffect(() => {
    // Apply default auto-collapse only if user has no persisted preference.
    if (readCollapsedState(parentSessionId) !== null) return;
    setIsCollapsed(mergedItems.length > AUTO_COLLAPSE_CHILD_THRESHOLD);
  }, [parentSessionId, mergedItems.length]);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      persistCollapsedState(parentSessionId, next);
      return next;
    });
  }, [parentSessionId]);

  const toErrorMessage = useCallback(
    (error: unknown): string => {
      if (error instanceof Error && error.message.trim()) {
        return error.message;
      }
      return t("chat.subAgents.runChildFailed");
    },
    [t],
  );

  const runChildSession = useCallback(
    async (childSessionId: string, retryMode: SubAgentRetryMode = "regenerate") => {
      setRetryingChildId(childSessionId);
      applyChildProgress(parentSessionId, childSessionId, {
        status: "running",
        error: undefined,
        lastEventAt: new Date().toISOString(),
      });
      markRetryStart(childSessionId);

      try {
        const executeResult = await toolService.executeTool({
          tool_name: "SubAgent",
          session_id: parentSessionId,
          parameters: [
            { name: "action", value: "run" },
            { name: "child_session_id", value: childSessionId },
            {
              name: "reset_to_last_user",
              value: retryMode === "error_retry" ? "false" : "true",
            },
          ],
        });

        if (!executeResult.success) {
          throw new Error(executeResult.result || "Failed to run sub-agent");
        }

        applyChildProgress(parentSessionId, childSessionId, {
          status: "running",
          error: undefined,
          lastEventAt: new Date().toISOString(),
        });
        await loadChatHistory(childSessionId, { mode: "replace" });
        await refreshChats();
      } catch (error) {
        markSettleTimeout(childSessionId);
        applyChildProgress(parentSessionId, childSessionId, {
          status: "error",
          error: toErrorMessage(error),
          lastEventAt: new Date().toISOString(),
        });
      } finally {
        setRetryingChildId((prev) => (prev === childSessionId ? null : prev));
      }
    },
    [
      loadChatHistory,
      parentSessionId,
      refreshChats,
      markRetryStart,
      markSettleTimeout,
      toErrorMessage,
      applyChildProgress,
    ],
  );

  const continueChildSession = useCallback(
    async (childSessionId: string) => {
      const promptFn = typeof window !== "undefined" ? window.prompt.bind(window) : null;
      if (!promptFn) return;

      const followUp = promptFn(
        "Send a follow-up message to this sub-agent:",
        "Continue from where you left off.",
      );
      if (followUp === null) return;

      const message = followUp.trim();
      if (!message) {
        applyChildProgress(parentSessionId, childSessionId, {
          status: "error",
          error: "Follow-up message cannot be empty.",
          lastEventAt: new Date().toISOString(),
        });
        return;
      }

      setContinuingChildId(childSessionId);
      applyChildProgress(parentSessionId, childSessionId, {
        status: "running",
        error: undefined,
        lastEventAt: new Date().toISOString(),
      });
      markOptimisticStart(childSessionId);

      try {
        const executeResult = await toolService.executeTool({
          tool_name: "SubAgent",
          session_id: parentSessionId,
          parameters: [
            { name: "action", value: "send_message" },
            { name: "child_session_id", value: childSessionId },
            { name: "message", value: message },
            { name: "auto_run", value: "true" },
          ],
        });

        if (!executeResult.success) {
          throw new Error(executeResult.result || "Follow-up failed");
        }

        let optimisticStatus = "running";
        try {
          const payload = JSON.parse(executeResult.result) as {
            status?: string;
          };
          if (payload.status === "pending") {
            optimisticStatus = "pending";
          }
        } catch {
          optimisticStatus = "running";
        }

        applyChildProgress(parentSessionId, childSessionId, {
          status: optimisticStatus,
          error: undefined,
          lastEventAt: new Date().toISOString(),
        });
        await refreshChats();
      } catch (error) {
        markSettleTimeout(childSessionId);
        applyChildProgress(parentSessionId, childSessionId, {
          status: "error",
          error:
            error instanceof Error && error.message.trim()
              ? error.message
              : t("chat.subAgents.continueChildFailed"),
          lastEventAt: new Date().toISOString(),
        });
      } finally {
        setContinuingChildId((prev) => (prev === childSessionId ? null : prev));
      }
    },
    [parentSessionId, refreshChats, markOptimisticStart, markSettleTimeout, applyChildProgress, t],
  );

  const removeChildSession = useCallback(
    async (childSessionId: string) => {
      setDeletingChildId(childSessionId);
      try {
        const deleteResult = await toolService.executeTool({
          tool_name: "SubAgent",
          session_id: parentSessionId,
          parameters: [
            { name: "action", value: "delete" },
            { name: "child_session_id", value: childSessionId },
          ],
        });

        if (!deleteResult.success) {
          throw new Error(deleteResult.result || "Failed to delete sub-agent");
        }

        clearChildProgress(parentSessionId, childSessionId);
        await refreshChats();
      } finally {
        setDeletingChildId((prev) => (prev === childSessionId ? null : prev));
      }
    },
    [clearChildProgress, parentSessionId, refreshChats],
  );

  if (mergedItems.length === 0) return null;

  const headerTitle = (
    <Text strong>
      {t("chat.subAgents.title")} <Text type="secondary">({mergedItems.length})</Text>
    </Text>
  );

  const compactItemTagStyle = compact
    ? { marginInlineEnd: 0, flex: "0 0 auto", fontSize: 10, lineHeight: "16px", paddingInline: 6 }
    : { marginInlineEnd: 0, flex: "0 0 auto" };
  const compactActionButtonStyle = compact ? { paddingInline: 0, height: 22 } : undefined;
  const getStatusLabel = (value: string) =>
    value === "running"
      ? t("chat.subAgents.statusRunning")
      : value === "completed"
        ? t("chat.subAgents.statusCompleted")
        : value === "pending"
          ? t("chat.subAgents.statusPending")
          : value === "cancelled"
            ? t("chat.subAgents.statusCancelled")
            : value === "error" || value === "failed"
              ? t("chat.subAgents.statusFailed")
              : value;
  const getStatusColor = (value: string) =>
    value === "running"
      ? token.colorPrimary
      : value === "completed"
        ? token.colorSuccess
        : value === "error" || value === "failed"
          ? token.colorError
          : value === "cancelled"
            ? token.colorWarning
            : token.colorTextSecondary;

  const headerExtra = (
    <Button
      type="text"
      size="small"
      icon={isCollapsed ? <DownOutlined /> : <UpOutlined />}
      onClick={toggleCollapsed}
      data-testid="sub-agents-toggle"
      style={compact ? { paddingInline: 4 } : undefined}
    >
      {isCollapsed ? t("chat.subAgents.expand") : t("chat.subAgents.collapse")}
    </Button>
  );

  const listContent = !isCollapsed ? (
    <Flex
      vertical
      gap={compact ? token.marginXS : token.marginSM}
      data-testid="sub-agents-list"
      style={{
        width: "100%",
        minWidth: 0,
        maxHeight: `${SUB_AGENTS_LIST_MAX_HEIGHT_PX}px`,
        overflowY: "auto",
        overflowX: "hidden",
        paddingRight: compact ? 0 : token.paddingXS,
      }}
    >
      {mergedItems.map((it, index) => {
        const status = normalizeSubAgentStatus(it.status);
        const isRunning = status === "running";
        const isRetrying = retryingChildId === it.childSessionId;
        const isContinuing = continuingChildId === it.childSessionId;
        const isDeleting = deletingChildId === it.childSessionId;
        const isBusy = isRetrying || isContinuing || isDeleting;

        return (
          <Flex
            key={it.childSessionId}
            vertical
            gap={compact ? 6 : token.marginSM}
            className={compact ? undefined : "lotus-settings-list-item"}
            style={{
              width: "100%",
              minWidth: 0,
              padding: compact ? `6px 0` : token.paddingSM,
              borderRadius: compact ? 0 : token.borderRadiusSM,
              borderTop:
                compact && index > 0 ? `1px solid ${token.colorBorderSecondary}` : undefined,
              background: compact ? "transparent" : undefined,
            }}
          >
            <Flex vertical style={{ width: "100%", minWidth: 0 }}>
              <Flex align="center" gap={token.marginXS} wrap style={{ width: "100%", minWidth: 0 }}>
                <Text
                  strong
                  ellipsis
                  style={{ minWidth: 0, flex: "1 1 180px", fontSize: compact ? 13 : undefined }}
                >
                  {it.title || t("chat.subAgents.fallbackTitle")}
                </Text>
                {compact ? (
                  <InlineMetaText
                    nowrap
                    items={[
                      <span style={{ color: getStatusColor(status) }}>
                        {getStatusLabel(status)}
                      </span>,
                      it.pinned ? t("chat.subAgents.pinned") : null,
                      renderSubagentTypeTag(it.subagentType, subagentProfilesById, {
                        compact: true,
                      }),
                    ]}
                  />
                ) : (
                  <>
                    <Tag
                      color={
                        status === "running"
                          ? "processing"
                          : status === "completed"
                            ? "success"
                            : status === "error" || status === "failed"
                              ? "error"
                              : status === "cancelled"
                                ? "warning"
                                : "default"
                      }
                      style={compactItemTagStyle}
                    >
                      {getStatusLabel(status)}
                    </Tag>
                    {it.pinned ? (
                      <Tag color="warning" style={compactItemTagStyle}>
                        {t("chat.subAgents.pinned")}
                      </Tag>
                    ) : null}
                    {renderSubagentTypeTag(it.subagentType, subagentProfilesById)}
                  </>
                )}
              </Flex>

              {compact ? (
                <InlineMetaText
                  block
                  items={[
                    it.childSessionId.slice(0, 8),
                    it.updatedAt,
                    it.lastHeartbeatAt
                      ? `${t("chat.subAgents.heartbeat")}: ${it.lastHeartbeatAt}`
                      : null,
                    typeof it.roundCount === "number"
                      ? `${t("chat.subAgents.round")} ${it.roundCount + 1}`
                      : null,
                  ]}
                />
              ) : (
                <Text
                  type="secondary"
                  style={{
                    display: "block",
                    minWidth: 0,
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  {it.childSessionId.slice(0, 8)}
                  {it.updatedAt ? ` • ${it.updatedAt}` : ""}
                  {it.lastHeartbeatAt
                    ? ` • ${t("chat.subAgents.heartbeat")}: ${it.lastHeartbeatAt}`
                    : ""}
                  {typeof it.roundCount === "number"
                    ? ` • ${t("chat.subAgents.round")} ${it.roundCount + 1}`
                    : ""}
                </Text>
              )}

              {it.outputPreview ? (
                <Text
                  type="secondary"
                  style={{
                    display: "block",
                    minWidth: 0,
                    marginTop: compact ? 4 : token.marginXS,
                    fontSize: compact ? 11 : 13,
                    lineHeight: compact ? 1.35 : undefined,
                  }}
                  ellipsis
                >
                  {it.outputPreview}
                </Text>
              ) : null}

              {it.error ? (
                <Text
                  type="danger"
                  style={{
                    display: "block",
                    minWidth: 0,
                    marginTop: compact ? 4 : token.marginXS,
                    fontSize: compact ? 11 : undefined,
                    lineHeight: compact ? 1.35 : undefined,
                  }}
                >
                  {it.error}
                </Text>
              ) : null}
            </Flex>

            <Flex
              gap={compact ? 4 : 8}
              wrap
              style={{ width: "100%", minWidth: 0, paddingTop: compact ? 2 : 0 }}
            >
              <Button
                size="small"
                type={compact ? "text" : "default"}
                style={compactActionButtonStyle}
                disabled={isBusy}
                onClick={() => {
                  openSession(it.childSessionId);
                  void loadChatHistory(it.childSessionId);
                }}
              >
                {t("chat.subAgents.open")}
              </Button>
              <Button
                size="small"
                type={compact ? "text" : "default"}
                style={compactActionButtonStyle}
                loading={isContinuing}
                disabled={isDeleting || isRetrying || isRunning}
                data-testid={`sub-agent-continue-${it.childSessionId}`}
                onClick={() => {
                  void continueChildSession(it.childSessionId);
                }}
              >
                {t("chat.subAgents.continue")}
              </Button>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "regenerate",
                      label: t("chat.actions.regenerate"),
                    },
                    {
                      key: "error_retry",
                      label: t("chat.actions.retryFailed"),
                    },
                  ],
                  onClick: ({ key }) => {
                    void runChildSession(it.childSessionId, key as SubAgentRetryMode);
                  },
                }}
                disabled={isDeleting || isRunning || isContinuing}
              >
                <Button
                  size="small"
                  type={compact ? "text" : "default"}
                  style={compactActionButtonStyle}
                  loading={isRetrying}
                  disabled={isDeleting || isRunning || isContinuing}
                  data-testid={`sub-agent-retry-${it.childSessionId}`}
                >
                  {t("chat.subAgents.retry")}
                </Button>
              </Dropdown>
              {typeof it.pinned === "boolean" ? (
                <Button
                  size="small"
                  type={compact ? "text" : "default"}
                  style={compactActionButtonStyle}
                  disabled={isBusy}
                  onClick={() => {
                    if (it.pinned) unpinSession(it.childSessionId);
                    else pinSession(it.childSessionId);
                  }}
                >
                  {it.pinned ? t("chat.actions.unpin") : t("chat.actions.pin")}
                </Button>
              ) : null}
              <Button
                danger
                type={compact ? "text" : "default"}
                style={compactActionButtonStyle}
                size="small"
                loading={isDeleting}
                disabled={isRetrying}
                data-testid={`sub-agent-delete-${it.childSessionId}`}
                onClick={() => {
                  void removeChildSession(it.childSessionId);
                }}
              >
                {t("common.delete")}
              </Button>
            </Flex>
          </Flex>
        );
      })}
    </Flex>
  ) : (
    <Text type="secondary" data-testid="sub-agents-collapsed-hint">
      {t("chat.subAgents.hiddenHint", { count: mergedItems.length })}
    </Text>
  );

  const footer =
    !isCollapsed && mergedItems.length > 1 ? <SubAgentsSummaryFooter items={mergedItems} /> : null;

  if (compact) {
    return (
      <section
        data-testid="sub-agents-panel"
        style={{
          width: "100%",
          minWidth: 0,
          marginBottom: token.marginXS,
          overflow: "hidden",
        }}
      >
        <Flex
          align="center"
          justify="space-between"
          gap={token.marginXS}
          style={{
            padding: `${token.paddingXXS ?? 2}px 0 ${token.paddingXS}px`,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>{headerTitle}</div>
          <div style={{ flex: "0 0 auto" }}>{headerExtra}</div>
        </Flex>
        <div style={{ padding: `${token.paddingXS}px 0 0` }}>
          {listContent}
          {footer}
        </div>
      </section>
    );
  }

  return (
    <Card
      size="small"
      className="lotus-settings-card"
      style={{ marginBottom: token.marginMD }}
      data-testid="sub-agents-panel"
      title={headerTitle}
      extra={headerExtra}
    >
      {listContent}
      {footer}
    </Card>
  );
};

/** Compact summary of sub-agent statuses. */
const SubAgentsSummaryFooter: React.FC<{ items: Array<{ status?: string }> }> = ({ items }) => {
  const { token } = useToken();
  const { t } = useTranslation();
  const counts = items.reduce(
    (acc, it) => {
      const s = normalizeSubAgentStatus(it.status);
      if (s === "completed") acc.completed++;
      else if (s === "running") acc.running++;
      else if (s === "error" || s === "failed") acc.error++;
      else acc.pending++;
      return acc;
    },
    { completed: 0, running: 0, error: 0, pending: 0 },
  );
  const parts: string[] = [];
  if (counts.completed > 0)
    parts.push(t("chat.subAgents.summaryCompleted", { count: counts.completed }));
  if (counts.running > 0) parts.push(t("chat.subAgents.summaryRunning", { count: counts.running }));
  if (counts.pending > 0) parts.push(t("chat.subAgents.summaryPending", { count: counts.pending }));
  if (counts.error > 0) parts.push(t("chat.subAgents.summaryFailed", { count: counts.error }));
  if (parts.length === 0) return null;
  return <InlineMetaText block items={parts} style={{ marginTop: token.marginXS }} />;
};
