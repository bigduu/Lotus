import React, { useMemo } from "react";
import { Drawer, Tabs, Tag, Typography, Button, Space, Tooltip, theme, Image } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { generateIntentDescription } from "../../utils/toolIntent";
import { parseMcpToolAlias } from "../../utils/mcpAlias";
import { parseFileChangeResultPayload, safeStringify } from "@shared/utils/resultFormatters";
import {
  getMergedToolStreamingOutput,
  useToolStreamingStates,
} from "../../streaming/useToolStreamingStates";
import { copyText } from "@shared/utils/clipboard";
import type { AssistantToolResultMessage } from "@shared/types/chat";
import FileChangeViewer from "../FileChangeViewer";
import FormattedContentPreview, { type FormattedContentMode } from "./FormattedContentPreview";

const { Text } = Typography;

type ToolStepDrawerTab = "preview" | "parameters" | "result" | "diff";

export interface ToolStepDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  sessionId?: string | null;
  call: {
    toolCallId: string;
    toolName: string;
    parameters: Record<string, unknown>;
    streamingOutput?: string;
  };
  metadata?: {
    elapsed_ms?: number;
    is_mutating?: boolean;
    summary?: string;
  };
  initialTab?: ToolStepDrawerTab;
  result?: AssistantToolResultMessage;
}

const formatElapsed = (ms: number | undefined): string => {
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};

