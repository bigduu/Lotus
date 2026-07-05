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
  SyncOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { AssistantToolCallMessage, AssistantToolResultMessage } from "@shared/types/chat";
import { generateIntentDescription } from "../../utils/toolIntent";
import { parseMcpToolAlias } from "../../utils/mcpAlias";
import {
  createFocusedUnifiedDiffPreview,
  formatResultContent,
  getFileChangeDiffStats,
  parseFileChangeResultPayload,
  parseBackgroundBashResultPayload,
  type BackgroundBashResultPayload,
} from "@shared/utils/resultFormatters";
import {
  getMergedToolStreamingOutput,
  useToolStreamingStates,
} from "../../streaming/useToolStreamingStates";
import {
  getBackgroundBashDone,
  useBackgroundBashStatuses,
  type BackgroundBashDone,
} from "../../streaming/backgroundBashAtoms";
import type { ToolCallCardProps } from "../ToolCallCard";
import type { ToolSessionItem } from "../ToolSessionCard";
import FileChangeViewer from "../FileChangeViewer";
import ToolStepDetailDrawer from "./ToolStepDetailDrawer";
import FormattedContentPreview, { type FormattedContentMode } from "./FormattedContentPreview";
import "./styles.css";

const { Text } = Typography;

const INLINE_FILE_CHANGE_PREVIEW_MAX_HEIGHT = 1760;

