import React, { useMemo } from "react";
import { Button, Drawer, Flex, theme, Typography } from "antd";
import { AppstoreOutlined, CloseOutlined, FlagOutlined } from "@ant-design/icons";

import InlineMetaText from "@shared/components/InlineMetaText";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";

import type { SessionDiffSummary } from "../components/ChatView/ActiveToolMessageCard";
import { ActiveToolMessageCard } from "../components/ChatView/ActiveToolMessageCard";
import { CHAT_FOCUS_INPUT_EVENT } from "../components/ChatView/events";
import { selectSessionById, useAppStore } from "../store";
import { useExperienceModeStore } from "@shared/store/experienceModeStore";

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

const SessionGoalCard: React.FC<{ sessionId: string }> = ({ sessionId }) => {
  const { token } = theme.useToken();
  const chat = useAppStore(selectSessionById(sessionId));
  const setInputContent = useAppStore((state) => state.setInputContent);
  const goldConfig = chat?.config?.goldConfig ?? null;
  const goalPrompt = (goldConfig?.goal ?? goldConfig?.evaluation_prompt)?.trim() ?? "";
  const isGoalEnabled = goldConfig?.enabled === true;
  const hasGoalPrompt = goalPrompt.length > 0;

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

  const sections = useMemo(
    () =>
      [
        {
          key: "goal",
          title: "Goal",
          showTitle: false,
          visible: hasGoalSection,
          node: <SessionGoalCard sessionId={sessionId} />,
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
    return (
      <Drawer
        title="Inspector"
        placement="right"
        open={open}
        onClose={() => onOpenChange(false)}
        width={inspectorWidthPx}
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
          <Text strong>Inspector</Text>
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
