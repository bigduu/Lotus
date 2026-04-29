import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { Button, Card, Dropdown, Flex, Tag, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";

import { useAppStore } from "../../store";
import { openSession } from "../../utils/openSession";
import { toolService } from "../../../../services/tool/ToolService";
import { useSubagentProfiles } from "../../../../hooks/useSubagentProfiles";
import { renderSubagentTypeTag } from "./renderSubagentTypeTag";

const { Text } = Typography;
const { useToken } = theme;
const SUB_SESSIONS_COLLAPSE_STORAGE_KEY_PREFIX = "chat-session-sub-sessions-collapsed:";
const AUTO_COLLAPSE_CHILD_THRESHOLD = 3;
const SUB_SESSIONS_LIST_MAX_HEIGHT_PX = 600;

const normalizeSubSessionStatus = (status?: string): string => {
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

const getSubSessionsCollapseStorageKey = (parentSessionId: string) =>
  `${SUB_SESSIONS_COLLAPSE_STORAGE_KEY_PREFIX}${parentSessionId}`;

const readCollapsedState = (parentSessionId: string): boolean | null => {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(getSubSessionsCollapseStorageKey(parentSessionId));
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
      getSubSessionsCollapseStorageKey(parentSessionId),
      isCollapsed ? "1" : "0",
    );
  } catch {}
};

export interface SubSessionsPanelProps {
  parentSessionId: string;
}

type SubSessionRetryMode = "regenerate" | "error_retry";

