import React from "react";
import type { TFunction } from "i18next";
import { Button, Flex, Tooltip, theme, Tag } from "antd";
import { AppstoreOutlined, CompassOutlined, ThunderboltOutlined } from "@ant-design/icons";

import type { ConversationWorkspaceState } from "../workspace/workspaceState";
import { selectSessionById, useAppStore } from "@shared/store/appStore";

const LazyContextBar = React.lazy(() =>
  import("../components/ContextBar").then((m) => ({ default: m.ContextBar })),
);

export type ConversationMetaStripProps = {
  sessionId: string | null;
  auxReady: boolean;
  maxWidth: string;
  paddingLeft: number;
  paddingRight: number;
  workspaceState: ConversationWorkspaceState;
  inspectorEligible: boolean;
  planMode:
    | {
        status: string;
        pre_permission_mode: string;
      }
    | null
    | undefined;
  onRequestOpenInspector?: () => void;
  t: TFunction;
};

export const ConversationMetaStrip: React.FC<ConversationMetaStripProps> = ({
  sessionId,
  auxReady,
  maxWidth,
  paddingLeft,
  paddingRight,
  workspaceState,
  inspectorEligible,
  planMode,
  onRequestOpenInspector,
  t,
}) => {
  const { token } = theme.useToken();
  const chat = useAppStore(selectSessionById(sessionId));

  if (!sessionId) {
    return null;
  }

  const planModeIndicator = planMode ? (
    <Tooltip
      title={t("chat.planMode.tooltip", {
        status: planMode.status,
        mode: planMode.pre_permission_mode,
      })}
    >
      <Tag color="purple" icon={<CompassOutlined />} style={{ marginInlineEnd: 0 }}>
        {t("chat.planMode.active")}
      </Tag>
    </Tooltip>
  ) : null;

  const activeWorkflow = chat?.activeWorkflow;
  const invocationMode =
    activeWorkflow?.invokedBy === "model"
      ? t("chat.workflowSelection.invocationAutomatic")
      : t("chat.workflowSelection.invocationExplicit");
  const invokedBy = activeWorkflow
    ? t(
        `chat.workflowSelection.invokedBy${
          activeWorkflow.invokedBy === "api"
            ? "Api"
            : activeWorkflow.invokedBy === "model"
              ? "Model"
              : "User"
        }`,
      )
    : null;
  const activeWorkflowIndicator = activeWorkflow ? (
    <Tooltip
      title={[
        activeWorkflow.name || activeWorkflow.id,
        activeWorkflow.kind,
        activeWorkflow.source,
        activeWorkflow.version ? `v${activeWorkflow.version}` : null,
        `r${activeWorkflow.revision}`,
        invocationMode,
        invokedBy,
        activeWorkflow.status,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <Tag color="green" icon={<ThunderboltOutlined />} style={{ marginInlineEnd: 0 }}>
        {t("chat.workflowSelection.active")}: {activeWorkflow.name || activeWorkflow.id} ·{" "}
        {invocationMode}
      </Tag>
    </Tooltip>
  ) : null;

  const showMetaStripInspectorToggle =
    inspectorEligible &&
    workspaceState.inspectorTogglePlacement === "meta_strip" &&
    Boolean(onRequestOpenInspector);

  const hasSecondaryRow = Boolean(
    activeWorkflowIndicator ||
      planModeIndicator ||
      workspaceState.isMultiPane ||
      showMetaStripInspectorToggle,
  );

  return (
    <>
      {auxReady ? (
        <React.Suspense fallback={null}>
          <LazyContextBar sessionId={sessionId} />
        </React.Suspense>
      ) : null}

      {hasSecondaryRow ? (
        <div
          data-conversation-meta-strip
          data-inspector-toggle-placement={workspaceState.inspectorTogglePlacement}
          style={{
            paddingTop: token.paddingXS,
            paddingRight,
            paddingBottom: 0,
            paddingLeft,
            maxWidth,
            margin: "0 auto",
            width: "100%",
          }}
        >
          <Flex align="center" justify="space-between" gap={token.marginXS} wrap>
            <Flex align="center" gap={token.marginXS} wrap>
              {planModeIndicator}
              {activeWorkflowIndicator}
              {workspaceState.isMultiPane ? (
                <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                  {t("chat.workspace.multiPane", {
                    count: workspaceState.leafCount,
                  })}
                </Tag>
              ) : null}
            </Flex>

            {showMetaStripInspectorToggle && onRequestOpenInspector ? (
              <Button
                size="small"
                icon={<AppstoreOutlined />}
                onClick={onRequestOpenInspector}
                aria-label={t("chat.workspace.toggleInspector")}
              >
                {workspaceState.inspectorMode === "drawer"
                  ? t("chat.workspace.openInspector")
                  : t("chat.workspace.toggleInspector")}
              </Button>
            ) : null}
          </Flex>
        </div>
      ) : null}
    </>
  );
};

export default ConversationMetaStrip;
