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
import { useShallow } from "zustand/react/shallow";

import { selectRailModel, useAppStore } from "@shared/store/appStore";

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
    fallbackLabel: "Running sub-agents…",
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

  // `selectRailModel` builds a fresh `RailModel` object literal on every
  // invocation (issue #6), so a plain `useAppStore(selectRailModel(id))`
  // subscription re-renders on *any* store mutation — not just this
  // session's execution state — because the default equality check
  // (`Object.is`) always sees a "new" object. `useShallow` compares the
  // returned object's own fields instead, and the underlying execution
  // reducer preserves referential identity for fields it doesn't touch
  // (see `executionStateSlice/reducer.ts`), so this bails out unless a
  // field relevant to this session's rail actually changed.
  const model = useAppStore(useShallow(selectRailModel(sessionId)));
  // Some embedded/legacy store harnesses omit this auxiliary slice.
  const evaluation = useAppStore((state) => state.evaluationStates?.[sessionId]);
  const isEvaluating = evaluation?.phase === "running";

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
  if (executionState === "idle" && !isEvaluating) return null;

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
        {executionState !== "idle" && (
          <Tag
            icon={config.icon}
            color={config.color}
            bordered={false}
            className="lotus-execution-rail__status-tag"
          >
            {t(config.labelKey, config.fallbackLabel)}
          </Tag>
        )}

        {isEvaluating && (
          <Tag
            icon={<SyncOutlined spin />}
            color="processing"
            bordered={false}
            className="lotus-execution-rail__status-tag"
          >
            {t("chat.statusRail.evaluatingTasks", "Evaluating task progress…")}
          </Tag>
        )}

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
              defaultValue: "{{running}} running sub-agents",
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