export interface ToolStepsCardProps {
  sessionId?: string | null;
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

interface StepEntry {
  key: string;
  toolName: string;
  parameters: Record<string, unknown>;
  streamingOutput?: string;
  info: StepInfo;
  result?: AssistantToolResultMessage;
  metadata?: ToolCallCardProps["metadata"];
  /** Non-null when this tool is a background/async shell (detected from its result JSON). */
  backgroundBash?: BackgroundBashResultPayload | null;
  /** The reconciled completion for {@link backgroundBash} (null while still running). */
  backgroundDone?: BackgroundBashDone | null;
}

interface BackgroundStepState {
  payload: BackgroundBashResultPayload;
  done: BackgroundBashDone | null;
}

const isBackgroundBashSuccess = (done: BackgroundBashDone): boolean =>
  done.status === "completed" && (done.exitCode === 0 || done.exitCode == null);

function getResolvedStepInfo(
  result: AssistantToolResultMessage | undefined,
  streamingOutput: string | undefined,
  liveStatus?: "idle" | "running" | "completed" | "error",
  background?: BackgroundStepState,
): StepInfo {
  // A background/async shell reports a normal ToolComplete immediately, but the
  // shell keeps running: don't show the green check until the `bash_completed`
  // event reconciles into the background-status store.
  if (background) {
    const { done } = background;
    if (!done) {
      return { status: "process", icon: <SyncOutlined spin /> };
    }
    if (isBackgroundBashSuccess(done)) {
      return { status: "finish", icon: <CheckCircleOutlined /> };
    }
    if (done.status === "killed") {
      return { status: "finish", icon: <MinusCircleOutlined /> };
    }
    return { status: "error", icon: <CloseCircleOutlined /> };
  }

  if (result) {
    if (result.isError) {
      return { status: "error", icon: <CloseCircleOutlined /> };
    }
    return { status: "finish", icon: <CheckCircleOutlined /> };
  }

  if (liveStatus === "error") {
    return { status: "error", icon: <CloseCircleOutlined /> };
  }

  if (liveStatus === "completed") {
    return { status: "finish", icon: <CheckCircleOutlined /> };
  }

  const hasOutput = !!streamingOutput?.trim();
  if (!hasOutput && liveStatus !== "running") {
    return { status: "wait", icon: <ClockCircleOutlined /> };
  }

  return { status: "process", icon: <LoadingOutlined spin /> };
}

/**
 * The amber "Running in background…" / completed / killed / failed badge for a
 * background shell step. Returns null for ordinary tools.
 */
function renderBackgroundBadge(entry: StepEntry, t: TFunction): React.ReactNode {
  if (!entry.backgroundBash) {
    return null;
  }

  const done = entry.backgroundDone ?? null;
  if (!done) {
    return (
      <Tag color="warning" icon={<SyncOutlined spin />} style={{ margin: 0 }}>
        {t("components.toolSteps.runningInBackground")}
      </Tag>
    );
  }

  if (isBackgroundBashSuccess(done)) {
    return (
      <Tag color="success" style={{ margin: 0 }}>
        {`${t("components.toolSteps.backgroundCompleted")} · exit ${done.exitCode ?? 0}`}
      </Tag>
    );
  }

  if (done.status === "killed") {
    return <Tag style={{ margin: 0 }}>{t("components.toolSteps.backgroundKilled")}</Tag>;
  }

  const suffix = done.exitCode != null ? ` · exit ${done.exitCode}` : "";
  return (
    <Tag color="error" style={{ margin: 0 }}>
      {`${t("components.toolSteps.backgroundFailed")}${suffix}`}
    </Tag>
  );
}

const formatElapsed = (ms: number | undefined): string => {
  if (ms == null) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
};

const ToolStepsCardComponent: React.FC<ToolStepsCardProps> = ({
  sessionId = null,
  toolCalls,
  metadata,
  tools,
  defaultExpanded = false,
  hideHeader = false,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const [expanded, setExpanded] = useState(defaultExpanded);

  const rawEntries: StepEntry[] = useMemo(() => {
    if (tools && tools.length > 0) {
      return tools.map((item) => {
        const call = item.call.toolCalls[0];
        return {
          key: call?.toolCallId || "unknown",
          toolName: call?.toolName || "tool",
          parameters: call?.parameters || {},
          streamingOutput: call?.streamingOutput,
          info: { status: "wait", icon: <ClockCircleOutlined /> },
          result: item.result,
          metadata: (item.call.metadata as ToolCallCardProps["metadata"]) ?? metadata,
        };
      });
    }

    return (toolCalls || []).map((call) => ({
      key: call.toolCallId,
      toolName: call.toolName,
      parameters: call.parameters,
      streamingOutput: call.streamingOutput,
      info: { status: "wait", icon: <ClockCircleOutlined /> },
      result: undefined,
      metadata,
    }));
  }, [tools, toolCalls, metadata]);

  const toolCallIds = useMemo(() => rawEntries.map((entry) => entry.key), [rawEntries]);
  const liveStateMap = useToolStreamingStates(sessionId, toolCallIds);

  // Detect background/async shells from each result payload, then subscribe to
  // their reconciled completions (keyed by bash_id) so cards flip reactively.
  const backgroundPayloadByKey = useMemo(() => {
    const map: Record<string, BackgroundBashResultPayload | null> = {};
    rawEntries.forEach((entry) => {
      const resultText = entry.result?.result?.result ?? "";
      map[entry.key] = resultText ? parseBackgroundBashResultPayload(resultText) : null;
    });
    return map;
  }, [rawEntries]);

  const backgroundBashIds = useMemo(
    () =>
      Object.values(backgroundPayloadByKey)
        .filter((payload): payload is BackgroundBashResultPayload => payload != null)
        .map((payload) => payload.bashId),
    [backgroundPayloadByKey],
  );

  const backgroundStatusMap = useBackgroundBashStatuses(backgroundBashIds);

  const entries: StepEntry[] = useMemo(
    () =>
      rawEntries.map((entry) => {
        const liveState = liveStateMap[entry.key];
        const streamingOutput = getMergedToolStreamingOutput(
          entry.key,
          liveStateMap,
          entry.streamingOutput,
        );
        const backgroundBash = backgroundPayloadByKey[entry.key] ?? null;
        const backgroundDone = backgroundBash
          ? getBackgroundBashDone(backgroundBash.bashId, backgroundStatusMap)
          : null;
        return {
          ...entry,
          streamingOutput,
          backgroundBash,
          backgroundDone,
          info: getResolvedStepInfo(
            entry.result,
            streamingOutput,
            liveState?.status,
            backgroundBash ? { payload: backgroundBash, done: backgroundDone } : undefined,
          ),
        };
      }),
    [rawEntries, liveStateMap, backgroundPayloadByKey, backgroundStatusMap],
  );

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerEntry, setDrawerEntry] = useState<StepEntry | null>(null);
  const [drawerInitialTab, setDrawerInitialTab] = useState<
    "preview" | "parameters" | "result" | "diff"
  >("preview");

  const openDrawer = (entry: StepEntry, tab?: "preview" | "parameters" | "result" | "diff") => {
    setDrawerEntry(entry);
    setDrawerInitialTab(tab ?? "preview");
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const currentStep = useMemo(() => {
    const idx = entries.findIndex((e) => e.info.status !== "finish");
    return idx === -1 ? Math.max(entries.length - 1, 0) : idx;
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
        const resultContent = entry.result?.result?.result ?? "";
        const fileChangePayload = resultContent
          ? parseFileChangeResultPayload(resultContent)
          : null;
        const fileChangeStats = resultContent ? getFileChangeDiffStats(resultContent) : null;
        const focusedInlineDiffLines = fileChangePayload
          ? createFocusedUnifiedDiffPreview(fileChangePayload.diff.unified, {
              contextLines: 2,
              maxLines: 120,
              preserveLeadingMeta: true,
            })
          : null;
        const summaryText =
          typeof entry.metadata?.summary === "string" && entry.metadata.summary.trim().length > 0
            ? entry.metadata.summary.trim()
            : null;
        const fileChangeTitle = fileChangePayload
          ? `${fileChangePayload.operation}(${fileChangePayload.file_path})`
          : null;

        let miniPreview: string | null = null;
        let miniPreviewMode: FormattedContentMode = "text";
        let miniPreviewKind: "live" | "result" | null = null;
        if (entry.info.status === "process" && entry.streamingOutput?.trim()) {
          const lines = entry.streamingOutput.split("\n");
          miniPreview = lines.slice(-3).join("\n");
          miniPreviewMode = formatResultContent(entry.streamingOutput).isJson ? "auto" : "text";
          miniPreviewKind = "live";
        } else if (
          !fileChangePayload &&
          // A background shell's result body is just `{bash_id, status:"running"}`
          // — never surface it as a mini result preview; the badge conveys state.
          !entry.backgroundBash &&
          (entry.info.status === "finish" || entry.info.status === "error") &&
          entry.result?.result?.result
        ) {
          const formattedResult = formatResultContent(entry.result.result.result);
          const text = formattedResult.formattedText.trimEnd();
          if (text.length > 0) {
            const lines = text.split("\n");
            miniPreview = lines.slice(0, 3).join("\n");
            miniPreviewMode = formattedResult.isJson ? "json" : "text";
            miniPreviewKind = "result";
          }
        }

        const backgroundBadge = renderBackgroundBadge(entry, t);
        // The badge already conveys the running/finished state for a background
        // shell, so drop the redundant "running…"/elapsed text in that case.
        const subTitleText = entry.backgroundBash
          ? undefined
          : entry.info.status === "process"
            ? t("components.toolSteps.running")
            : entry.metadata?.elapsed_ms != null
              ? formatElapsed(entry.metadata.elapsed_ms)
              : undefined;
        const subTitleNode =
          subTitleText || backgroundBadge ? (
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: token.marginXS }}
            >
              {subTitleText ? (
                <Text type="secondary" style={{ fontSize: token.fontSizeSM - 1 }}>
                  {subTitleText}
                </Text>
              ) : null}
              {backgroundBadge}
            </span>
          ) : undefined;

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
          subTitle: subTitleNode,
          description: (
            <div style={{ minWidth: 0 }}>
              <Text
                ellipsis
                style={{ fontSize: token.fontSizeSM, display: "block", maxWidth: "100%" }}
              >
                {truncatedIntent}
              </Text>
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
                  onClick={() => openDrawer(entry, fileChangePayload ? "diff" : "preview")}
                >
                  {t("components.toolSteps.details")}
                </Button>
              </div>
              {summaryText && !fileChangePayload && (
                <Text
                  type="secondary"
                  style={{
                    display: "block",
                    marginTop: token.marginXS,
                    fontSize: token.fontSizeSM - 1,
                  }}
                >
                  {summaryText}
                </Text>
              )}
              {fileChangePayload && fileChangeStats && (
                <div
                  style={{
                    marginTop: token.marginXS,
                    padding: token.paddingXS,
                    borderRadius: token.borderRadiusSM,
                    background: token.colorFillTertiary,
                    border: `1px solid ${token.colorBorderSecondary}`,
                  }}
                  data-testid={`tool-step-file-change-${entry.key}`}
                >
                  <div style={{ display: "grid", gap: token.marginXXS ?? 2 }}>
                    <Text
                      strong
                      style={{ fontSize: token.fontSizeSM }}
                      ellipsis={{ tooltip: fileChangeTitle }}
                    >
                      {fileChangeTitle}
                    </Text>
                    <Text type="secondary" style={{ fontSize: token.fontSizeSM - 1 }}>
                      {t("components.toolSteps.fileChangeStats", {
                        added: fileChangeStats.added,
                        removed: fileChangeStats.removed,
                        defaultValue: `Added ${fileChangeStats.added} lines, removed ${fileChangeStats.removed} lines`,
                      })}
                    </Text>
                    <FileChangeViewer
                      payload={fileChangePayload}
                      compact={true}
                      showHeader={false}
                      showViewToggle={false}
                      defaultViewMode="unified"
                      maxHeight={INLINE_FILE_CHANGE_PREVIEW_MAX_HEIGHT}
                      unifiedLinesOverride={focusedInlineDiffLines ?? undefined}
                    />
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: "auto", fontSize: token.fontSizeSM - 1 }}
                      onClick={() => openDrawer(entry, "diff")}
                    >
                      {t("components.toolSteps.viewFullDiff", { defaultValue: "View full diff" })}
                    </Button>
                  </div>
                </div>
              )}
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
    [entries, token, t],
  );

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

      {(hideHeader || expanded) && (
        <div
          style={{
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

      {drawerEntry && (
        <ToolStepDetailDrawer
          open={drawerOpen}
          onClose={closeDrawer}
          sessionId={sessionId}
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
