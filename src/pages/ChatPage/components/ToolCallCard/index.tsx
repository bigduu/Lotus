import React, { memo, useEffect, useMemo, useRef, useState } from "react";
import { useThemeStore } from "@shared/store/themeStore";
import { Collapse, Space, Button, Typography, theme, Tooltip, Tag } from "antd";
import { ToolOutlined, CopyOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { safeStringify } from "../../utils/resultFormatters";
import { parseMcpToolAlias } from "../../utils/mcpAlias";
import { copyText } from "@shared/utils/clipboard";

const { Text } = Typography;

export interface ToolCallCardProps {
  toolName: string;
  parameters: Record<string, any>;
  toolCallId: string;
  streamingOutput?: string;
  defaultExpanded?: boolean;
}

/**
 * Generate a human-readable intent description from tool name and parameters
 */
function generateIntentDescription(
  toolName: string,
  params: Record<string, any>,
): string {
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
    file_read: (p) =>
      `Reading: ${truncate(p.path || p.file_path || "unknown", 40)}`,
    file_write: (p) =>
      `Writing to: ${truncate(p.path || p.file_path || "unknown", 35)}`,
    file_edit: (p) =>
      `Editing: ${truncate(p.path || p.file_path || "unknown", 40)}`,
    bash: (p) => `Executing: ${truncate(p.command, 40)}`,
    grep: (p) => `Searching: "${truncate(p.pattern, 30)}"`,
    glob: (p) => `Finding files: "${p.pattern}"`,
    read: (p) => `Reading: ${p.file_path || "file"}`,
    write: (p) => `Writing: ${p.file_path || "file"}`,
    edit: (p) => `Editing: ${p.file_path || "file"}`,
    search: (p) => `Searching: "${truncate(p.query || p.pattern, 30)}"`,
    default: () => `Calling ${toolName}`,
  };

  const generator = nameMap[toolName] || nameMap["default"];
  return generator(params);
}

