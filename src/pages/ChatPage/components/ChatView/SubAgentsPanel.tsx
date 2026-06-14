import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { App as AntApp, Button, Card, Flex, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";

import { selectChildren, useAppStore } from "@shared/store/appStore";
import { openSession } from "@shared/utils/openSession";
import { toolService } from "@services/tool/ToolService";
import { useSubagentProfiles } from "../../hooks/useSubagentProfiles";
import InlineMetaText from "@shared/components/InlineMetaText";
import { SubAgentRow, type SubAgentRetryMode, type SubAgentRowData } from "./SubAgentRow";

const { Text } = Typography;
const { useToken } = theme;
const SUB_AGENTS_COLLAPSE_STORAGE_KEY_PREFIX = "chat-session-sub-agents-collapsed:";
// Completed children are shown inline only when there are few of them; beyond
// this they fold behind a "Completed (N)" toggle so the panel stays focused on
// active work. Active children are ALWAYS shown regardless of this.
const COMPLETED_INLINE_MAX = 3;
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

const ACTIVE_SUB_AGENT_STATUSES = new Set(["running", "pending"]);

const isActiveSubAgentStatus = (status?: string): boolean =>
  ACTIVE_SUB_AGENT_STATUSES.has(normalizeSubAgentStatus(status));

/**
 * Sort by creation time descending (newest first). Unlike `lastEventAt` /
 * `updatedAt`, `createdAt` never changes as a child updates its content, so
 * the sub-agent list order stays stable instead of reshuffling on every
 * progress event. Stable tiebreak on `childSessionId` for deterministic order.
 */
const compareByCreatedAt = (a: MergedSubAgentItem, b: MergedSubAgentItem): number => {
  const byTime = (b.createdAt ?? 0) - (a.createdAt ?? 0);
  if (byTime !== 0) return byTime;
  return a.childSessionId.localeCompare(b.childSessionId);
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

type MergedSubAgentItem = SubAgentRowData;

const areMergedItemsEqual = (a: MergedSubAgentItem, b: MergedSubAgentItem): boolean =>
  a.childSessionId === b.childSessionId &&
  a.title === b.title &&
  a.status === b.status &&
  a.error === b.error &&
  a.lastHeartbeatAt === b.lastHeartbeatAt &&
  a.lastEventAt === b.lastEventAt &&
  a.outputPreview === b.outputPreview &&
  a.pinned === b.pinned &&
  a.updatedAt === b.updatedAt &&
  a.createdAt === b.createdAt &&
  a.isRunning === b.isRunning &&
  a.messageCount === b.messageCount &&
  a.lastRunStatus === b.lastRunStatus &&
  a.lastRunError === b.lastRunError &&
  a.subagentType === b.subagentType &&
  a.roundCount === b.roundCount &&
  a.lifecycle === b.lifecycle &&
  a.residentName === b.residentName;

export const SubAgentsPanel: React.FC<SubAgentsPanelProps> = ({
  parentSessionId,
  compact = false,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const { message } = AntApp.useApp();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    () => readCollapsedState(parentSessionId) ?? false,
  );
  const [retryingChildId, setRetryingChildId] = useState<string | null>(null);
  const [continuingChildId, setContinuingChildId] = useState<string | null>(null);
  const [deletingChildId, setDeletingChildId] = useState<string | null>(null);
  // Completed/cancelled/errored children are folded away by default so the panel
  // stays focused on what is actively running — they expand on demand.
  const [showCompleted, setShowCompleted] = useState<boolean>(false);

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

  const { byId: subagentProfilesById } = useSubagentProfiles();
  const previousMergedItemsByIdRef = useRef<Map<string, MergedSubAgentItem>>(new Map());

  const progressItems = useMemo(() => {
    return Object.entries(childrenById).map(([childSessionId, v]) => ({
      childSessionId,
      ...v,
    }));
  }, [childrenById]);

  const persistedChildren = useMemo(() => {
    return chats
      .filter((c) => c.kind === "child" && c.parentSessionId === parentSessionId)
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [chats, parentSessionId]);

  const mergedItems = useMemo(() => {
    const progressById = new Map(progressItems.map((x) => [x.childSessionId, x]));
    const previousById = previousMergedItemsByIdRef.current;
    const out: MergedSubAgentItem[] = [];

    for (const child of persistedChildren) {
      const p = progressById.get(child.id);
      const nextItem: MergedSubAgentItem = {
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
        createdAt: child.createdAt,
        isRunning: child.isRunning,
        messageCount: child.messageCount,
        lastRunStatus: child.lastRunStatus,
        lastRunError: child.lastRunError,
        subagentType: child.subagentType ?? null,
        lifecycle: child.lifecycle ?? null,
        residentName: child.residentName ?? null,
      };
      const previous = previousById.get(child.id);
      out.push(previous && areMergedItemsEqual(previous, nextItem) ? previous : nextItem);
      progressById.delete(child.id);
    }

    for (const p of progressById.values()) {
      const nextItem: MergedSubAgentItem = {
        childSessionId: p.childSessionId,
        title: p.title,
        status: normalizeSubAgentStatus(p.status),
        error: p.error,
        lastHeartbeatAt: p.lastHeartbeatAt,
        lastEventAt: p.lastEventAt,
        outputPreview: p.outputPreview,
        roundCount: p.roundCount,
        // Progress-only children haven't been persisted yet — treat them as
        // just-created so they appear at the top (newest first).
        createdAt: Date.now(),
      };
      const previous = previousById.get(p.childSessionId);
      out.push(previous && areMergedItemsEqual(previous, nextItem) ? previous : nextItem);
    }

    previousMergedItemsByIdRef.current = new Map(out.map((item) => [item.childSessionId, item]));
    return out;
  }, [persistedChildren, progressItems]);

  // Concentrate the panel: resident agents are stable, always-visible entries
  // (one per reusable agent); the remaining one-shot children split into active
  // (running/pending, front-and-center) and completed (folded behind a count).
  const { residentItems, activeItems, completedItems } = useMemo(() => {
    const resident: MergedSubAgentItem[] = [];
    const active: MergedSubAgentItem[] = [];
    const completed: MergedSubAgentItem[] = [];
    for (const it of mergedItems) {
      if (it.lifecycle === "resident") resident.push(it);
      else if (isActiveSubAgentStatus(it.status)) active.push(it);
      else completed.push(it);
    }
    resident.sort(compareByCreatedAt);
    active.sort(compareByCreatedAt);
    completed.sort(compareByCreatedAt);
    return { residentItems: resident, activeItems: active, completedItems: completed };
  }, [mergedItems]);

  // Only an explicit, persisted user preference collapses the whole panel. We no
  // longer auto-collapse on child count: that hid actively-running children
  // (the whole point of the panel) behind an "N hidden" line. Concentration is
  // handled instead by folding only COMPLETED children below.
  useEffect(() => {
    setIsCollapsed(readCollapsedState(parentSessionId) ?? false);
  }, [parentSessionId]);

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

      const text = followUp.trim();
      if (!text) {
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
            { name: "message", value: text },
            { name: "auto_run", value: "true" },
          ],
        });

        if (!executeResult.success) {
          throw new Error(executeResult.result || "Follow-up failed");
        }

        let optimisticStatus = "running";
        try {
          const payload = JSON.parse(executeResult.result) as { status?: string };
          if (payload.status === "message_delivered_live") {
            optimisticStatus = "running";
            message.success(t("chat.subAgents.steeredLive"));
          } else if (payload.status === "message_queued") {
            optimisticStatus = "pending";
            message.info(t("chat.subAgents.queuedNextTurn"));
          } else if (payload.status === "pending") {
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
    [
      parentSessionId,
      refreshChats,
      markOptimisticStart,
      markSettleTimeout,
      applyChildProgress,
      t,
      message,
    ],
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

  const handleOpenChild = useCallback(
    (childSessionId: string) => {
      openSession(childSessionId);
      void loadChatHistory(childSessionId);
    },
    [loadChatHistory],
  );

  const handleContinueChild = useCallback(
    (childSessionId: string) => {
      void continueChildSession(childSessionId);
    },
    [continueChildSession],
  );

  const handleRetryChild = useCallback(
    (childSessionId: string, retryMode: SubAgentRetryMode) => {
      void runChildSession(childSessionId, retryMode);
    },
    [runChildSession],
  );

  const handleTogglePin = useCallback(
    (childSessionId: string, pinned?: boolean) => {
      if (pinned) unpinSession(childSessionId);
      else pinSession(childSessionId);
    },
    [pinSession, unpinSession],
  );

  const handleDeleteChild = useCallback(
    (childSessionId: string) => {
      void removeChildSession(childSessionId);
    },
    [removeChildSession],
  );

  if (mergedItems.length === 0) return null;

  const headerTitle = (
    <Text strong>
      {t("chat.subAgents.title")}{" "}
      <Text type="secondary">
        {activeItems.length > 0
          ? t("chat.subAgents.headerCount", {
              active: activeItems.length,
              total: mergedItems.length,
            })
          : `(${mergedItems.length})`}
      </Text>
    </Text>
  );

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

  const renderRow = (it: MergedSubAgentItem, index: number) => (
    <SubAgentRow
      key={it.childSessionId}
      parentSessionId={parentSessionId}
      item={it}
      index={index}
      compact={compact}
      isRetrying={retryingChildId === it.childSessionId}
      isContinuing={continuingChildId === it.childSessionId}
      isDeleting={deletingChildId === it.childSessionId}
      subagentProfilesById={subagentProfilesById}
      onOpenChild={handleOpenChild}
      onContinueChild={handleContinueChild}
      onRetryChild={handleRetryChild}
      onTogglePin={handleTogglePin}
      onDeleteChild={handleDeleteChild}
    />
  );

  // Show completed inline when there are only a few; fold behind a count only
  // when there are genuinely many. (Previously this also folded when ANY child
  // was active, which hid even a single just-finished sibling behind a
  // "Completed (1)" toggle — over-aggressive. Concentration is about volume,
  // not the mere presence of active work.)
  const completedInline = completedItems.length <= COMPLETED_INLINE_MAX;

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
      {residentItems.length > 0 ? (
        <>
          <Text
            type="secondary"
            data-testid="sub-agents-resident-label"
            style={{ fontSize: 12, opacity: 0.75 }}
          >
            {t("chat.subAgents.residentGroup", { count: residentItems.length })}
          </Text>
          {residentItems.map((it, index) => renderRow(it, index))}
        </>
      ) : null}

      {activeItems.length > 0 ? (
        activeItems.map((it, index) => renderRow(it, index))
      ) : residentItems.length === 0 && completedItems.length > 0 && !completedInline ? (
        <Text type="secondary" data-testid="sub-agents-no-active">
          {t("chat.subAgents.noActive")}
        </Text>
      ) : null}

      {completedItems.length > 0 ? (
        completedInline ? (
          completedItems.map((it, index) => renderRow(it, index))
        ) : (
          <>
            <Button
              type="text"
              size="small"
              data-testid="sub-agents-completed-toggle"
              icon={showCompleted ? <UpOutlined /> : <DownOutlined />}
              onClick={() => setShowCompleted((prev) => !prev)}
              style={{
                alignSelf: "flex-start",
                paddingInline: 4,
                color: token.colorTextSecondary,
              }}
            >
              {t("chat.subAgents.completedGroup", { count: completedItems.length })}
            </Button>
            {showCompleted ? completedItems.map((it, index) => renderRow(it, index)) : null}
          </>
        )
      ) : null}
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
      else if (s === "cancelled") acc.cancelled++;
      else acc.pending++;
      return acc;
    },
    { completed: 0, running: 0, error: 0, pending: 0, cancelled: 0 },
  );
  const parts: string[] = [];
  if (counts.completed > 0)
    parts.push(t("chat.subAgents.summaryCompleted", { count: counts.completed }));
  if (counts.running > 0) parts.push(t("chat.subAgents.summaryRunning", { count: counts.running }));
  if (counts.pending > 0) parts.push(t("chat.subAgents.summaryPending", { count: counts.pending }));
  if (counts.cancelled > 0)
    parts.push(`${counts.cancelled} ${t("chat.subAgents.statusCancelled")}`);
  if (counts.error > 0) parts.push(t("chat.subAgents.summaryFailed", { count: counts.error }));
  if (parts.length === 0) return null;
  return <InlineMetaText block items={parts} style={{ marginTop: token.marginXS }} />;
};
