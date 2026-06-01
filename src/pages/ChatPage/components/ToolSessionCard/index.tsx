import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { Space, Typography, theme, Badge, Button, Tooltip } from "antd";
import { ToolOutlined, DownOutlined, RightOutlined, DeleteOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { AssistantToolCallMessage, AssistantToolResultMessage } from "@shared/types/chat";
import { parseMcpToolAlias } from "../../utils/mcpAlias";
import { getFileChangeDiffStats } from "@shared/utils/resultFormatters";
import { StorageManager } from "../../../../services/storage/StorageManager";
import ToolStepsCard from "../ToolStepsCard";

const { Text } = Typography;

export interface ToolSessionItem {
  call: AssistantToolCallMessage;
  result?: AssistantToolResultMessage;
  callMessageId?: string;
  resultMessageId?: string;
}

export interface ToolSessionCardProps {
  tools: ToolSessionItem[];
  sessionId: string;
  createdAt: string;
  defaultExpanded?: boolean;
  /**
   * When this prop transitions from `false` → `true` (i.e. a newer message
   * arrived after this tool session), automatically collapse the group once.
   * Subsequent manual user toggles are preserved.
   */
  autoCollapseWhenStale?: boolean;
  onDeleteMessageIds?: (messageIds: string[]) => void | Promise<void>;
}

interface PersistedToolSessionState {
  isExpanded: boolean;
  expandedTools: string[];
}

const TOOL_SESSION_COLLAPSE_STORAGE_KEY_PREFIX = "chat-session-tool-collapse:";

const getToolSessionCollapseStorageKey = (sessionId: string, toolSessionId: string): string =>
  `${TOOL_SESSION_COLLAPSE_STORAGE_KEY_PREFIX}${sessionId}:${toolSessionId}`;

const readPersistedToolSessionState = (
  sessionId: string,
  toolSessionId: string,
): PersistedToolSessionState | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(
      getToolSessionCollapseStorageKey(sessionId, toolSessionId),
    );
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;

    const isExpanded =
      "isExpanded" in parsed && typeof parsed.isExpanded === "boolean" ? parsed.isExpanded : true;

    return { isExpanded, expandedTools: [] };
  } catch {
    return null;
  }
};

const writePersistedToolSessionState = async (
  sessionId: string,
  toolSessionId: string,
  state: PersistedToolSessionState,
): Promise<void> => {
  if (typeof window === "undefined") return;

  // Write to IndexedDB
  const manager = StorageManager.getInstance();
  await manager.saveToolSessionCollapse(sessionId, toolSessionId, state);

  // Also write to localStorage as fallback
  try {
    window.localStorage.setItem(
      getToolSessionCollapseStorageKey(sessionId, toolSessionId),
      JSON.stringify(state),
    );
  } catch {
    // Best-effort only.
  }
};

const SYNTHETIC_TOOL_CALL_PREFIX = "synthetic-tool-call:";

const getDeletableMessageIds = (item: ToolSessionItem): string[] => {
  const ids = new Set<string>();

  if (item.callMessageId?.trim()) {
    ids.add(item.callMessageId.trim());
  } else if (
    item.call.id &&
    !item.call.id.includes(":") &&
    !item.call.id.startsWith(SYNTHETIC_TOOL_CALL_PREFIX)
  ) {
    ids.add(item.call.id);
  }

  if (item.resultMessageId?.trim()) {
    ids.add(item.resultMessageId.trim());
  } else if (item.result?.id?.trim()) {
    ids.add(item.result.id.trim());
  }

  return Array.from(ids);
};

/** Collect all deletable message IDs across all tools in the session. */
const getAllDeletableMessageIds = (tools: ToolSessionItem[]): string[] => {
  const ids = new Set<string>();
  tools.forEach((item) => {
    getDeletableMessageIds(item).forEach((id) => ids.add(id));
  });
  return Array.from(ids);
};

