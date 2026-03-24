import React, { memo, useMemo } from "react";
import {
  Alert,
  Button,
  Collapse,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
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
  safeStringify,
} from "../../utils/resultFormatters";
import { ExecutionStatus } from "../../types/chat";
import { copyText } from "@shared/utils/clipboard";

const { Text } = Typography;

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
  const fileChangePayload = useMemo(
    () => parseFileChangeResultPayload(content),
    [content],
  );
  const parsedDiffLines = useMemo(
    () =>
      fileChangePayload
        ? parseUnifiedDiffLines(fileChangePayload.diff.unified)
        : [],
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
    const hash = content
      ? content.slice(0, 50).replace(/[^a-zA-Z0-9]/g, "")
      : "empty";
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
              <RobotOutlined
                style={{ color: token.colorPrimary, flexShrink: 0 }}
              />
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
              <Tag
                color={getStatusColor(status)}
                style={{ flexShrink: 0, margin: 0 }}
              >
                {status}
              </Tag>
            </div>
          ),
          children: (
            <Space
              direction="vertical"
              style={{ width: "100%" }}
              size={token.marginSM}
            >
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
                    type="text"
                    size="small"
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
                  <Text type="secondary">
                    {t("components.toolResult.waitingForResult")}
                  </Text>
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
