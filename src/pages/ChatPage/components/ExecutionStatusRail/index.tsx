import React, { useMemo } from "react";
import { Tooltip, theme } from "antd";
import { Tag } from "@/components/ui/tag";
import { Flex } from "@/components/ui/flex";
import { Typography } from "@/components/ui/typography";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  QuestionCircleOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { selectSessionById, useAppStore } from "../../store";

import "./index.css";

const { Text } = Typography;
const { useToken } = theme;

/* ---------- Execution state machine ---------- */

export type ExecutionState =
  | "idle"
  | "thinking"
  | "running_tools"
  | "waiting_approval"
  | "waiting_user_answer"
  | "running_children"
  | "completed"
  | "error";

type ExecutionStatusInfo = {
  state: ExecutionState;
  pendingApprovalToolName?: string;
  childSessionCount: number;
  runningChildCount: number;
  hasQuestion: boolean;
};

/* ---------- State derivation ---------- */

function deriveExecutionState(
  isProcessing: boolean,
  hasQuestion: boolean,
  hasPendingApproval: boolean,
  hasRunningChildren: boolean,
  hasError: boolean,
  isStreaming: boolean,
): ExecutionState {
  if (hasError) return "error";
  if (hasQuestion) return "waiting_user_answer";
  if (hasPendingApproval) return "waiting_approval";

  if (isProcessing) {
    if (hasRunningChildren) return "running_children";
    if (isStreaming) return "thinking";
    return "running_tools";
  }

  return "idle";
}

/* ---------- Status label/icon config ---------- */

type StatusConfig = {
  icon: React.ReactNode;
  color: string;
  labelKey: string;
  fallbackLabel: string;
  animate?: boolean;
};

const STATUS_CONFIGS: Record<ExecutionState, StatusConfig> = {
  idle: {
    icon: <MinusCircleOutlined />,
    color: "default",
    labelKey: "chat.statusRail.idle",
    fallbackLabel: "Ready",
  },
  thinking: {
    icon: <LoadingOutlined spin />,
    color: "processing",
    labelKey: "chat.statusRail.thinking",
    fallbackLabel: "Thinking…",
    animate: true,
  },
  running_tools: {
    icon: <SyncOutlined spin />,
    color: "processing",
    labelKey: "chat.statusRail.runningTools",
    fallbackLabel: "Running tools…",
    animate: true,
  },
  waiting_approval: {
    icon: <ExclamationCircleOutlined />,
    color: "warning",
    labelKey: "chat.statusRail.waitingApproval",
    fallbackLabel: "Waiting for approval",
  },
  waiting_user_answer: {
    icon: <QuestionCircleOutlined />,
    color: "warning",
    labelKey: "chat.statusRail.waitingAnswer",
    fallbackLabel: "Waiting for your answer",
  },
  running_children: {
    icon: <SyncOutlined spin />,
    color: "processing",
    labelKey: "chat.statusRail.runningChildren",
    fallbackLabel: "Running sub-sessions…",
    animate: true,
  },
  completed: {
    icon: <CheckCircleOutlined />,
    color: "success",
    labelKey: "chat.statusRail.completed",
    fallbackLabel: "Completed",
  },
  error: {
    icon: <CloseCircleOutlined />,
    color: "error",
    labelKey: "chat.statusRail.error",
    fallbackLabel: "Error",
  },
};

/* ---------- Component ---------- */

export type ExecutionStatusRailProps = {
  sessionId: string;
};

export const ExecutionStatusRail: React.FC<ExecutionStatusRailProps> = ({ sessionId }) => {
  const { t } = useTranslation();
  const { token } = useToken();

  // Gather all state signals
  const isProcessing = useAppStore((state) => state.processingChats.has(sessionId));
  const currentChat = useAppStore(selectSessionById(sessionId));
  const subSessions = useAppStore((state) => state.subSessionsByParent[sessionId]);
  const pendingQuestionRespond = useAppStore((state) => state.pendingQuestionRespond);

  const statusInfo = useMemo<ExecutionStatusInfo>(() => {
    const hasPendingApproval = Boolean(currentChat?.currentInteraction?.pendingApproval);
    const pendingApprovalToolName =
      currentChat?.currentInteraction?.pendingApproval?.toolName;
    const isStreaming = Boolean(currentChat?.currentInteraction?.streamingContent);
    const hasError = Boolean(currentChat?.currentInteraction?.error);
    const hasQuestion =
      pendingQuestionRespond?.sessionId === sessionId &&
      Boolean(pendingQuestionRespond?.question);

    // Count child sessions
    const childEntries = subSessions ? Object.entries(subSessions) : [];
    const childSessionCount = childEntries.length;
    const runningChildCount = childEntries.filter(
      ([, progress]) => {
        const status = (progress as any)?.status || "";
        return (
          status === "running" ||
          status === "started" ||
          status === "already_running"
        );
      },
    ).length;
    const hasRunningChildren = runningChildCount > 0;

    const state = deriveExecutionState(
      isProcessing,
      hasQuestion,
      hasPendingApproval,
      hasRunningChildren,
      hasError,
      isStreaming,
    );

    return {
      state,
      pendingApprovalToolName,
      childSessionCount,
      runningChildCount,
      hasQuestion,
    };
  }, [
    currentChat,
    isProcessing,
    pendingQuestionRespond,
    sessionId,
    subSessions,
  ]);

  // Only render when there's an active (non-idle) state
  if (statusInfo.state === "idle") return null;

  const config = STATUS_CONFIGS[statusInfo.state];

  const isActive = statusInfo.state !== "completed";

  return (
    <div
      className={`lotus-execution-rail ${isActive ? "lotus-execution-rail--active" : ""}`}
      style={{
        borderTopColor: token.colorBorderSecondary,
        backgroundColor: token.colorBgLayout,
      }}
    >
      <Flex align="center" gap={8} wrap="wrap" className="lotus-execution-rail__content">
        {/* Status tag */}
        <Tag
          icon={config.icon}
          color={config.color}
          bordered={false}
          className="lotus-execution-rail__status-tag"
        >
          {t(config.labelKey, config.fallbackLabel)}
        </Tag>

        {/* Pending approval tool name */}
        {statusInfo.state === "waiting_approval" && statusInfo.pendingApprovalToolName && (
          <Text type="secondary" className="lotus-execution-rail__detail">
            {statusInfo.pendingApprovalToolName}
          </Text>
        )}

        {/* Child session count */}
        {statusInfo.childSessionCount > 0 && (
          <Tooltip
            title={t("chat.statusRail.childrenTooltip", {
              running: statusInfo.runningChildCount,
              total: statusInfo.childSessionCount,
              defaultValue: "{{running}} running / {{total}} total sub-sessions",
            })}
          >
            <Tag bordered={false} className="lotus-execution-rail__detail-tag">
              🔄 {statusInfo.runningChildCount}/{statusInfo.childSessionCount}
            </Tag>
          </Tooltip>
        )}
      </Flex>
    </div>
  );
};

export default ExecutionStatusRail;