const ToolSessionCardComponent: React.FC<ToolSessionCardProps> = ({
  tools,
  sessionId,
  defaultExpanded = false,
  autoCollapseWhenStale = false,
  onDeleteMessageIds,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const toolSessionStorageId = useMemo(() => {
    const firstTool = tools[0];
    const firstCall = firstTool?.call?.toolCalls?.[0];
    const messageScopeId =
      firstTool?.callMessageId ||
      firstTool?.call?.id ||
      firstTool?.resultMessageId ||
      firstTool?.result?.id ||
      "tool-message-missing";
    return `${messageScopeId}:${firstCall?.toolCallId || "tool-call-missing"}`;
  }, [tools]);

  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    const persisted = readPersistedToolSessionState(sessionId, toolSessionStorageId);
    if (persisted) return persisted.isExpanded;
    return defaultExpanded;
  });

  useEffect(() => {
    const persisted = readPersistedToolSessionState(sessionId, toolSessionStorageId);
    if (persisted) {
      setIsExpanded(persisted.isExpanded);
    } else {
      setIsExpanded(defaultExpanded);
    }

    // Also try to load from IndexedDB (async) and update if different
    const manager = StorageManager.getInstance();
    manager
      .loadToolSessionCollapse(sessionId, toolSessionStorageId)
      .then((idbState) => {
        if (idbState) {
          setIsExpanded(idbState.isExpanded);
        }
      })
      .catch(() => {
        // Ignore IndexedDB errors, localStorage already handled above
      });
  }, [defaultExpanded, sessionId, toolSessionStorageId]);

  useEffect(() => {
    writePersistedToolSessionState(sessionId, toolSessionStorageId, {
      isExpanded,
      expandedTools: [],
    }).catch(() => {});
  }, [sessionId, toolSessionStorageId, isExpanded]);

  // Auto-collapse when this tool group goes stale (a newer message arrived).
  // Fires only on the false → true transition, so a manually re-expanded
  // group stays open afterwards until the next "stale" trigger.
  const prevStaleRef = useRef<boolean>(autoCollapseWhenStale);
  useEffect(() => {
    if (!prevStaleRef.current && autoCollapseWhenStale) {
      setIsExpanded(false);
    }
    prevStaleRef.current = autoCollapseWhenStale;
  }, [autoCollapseWhenStale]);

  const { completedCount, pendingCount, hasErrors } = useMemo(() => {
    let completed = 0;
    let pending = 0;
    let errors = false;

    tools.forEach((item) => {
      if (item.result) {
        completed++;
        if (item.result.isError) {
          errors = true;
        }
      } else {
        pending++;
      }
    });

    return {
      completedCount: completed,
      pendingCount: pending,
      hasErrors: errors,
    };
  }, [tools]);

  const sessionStatus = useMemo(() => {
    if (pendingCount > 0) {
      return {
        color: "processing" as const,
        text: t("components.toolSession.completedProgress", {
          completed: completedCount,
          total: tools.length,
        }),
      };
    }
    if (hasErrors) {
      return {
        color: "warning" as const,
        text: t("components.toolSession.completedWithErrors", {
          completed: completedCount,
        }),
      };
    }
    return {
      color: "success" as const,
      text: t("components.toolSession.completedOnly", {
        completed: completedCount,
      }),
    };
  }, [completedCount, pendingCount, hasErrors, tools.length, t]);

  const sessionDiffStats = useMemo(() => {
    let added = 0;
    let removed = 0;
    let changedTools = 0;

    tools.forEach((item) => {
      const content = item.result?.result?.result;
      if (!content) return;
      const stats = getFileChangeDiffStats(content);
      if (!stats) return;
      added += stats.added;
      removed += stats.removed;
      changedTools += 1;
    });

    return { added, removed, changedTools };
  }, [tools]);

  const headerTitle = useMemo(() => {
    const names = tools
      .map((item) => {
        const call = item.call?.toolCalls?.[0];
        if (!call) return null;
        const mcpParts = parseMcpToolAlias(call.toolName);
        return mcpParts ? mcpParts.toolName : call.toolName || null;
      })
      .filter((n): n is string => Boolean(n));

    if (names.length === 0) {
      return t("components.toolSession.title");
    }
    if (names.length === 1) {
      return names[0];
    }
    // Dedupe consecutive duplicates for compactness, then summarize.
    const deduped = names.filter((name, index) => index === 0 || name !== names[index - 1]);
    const MAX_SHOWN = 3;
    if (deduped.length <= MAX_SHOWN) {
      return deduped.join(" → ");
    }
    return `${deduped.slice(0, MAX_SHOWN).join(" → ")} +${deduped.length - MAX_SHOWN}`;
  }, [tools, t]);

  const allDeletableIds = useMemo(() => getAllDeletableMessageIds(tools), [tools]);

  const stepsBody = (
    <ToolStepsCard sessionId={sessionId} tools={tools} defaultExpanded={true} hideHeader={true} />
  );

  // Inline (no card chrome): tool sessions blend into the conversation rather
  // than appearing as another bordered message card.
  const cardContainerStyle: React.CSSProperties = {
    background: "transparent",
  };

  return (
    <div style={cardContainerStyle}>
      {/* Session Header — lightweight inline strip, no outer border */}
      <div
        style={{
          padding: `${token.paddingXS}px 0`,
          backgroundColor: "transparent",
          borderBottom: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: token.marginSM,
          transition: "border-color 240ms ease, background-color 240ms ease",
        }}
        onClick={() => setIsExpanded(!isExpanded)}
        data-testid="tool-session-card-header"
      >
        <ToolOutlined style={{ color: token.colorPrimary }} />
        <Text strong style={{ flex: 1 }}>
          {headerTitle}
        </Text>
        <Badge count={tools.length} style={{ backgroundColor: token.colorPrimary }} />
        {sessionDiffStats.changedTools > 0 && (
          <Space size={4} style={{ marginInlineStart: token.marginXS }}>
            <Text
              style={{
                color: token.colorSuccess,
                fontSize: token.fontSizeSM,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              +{sessionDiffStats.added}
            </Text>
            <Text
              style={{
                color: token.colorError,
                fontSize: token.fontSizeSM,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              -{sessionDiffStats.removed}
            </Text>
          </Space>
        )}
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {sessionStatus.text}
        </Text>
        {onDeleteMessageIds && (
          <Tooltip
            title={
              allDeletableIds.length > 0
                ? t("components.toolSession.deleteMessage")
                : t("components.toolSession.noPersistedMessage")
            }
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={t("components.toolSession.deleteMessage")}
              data-testid={`delete-tool-session`}
              disabled={allDeletableIds.length === 0}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (allDeletableIds.length === 0) return;
                void onDeleteMessageIds(allDeletableIds);
              }}
            />
          </Tooltip>
        )}
        <div style={{ marginLeft: token.marginXS }}>
          {isExpanded ? (
            <DownOutlined style={{ color: token.colorTextSecondary }} />
          ) : (
            <RightOutlined style={{ color: token.colorTextSecondary }} />
          )}
        </div>
      </div>

      {/* Steps body */}
      {isExpanded && stepsBody}
    </div>
  );
};

export const ToolSessionCard = memo(ToolSessionCardComponent);
ToolSessionCard.displayName = "ToolSessionCard";

export default ToolSessionCard;
