import React, { useMemo } from "react";
import { Flex, Tag, Tooltip, Typography, theme } from "antd";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  QuestionCircleOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { selectRailModel, useAppStore } from "../../store";

import "./index.css";

const { Text } = Typography;
const { useToken } = theme;

/* ---------- Execution state machine (display-only) ---------- */

export type ExecutionState =
  | "idle"
  | "thinking"
  | "running_tools"
  | "waiting_user_answer"
  | "running_children"
  | "completed"
  | "error";

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

  const model = useAppStore(selectRailModel(sessionId));

  // Map the rich RailModel to the display-oriented ExecutionState.
  const executionState = useMemo<ExecutionState>(() => {
    if (model.hasError) return "error";
    if (model.hasQuestion) return "waiting_user_answer";

    switch (model.state) {
      case "idle":
      case "cancelled":
        return "idle";
      case "completed":
        return "completed";
      case "running_tools":
        return "running_tools";
      case "running_children":
        return "running_children";
      case "waiting_user_answer":
        return "waiting_user_answer";
      default:
        // starting, running, streaming, settling
        return "thinking";
    }
  }, [model]);

  // Only render when there's an active (non-idle) state
  if (executionState === "idle") return null;

  const config = STATUS_CONFIGS[executionState];
  const isActive = executionState !== "completed";

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

        {/* Concurrent tool calls */}
        {model.activeToolCalls.length > 0 &&
          model.activeToolCalls.map((tool) => (
            <Text key={tool.toolCallId} type="secondary" className="lotus-execution-rail__detail">
              {tool.toolName}
              {tool.preview ? ` · ${tool.preview}` : ""}
            </Text>
          ))}

        {/* Child session count */}
        {model.runningChildCount > 0 && (
          <Tooltip
            title={t("chat.statusRail.childrenTooltip", {
              running: model.runningChildCount,
              total: model.runningChildCount,
              defaultValue: "{{running}} running sub-sessions",
            })}
          >
            <Tag bordered={false} className="lotus-execution-rail__detail-tag">
              🔄 {model.runningChildCount}
            </Tag>
          </Tooltip>
        )}
      </Flex>
    </div>
  );
};

export default ExecutionStatusRail;
