import React, { useMemo } from "react";
import { Button, Drawer, Flex, Tag, theme, Typography } from "antd";
import {
  AppstoreOutlined,
  CloseOutlined,
  FlagOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import InlineMetaText from "@shared/components/InlineMetaText";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import { useIsMobile } from "@shared/hooks/useMediaQuery";

import type { SessionDiffSummary } from "../components/ChatView/ActiveToolMessageCard";
import { ActiveToolMessageCard } from "../components/ChatView/ActiveToolMessageCard";
import { CHAT_FOCUS_INPUT_EVENT } from "../components/ChatView/events";
import { selectSessionById, useAppStore } from "@shared/store/appStore";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import { PROVIDER_LABELS, type ProviderType } from "@shared/types/providerConfig";
import { useExperienceModeStore } from "@shared/store/experienceModeStore";

const REASONING_EFFORT_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const LazySessionSummaryCard = React.lazy(() =>
  import("../components/SessionSummaryCard").then((m) => ({ default: m.SessionSummaryCard })),
);
const LazyTodoList = React.lazy(() =>
  import("@components/TodoList").then((m) => ({ default: m.TodoList })),
);
const LazySubAgentsPanel = React.lazy(() =>
  import("../components/ChatView/SubAgentsPanel").then((m) => ({ default: m.SubAgentsPanel })),
);

const { Title, Text } = Typography;

/** Display metadata for each runtime goal status (antd Tag color presets). */
const GOAL_STATUS_META: Record<string, { label: string; color: string }> = {
  active: { label: "Active", color: "processing" },
  complete: { label: "Complete", color: "success" },
  blocked: { label: "Blocked", color: "error" },
  need_input: { label: "Needs input", color: "warning" },
  budget_limited: { label: "Budget limited", color: "warning" },
};

const SessionGoalCard: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { token } = theme.useToken();
  const chat = useAppStore(selectSessionById(sessionId));
  const setInputContent = useAppStore((state) => state.setInputContent);
  const goldConfig = chat?.config?.goldConfig ?? null;
  const goalState = chat?.config?.goalState ?? null;
  const goalPrompt = (goldConfig?.goal ?? goldConfig?.evaluation_prompt)?.trim() ?? "";
  const isGoalEnabled = goldConfig?.enabled === true;
  const hasGoalPrompt = goalPrompt.length > 0;
  const lastEval = goalState?.eval_history?.[goalState.eval_history.length - 1] ?? null;

  if (!chat || !goldConfig || (!hasGoalPrompt && !isGoalEnabled)) {
    return null;
  }

  const handleEditGoal = () => {
    const nextInput = hasGoalPrompt ? `/goal ${goalPrompt}` : "/goal ";
    setInputContent(sessionId, nextInput);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(CHAT_FOCUS_INPUT_EVENT, {
          detail: { sessionId },
        }),
      );
    }
  };

  return (
    <div
      data-testid="session-goal-card"
      style={{
        padding: `${token.paddingXXS}px ${token.paddingXS}px`,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${isGoalEnabled ? token.colorWarningBorder : token.colorBorderSecondary}`,
        background: isGoalEnabled ? token.colorWarningBg : token.colorFillQuaternary,
      }}
    >
      <Flex vertical gap={4} style={{ width: "100%", minWidth: 0 }}>
        <Flex align="center" justify="space-between" gap={8}>
          <Flex align="center" gap={6} style={{ minWidth: 0 }}>
            <FlagOutlined
              style={{ color: isGoalEnabled ? token.colorWarning : token.colorTextSecondary }}
            />
            <Text strong style={{ fontSize: 12 }}>
              Goal
            </Text>
          </Flex>
          <Button size="small" type="text" onClick={handleEditGoal} style={{ paddingInline: 6 }}>
            Edit /goal
          </Button>
        </Flex>
        <InlineMetaText
          items={[
            isGoalEnabled ? "Enabled" : "Disabled",
            goldConfig.auto_answer_enabled ? "Auto-answer" : null,
            goldConfig.auto_continue_enabled ? "Auto-continue" : null,
          ]}
          block
        />
        <Text
          style={{
            fontSize: 12,
            lineHeight: 1.45,
            color: hasGoalPrompt ? token.colorText : token.colorTextSecondary,
            whiteSpace: "pre-wrap",
          }}
        >
          {hasGoalPrompt ? goalPrompt : "Use /goal <prompt> in the composer to set a session goal."}
        </Text>
        {goalState ? (
          <Flex vertical gap={4} style={{ marginTop: 2 }}>
            <Flex align="center" gap={6} wrap="wrap">
              <Tag
                color={GOAL_STATUS_META[goalState.status]?.color ?? "default"}
                style={{ marginInlineEnd: 0 }}
              >
                {GOAL_STATUS_META[goalState.status]?.label ?? goalState.status}
              </Tag>
              {goalState.continuation_count > 0 ? (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {goalState.continuation_count} continuation
                  {goalState.continuation_count === 1 ? "" : "s"}
                </Text>
              ) : null}
              {goalState.eval_history?.length ? (
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {goalState.eval_history.length} double-check
                  {goalState.eval_history.length === 1 ? "" : "s"}
                </Text>
              ) : null}
            </Flex>
            {lastEval ? (
              <Text
                type="secondary"
                style={{ fontSize: 11, lineHeight: 1.4, whiteSpace: "pre-wrap" }}
              >
                {`Last check [${lastEval.checkpoint}] ${lastEval.decision}/${lastEval.confidence}: ${lastEval.reasoning}`}
              </Text>
            ) : null}
          </Flex>
        ) : null}
      </Flex>
    </div>
  );
};

/**
 * Shows the session's effective run configuration — model, provider and
 * reasoning effort — which previously were only visible by opening the
 * composer. Read-only; "Edit" focuses the composer where these are editable.
 */
const SessionConfigCard: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const chat = useAppStore(selectSessionById(sessionId));
  const providerInstances = useProviderStore((state) => state.providerInstances);

  const config = chat?.config;
  const modelName = config?.model_ref?.model ?? config?.model ?? null;
  const providerKey = config?.model_ref?.provider ?? null;

  const providerLabel = useMemo(() => {
    if (!providerKey) return null;
    const instance = providerInstances.find((inst) => inst.id === providerKey);
    if (instance) return instance.label || instance.id;
    return PROVIDER_LABELS[providerKey as ProviderType] ?? providerKey;
  }, [providerKey, providerInstances]);

  // Show the card whenever a model is known (effectively always for real sessions).
  if (!chat || !modelName) {
    return null;
  }

  const reasoningRaw = config?.reasoningEffort ?? null;
  const reasoningLabel = reasoningRaw
    ? (REASONING_EFFORT_LABELS[reasoningRaw] ?? reasoningRaw)
    : "Provider default";
  const roleLabel = config?.agentRole ?? null;

  const rows: Array<{ label: string; value: string; muted?: boolean }> = [
    { label: "Model", value: modelName },
    ...(providerLabel ? [{ label: "Provider", value: providerLabel }] : []),
    { label: "Reasoning", value: reasoningLabel, muted: !reasoningRaw },
    ...(roleLabel ? [{ label: "Role", value: roleLabel }] : []),
  ];

  return (
    <div
      data-testid="session-config-card"
      style={{
        padding: `${token.paddingXXS}px ${token.paddingXS}px`,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillQuaternary,
      }}
    >
      <Flex vertical gap={4} style={{ width: "100%", minWidth: 0 }}>
        <Flex align="center" gap={6} style={{ minWidth: 0 }}>
          <RobotOutlined style={{ color: token.colorTextSecondary }} />
          <Text strong style={{ fontSize: 12 }}>
            {t("inspector.configuration")}
          </Text>
        </Flex>
        <Flex vertical gap={2} style={{ width: "100%", minWidth: 0 }}>
          {rows.map((row) => (
            <Flex key={row.label} align="center" justify="space-between" gap={8}>
              <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
                {row.label}
              </Text>
              <Text
                style={{
                  fontSize: 12,
                  textAlign: "right",
                  color: row.muted ? token.colorTextTertiary : token.colorText,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={row.value}
              >
                {row.value}
              </Text>
            </Flex>
          ))}
        </Flex>
      </Flex>
    </div>
  );
};

const ActiveWorkflowCard: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const workflow = useAppStore(selectSessionById(sessionId))?.activeWorkflow;
  if (!workflow) return null;

  const invocationMode =
    workflow.invokedBy === "model"
      ? t("chat.workflowSelection.invocationAutomatic")
      : t("chat.workflowSelection.invocationExplicit");
  const invokedBy =
    workflow.invokedBy === "model"
      ? t("chat.workflowSelection.invokedByModel")
      : workflow.invokedBy === "api"
        ? t("chat.workflowSelection.invokedByApi")
        : t("chat.workflowSelection.invokedByUser");
  const rows = [
    { label: "Name", value: workflow.name || workflow.id },
    { label: "Kind", value: workflow.kind },
    { label: "Source", value: workflow.source },
    ...(workflow.version ? [{ label: "Version", value: workflow.version }] : []),
    { label: "Revision", value: String(workflow.revision) },
    { label: "Invocation", value: `${invocationMode} · ${invokedBy}` },
  ];

  return (
    <div
      data-testid="active-workflow-card"
      style={{
        padding: `${token.paddingXXS}px ${token.paddingXS}px`,
        borderRadius: token.borderRadiusLG,
        border: `1px solid ${token.colorSuccessBorder}`,
        background: token.colorSuccessBg,
      }}
    >
      <Flex vertical gap={4} style={{ width: "100%", minWidth: 0 }}>
        <Flex align="center" justify="space-between" gap={8}>
          <Flex align="center" gap={6}>
            <ThunderboltOutlined style={{ color: token.colorSuccess }} />
            <Text strong style={{ fontSize: 12 }}>
              {t("inspector.activeWorkflow")}
            </Text>
          </Flex>
          <Tag
            color={workflow.status === "active" ? "success" : "warning"}
            style={{ marginInlineEnd: 0 }}
          >
            {workflow.status}
          </Tag>
        </Flex>
        <Flex vertical gap={2}>
          {rows.map((row) => (
            <Flex key={row.label} align="center" justify="space-between" gap={8}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {row.label}
              </Text>
              <Text
                title={row.value}
                style={{
                  fontSize: 12,
                  textAlign: "right",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {row.value}
              </Text>
            </Flex>
          ))}
        </Flex>
      </Flex>
    </div>
  );
};

export type SessionInspectorPaneProps = {
  sessionId: string | null;
  auxReady: boolean;
  mode: "rail" | "drawer";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showMessagesView: boolean;
  shouldShowTaskPanel: boolean;
  hasSubAgents: boolean;
  sessionDiffSummary: SessionDiffSummary | null;
};

const InspectorBody: React.FC<{
  sessionId: string;
  auxReady: boolean;
  showMessagesView: boolean;
  shouldShowTaskPanel: boolean;
  hasSubAgents: boolean;
  sessionDiffSummary: SessionDiffSummary | null;
}> = ({
  sessionId,
  auxReady,
  showMessagesView,
  shouldShowTaskPanel,
  hasSubAgents,
  sessionDiffSummary,
}) => {
  const { token } = theme.useToken();
  const isAdvancedMode = useExperienceModeStore((state) => state.isAdvanced);
  const chat = useAppStore(selectSessionById(sessionId));
  const hasGoalSection = Boolean(
    chat?.config?.goldConfig &&
      (((chat.config.goldConfig.goal ?? chat.config.goldConfig.evaluation_prompt)?.trim()?.length ??
        0) > 0 ||
        chat.config.goldConfig.enabled === true),
  );
  const hasConfigSection = Boolean(chat?.config?.model_ref?.model || chat?.config?.model);
  const hasActiveWorkflowSection = Boolean(chat?.activeWorkflow);

  const sections = useMemo(
    () =>
      [
        {
          key: "active-workflow",
          title: "Active Workflow",
          showTitle: false,
          visible: hasActiveWorkflowSection,
          node: <ActiveWorkflowCard sessionId={sessionId} />,
        },
        {
          key: "goal",
          title: "Goal",
          showTitle: false,
          visible: hasGoalSection,
          node: <SessionGoalCard sessionId={sessionId} />,
        },
        {
          key: "config",
          title: "Configuration",
          showTitle: false,
          visible: hasConfigSection,
          node: <SessionConfigCard sessionId={sessionId} />,
        },
        {
          key: "overview",
          title: "Overview",
          showTitle: false,
          visible: isAdvancedMode && showMessagesView,
          node: auxReady ? (
            <React.Suspense fallback={null}>
              <LazySessionSummaryCard sessionId={sessionId} compact />
            </React.Suspense>
          ) : null,
        },
        {
          key: "tasks",
          title: "Tasks",
          showTitle: false,
          visible: shouldShowTaskPanel,
          node: auxReady ? (
            <React.Suspense fallback={null}>
              <LazyTodoList sessionId={sessionId} initialCollapsed={false} compact />
            </React.Suspense>
          ) : null,
        },
        {
          key: "agents",
          title: "Sub-agents",
          showTitle: false,
          visible: hasSubAgents,
          node: auxReady ? (
            <React.Suspense fallback={null}>
              <LazySubAgentsPanel parentSessionId={sessionId} compact />
            </React.Suspense>
          ) : null,
        },
        {
          key: "diffs",
          title: "Diffs",
          showTitle: false,
          visible: Boolean(sessionDiffSummary),
          node: (
            <ActiveToolMessageCard
              sessionDiffSummary={sessionDiffSummary}
              sessionId={sessionId}
              compact
            />
          ),
        },
      ].filter((section) => section.visible),
    [
      auxReady,
      hasConfigSection,
      hasActiveWorkflowSection,
      hasGoalSection,
      hasSubAgents,
      isAdvancedMode,
      sessionDiffSummary,
      sessionId,
      shouldShowTaskPanel,
      showMessagesView,
    ],
  );

  if (sections.length === 0) {
    return (
      <Flex
        vertical
        align="center"
        justify="center"
        style={{
          minHeight: 180,
          color: token.colorTextSecondary,
          padding: token.paddingLG,
          textAlign: "center",
        }}
      >
        <Text type="secondary">No session details available yet.</Text>
      </Flex>
    );
  }

  return (
    <Flex vertical gap={2} style={{ width: "100%", minWidth: 0 }}>
      {sections.map((section, index) => (
        <section
          key={section.key}
          style={{
            width: "100%",
            minWidth: 0,
            paddingTop: index === 0 ? 0 : 6,
            borderTop: index === 0 ? "none" : `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          {section.showTitle ? (
            <Flex vertical gap={6} style={{ width: "100%", minWidth: 0 }}>
              <Title level={5} style={{ margin: 0, fontSize: token.fontSizeLG }}>
                {section.title}
              </Title>
              {section.node}
            </Flex>
          ) : (
            section.node
          )}
        </section>
      ))}
    </Flex>
  );
};

