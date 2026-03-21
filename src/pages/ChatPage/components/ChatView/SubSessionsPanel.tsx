import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { Button, Card, Dropdown, Flex, Tag, Typography, theme } from "antd";

import { useAppStore } from "../../store";
import { useActiveModel } from "../../hooks/useActiveModel";
import { agentClient } from "../../services/AgentService";
import { openSession } from "../../utils/openSession";
import { toolService } from "../../../../services/tool/ToolService";

const { Text } = Typography;
const { useToken } = theme;
const SUB_SESSIONS_COLLAPSE_STORAGE_KEY_PREFIX =
  "chat-session-sub-sessions-collapsed:";
const AUTO_COLLAPSE_CHILD_THRESHOLD = 3;
const SUB_SESSIONS_LIST_MAX_HEIGHT_PX = 420;

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
    const raw = window.localStorage.getItem(
      getSubSessionsCollapseStorageKey(parentSessionId),
    );
    if (raw === "1") return true;
    if (raw === "0") return false;
    return null;
  } catch {
    return null;
  }
};

const persistCollapsedState = (
  parentSessionId: string,
  isCollapsed: boolean,
) => {
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

export const SubSessionsPanel: React.FC<SubSessionsPanelProps> = ({
  parentSessionId,
}) => {
  const { token } = useToken();
  const activeModel = useActiveModel();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(
    () => readCollapsedState(parentSessionId) ?? false,
  );
  const [retryingChildId, setRetryingChildId] = useState<string | null>(null);
  const [continuingChildId, setContinuingChildId] = useState<string | null>(
    null,
  );
  const [deletingChildId, setDeletingChildId] = useState<string | null>(null);

  const subSessionsByParent = useAppStore((s) => s.subSessionsByParent);
  const chats = useAppStore((s) => s.chats);
  const loadChatHistory = useAppStore((s) => s.loadChatHistory);
  const refreshChats = useAppStore((s) => s.refreshChats);
  const setSessionProcessing = useAppStore((s) => s.setSessionProcessing);
  const pinSession = useAppStore((s) => s.pinSession);
  const unpinSession = useAppStore((s) => s.unpinSession);
  const deleteSession = useAppStore((s) => s.deleteSession);
  const upsertSubSessionProgress = useAppStore(
    (s) => s.upsertSubSessionProgress,
  );
  const clearSubSessionProgress = useAppStore((s) => s.clearSubSessionProgress);

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
      .filter(
        (c) => c.kind === "child" && c.parentSessionId === parentSessionId,
      )
      .sort((a, b) => {
        const aTime = Date.parse(a.updatedAt || "") || 0;
        const bTime = Date.parse(b.updatedAt || "") || 0;
        return bTime - aTime;
      });
  }, [chats, parentSessionId]);

  const mergedItems = useMemo(() => {
    const progressById = new Map(
      progressItems.map((x) => [x.childSessionId, x]),
    );
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
    }> = [];

    for (const child of persistedChildren) {
      const p = progressById.get(child.id);
      out.push({
        childSessionId: child.id,
        title: p?.title || child.title,
        status: normalizeSubSessionStatus(
          deriveFallbackStatus(child, p?.status),
        ),
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
    async (
      childSessionId: string,
      retryMode: SubSessionRetryMode = "regenerate",
    ) => {
      if (!activeModel) {
        upsertSubSessionProgress(parentSessionId, childSessionId, {
          status: "error",
          error: "No model configured. Please select a model first.",
          lastEventAt: new Date().toISOString(),
        });
        return;
      }

      setRetryingChildId(childSessionId);
      upsertSubSessionProgress(parentSessionId, childSessionId, {
        status: "running",
        error: undefined,
        lastEventAt: new Date().toISOString(),
      });
      setSessionProcessing(childSessionId, true);

      try {
        const truncateMode =
          retryMode === "error_retry" ? "error_retry" : "after_last_user";
        await agentClient.truncateSessionMessages(childSessionId, {
          mode: truncateMode,
        });
        if (retryMode === "regenerate") {
          await loadChatHistory(childSessionId, { mode: "replace" });
        }

        const executeResult = await agentClient.execute(
          childSessionId,
          activeModel,
        );
        if (
          executeResult.status === "started" ||
          executeResult.status === "already_running"
        ) {
          return;
        }

        if (executeResult.status === "completed") {
          setSessionProcessing(childSessionId, false);
          upsertSubSessionProgress(parentSessionId, childSessionId, {
            status: "completed",
            error: undefined,
            lastEventAt: new Date().toISOString(),
          });
          await refreshChats();
          return;
        }

        throw new Error(`Execute failed: ${executeResult.status}`);
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
      activeModel,
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
      const promptFn =
        typeof window !== "undefined" ? window.prompt.bind(window) : null;
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
          tool_name: "sub_session_manager",
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
    [
      parentSessionId,
      refreshChats,
      setSessionProcessing,
      upsertSubSessionProgress,
    ],
  );

  const removeChildSession = useCallback(
    async (childSessionId: string) => {
      setDeletingChildId(childSessionId);
      try {
        await deleteSession(childSessionId);
        clearSubSessionProgress(parentSessionId, childSessionId);
      } finally {
        setDeletingChildId((prev) => (prev === childSessionId ? null : prev));
      }
    },
    [clearSubSessionProgress, deleteSession, parentSessionId],
  );

  if (mergedItems.length === 0) return null;

  return (
    <Card
      size="small"
      style={{ marginBottom: token.marginMD }}
      data-testid="sub-sessions-panel"
      title={
        <Text strong>
          Child Sessions <Text type="secondary">({mergedItems.length})</Text>
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
          {isCollapsed ? "Expand" : "Collapse"}
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
                style={{
                  padding: token.paddingSM,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadius,
                }}
              >
                <Flex vertical style={{ flex: 1, minWidth: 0 }}>
                  <Flex
                    align="center"
                    gap={token.marginXS}
                    style={{ minWidth: 0 }}
                  >
                    <Text strong ellipsis style={{ minWidth: 0 }}>
                      {it.title || "Child Session"}{" "}
                      <Text type="secondary">({it.childSessionId})</Text>
                    </Text>
                    <Tag
                      color="geekblue"
                      style={{ marginInlineEnd: 0, flex: "0 0 auto" }}
                    >
                      Child
                    </Tag>
                    {it.pinned ? (
                      <Tag
                        color="gold"
                        style={{ marginInlineEnd: 0, flex: "0 0 auto" }}
                      >
                        Pinned
                      </Tag>
                    ) : null}
                  </Flex>

                  <Text type="secondary">
                    Status: {status}
                    {it.updatedAt ? ` • updated: ${it.updatedAt}` : ""}
                    {it.lastHeartbeatAt
                      ? ` • heartbeat: ${it.lastHeartbeatAt}`
                      : ""}
                  </Text>

                  {it.outputPreview ? (
                    <Text style={{ marginTop: token.marginXS }} ellipsis>
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
                    Open
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
                    Continue
                  </Button>
                  <Dropdown
                    trigger={["click"]}
                    menu={{
                      items: [
                        {
                          key: "regenerate",
                          label: "Regenerate response",
                        },
                        {
                          key: "error_retry",
                          label: "Retry failed request",
                        },
                      ],
                      onClick: ({ key }) => {
                        void runChildSession(
                          it.childSessionId,
                          key as SubSessionRetryMode,
                        );
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
                      Retry
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
                      {it.pinned ? "Unpin" : "Pin"}
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
                    Delete
                  </Button>
                </Flex>
              </Flex>
            );
          })}
        </Flex>
      ) : (
        <Text type="secondary" data-testid="sub-sessions-collapsed-hint">
          Hidden {mergedItems.length} child sessions. Click Expand to view.
        </Text>
      )}
    </Card>
  );
};
