import React, { memo, useEffect, useMemo, useState } from "react";
import { Collapse, theme, Badge, CollapseProps, Tag, Tooltip } from "antd";
import { Space } from "@/components/ui/space";
import { Typography } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import type { GlobalToken } from "antd/es/theme/interface";
import {
  ToolOutlined,
  DownOutlined,
  RightOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import ToolCallCard from "../ToolCallCard";
import ToolResultCard from "../ToolResultCard";
import type { AssistantToolCallMessage, AssistantToolResultMessage } from "../../types/chat";
import { parseMcpToolAlias } from "../../utils/mcpAlias";
import { getFileChangeDiffStats, parseFileChangeResultPayload } from "../../utils/resultFormatters";

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
    const expandedTools =
      "expandedTools" in parsed && Array.isArray(parsed.expandedTools)
        ? parsed.expandedTools.filter((item): item is string => typeof item === "string")
        : [];

    return { isExpanded, expandedTools };
  } catch {
    return null;
  }
};

const writePersistedToolSessionState = (
  sessionId: string,
  toolSessionId: string,
  state: PersistedToolSessionState,
): void => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      getToolSessionCollapseStorageKey(sessionId, toolSessionId),
      JSON.stringify(state),
    );
  } catch {
    // Best-effort only.
  }
};

interface ToolItemStatus {
  icon: React.ReactNode;
  color: string;
  text: string;
}

const getToolItemKey = (item: ToolSessionItem): string => {
  const toolCallId = item.call.toolCalls?.[0]?.toolCallId || "tool-call-missing";
  const messageScopeId =
    item.callMessageId ||
    item.call.id ||
    item.resultMessageId ||
    item.result?.id ||
    "tool-message-missing";
  return `${messageScopeId}:${toolCallId}`;
};

const getToolItemTestId = (item: ToolSessionItem): string =>
  item.call.toolCalls?.[0]?.toolCallId || item.call.id;

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

function getToolStatus(
  item: ToolSessionItem,
  token: GlobalToken,
  t: (key: string, options?: Record<string, unknown>) => string,
): ToolItemStatus {
  if (!item.result) {
    return {
      icon: <LoadingOutlined spin style={{ color: token.colorPrimary }} />,
      color: token.colorPrimary,
      text: t("components.toolSession.running"),
    };
  }

  if (item.result.isError) {
    return {
      icon: <ExclamationCircleOutlined style={{ color: token.colorError }} />,
      color: token.colorError,
      text: t("components.toolSession.error"),
    };
  }

  return {
    icon: <CheckCircleOutlined style={{ color: token.colorSuccess }} />,
    color: token.colorSuccess,
    text: t("components.toolSession.done"),
  };
}

function generateToolIntent(toolName: string, params: Record<string, unknown>): string {
  const mcpParts = parseMcpToolAlias(toolName);
  if (mcpParts) {
    return `MCP ${mcpParts.serverId}: ${mcpParts.toolName}`;
  }

  const truncate = (value: unknown, maxLen: number) => {
    const str = typeof value === "string" ? value : String(value ?? "");
    if (!str || str.length <= maxLen) return str;
    return str.substring(0, maxLen).trimEnd() + "…";
  };

  const nameMap: Record<string, (p: typeof params) => string> = {
    file_read: (p) => `Reading: ${truncate(p.path || p.file_path || "file", 35)}`,
    file_write: (p) => `Writing: ${truncate(p.path || p.file_path || "file", 35)}`,
    file_edit: (p) => `Editing: ${truncate(p.path || p.file_path || "file", 35)}`,
    bash: (p) => `Executing: ${truncate(p.command, 35)}`,
    grep: (p) => `Searching: "${truncate(p.pattern, 25)}"`,
    glob: (p) => `Finding: "${p.pattern}"`,
    conclusion: (p) => `Conclusion: ${truncate(p.conclusion || p.title || "", 28)}`,
    read: (p) => `Reading: ${p.file_path || "file"}`,
    write: (p) => `Writing: ${p.file_path || "file"}`,
    edit: (p) => `Editing: ${p.file_path || "file"}`,
    search: (p) => `Searching: "${truncate(p.query || p.pattern, 25)}"`,
    default: () => `${toolName}`,
  };

  const generator = nameMap[toolName] || nameMap["default"];
  return generator(params);
}

