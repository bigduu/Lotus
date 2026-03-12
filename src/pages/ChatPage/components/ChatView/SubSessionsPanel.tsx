import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { Button, Card, Flex, Tag, Typography, theme } from "antd";

import { useAppStore } from "../../store";
import { openSession } from "../../utils/openSession";

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

export const SubSessionsPanel: React.FC<SubSessionsPanelProps> = ({
  parentSessionId,
}) => {
  const { token } = useToken();
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() =>
    readCollapsedState(parentSessionId) ?? false,
  );

  const subSessionsByParent = useAppStore((s) => s.subSessionsByParent);
  const chats = useAppStore((s) => s.chats);
  const loadChatHistory = useAppStore((s) => s.loadChatHistory);
  const pinSession = useAppStore((s) => s.pinSession);
  const unpinSession = useAppStore((s) => s.unpinSession);

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
    }> = [];

    for (const child of persistedChildren) {
      const p = progressById.get(child.id);
      out.push({
        childSessionId: child.id,
        title: p?.title || child.title,
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
          {mergedItems.map((it) => (
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
                <Flex align="center" gap={token.marginXS} style={{ minWidth: 0 }}>
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
                  Status: {normalizeSubSessionStatus(it.status)}
                  {it.updatedAt ? ` • updated: ${it.updatedAt}` : ""}
                  {it.lastHeartbeatAt ? ` • heartbeat: ${it.lastHeartbeatAt}` : ""}
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
                  onClick={() => {
                    openSession(it.childSessionId);
                    void loadChatHistory(it.childSessionId);
                  }}
                >
                  Open
                </Button>
                {typeof it.pinned === "boolean" ? (
                  <Button
                    size="small"
                    onClick={() => {
                      if (it.pinned) unpinSession(it.childSessionId);
                      else pinSession(it.childSessionId);
                    }}
                  >
                    {it.pinned ? "Unpin" : "Pin"}
                  </Button>
                ) : null}
              </Flex>
            </Flex>
          ))}
        </Flex>
      ) : (
        <Text type="secondary" data-testid="sub-sessions-collapsed-hint">
          Hidden {mergedItems.length} child sessions. Click Expand to view.
        </Text>
      )}
    </Card>
  );
};
