import React, { memo, useMemo, useState } from "react";
import { Steps, Typography, theme, Tag, Button } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  EyeOutlined,
  DownOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { AssistantToolCallMessage, AssistantToolResultMessage } from "../../types/chat";
import { generateIntentDescription } from "../../utils/toolIntent";
import { parseMcpToolAlias } from "../../utils/mcpAlias";
import { formatResultContent } from "../../utils/resultFormatters";
import type { ToolCallCardProps } from "../ToolCallCard";
import type { ToolSessionItem } from "../ToolSessionCard";
import ToolStepDetailDrawer from "./ToolStepDetailDrawer";
import FormattedContentPreview, { type FormattedContentMode } from "./FormattedContentPreview";
import "./styles.css";

const { Text } = Typography;

type ToolCallItem = AssistantToolCallMessage["toolCalls"][number];

export interface ToolStepsCardProps {
  /** Old usage (MessageCardContent direct pass) */
  toolCalls?: AssistantToolCallMessage["toolCalls"];
  metadata?: ToolCallCardProps["metadata"];
  /** New usage (ToolSessionCard pass — includes result for finish/error states) */
  tools?: ToolSessionItem[];
  defaultExpanded?: boolean;
  /** Hide the built-in mini header when embedded in ToolSessionCard */
  hideHeader?: boolean;
}

type StepStatus = "wait" | "process" | "finish" | "error";

interface StepInfo {
  status: StepStatus;
  icon: React.ReactNode;
}

/**
 * Derive step info from a bare ToolCallItem (no result available).
 * Used for the legacy `toolCalls` prop path.
 */
function getStepInfoFromCall(call: ToolCallItem): StepInfo {
  const hasOutput = !!call.streamingOutput?.trim();
  if (!hasOutput) {
    return { status: "wait", icon: <ClockCircleOutlined /> };
  }
  return { status: "process", icon: <LoadingOutlined spin /> };
}

/**
 * Derive step info from a ToolSessionItem (may include result).
 * Used for the new `tools` prop path.
 */
function getStepInfoFromItem(item: ToolSessionItem): StepInfo {
  const call = item.call.toolCalls[0];
  if (item.result) {
    if (item.result.isError) {
      return { status: "error", icon: <CloseCircleOutlined /> };
    }
    return { status: "finish", icon: <CheckCircleOutlined /> };
  }
  // No result yet — check streamingOutput
  const hasOutput = !!call?.streamingOutput?.trim();
  if (!hasOutput) {
    return { status: "wait", icon: <ClockCircleOutlined /> };
  }
  return { status: "process", icon: <LoadingOutlined spin /> };
}

/** Normalised step data used internally regardless of prop path. */
interface StepEntry {
  key: string;
  toolName: string;
  parameters: Record<string, unknown>;
  streamingOutput?: string;
  info: StepInfo;
  result?: AssistantToolResultMessage;
  metadata?: ToolCallCardProps["metadata"];
}

const formatElapsed = (ms: number | undefined): string => {
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};

