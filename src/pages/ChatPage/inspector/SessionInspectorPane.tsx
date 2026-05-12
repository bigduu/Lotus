import React, { useMemo } from "react";
import { Button, Drawer, Flex, theme, Typography } from "antd";
import { AppstoreOutlined, CloseOutlined } from "@ant-design/icons";

import { useUILayoutStore } from "@shared/store/uiLayoutStore";

import type { SessionDiffSummary } from "../components/ChatView/ActiveToolMessageCard";
import { ActiveToolMessageCard } from "../components/ChatView/ActiveToolMessageCard";
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

  const sections = useMemo(
    () =>
      [
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