export const SessionInspectorPane: React.FC<SessionInspectorPaneProps> = ({
  sessionId,
  auxReady,
  mode,
  open,
  onOpenChange,
  showMessagesView,
  shouldShowTaskPanel,
  hasSubAgents,
  sessionDiffSummary,
}) => {
  const { token } = theme.useToken();
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const inspectorWidthPx = useUILayoutStore((state) => state.inspector.widthPx);
  const inspectorMinWidthPx = useUILayoutStore((state) => state.inspector.minWidthPx);
  const inspectorMaxWidthPx = useUILayoutStore((state) => state.inspector.maxWidthPx);

  if (!sessionId) {
    return null;
  }

  const content = (
    <InspectorBody
      sessionId={sessionId}
      auxReady={auxReady}
      showMessagesView={showMessagesView}
      shouldShowTaskPanel={shouldShowTaskPanel}
      hasSubAgents={hasSubAgents}
      sessionDiffSummary={sessionDiffSummary}
    />
  );

  if (mode === "drawer") {
    // On phones a right-side drawer at 520px just covers the whole screen, so
    // present the inspector as a bottom sheet (swipe-down-friendly, rounded top)
    // that leaves the conversation visible behind it.
    return (
      <Drawer
        title={t("inspector.title")}
        placement={isMobile ? "bottom" : "right"}
        open={open}
        onClose={() => onOpenChange(false)}
        width={isMobile ? undefined : inspectorWidthPx}
        height={isMobile ? "85vh" : undefined}
        styles={
          isMobile ? { content: { borderTopLeftRadius: 16, borderTopRightRadius: 16 } } : undefined
        }
      >
        {content}
      </Drawer>
    );
  }

  if (!open) {
    return null;
  }

  return (
    <aside
      data-session-inspector-pane
      style={{
        width: "100%",
        minWidth: inspectorMinWidthPx,
        maxWidth: inspectorMaxWidthPx,
        height: "100%",
        minHeight: 0,
        borderLeft: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgLayout,
        overflow: "auto",
      }}
    >
      <Flex
        align="center"
        justify="space-between"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 1,
          padding: `6px ${token.paddingSM}px`,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgLayout,
        }}
      >
        <Flex align="center" gap={token.marginXS}>
          <AppstoreOutlined />
          <Text strong>{t("inspector.title")}</Text>
        </Flex>
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          aria-label="Close inspector"
          onClick={() => onOpenChange(false)}
        />
      </Flex>
      <div style={{ padding: `6px ${token.paddingSM}px ${token.paddingSM}px`, minWidth: 0 }}>
        {content}
      </div>
    </aside>
  );
};

export default SessionInspectorPane;
