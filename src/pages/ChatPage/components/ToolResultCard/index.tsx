import React, { memo, useMemo } from "react";
import { Alert, Collapse, Divider, Space, Tag, Tooltip, Typography, theme } from "antd";
import { Button } from "@/components/ui/button";
import { RobotOutlined, CopyOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  formatResultContent,
  createCompactPreview,
  getStatusColor,
  parseUnifiedDiffLines,
  parseFileChangeResultPayload,
  parseMemoryInspectRebuildPayload,
  safeStringify,
} from "../../utils/resultFormatters";
import { ExecutionStatus } from "../../types/chat";
import { copyText } from "@shared/utils/clipboard";

const { Text } = Typography;

const formatOptionalTimestamp = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

export interface ToolResultCardProps {
  content: string;
  toolName: string;
  status?: ExecutionStatus;
  timestamp?: string;
  defaultCollapsed?: boolean;
  isLoading?: boolean;
  errorMessage?: string;
}

const ToolResultCardComponent: React.FC<ToolResultCardProps> = ({
  content,
  toolName,
  status = "success",
  timestamp,
  defaultCollapsed = true,
  isLoading,
  errorMessage,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const formatted = useMemo(() => formatResultContent(content), [content]);

  const derivedIsLoading = useMemo(() => {
    if (typeof isLoading === "boolean") {
      return isLoading;
    }
    return formatted.formattedText.trim().length === 0;
  }, [formatted.formattedText, isLoading]);

  const preview = useMemo(
    () => createCompactPreview(formatted.formattedText),
    [formatted.formattedText],
  );
  const fileChangePayload = useMemo(() => parseFileChangeResultPayload(content), [content]);
  const memoryInspectPayload = useMemo(() => parseMemoryInspectRebuildPayload(content), [content]);
  const parsedDiffLines = useMemo(
    () => (fileChangePayload ? parseUnifiedDiffLines(fileChangePayload.diff.unified) : []),
    [fileChangePayload],
  );

  const handleCopy = async () => {
    try {
      const textToCopy = formatted.isJson
        ? safeStringify(formatted.parsedJson)
        : formatted.formattedText;
      await copyText(textToCopy);
    } catch (error) {
      console.error("[ToolResultCard] Failed to copy result:", error);
    }
  };

  // Use stable key based on tool name and content hash for consistency
  const collapseKey = useMemo(() => {
    // Simple hash of content for stability
    const hash = content ? content.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "") : "empty";
    return `tool-result-${toolName}-${hash}`;
  }, [toolName, content]);

  return (
    <Collapse
      defaultActiveKey={defaultCollapsed ? [] : [collapseKey]}
      style={{
        backgroundColor: token.colorBgContainer,
        borderColor: token.colorBorderSecondary,
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: token.borderRadiusLG,
      }}
      items={[
        {
          key: collapseKey,
          label: (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: token.marginSM,
                width: "100%",
              }}
            >
              <RobotOutlined style={{ color: token.colorPrimary, flexShrink: 0 }} />
              <Text strong style={{ color: token.colorText, flexShrink: 0 }}>
                {toolName}
              </Text>
              <Text
                type="secondary"
                ellipsis
                style={{ flex: 1, minWidth: 0, fontSize: token.fontSizeSM }}
              >
                {derivedIsLoading ? t("components.toolResult.waiting") : preview}
              </Text>
              <Tag color={getStatusColor(status)} style={{ flexShrink: 0, margin: 0 }}>
                {status}
              </Tag>
            </div>
          ),
          children: (
            <Space direction="vertical" style={{ width: "100%" }} size={token.marginSM}>
              {/* Timestamp */}
              {timestamp && (
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {new Date(timestamp).toLocaleString()}
                </Text>
              )}

              {/* Error Alert */}
              {errorMessage && (
                <Alert
                  type="error"
                  message={t("components.toolResult.executionFailed")}
                  description={errorMessage}
                  showIcon
                />
              )}

              {/* Content */}
              <div style={{ position: "relative" }}>
                <Tooltip title={t("components.toolResult.copyResult")}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<CopyOutlined />}
                    aria-label={t("components.toolResult.copyResult")}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCopy();
                    }}
                    style={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      zIndex: 1,
                    }}
                  />
                </Tooltip>

                {derivedIsLoading ? (
                  <Text type="secondary">{t("components.toolResult.waitingForResult")}</Text>
                ) : memoryInspectPayload ? (
                  <Space direction="vertical" style={{ width: "100%" }} size={10}>
                    <Space wrap>
                      <Tag color={memoryInspectPayload.action === "rebuild" ? "gold" : "blue"}>
                        {t(`components.toolResult.memory.action.${memoryInspectPayload.action}`)}
                      </Tag>
                      <Tag>{memoryInspectPayload.data.scope}</Tag>
                      {memoryInspectPayload.data.project_key ? (
                        <Tag>{memoryInspectPayload.data.project_key}</Tag>
                      ) : null}
                      <Tag color="green">
                        {t("components.toolResult.memory.totalMemories", {
                          count: memoryInspectPayload.data.total_memories,
                        })}
                      </Tag>
                      <Tag
                        color={
                          memoryInspectPayload.data.stale_candidate_count > 0 ? "orange" : "default"
                        }
                      >
                        {t("components.toolResult.memory.staleCandidates", {
                          count: memoryInspectPayload.data.stale_candidate_count,
                        })}
                      </Tag>
                    </Space>

                    <div>
                      <Text strong style={{ fontSize: token.fontSizeSM }}>
                        {t("components.toolResult.memory.coverage")}
                      </Text>
                      <div
                        style={{
                          marginTop: token.marginXS,
                          display: "flex",
                          flexWrap: "wrap",
                          gap: token.marginXS,
                        }}
                      >
                        {Object.entries(memoryInspectPayload.data.by_type).map(([label, count]) => (
                          <Tag key={`type-${label}`}>{`${label}: ${count}`}</Tag>
                        ))}
                        {Object.entries(memoryInspectPayload.data.by_status).map(
                          ([label, count]) => (
                            <Tag
                              key={`status-${label}`}
                              color="processing"
                            >{`${label}: ${count}`}</Tag>
                          ),
                        )}
                      </div>
                    </div>

                    <Divider style={{ margin: `${token.marginXS}px 0` }} />

                    <div style={{ display: "grid", gap: token.marginXS }}>
                      <Text style={{ fontSize: token.fontSizeSM }}>
                        <Text strong>{t("components.toolResult.memory.viewsLabel")}</Text>{" "}
                        {memoryInspectPayload.data.view_files.length}
                      </Text>
                      <Text style={{ fontSize: token.fontSizeSM }}>
                        <Text strong>{t("components.toolResult.memory.indexesLabel")}</Text>{" "}
                        {memoryInspectPayload.data.index_files.length}
                      </Text>
                      <Text style={{ fontSize: token.fontSizeSM }}>
                        <Text strong>{t("components.toolResult.memory.stateFilesLabel")}</Text>{" "}
                        {memoryInspectPayload.data.state_files.length}
                      </Text>
                      {memoryInspectPayload.data.last_reindex_at ? (
                        <Text style={{ fontSize: token.fontSizeSM }}>
                          <Text strong>{t("components.toolResult.memory.lastReindexLabel")}</Text>{" "}
                          {formatOptionalTimestamp(memoryInspectPayload.data.last_reindex_at)}
                        </Text>
                      ) : null}
                      {memoryInspectPayload.data.last_dream_at ? (
                        <Text style={{ fontSize: token.fontSizeSM }}>
                          <Text strong>{t("components.toolResult.memory.lastDreamLabel")}</Text>{" "}
                          {formatOptionalTimestamp(memoryInspectPayload.data.last_dream_at)}
                        </Text>
                      ) : null}
                    </div>

                    {memoryInspectPayload.data.view_files.length > 0 ? (
                      <div>
                        <Text strong style={{ fontSize: token.fontSizeSM }}>
                          {t("components.toolResult.memory.viewFiles")}
                        </Text>
                        <div
                          style={{
                            marginTop: token.marginXS,
                            display: "flex",
                            flexWrap: "wrap",
                            gap: token.marginXS,
                          }}
                        >
                          {memoryInspectPayload.data.view_files.map((item) => (
                            <Tag key={`view-${item}`}>{item}</Tag>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {memoryInspectPayload.data.index_files.length > 0 ? (
                      <div>
                        <Text strong style={{ fontSize: token.fontSizeSM }}>
                          {t("components.toolResult.memory.indexFiles")}
                        </Text>
                        <div
                          style={{
                            marginTop: token.marginXS,
                            display: "flex",
                            flexWrap: "wrap",
                            gap: token.marginXS,
                          }}
                        >
                          {memoryInspectPayload.data.index_files.map((item) => (
                            <Tag key={`index-${item}`}>{item}</Tag>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {memoryInspectPayload.data.state_files.length > 0 ? (
                      <div>
                        <Text strong style={{ fontSize: token.fontSizeSM }}>
                          {t("components.toolResult.memory.stateFiles")}
                        </Text>
                        <div
                          style={{
                            marginTop: token.marginXS,
                            display: "flex",
                            flexWrap: "wrap",
                            gap: token.marginXS,
                          }}
                        >
                          {memoryInspectPayload.data.state_files.map((item) => (
                            <Tag key={`state-${item}`}>{item}</Tag>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {memoryInspectPayload.data.topic_paths.length > 0 ? (
                      <div>
                        <Text strong style={{ fontSize: token.fontSizeSM }}>
                          {t("components.toolResult.memory.topicPaths")}
                        </Text>
                        <div
                          style={{
                            marginTop: token.marginXS,
                            display: "flex",
                            flexWrap: "wrap",
                            gap: token.marginXS,
                          }}
                        >
                          {memoryInspectPayload.data.topic_paths.map((item) => (
                            <Tag key={`topic-${item}`}>{item}</Tag>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {memoryInspectPayload.data.recent_ids.length > 0 ? (
                      <div>
                        <Text strong style={{ fontSize: token.fontSizeSM }}>
                          {t("components.toolResult.memory.recentMemories")}
                        </Text>
                        <div
                          style={{
                            marginTop: token.marginXS,
                            display: "flex",
                            flexWrap: "wrap",
                            gap: token.marginXS,
                          }}
                        >
                          {memoryInspectPayload.data.recent_ids.map((item) => (
                            <Tag key={`recent-${item}`} color="default">
                              {item}
                            </Tag>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </Space>
                ) : fileChangePayload ? (
                  <Space direction="vertical" style={{ width: "100%" }} size={8}>
                    {fileChangePayload.message && (
                      <Text style={{ fontSize: token.fontSizeSM }}>
                        {fileChangePayload.message}
                      </Text>
                    )}
                    <Text style={{ fontSize: token.fontSizeSM }}>
                      <Text strong>{t("common.file")}:</Text>{" "}
                      <Text code>{fileChangePayload.file_path}</Text>
                    </Text>
                    {fileChangePayload.workspace && (
                      <Text style={{ fontSize: token.fontSizeSM }}>
                        <Text strong>{t("common.workspace")}:</Text>{" "}
                        <Text code>{fileChangePayload.workspace}</Text>
                      </Text>
                    )}
                    {fileChangePayload.checkpoint?.created ? (
                      <Text style={{ fontSize: token.fontSizeSM }}>
                        <Text strong>{t("components.toolResult.checkpoint")}:</Text>{" "}
                        <Text code>{fileChangePayload.checkpoint.path}</Text>
                      </Text>
                    ) : (
                      <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        {t("components.toolResult.checkpointNone")}
                      </Text>
                    )}
                    <div
                      style={{
                        border: `1px solid ${token.colorBorderSecondary}`,
                        borderRadius: token.borderRadiusSM,
                        maxHeight: 400,
                        overflow: "auto",
                        background: token.colorBgContainer,
                      }}
                    >
                      {parsedDiffLines.map((line, idx) => {
                        const style: React.CSSProperties = {
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                          fontSize: token.fontSizeSM,
                          lineHeight: 1.5,
                          padding: "0 8px",
                          fontFamily:
                            "Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                        };

                        if (line.kind === "add") {
                          style.background = token.colorSuccessBg;
                        } else if (line.kind === "remove") {
                          style.background = token.colorErrorBg;
                        } else if (line.kind === "modified_add") {
                          style.background = token.colorWarningBg;
                          style.borderLeft = `3px solid ${token.colorSuccess}`;
                        } else if (line.kind === "modified_remove") {
                          style.background = token.colorWarningBg;
                          style.borderLeft = `3px solid ${token.colorError}`;
                        } else if (line.kind === "hunk") {
                          style.background = token.colorFillSecondary;
                          style.color = token.colorTextSecondary;
                        } else if (line.kind === "meta") {
                          style.background = token.colorFillTertiary;
                          style.color = token.colorTextSecondary;
                        }

                        return (
                          <pre key={`${idx}-${line.kind}`} style={style}>
                            {line.text || " "}
                          </pre>
                        );
                      })}
                    </div>
                    {fileChangePayload.diff.truncated && (
                      <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                        {t("components.toolResult.diffTruncated")}
                      </Text>
                    )}
                  </Space>
                ) : formatted.isJson ? (
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
                    codeTagProps={{
                      style: {
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      },
                    }}
                  >
                    {formatted.formattedText}
                  </SyntaxHighlighter>
                ) : (
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      fontSize: token.fontSizeSM,
                      backgroundColor: token.colorBgContainer,
                      padding: token.paddingSM,
                      borderRadius: token.borderRadiusSM,
                      margin: 0,
                      maxHeight: 400,
                      overflow: "auto",
                    }}
                  >
                    {formatted.formattedText}
                  </pre>
                )}
              </div>
            </Space>
          ),
        },
      ]}
    />
  );
};

export const ToolResultCard = memo(ToolResultCardComponent);
ToolResultCard.displayName = "ToolResultCard";

export default ToolResultCard;