const ToolStepDetailDrawer: React.FC<ToolStepDetailDrawerProps> = ({
  open,
  onClose,
  sessionId = null,
  call,
  metadata,
  initialTab = "preview",
  result,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const liveStateMap = useToolStreamingStates(sessionId, [call.toolCallId]);
  const mergedStreamingOutput = getMergedToolStreamingOutput(
    call.toolCallId,
    liveStateMap,
    call.streamingOutput,
  );

  const mcpParts = useMemo(() => parseMcpToolAlias(call.toolName), [call.toolName]);
  const intentDescription = useMemo(
    () => generateIntentDescription(call.toolName, call.parameters),
    [call.toolName, call.parameters],
  );
  const resultContent = result?.result?.result ?? "";
  const fileChangePayload = useMemo(
    () => (resultContent.trim() ? parseFileChangeResultPayload(resultContent) : null),
    [resultContent],
  );
  const summaryText =
    typeof metadata?.summary === "string" && metadata.summary.trim().length > 0
      ? metadata.summary.trim()
      : null;

  const formattedJson = useMemo(() => safeStringify(call.parameters, 2), [call.parameters]);

  const handleCopyParameters = async () => {
    try {
      await copyText(formattedJson);
    } catch (error) {
      console.error("[ToolStepDetailDrawer] Failed to copy parameters:", error);
    }
  };

  const previewPanel = useMemo<{
    label: string;
    value: unknown;
    mode: FormattedContentMode;
  } | null>(() => {
    if (mergedStreamingOutput?.trim()) {
      return {
        label: t("components.toolCall.liveOutput"),
        value: mergedStreamingOutput,
        mode: "auto",
      };
    }

    if (!fileChangePayload && resultContent.trim()) {
      return {
        label: t("components.toolSteps.result"),
        value: resultContent,
        mode: "auto",
      };
    }

    if (Object.keys(call.parameters).length > 0) {
      return {
        label: t("components.toolSteps.parameters"),
        value: call.parameters,
        mode: "json",
      };
    }

    return null;
  }, [call.parameters, fileChangePayload, mergedStreamingOutput, resultContent, t]);

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

  const hasStreamingOutput = !!mergedStreamingOutput?.trim();
  const statusTag = useMemo(() => {
    if (result) {
      if (result.isError) {
        return <Tag color="error">{t("components.toolSteps.statusError")}</Tag>;
      }
      return <Tag color="success">{t("components.toolSteps.statusFinish")}</Tag>;
    }
    if (hasStreamingOutput) {
      return <Tag color="processing">{t("components.toolSteps.statusProcess")}</Tag>;
    }
    return <Tag color="default">{t("components.toolSteps.statusWait")}</Tag>;
  }, [result, hasStreamingOutput, t]);

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

  const resolvedInitialTab: ToolStepDrawerTab = fileChangePayload
    ? initialTab
    : initialTab === "diff"
      ? "preview"
      : initialTab;

  const tabItems = [
    {
      key: "preview" as const,
      label: t("components.toolSteps.preview"),
      children: (
        <div className="lotus-tool-step-drawer-pane">
          <div style={{ display: "grid", gap: token.marginSM, flexShrink: 0 }}>
            <div>
              <Text strong style={{ fontSize: token.fontSizeSM }}>
                {t("components.toolSteps.intent")}
              </Text>
              <div style={{ marginTop: token.marginXS }}>
                <Text style={{ fontSize: token.fontSizeSM }}>{intentDescription}</Text>
              </div>
            </div>

            {summaryText ? (
              <div>
                <Text strong style={{ fontSize: token.fontSizeSM }}>
                  {t("components.toolSteps.summary", { defaultValue: "Summary" })}
                </Text>
                <div style={{ marginTop: token.marginXS }}>
                  <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    {summaryText}
                  </Text>
                </div>
              </div>
            ) : null}

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
          </div>

          <div
            style={{
              marginTop: token.marginSM,
              display: "flex",
              flexDirection: "column",
              gap: token.marginXS,
              flex: 1,
              minHeight: 0,
            }}
          >
            {result?.images && result.images.length > 0 ? (
              <div style={{ flexShrink: 0, marginBottom: token.marginXS }}>
                <Image.PreviewGroup>
                  <Space size={token.marginXS} wrap>
                    {result.images.map((img) => (
                      <Image
                        key={img.id}
                        src={img.url}
                        alt={img.name}
                        style={{
                          maxHeight: 360,
                          maxWidth: "100%",
                          objectFit: "contain",
                          borderRadius: token.borderRadius,
                          border: `1px solid ${token.colorBorderSecondary}`,
                        }}
                      />
                    ))}
                  </Space>
                </Image.PreviewGroup>
              </div>
            ) : null}

            {fileChangePayload ? (
              <>
                <Text strong style={{ fontSize: token.fontSizeSM }}>
                  {t("components.toolSteps.fileChanges", { defaultValue: "File changes" })}
                </Text>
                <FileChangeViewer
                  payload={fileChangePayload}
                  defaultViewMode="unified"
                  maxHeight={340}
                />
              </>
            ) : previewPanel ? (
              <>
                <Text strong style={{ fontSize: token.fontSizeSM }}>
                  {previewPanel.label}
                </Text>
                <FormattedContentPreview
                  value={previewPanel.value}
                  mode={previewPanel.mode}
                  height="100%"
                  scrollable={true}
                  emptyDescription={t("components.toolSteps.noResult")}
                />
              </>
            ) : (
              <FormattedContentPreview
                emptyDescription={t("components.toolSteps.noResult")}
                height="100%"
                scrollable={true}
              />
            )}
          </div>
        </div>
      ),
    },
    ...(fileChangePayload
      ? [
          {
            key: "diff" as const,
            label: t("components.toolSteps.diff", { defaultValue: "Diff" }),
            children: (
              <div className="lotus-tool-step-drawer-pane">
                <FileChangeViewer
                  payload={fileChangePayload}
                  defaultViewMode="sideBySide"
                  height="100%"
                />
              </div>
            ),
          },
        ]
      : []),
    {
      key: "parameters" as const,
      label: t("components.toolSteps.parameters"),
      children: (
        <div className="lotus-tool-step-drawer-pane">
          <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
            <Tooltip title={t("components.toolCall.copyParameters")}>
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                aria-label={t("components.toolCall.copyParameters")}
                onClick={handleCopyParameters}
                style={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}
              />
            </Tooltip>
            <FormattedContentPreview
              value={formattedJson}
              mode="json"
              height="100%"
              scrollable={true}
            />
          </div>
        </div>
      ),
    },
    {
      key: "result" as const,
      label: t("components.toolSteps.result"),
      children: (
        <div className="lotus-tool-step-drawer-pane">
          {result?.images && result.images.length > 0 ? (
            <div style={{ flexShrink: 0, marginBottom: token.marginSM }}>
              <Image.PreviewGroup>
                <Space size={token.marginXS} wrap>
                  {result.images.map((img) => (
                    <Image
                      key={img.id}
                      src={img.url}
                      alt={img.name}
                      style={{
                        maxHeight: 480,
                        maxWidth: "100%",
                        objectFit: "contain",
                        borderRadius: token.borderRadius,
                        border: `1px solid ${token.colorBorderSecondary}`,
                      }}
                    />
                  ))}
                </Space>
              </Image.PreviewGroup>
            </div>
          ) : null}
          <FormattedContentPreview
            value={resultContent}
            mode="auto"
            height="100%"
            scrollable={true}
            emptyDescription={t("components.toolSteps.noResult")}
          />
        </div>
      ),
    },
  ];

  return (
    <Drawer
      placement="right"
      width={960}
      open={open}
      onClose={onClose}
      title={title}
      destroyOnClose
      styles={{
        body: {
          paddingTop: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          overflow: "hidden",
        },
      }}
    >
      <div className="lotus-tool-step-drawer-tabs">
        <Tabs
          key={`${call.toolCallId}:${resolvedInitialTab}`}
          defaultActiveKey={resolvedInitialTab}
          items={tabItems}
          style={{ height: "100%" }}
        />
      </div>
    </Drawer>
  );
};

export default ToolStepDetailDrawer;