const ToolStepsCardComponent: React.FC<ToolStepsCardProps> = ({
  toolCalls,
  metadata,
  tools,
  defaultExpanded = false,
  hideHeader = false,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const [expanded, setExpanded] = useState(defaultExpanded);

  // Normalise both prop paths into a single StepEntry[]
  const entries: StepEntry[] = useMemo(() => {
    if (tools && tools.length > 0) {
      return tools.map((item) => {
        const call = item.call.toolCalls[0];
        return {
          key: call?.toolCallId || "unknown",
          toolName: call?.toolName || "tool",
          parameters: call?.parameters || {},
          streamingOutput: call?.streamingOutput,
          info: getStepInfoFromItem(item),
          result: item.result,
          metadata,
        };
      });
    }
    // Legacy path: only toolCalls
    return (toolCalls || []).map((call) => ({
      key: call.toolCallId,
      toolName: call.toolName,
      parameters: call.parameters,
      streamingOutput: call.streamingOutput,
      info: getStepInfoFromCall(call),
      result: undefined,
      metadata,
    }));
  }, [tools, toolCalls, metadata]);

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerEntry, setDrawerEntry] = useState<StepEntry | null>(null);
  const [drawerInitialTab, setDrawerInitialTab] = useState<"preview" | "parameters" | "result">(
    "preview",
  );

  const openDrawer = (entry: StepEntry, tab?: "preview" | "parameters" | "result") => {
    setDrawerEntry(entry);
    setDrawerInitialTab(tab ?? "preview");
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  // First non-finish step index
  const currentStep = useMemo(() => {
    const idx = entries.findIndex((e) => e.info.status !== "finish");
    return idx === -1 ? entries.length - 1 : idx;
  }, [entries]);

  const hasError = entries.some((e) => e.info.status === "error");
  const finishedCount = entries.filter((e) => e.info.status === "finish").length;
  const total = entries.length;
  const totalElapsed = formatElapsed(metadata?.elapsed_ms);

  const headerLabel = useMemo(() => {
    const parts = [t("components.toolSteps.title"), `${finishedCount}/${total}`];
    if (totalElapsed) parts.push(totalElapsed);
    return parts.join(" · ");
  }, [t, finishedCount, total, totalElapsed]);

  const stepsItems = useMemo(
    () =>
      entries.map((entry) => {
        const mcpParts = parseMcpToolAlias(entry.toolName);
        const intent = generateIntentDescription(entry.toolName, entry.parameters);
        const truncatedIntent =
          intent.length > 60 ? intent.substring(0, 60).trimEnd() + "…" : intent;

        // Mini output preview — shown for process (live tail of streamingOutput)
        // and for finish/error (head of the final result text). Use the same
        // formatter as the detail drawer so JSON/object output is readable.
        let miniPreview: string | null = null;
        let miniPreviewMode: FormattedContentMode = "text";
        let miniPreviewKind: "live" | "result" | null = null;
        if (entry.info.status === "process" && entry.streamingOutput?.trim()) {
          const lines = entry.streamingOutput.split("\n");
          miniPreview = lines.slice(-3).join("\n");
          miniPreviewMode = formatResultContent(entry.streamingOutput).isJson ? "auto" : "text";
          miniPreviewKind = "live";
        } else if (
          (entry.info.status === "finish" || entry.info.status === "error") &&
          entry.result?.result?.result
        ) {
          const formattedResult = formatResultContent(entry.result.result.result);
          const text = formattedResult.formattedText.trimEnd();
          if (text.length > 0) {
            const lines = text.split("\n");
            // For results we show the first 3 lines (head), which usually
            // carries the most informative summary line.
            miniPreview = lines.slice(0, 3).join("\n");
            miniPreviewMode = formattedResult.isJson ? "json" : "text";
            miniPreviewKind = "result";
          }
        }

        const subTitle =
          entry.info.status === "process"
            ? t("components.toolSteps.running")
            : metadata?.elapsed_ms != null
              ? formatElapsed(metadata.elapsed_ms)
              : undefined;

        return {
          key: entry.key,
          title: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: token.marginXS }}>
              {mcpParts ? (
                <>
                  <Tag
                    color="purple"
                    style={{
                      marginInlineEnd: 0,
                      borderRadius: 999,
                      paddingInline: 6,
                      fontWeight: 700,
                      fontSize: token.fontSizeSM - 1,
                      lineHeight: "18px",
                    }}
                  >
                    MCP
                  </Tag>
                  <Text strong style={{ fontSize: token.fontSizeSM }}>
                    {mcpParts.toolName}
                  </Text>
                </>
              ) : (
                <Text strong style={{ fontSize: token.fontSizeSM }}>
                  {entry.toolName}
                </Text>
              )}
            </span>
          ),
          subTitle: subTitle ? (
            <Text type="secondary" style={{ fontSize: token.fontSizeSM - 1 }}>
              {subTitle}
            </Text>
          ) : undefined,
          description: (
            <div style={{ minWidth: 0 }}>
              <Text
                ellipsis
                style={{ fontSize: token.fontSizeSM, display: "block", maxWidth: "100%" }}
              >
                {truncatedIntent}
              </Text>
              {/* Action links */}
              <div
                style={{
                  marginTop: token.marginXXS,
                  display: "flex",
                  gap: token.marginXS,
                  alignItems: "center",
                }}
              >
                <Button
                  type="link"
                  size="small"
                  icon={<EyeOutlined />}
                  style={{ padding: 0, height: "auto", fontSize: token.fontSizeSM }}
                  data-testid={`tool-step-details-${entry.key}`}
                  onClick={() => openDrawer(entry, "preview")}
                >
                  {t("components.toolSteps.details")}
                </Button>
              </div>
              {/* Mini output preview (live streaming tail OR final result head) */}
              {miniPreview && (
                <div style={{ marginTop: token.marginXS }}>
                  <FormattedContentPreview
                    value={miniPreview}
                    mode={miniPreviewMode}
                    className="lotus-tool-step-preview"
                    compact={true}
                    maxHeight={72}
                    scrollable={false}
                    backgroundColor="transparent"
                  />
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: 0, height: "auto", fontSize: token.fontSizeSM - 1 }}
                    onClick={() =>
                      openDrawer(entry, miniPreviewKind === "result" ? "result" : "preview")
                    }
                  >
                    {miniPreviewKind === "result"
                      ? t("components.toolSteps.viewFullResult", {
                          defaultValue: "View full result",
                        })
                      : t("components.toolSteps.viewFullOutput")}
                  </Button>
                </div>
              )}
            </div>
          ),
          status: entry.info.status,
          icon: entry.info.icon,
        };
      }),
    [entries, token, metadata, t],
  );

  // When embedded (hideHeader), drop the chrome — feels cleaner inside ToolSessionCard.
  const containerStyle: React.CSSProperties = hideHeader
    ? { background: "transparent" }
    : {
        background: "var(--lotus-tool-card-bg)",
        borderColor: "var(--lotus-tool-card-border)",
        borderWidth: 1,
        borderStyle: "solid",
        borderRadius: token.borderRadiusLG,
        overflow: "hidden",
      };

  return (
    <div className="lotus-tool-steps" style={containerStyle}>
      {/* Mini header — hidden when ToolSessionCard provides its own */}
      {!hideHeader && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: token.marginSM,
            padding: `${token.paddingSM}px ${token.paddingSM}px`,
            cursor: "pointer",
            userSelect: "none",
          }}
          onClick={() => setExpanded((prev) => !prev)}
          data-testid="tool-steps-header"
        >
          <span style={{ flexShrink: 0 }}>
            {expanded ? (
              <DownOutlined
                style={{ color: token.colorTextSecondary, fontSize: token.fontSizeSM }}
              />
            ) : (
              <RightOutlined
                style={{ color: token.colorTextSecondary, fontSize: token.fontSizeSM }}
              />
            )}
          </span>
          <Text strong style={{ fontSize: token.fontSizeSM }}>
            🛠 {headerLabel}
          </Text>
        </div>
      )}

      {/* Steps body */}
      {(hideHeader || expanded) && (
        <div
          style={{
            // Embedded mode: breathing room on all sides so content doesn't hug the header.
            // Standalone mode: keep prior layout (header already supplies top padding).
            // Inline mode: small top gap, no horizontal padding so Steps icons
            // align with the inline header to the left of the conversation.
            padding: hideHeader
              ? `${token.paddingXS}px 0 0 0`
              : `${token.paddingXS}px ${token.paddingSM}px ${token.paddingSM}px`,
          }}
        >
          <Steps
            direction="vertical"
            size="small"
            current={currentStep}
            status={hasError ? "error" : "process"}
            items={stepsItems}
          />
        </div>
      )}

      {/* Drawer */}
      {drawerEntry && (
        <ToolStepDetailDrawer
          open={drawerOpen}
          onClose={closeDrawer}
          call={{
            toolCallId: drawerEntry.key,
            toolName: drawerEntry.toolName,
            parameters: drawerEntry.parameters,
            streamingOutput: drawerEntry.streamingOutput,
          }}
          metadata={drawerEntry.metadata}
          initialTab={drawerInitialTab}
          result={drawerEntry.result}
        />
      )}
    </div>
  );
};

export const ToolStepsCard = memo(ToolStepsCardComponent);
ToolStepsCard.displayName = "ToolStepsCard";

export default ToolStepsCard;