const ToolCallCardComponent: React.FC<ToolCallCardProps> = ({
  toolName,
  parameters,
  toolCallId,
  streamingOutput,
  defaultExpanded = false,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const isDark = useThemeStore((s) => s.themeMode) === "dark";
  const mcpParts = useMemo(() => parseMcpToolAlias(toolName), [toolName]);

  const [activeKeys, setActiveKeys] = useState<string[]>(
    defaultExpanded ? [toolCallId] : [],
  );
  const autoExpandedOnceRef = useRef(false);
  const liveOutputScrollRef = useRef<HTMLDivElement | null>(null);

  // Auto-expand the card the first time we receive any live output so users can
  // actually see streaming stdout without manually expanding.
  useEffect(() => {
    if (autoExpandedOnceRef.current) return;
    if (!streamingOutput || streamingOutput.trim().length === 0) return;
    setActiveKeys((prev) => (prev.includes(toolCallId) ? prev : [toolCallId]));
    autoExpandedOnceRef.current = true;
  }, [streamingOutput, toolCallId]);

  // Keep the live output viewport scrolled to the bottom as new chunks arrive.
  useEffect(() => {
    if (!streamingOutput || streamingOutput.trim().length === 0) return;
    if (!activeKeys.includes(toolCallId)) return;
    const el = liveOutputScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [streamingOutput, activeKeys, toolCallId]);

  const intentDescription = useMemo(
    () => generateIntentDescription(toolName, parameters),
    [toolName, parameters],
  );

  const formattedJson = useMemo(
    () => safeStringify(parameters, 2),
    [parameters],
  );

  const handleCopy = async () => {
    try {
      await copyText(formattedJson);
    } catch (error) {
      console.error("[ToolCallCard] Failed to copy parameters:", error);
    }
  };

  // Get first 2-3 key params for bullet list in expanded view
  const keyParamsList = useMemo(() => {
    const priorityKeys = [
      "path",
      "file_path",
      "command",
      "pattern",
      "query",
      "limit",
    ];
    const entries = Object.entries(parameters);
    const sortedEntries = entries.sort((a, b) => {
      const aIndex = priorityKeys.indexOf(a[0]);
      const bIndex = priorityKeys.indexOf(b[0]);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
    return sortedEntries.slice(0, 3);
  }, [parameters]);

  return (
    <Collapse
      activeKey={activeKeys}
      onChange={(next) => {
        const keys = Array.isArray(next)
          ? (next as string[]).map(String)
          : next == null
            ? []
            : [String(next)];
        setActiveKeys(keys);
        if (keys.includes(toolCallId)) {
          autoExpandedOnceRef.current = true;
        }
      }}
      style={{
        background: isDark
          ? "linear-gradient(135deg, rgba(13, 148, 136, 0.08) 0%, rgba(5, 150, 105, 0.06) 100%)"
          : "linear-gradient(135deg, rgba(239, 246, 255, 0.96) 0%, rgba(250, 245, 255, 0.96) 100%)",
        borderColor: isDark ? "rgba(13, 148, 136, 0.22)" : "rgba(13, 148, 136, 0.16)",
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: token.borderRadiusLG,
        boxShadow: isDark ? "0 10px 24px rgba(2, 6, 23, 0.18)" : "0 10px 24px rgba(13, 148, 136, 0.08)",
        transition: "all 0.3s ease",
        overflow: "hidden",
      }}
      className="tool-call-card-collapse"
      items={[
        {
          key: toolCallId,
          label: (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: token.marginSM,
                width: "100%",
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  background: isDark
                    ? "linear-gradient(135deg, rgba(13, 148, 136, 0.22) 0%, rgba(5, 150, 105, 0.2) 100%)"
                    : "linear-gradient(135deg, rgba(13, 148, 136, 0.14) 0%, rgba(5, 150, 105, 0.12) 100%)",
                  border: isDark
                    ? "1px solid rgba(255,255,255,0.08)"
                    : "1px solid rgba(13,148,136,0.12)",
                  boxShadow: isDark
                    ? "none"
                    : "0 8px 18px rgba(13, 148, 136, 0.12)",
                }}
              >
                <ToolOutlined
                  style={{ color: token.colorPrimary, flexShrink: 0 }}
                />
              </div>
              {mcpParts ? (
                <Space size="small" wrap={false}>
                  <Tag
                    color="purple"
                    style={{
                      marginInlineEnd: 0,
                      borderRadius: 999,
                      paddingInline: 8,
                      fontWeight: 700,
                      boxShadow: isDark
                        ? "none"
                        : "0 4px 12px rgba(139, 92, 246, 0.14)",
                    }}
                  >
                    MCP
                  </Tag>
                  <Text strong style={{ color: token.colorText }}>
                    {mcpParts.toolName}
                  </Text>
                  <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    <Text code style={{ fontSize: token.fontSizeSM }}>
                      {mcpParts.serverId}
                    </Text>
                  </Text>
                </Space>
              ) : (
                <Text strong style={{ color: token.colorText, flexShrink: 0 }}>
                  {toolName}
                </Text>
              )}
              <Text
                type="secondary"
                ellipsis
                style={{ flex: 1, minWidth: 0, fontSize: token.fontSizeSM }}
              >
                {intentDescription}
              </Text>
            </div>
          ),
          children: (
            <Space
              direction="vertical"
              style={{ width: "100%" }}
              size={token.marginSM}
            >
              {/* Live Output Section (optional) */}
              {streamingOutput && streamingOutput.trim().length > 0 && (
                <div>
                  <Text strong style={{ fontSize: token.fontSizeSM }}>
                    {t("components.toolCall.liveOutput")}
                  </Text>
                  <div
                    ref={liveOutputScrollRef}
                    className="lotus-code-surface"
                    style={{
                      marginTop: token.marginXS,
                      borderRadius: token.borderRadiusSM,
                      backgroundColor: token.colorBgContainer,
                      maxHeight: 240,
                      overflow: "auto",
                    }}
                  >
                    <SyntaxHighlighter
                      language="text"
                      style={oneDark}
                      wrapLongLines={true}
                      customStyle={{
                        margin: 0,
                        backgroundColor: "transparent",
                        fontSize: token.fontSizeSM,
                      }}
                      codeTagProps={{
                        style: {
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        },
                      }}
                    >
                      {streamingOutput}
                    </SyntaxHighlighter>
                  </div>
                </div>
              )}

              {/* Key Parameters Section */}
              {keyParamsList.length > 0 && (
                <div>
                  <Text
                    strong
                    style={{
                      fontSize: token.fontSizeSM,
                      marginBottom: token.marginXS,
                      display: "block",
                    }}
                  >
                    {t("components.toolCall.keyParameters")}
                  </Text>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: token.paddingLG,
                      fontSize: token.fontSizeSM,
                    }}
                  >
                    {keyParamsList.map(([key, value]) => (
                      <li key={key}>
                        <Text code style={{ fontSize: token.fontSizeSM }}>
                          {key}
                        </Text>
                        <Text style={{ fontSize: token.fontSizeSM }}>
                          :{" "}
                          {typeof value === "string"
                            ? value
                            : JSON.stringify(value)}
                        </Text>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Full Parameters Section */}
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: token.marginXS,
                  }}
                >
                  <Text strong style={{ fontSize: token.fontSizeSM }}>
                    {t("components.toolCall.fullParameters")}
                  </Text>
                  <Tooltip title={t("components.toolCall.copyParameters")}>
                    <Button
                      type="text"
                      size="small"
                      icon={<CopyOutlined />}
                      aria-label={t("components.toolCall.copyParameters")}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy();
                      }}
                    />
                  </Tooltip>
                </div>
                <SyntaxHighlighter
                  language="json"
                  style={oneDark}
                  wrapLongLines={true}
                  customStyle={{
                    margin: 0,
                    borderRadius: token.borderRadiusSM,
                    backgroundColor: token.colorBgContainer,
                    fontSize: token.fontSizeSM,
                    maxHeight: 400,
                    overflow: "auto",
                  }}
                  className="lotus-code-surface"
                  codeTagProps={{
                    style: {
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    },
                  }}
                >
                  {formattedJson}
                </SyntaxHighlighter>
              </div>
            </Space>
          ),
        },
      ]}
    />
  );
};

export const ToolCallCard = memo(ToolCallCardComponent);
ToolCallCard.displayName = "ToolCallCard";

export default ToolCallCard;