const ToolSessionCardComponent: React.FC<ToolSessionCardProps> = ({
  tools,
  sessionId,
  defaultExpanded = false,
  onDeleteMessageIds,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const isSingleToolSession = tools.length === 1;
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
  const defaultExpandedToolKey = useMemo(() => {
    const first = tools[0];
    return first ? getToolItemKey(first) : null;
  }, [tools]);

  const [isExpanded, setIsExpanded] = useState<boolean>(() => {
    const persisted = readPersistedToolSessionState(sessionId, toolSessionStorageId);
    if (persisted) return persisted.isExpanded;
    return defaultExpanded;
  });

  const [expandedTools, setExpandedTools] = useState<Set<string>>(() => {
    const persisted = readPersistedToolSessionState(sessionId, toolSessionStorageId);
    if (persisted) {
      return new Set(persisted.expandedTools);
    }
    return new Set(defaultExpanded && defaultExpandedToolKey ? [defaultExpandedToolKey] : []);
  });

  useEffect(() => {
    const persisted = readPersistedToolSessionState(sessionId, toolSessionStorageId);
    if (persisted) {
      setIsExpanded(persisted.isExpanded);
      setExpandedTools(new Set(persisted.expandedTools));
      return;
    }

    setIsExpanded(defaultExpanded);
    setExpandedTools(
      new Set(defaultExpanded && defaultExpandedToolKey ? [defaultExpandedToolKey] : []),
    );
  }, [defaultExpanded, defaultExpandedToolKey, sessionId, toolSessionStorageId]);

  useEffect(() => {
    const validToolKeys = new Set(tools.map((item) => getToolItemKey(item)));
    setExpandedTools((previous) => {
      const next = new Set<string>();
      let changed = false;

      previous.forEach((key) => {
        if (validToolKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });

      if (!changed && next.size === previous.size) {
        return previous;
      }
      return next;
    });
  }, [tools]);

  useEffect(() => {
    writePersistedToolSessionState(sessionId, toolSessionStorageId, {
      isExpanded,
      expandedTools: Array.from(expandedTools),
    });
  }, [sessionId, toolSessionStorageId, isExpanded, expandedTools]);

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
    if (tools.length !== 1) {
      return t("components.toolSession.title");
    }

    const call = tools[0]?.call?.toolCalls?.[0];
    if (!call) {
      return t("components.toolSession.title");
    }

    const mcpParts = parseMcpToolAlias(call.toolName);
    if (mcpParts) {
      return `MCP ${mcpParts.serverId}: ${mcpParts.toolName}`;
    }

    return call.toolName || t("components.toolSession.title");
  }, [tools, t]);

  const collapseItems: CollapseProps["items"] = useMemo(() => {
    return tools
      .map((item, index) => {
        const toolCall = item.call.toolCalls[0];
        if (!toolCall) return null;

        const status = getToolStatus(item, token, t);
        const intent = generateToolIntent(toolCall.toolName, toolCall.parameters);
        const mcpParts = parseMcpToolAlias(toolCall.toolName);
        const toolDiffStats = item.result
          ? getFileChangeDiffStats(item.result.result.result)
          : null;
        const fileChangePayload = item.result
          ? parseFileChangeResultPayload(item.result.result.result)
          : null;
        const deletableMessageIds = getDeletableMessageIds(item);

        return {
          key: getToolItemKey(item),
          label: (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: token.marginSM,
                width: "100%",
              }}
            >
              <span
                style={{
                  fontSize: token.fontSizeSM,
                  color: token.colorTextTertiary,
                  minWidth: 20,
                }}
              >
                {index + 1}.
              </span>
              <span style={{ flexShrink: 0 }}>{status.icon}</span>
              {mcpParts ? (
                <Space size="small" wrap={false}>
                  <Tag color="purple" style={{ marginInlineEnd: 0 }}>
                    MCP
                  </Tag>
                  <Text strong style={{ fontSize: token.fontSizeSM }}>
                    {mcpParts.toolName}
                  </Text>
                  <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    <Text code style={{ fontSize: token.fontSizeSM }}>
                      {mcpParts.serverId}
                    </Text>
                  </Text>
                </Space>
              ) : (
                <Text strong style={{ fontSize: token.fontSizeSM, flexShrink: 0 }}>
                  {toolCall.toolName}
                </Text>
              )}
              <Text
                type="secondary"
                ellipsis
                style={{ flex: 1, minWidth: 0, fontSize: token.fontSizeSM }}
              >
                {intent}
              </Text>
              {fileChangePayload && (
                <Text
                  type="secondary"
                  ellipsis
                  style={{ maxWidth: 180, fontSize: token.fontSizeSM }}
                >
                  {fileChangePayload.file_path.split(/[\\/]/).pop() || fileChangePayload.file_path}
                </Text>
              )}
              {toolDiffStats && (
                <Space size={4} style={{ marginLeft: token.marginXS }}>
                  <Text
                    style={{
                      color: token.colorSuccess,
                      fontSize: token.fontSizeSM,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    +{toolDiffStats.added}
                  </Text>
                  <Text
                    style={{
                      color: token.colorError,
                      fontSize: token.fontSizeSM,
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    -{toolDiffStats.removed}
                  </Text>
                </Space>
              )}
              {onDeleteMessageIds && (
                <Tooltip
                  title={
                    deletableMessageIds.length > 0
                      ? t("components.toolSession.deleteMessage")
                      : t("components.toolSession.noPersistedMessage")
                  }
                >
                  <Button
                    size="sm"
                    icon={<DeleteOutlined />}
                    aria-label={t("components.toolSession.deleteMessage")}
                    data-testid={`delete-tool-message-${getToolItemTestId(item)}`}
                    disabled={deletableMessageIds.length === 0}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (deletableMessageIds.length === 0) return;
                      void onDeleteMessageIds(deletableMessageIds);
                    }}
                    variant="destructive" />
                </Tooltip>
              )}
            </div>
          ),
          children: (
            <Space direction="vertical" style={{ width: "100%" }} size={token.marginSM}>
              <ToolCallCard
                toolName={toolCall.toolName}
                parameters={toolCall.parameters}
                toolCallId={toolCall.toolCallId}
                streamingOutput={toolCall.streamingOutput}
                defaultExpanded={false}
              />
              {item.result && item.result.result.display_preference !== "Hidden" && (
                <ToolResultCard
                  content={item.result.result.result}
                  toolName={toolCall.toolName}
                  status={item.result.isError ? "error" : "success"}
                  timestamp={item.result.createdAt}
                  defaultCollapsed={false}
                />
              )}
            </Space>
          ),
          style: {
            borderBottom:
              index < tools.length - 1 ? `1px solid ${token.colorBorderSecondary}` : undefined,
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
  }, [onDeleteMessageIds, t, token, tools]);

  const toolsList = (
    <div style={{ padding: token.paddingSM }}>
      <Collapse
        ghost
        activeKey={Array.from(expandedTools)}
        onChange={(keys) => {
          // keys 是 string | string[]
          const newExpandedKeys = new Set<string>(Array.isArray(keys) ? keys : keys ? [keys] : []);
          setExpandedTools(newExpandedKeys);
        }}
        items={collapseItems}
      />
    </div>
  );

  const cardContainerStyle: React.CSSProperties = {
    backgroundColor: token.colorBgElevated,
    border: `1px solid ${token.colorBorder}`,
    borderRadius: token.borderRadiusLG,
    overflow: "hidden",
  };

  if (isSingleToolSession) {
    return (
      <div style={{ width: "100%" }}>
        <div style={cardContainerStyle}>{toolsList}</div>
      </div>
    );
  }

  return (
    <div style={cardContainerStyle}>
      {/* Session Header */}
      <div
        style={{
          padding: `${token.paddingSM}px ${token.paddingMD}px`,
          backgroundColor: token.colorBgContainer,
          borderBottom: isExpanded ? `1px solid ${token.colorBorder}` : undefined,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: token.marginSM,
        }}
        onClick={() => setIsExpanded(!isExpanded)}
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
        <div style={{ marginLeft: token.marginXS }}>
          {isExpanded ? (
            <DownOutlined style={{ color: token.colorTextSecondary }} />
          ) : (
            <RightOutlined style={{ color: token.colorTextSecondary }} />
          )}
        </div>
      </div>

      {/* Tools List */}
      {isExpanded && toolsList}
    </div>
  );
};

export const ToolSessionCard = memo(ToolSessionCardComponent);
ToolSessionCard.displayName = "ToolSessionCard";

export default ToolSessionCard;
