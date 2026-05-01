import React, { useMemo } from "react";
import { Drawer, Tabs, Tag, Typography, Button, Space, Empty, theme, Tooltip } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { generateIntentDescription } from "../../utils/toolIntent";
import { parseMcpToolAlias } from "../../utils/mcpAlias";
import { safeStringify } from "../../utils/resultFormatters";
import { copyText } from "@shared/utils/clipboard";
import type { AssistantToolResultMessage } from "../../types/chat";

const { Text } = Typography;

export interface ToolStepDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  call: {
    toolCallId: string;
    toolName: string;
    parameters: Record<string, unknown>;
    streamingOutput?: string;
  };
  metadata?: {
    elapsed_ms?: number;
    is_mutating?: boolean;
  };
  initialTab?: "preview" | "parameters" | "result";
  result?: AssistantToolResultMessage;
}

const formatElapsed = (ms: number | undefined): string => {
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};

const ToolStepDetailDrawer: React.FC<ToolStepDetailDrawerProps> = ({
  open,
  onClose,
  call,
  metadata,
  initialTab = "preview",
  result,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const mcpParts = useMemo(() => parseMcpToolAlias(call.toolName), [call.toolName]);
  const intentDescription = useMemo(
    () => generateIntentDescription(call.toolName, call.parameters),
    [call.toolName, call.parameters],
  );

  const formattedJson = useMemo(() => safeStringify(call.parameters, 2), [call.parameters]);

  const handleCopy = async () => {
    try {
      await copyText(formattedJson);
    } catch (error) {
      console.error("[ToolStepDetailDrawer] Failed to copy parameters:", error);
    }
  };

  // Key params sorted by priority (first 3)
  const keyParamsList = useMemo(() => {
    const priorityKeys = ["path", "file_path", "command", "pattern", "query", "limit"];
    const entries = Object.entries(call.parameters);
    const sortedEntries = entries.sort((a, b) => {
      const aIndex = priorityKeys.indexOf(a[0]);
      const bIndex = priorityKeys.indexOf(b[0]);
      if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      return 0;
    });
    return sortedEntries.slice(0, 3);
  }, [call.parameters]);

  // Status tag
  const hasStreamingOutput = !!call.streamingOutput?.trim();
  const statusTag = useMemo(() => {
    if (result) {
      if (result.isError) {
        return <Tag color="error">error</Tag>;
      }
      return <Tag color="success">finish</Tag>;
    }
    if (hasStreamingOutput) {
      return <Tag color="processing">process</Tag>;
    }
    return <Tag color="default">wait</Tag>;
  }, [result, hasStreamingOutput]);

  const elapsedTag =
    metadata?.elapsed_ms != null ? (
      <Tag color={metadata.is_mutating ? "orange" : "green"}>
        {formatElapsed(metadata.elapsed_ms)}
      </Tag>
    ) : null;

  const title = (
    <Space size="small">
      {mcpParts ? (
        <>
          <Tag
            color="purple"
            style={{ marginInlineEnd: 0, borderRadius: 999, paddingInline: 8, fontWeight: 700 }}
          >
            MCP
          </Tag>
          <Text strong>{mcpParts.toolName}</Text>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            <Text code style={{ fontSize: token.fontSizeSM }}>
              {mcpParts.serverId}
            </Text>
          </Text>
        </>
      ) : (
        <Text strong>{call.toolName}</Text>
      )}
      {statusTag}
      {elapsedTag}
    </Space>
  );

  const tabItems = [
    {
      key: "preview" as const,
      label: t("components.toolSteps.preview"),
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={token.marginSM}>
          {/* Intent */}
          <div>
            <Text strong style={{ fontSize: token.fontSizeSM }}>
              {t("components.toolSteps.intent")}
            </Text>
            <div style={{ marginTop: token.marginXS }}>
              <Text style={{ fontSize: token.fontSizeSM }}>{intentDescription}</Text>
            </div>
          </div>

          {/* Key parameters */}
          {keyParamsList.length > 0 && (
            <div>
              <Text strong style={{ fontSize: token.fontSizeSM }}>
                {t("components.toolSteps.keyParameters")}
              </Text>
              <ul
                style={{
                  margin: `${token.marginXS}px 0 0`,
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
                      : {typeof value === "string" ? value : JSON.stringify(value)}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Full streaming output */}
          {call.streamingOutput?.trim() ? (
            <div>
              <Text strong style={{ fontSize: token.fontSizeSM }}>
                {t("components.toolCall.liveOutput")}
              </Text>
              <div
                className="lotus-code-surface"
                style={{
                  marginTop: token.marginXS,
                  borderRadius: token.borderRadiusSM,
                  backgroundColor: token.colorBgContainer,
                  maxHeight: 360,
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
                  {call.streamingOutput}
                </SyntaxHighlighter>
              </div>
            </div>
          ) : null}
        </Space>
      ),
    },
    {
      key: "parameters" as const,
      label: t("components.toolSteps.parameters"),
      children: (
        <div style={{ position: "relative" }}>
          <Tooltip title={t("components.toolCall.copyParameters")}>
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              aria-label={t("components.toolCall.copyParameters")}
              onClick={handleCopy}
              style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}
            />
          </Tooltip>
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
      ),
    },
    {
      key: "result" as const,
      label: t("components.toolSteps.result"),
      children: result ? (
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
          {result.result.result}
        </pre>
      ) : (
        <Empty description={t("components.toolSteps.noResult")} />
      ),
    },
  ];

  return (
    <Drawer
      placement="right"
      width={480}
      open={open}
      onClose={onClose}
      title={title}
      destroyOnClose
    >
      <Tabs defaultActiveKey={initialTab} items={tabItems} />
    </Drawer>
  );
};

export default ToolStepDetailDrawer;