export const SubSessionsPanel: React.FC<SubSessionsPanelProps> = ({ parentSessionId }) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    () => readCollapsedState(parentSessionId) ?? false,
  );
  const [retryingChildId, setRetryingChildId] = useState<string | null>(null);
  const [continuingChildId, setContinuingChildId] = useState<string | null>(null);
  const [deletingChildId, setDeletingChildId] = useState<string | null>(null);

  const subSessionsByParent = useAppStore((s) => s.subSessionsByParent);
  const chats = useAppStore((s) => s.chats);
  const loadChatHistory = useAppStore((s) => s.loadChatHistory);
  const refreshChats = useAppStore((s) => s.refreshChats);
  const setSessionProcessing = useAppStore((s) => s.setSessionProcessing);
  const pinSession = useAppStore((s) => s.pinSession);
  const unpinSession = useAppStore((s) => s.unpinSession);
  const upsertSubSessionProgress = useAppStore((s) => s.upsertSubSessionProgress);
  const clearSubSessionProgress = useAppStore((s) => s.clearSubSessionProgress);

  // Lazy-loaded subagent profile catalogue. Used to resolve a child's
  // `subagent_type` id (e.g. "plan") into a display name + ui hints
  // (icon/color). Failures are silent — we just fall back to the raw id.
  const { byId: subagentProfilesById } = useSubagentProfiles();

  // In-memory progress (lost on restart).
  const progressItems = useMemo(() => {
    const map = subSessionsByParent[parentSessionId] || {};
    return Object.entries(map).map(([childSessionId, v]) => ({
      childSessionId,
      ...v,
    }));
  }, [parentSessionId, subSessionsByParent]);

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
    }> = [];

    for (const child of persistedChildren) {
      const p = progressById.get(child.id);
      out.push({
        childSessionId: child.id,
        title: child.title || p?.title,
        status: normalizeSubSessionStatus(deriveFallbackStatus(child, p?.status)),
        error: p?.error || child.lastRunError,
        lastHeartbeatAt: p?.lastHeartbeatAt,
        lastEventAt: p?.lastEventAt,
        outputPreview: p?.outputPreview,
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
        status: normalizeSubSessionStatus(p.status),
        error: p.error,
        lastHeartbeatAt: p.lastHeartbeatAt,
        lastEventAt: p.lastEventAt,
        outputPreview: p.outputPreview,
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

  const toErrorMessage = useCallback((error: unknown): string => {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }
    return "Failed to run child session";
  }, []);

  const runChildSession = useCallback(
    async (childSessionId: string, retryMode: SubSessionRetryMode = "regenerate") => {
      setRetryingChildId(childSessionId);
      upsertSubSessionProgress(parentSessionId, childSessionId, {
        status: "running",
        error: undefined,
        lastEventAt: new Date().toISOString(),
      });
      setSessionProcessing(childSessionId, true);

      try {
        const executeResult = await toolService.executeTool({
          tool_name: "SubSession",
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
          throw new Error(executeResult.result || "Failed to run child session");
        }

        upsertSubSessionProgress(parentSessionId, childSessionId, {
          status: "running",
          error: undefined,
          lastEventAt: new Date().toISOString(),
        });
        await loadChatHistory(childSessionId, { mode: "replace" });
        await refreshChats();
      } catch (error) {
        setSessionProcessing(childSessionId, false);
        upsertSubSessionProgress(parentSessionId, childSessionId, {
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
      setSessionProcessing,
      toErrorMessage,
      upsertSubSessionProgress,
    ],
  );

  const continueChildSession = useCallback(
    async (childSessionId: string) => {
      const promptFn = typeof window !== "undefined" ? window.prompt.bind(window) : null;
      if (!promptFn) return;

      const followUp = promptFn(
        "Send a follow-up message to this child session:",
        "Continue from where you left off.",
      );
      if (followUp === null) return;

      const message = followUp.trim();
      if (!message) {
        upsertSubSessionProgress(parentSessionId, childSessionId, {
          status: "error",
          error: "Follow-up message cannot be empty.",
          lastEventAt: new Date().toISOString(),
        });
        return;
      }

      setContinuingChildId(childSessionId);
      upsertSubSessionProgress(parentSessionId, childSessionId, {
        status: "running",
        error: undefined,
        lastEventAt: new Date().toISOString(),
      });
      setSessionProcessing(childSessionId, true);

      try {
        const executeResult = await toolService.executeTool({
          tool_name: "SubSession",
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

        upsertSubSessionProgress(parentSessionId, childSessionId, {
          status: optimisticStatus,
          error: undefined,
          lastEventAt: new Date().toISOString(),
        });
        await refreshChats();
      } catch (error) {
        setSessionProcessing(childSessionId, false);
        upsertSubSessionProgress(parentSessionId, childSessionId, {
          status: "error",
          error:
            error instanceof Error && error.message.trim()
              ? error.message
              : "Failed to continue child session",
          lastEventAt: new Date().toISOString(),
        });
      } finally {
        setContinuingChildId((prev) => (prev === childSessionId ? null : prev));
      }
    },
    [parentSessionId, refreshChats, setSessionProcessing, upsertSubSessionProgress],
  );

  const removeChildSession = useCallback(
    async (childSessionId: string) => {
      setDeletingChildId(childSessionId);
      try {
        const deleteResult = await toolService.executeTool({
          tool_name: "SubSession",
          session_id: parentSessionId,
          parameters: [
            { name: "action", value: "delete" },
            { name: "child_session_id", value: childSessionId },
          ],
        });

        if (!deleteResult.success) {
          throw new Error(deleteResult.result || "Failed to delete child session");
        }

        clearSubSessionProgress(parentSessionId, childSessionId);
        await refreshChats();
      } finally {
        setDeletingChildId((prev) => (prev === childSessionId ? null : prev));
      }
    },
    [clearSubSessionProgress, parentSessionId, refreshChats],
  );

  if (mergedItems.length === 0) return null;

  return (
    <Card
      size="small"
      className="lotus-settings-card"
      style={{ marginBottom: token.marginMD }}
      data-testid="sub-sessions-panel"
      title={
        <Text strong>
          {t("chat.subSessions.title")} <Text type="secondary">({mergedItems.length})</Text>
        </Text>
      }
      extra={
        <Button
          type="text"
          size="small"
          icon={isCollapsed ? <DownOutlined /> : <UpOutlined />}
          onClick={toggleCollapsed}
          data-testid="sub-sessions-toggle"
        >
          {isCollapsed ? t("chat.subSessions.expand") : t("chat.subSessions.collapse")}
        </Button>
      }
    >
      {!isCollapsed ? (
        <Flex
          vertical
          gap={token.marginSM}
          data-testid="sub-sessions-list"
          style={{
            maxHeight: `${SUB_SESSIONS_LIST_MAX_HEIGHT_PX}px`,
            overflowY: "auto",
            paddingRight: token.paddingXS,
          }}
        >
          {mergedItems.map((it) => {
            const status = normalizeSubSessionStatus(it.status);
            const isRunning = status === "running";
            const isRetrying = retryingChildId === it.childSessionId;
            const isContinuing = continuingChildId === it.childSessionId;
            const isDeleting = deletingChildId === it.childSessionId;
            const isBusy = isRetrying || isContinuing || isDeleting;

            return (
              <Flex
                key={it.childSessionId}
                align="flex-start"
                justify="space-between"
                gap={token.marginSM}
                className="lotus-settings-list-item"
                style={{
                  padding: token.paddingSM,
                  borderRadius: token.borderRadiusSM,
                }}
              >
                <Flex vertical style={{ flex: 1, minWidth: 0 }}>
                  <Flex align="center" gap={token.marginXS} style={{ minWidth: 0 }}>
                    <Text strong ellipsis style={{ minWidth: 0 }}>
                      {it.title || "Child Session"}
                    </Text>
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
                      style={{ marginInlineEnd: 0, flex: "0 0 auto" }}
                    >
                      {status}
                    </Tag>
                    {it.pinned ? (
                      <Tag color="warning" style={{ marginInlineEnd: 0, flex: "0 0 auto" }}>
                        Pinned
                      </Tag>
                    ) : null}
                    {renderSubagentTypeTag(it.subagentType, subagentProfilesById)}
                  </Flex>

                  <Text type="secondary" style={{ fontSize: 12, marginTop: 2 }}>
                    {it.childSessionId.slice(0, 8)}
                    {it.updatedAt ? ` • ${it.updatedAt}` : ""}
                    {it.lastHeartbeatAt ? ` • heartbeat: ${it.lastHeartbeatAt}` : ""}
                  </Text>

                  {it.outputPreview ? (
                    <Text
                      type="secondary"
                      style={{ marginTop: token.marginXS, fontSize: 13 }}
                      ellipsis
                    >
                      {it.outputPreview}
                    </Text>
                  ) : null}

                  {it.error ? (
                    <Text type="danger" style={{ marginTop: token.marginXS }}>
                      {it.error}
                    </Text>
                  ) : null}
                </Flex>

                <Flex gap={8}>
                  <Button
                    size="small"
                    disabled={isBusy}
                    onClick={() => {
                      openSession(it.childSessionId);
                      void loadChatHistory(it.childSessionId);
                    }}
                  >
                    {t("chat.subSessions.open")}
                  </Button>
                  <Button
                    size="small"
                    loading={isContinuing}
                    disabled={isDeleting || isRetrying || isRunning}
                    data-testid={`sub-session-continue-${it.childSessionId}`}
                    onClick={() => {
                      void continueChildSession(it.childSessionId);
                    }}
                  >
                    {t("chat.subSessions.continue")}
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
                        void runChildSession(it.childSessionId, key as SubSessionRetryMode);
                      },
                    }}
                    disabled={isDeleting || isRunning || isContinuing}
                  >
                    <Button
                      size="small"
                      loading={isRetrying}
                      disabled={isDeleting || isRunning || isContinuing}
                      data-testid={`sub-session-retry-${it.childSessionId}`}
                    >
                      {t("chat.subSessions.retry")}
                    </Button>
                  </Dropdown>
                  {typeof it.pinned === "boolean" ? (
                    <Button
                      size="small"
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
                    size="small"
                    loading={isDeleting}
                    disabled={isRetrying}
                    data-testid={`sub-session-delete-${it.childSessionId}`}
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
        <Text type="secondary" data-testid="sub-sessions-collapsed-hint">
          {t("chat.subSessions.hiddenHint", { count: mergedItems.length })}
        </Text>
      )}
      {!isCollapsed && mergedItems.length > 1 && <SubSessionsSummaryFooter items={mergedItems} />}
    </Card>
  );
};

/** Compact summary of child session statuses. */
const SubSessionsSummaryFooter: React.FC<{ items: Array<{ status?: string }> }> = ({ items }) => {
  const { token } = useToken();
  const counts = items.reduce(
    (acc, it) => {
      const s = normalizeSubSessionStatus(it.status);
      if (s === "completed") acc.completed++;
      else if (s === "running") acc.running++;
      else if (s === "error" || s === "failed") acc.error++;
      else acc.pending++;
      return acc;
    },
    { completed: 0, running: 0, error: 0, pending: 0 },
  );
  const parts: string[] = [];
  if (counts.completed > 0) parts.push(`${counts.completed} completed`);
  if (counts.running > 0) parts.push(`${counts.running} running`);
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  if (counts.error > 0) parts.push(`${counts.error} failed`);
  if (parts.length === 0) return null;
  return (
    <Text type="secondary" style={{ fontSize: 11, marginTop: token.marginXS, display: "block" }}>
      {parts.join(" · ")}
    </Text>
  );
};
