import type { GlobalToken } from "antd/es/theme/interface";
import React, { useState } from "react";
import { useAppStore } from "@shared/store/appStore";
import {
  Alert,
  Badge,
  Card,
  Flex,
  List,
  Progress,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  CheckCircleOutlined,
  SyncOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  PushpinOutlined,
  PushpinFilled,
  DownOutlined,
  RightOutlined,
  RobotOutlined,
  ToolOutlined,
  LinkOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import InlineMetaText from "../../shared/components/InlineMetaText";

const { Text } = Typography;

// Type definitions (matching backend)
export interface TaskItem {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  depends_on: string[];
  notes: string;
  tool_calls_count?: number;
  summary?: string;
}

export interface TaskListData {
  session_id: string;
  title: string;
  items: TaskItem[];
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
}

interface TaskListPanelProps {
  sessionId: string;
  initialCollapsed?: boolean;
  compact?: boolean;
}

// Status configuration
// Status configuration factory – uses Ant Design theme tokens for dark/light safety
const getStatusConfig = (
  token: GlobalToken,
): Record<
  TaskItem["status"],
  {
    icon: React.ReactNode;
    color: string;
    textKey: string;
    tagColor: string;
  }
> => ({
  pending: {
    icon: <ClockCircleOutlined />,
    color: token.colorTextTertiary,
    textKey: "components.todoList.status.pending",
    tagColor: "default",
  },
  in_progress: {
    icon: <SyncOutlined spin />,
    color: token.colorPrimary,
    textKey: "components.todoList.status.inProgress",
    tagColor: "processing",
  },
  completed: {
    icon: <CheckCircleOutlined />,
    color: token.colorSuccess,
    textKey: "components.todoList.status.completed",
    tagColor: "success",
  },
  blocked: {
    icon: <ExclamationCircleOutlined />,
    color: token.colorError,
    textKey: "components.todoList.status.blocked",
    tagColor: "error",
  },
});

export const TodoList: React.FC<TaskListPanelProps> = ({
  sessionId,
  initialCollapsed = true,
  compact = false,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const statusConfig = React.useMemo(() => getStatusConfig(token), [token]);
  const sessionSummary = useAppStore((state) => state.chats.find((chat) => chat.id === sessionId));
  const sharedSessionId =
    sessionSummary?.kind === "child"
      ? sessionSummary.parentSessionId || sessionSummary.rootSessionId || sessionId
      : sessionId;

  // Get from Zustand store (real-time updates via useAgentEventSubscription)
  const taskListData = useAppStore((state) => state.taskLists[sharedSessionId]);
  const activeItemId = useAppStore((state) => state.activeItems[sharedSessionId]);
  const evaluationState = useAppStore((state) => state.evaluationStates[sharedSessionId]);

  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);
  const [isPinned, setIsPinned] = useState(false);

  // Use evaluation state from store
  const isEvaluating = evaluationState?.isEvaluating || false;
  const evaluationReasoning = evaluationState?.reasoning || null;

  // Transform store data to display format
  const taskList: TaskListData | null = taskListData
    ? {
        session_id: taskListData.session_id,
        title: taskListData.title,
        items: taskListData.items,
        progress: {
          completed: taskListData.items.filter((i) => i.status === "completed").length,
          total: taskListData.items.length,
          percentage:
            taskListData.items.length > 0
              ? Math.round(
                  (taskListData.items.filter((i) => i.status === "completed").length /
                    taskListData.items.length) *
                    100,
                )
              : 0,
        },
      }
    : null;

  // If no task list, don't render anything
  if (!taskList) {
    return null;
  }

  // Toggle collapse state
  const toggleCollapse = () => {
    if (!isPinned) {
      setIsCollapsed(!isCollapsed);
    }
  };

  // Toggle pin state
  const togglePin = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPinned(!isPinned);
    if (!isPinned) {
      setIsCollapsed(false);
    }
  };

  const { title, items, progress } = taskList;
  const isCompleted = progress.percentage === 100;

  const headerTitle = (
    <Space
      onClick={toggleCollapse}
      style={{ cursor: "pointer", width: "100%" }}
      size={compact ? 6 : 8}
    >
      <UnorderedListOutlined style={{ color: token.colorPrimary }} />
      <Text strong style={{ fontSize: compact ? 14 : 15 }}>
        {title || t("components.todoList.title")}
      </Text>
      {isEvaluating &&
        (compact ? (
          <InlineMetaText
            nowrap
            items={[
              <>
                <SyncOutlined spin style={{ color: token.colorPrimary, marginRight: 4 }} />
                {t("components.todoList.evaluating")}
              </>,
            ]}
          />
        ) : (
          <Tag icon={<SyncOutlined spin />} color="processing">
            {t("components.todoList.evaluating")}
          </Tag>
        ))}
      {!isCollapsed && progress.total > 0 && (
        <Badge
          count={`${progress.completed}/${progress.total}`}
          style={{
            backgroundColor: isCompleted ? token.colorSuccess : token.colorPrimary,
          }}
        />
      )}
    </Space>
  );

  const headerExtra = (
    <Space size={compact ? 6 : 8}>
      {progress.total > 0 && isCollapsed && (
        <Text type="secondary" style={{ fontSize: compact ? 12 : 13 }}>
          {progress.completed}/{progress.total}
          {isCompleted && (
            <CheckCircleOutlined style={{ color: token.colorSuccess, marginLeft: 4 }} />
          )}
        </Text>
      )}
      <Tooltip title={isPinned ? t("components.todoList.unpin") : t("components.todoList.pin")}>
        <span
          onClick={togglePin}
          style={{
            cursor: "pointer",
            color: isPinned ? token.colorPrimary : token.colorTextSecondary,
            fontSize: compact ? 14 : 16,
          }}
        >
          {isPinned ? <PushpinFilled /> : <PushpinOutlined />}
        </span>
      </Tooltip>
      {!isPinned && (
        <span
          onClick={toggleCollapse}
          style={{
            cursor: "pointer",
            color: token.colorTextSecondary,
            fontSize: 12,
            transform: isCollapsed ? "rotate(-90deg)" : undefined,
            transition: "transform 0.2s",
          }}
        >
          {isCollapsed ? <RightOutlined /> : <DownOutlined />}
        </span>
      )}
    </Space>
  );

  const bodyContent = !isCollapsed ? (
    <>
      {/* Evaluation reasoning banner */}
      {evaluationReasoning ? (
        compact ? (
          <Text
            type="secondary"
            style={{
              display: "block",
              marginBottom: token.marginXS,
              fontSize: 12,
              paddingLeft: token.paddingXS,
              borderLeft: `2px solid ${token.colorPrimaryBorder}`,
              lineHeight: 1.45,
            }}
          >
            <RobotOutlined style={{ marginRight: 6 }} />
            {evaluationReasoning}
          </Text>
        ) : (
          <Alert
            icon={<RobotOutlined />}
            message={t("components.todoList.llmEvaluation")}
            description={evaluationReasoning}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )
      ) : null}

      {/* Progress bar */}
      {progress.total > 0 && (
        <div style={{ marginBottom: compact ? token.marginXS : 16 }}>
          <Progress
            percent={progress.percentage}
            size="small"
            status={isCompleted ? "success" : "active"}
            format={(percent) => <Text type="secondary">{percent}%</Text>}
          />
        </div>
      )}

      {/* Task list */}
      <List
        size="small"
        split={false}
        dataSource={items}
        renderItem={(item) => {
          const status = statusConfig[item.status];
          const isActive = activeItemId === item.id;
          const statusText = t(status.textKey);

          return (
            <List.Item
              style={{
                padding: compact ? "6px 0" : "12px 0",
                borderLeft: isActive ? `3px solid ${token.colorPrimary}` : "3px solid transparent",
                paddingLeft: isActive ? (compact ? 8 : 12) : compact ? 10 : 15,
                backgroundColor: compact
                  ? "transparent"
                  : isActive
                    ? token.colorPrimaryBg
                    : "transparent",
                borderRadius: compact ? 0 : 4,
                marginBottom: compact ? 0 : 4,
              }}
            >
              <div style={{ width: "100%" }}>
                <Space align="start" style={{ width: "100%" }} size={compact ? 6 : 8}>
                  <Tooltip title={statusText}>
                    <span style={{ color: status.color, fontSize: compact ? 14 : 16 }}>
                      {status.icon}
                    </span>
                  </Tooltip>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text
                      style={{
                        textDecoration: item.status === "completed" ? "line-through" : "none",
                        color:
                          item.status === "completed" ? token.colorTextSecondary : token.colorText,
                        fontWeight: isActive ? 500 : 400,
                        fontSize: compact ? 13 : undefined,
                      }}
                    >
                      {item.description}
                    </Text>

                    {/* Meta info */}
                    <div style={{ marginTop: compact ? 3 : 4 }}>
                      {compact ? (
                        <InlineMetaText
                          block
                          items={[
                            <span style={{ color: status.color }}>{statusText}</span>,
                            item.tool_calls_count !== undefined && item.tool_calls_count > 0
                              ? `${item.tool_calls_count} ${t("components.todoList.tools")}`
                              : null,
                            item.depends_on?.length > 0
                              ? `${item.depends_on.length} ${t("components.todoList.dependencies")}`
                              : null,
                          ]}
                        />
                      ) : (
                        <Space size={compact ? 6 : 8} wrap>
                          <Tag color={status.tagColor}>{statusText}</Tag>

                          {/* Tool calls count */}
                          {item.tool_calls_count !== undefined && item.tool_calls_count > 0 && (
                            <Tag icon={<ToolOutlined />} color="processing">
                              {item.tool_calls_count} {t("components.todoList.tools")}
                            </Tag>
                          )}

                          {/* Dependencies */}
                          {item.depends_on?.length > 0 && (
                            <Tooltip
                              title={t("components.todoList.dependsOn", {
                                deps: item.depends_on.join(", "),
                              })}
                            >
                              <Tag icon={<LinkOutlined />}>
                                {item.depends_on.length} {t("components.todoList.dependencies")}
                              </Tag>
                            </Tooltip>
                          )}
                        </Space>
                      )}
                    </div>

                    {/* Summary (for completed tasks) */}
                    {item.status === "completed" && item.summary && (
                      <Text
                        type="secondary"
                        style={
                          compact
                            ? {
                                display: "block",
                                marginTop: 4,
                                fontSize: 12,
                                paddingLeft: token.paddingXS,
                                borderLeft: `2px solid ${token.colorSuccessBorder}`,
                                color: token.colorSuccess,
                                lineHeight: 1.45,
                              }
                            : {
                                display: "block",
                                marginTop: 6,
                                fontSize: 12,
                                padding: "4px 8px",
                                backgroundColor: token.colorSuccessBg,
                                borderRadius: 4,
                                color: token.colorSuccess,
                              }
                        }
                      >
                        {item.summary}
                      </Text>
                    )}

                    {/* Notes */}
                    {item.notes && (
                      <Text
                        type="secondary"
                        style={
                          compact
                            ? {
                                display: "block",
                                marginTop: 4,
                                fontSize: 12,
                                paddingLeft: token.paddingXS,
                                borderLeft: `2px solid ${token.colorBorderSecondary}`,
                                lineHeight: 1.45,
                              }
                            : {
                                display: "block",
                                marginTop: 6,
                                fontSize: 12,
                                padding: "4px 8px",
                                backgroundColor: token.colorFillQuaternary,
                                borderRadius: 4,
                              }
                        }
                      >
                        {item.notes}
                      </Text>
                    )}
                  </div>
                </Space>
              </div>
            </List.Item>
          );
        }}
      />
    </>
  ) : null;

  if (compact) {
    return (
      <section
        data-testid="todo-list-panel"
        style={{
          width: "100%",
          minWidth: 0,
          marginBottom: token.marginXS,
          overflow: "hidden",
          opacity: isCollapsed && !isPinned ? 0.9 : 1,
        }}
      >
        <Flex
          align="center"
          justify="space-between"
          gap={token.marginXS}
          style={{
            padding: `${token.paddingXXS ?? 2}px 0 ${token.paddingXS}px`,
            borderBottom: !isCollapsed
              ? `1px solid ${isEvaluating ? token.colorPrimaryBorder : token.colorBorderSecondary}`
              : undefined,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>{headerTitle}</div>
          <div style={{ flex: "0 0 auto" }}>{headerExtra}</div>
        </Flex>
        {bodyContent ? (
          <div style={{ padding: `0 0 ${token.paddingXS}px` }}>{bodyContent}</div>
        ) : null}
      </section>
    );
  }

  return (
    <Card
      size="small"
      className="lotus-settings-card"
      style={{
        marginBottom: 16,
        borderRadius: 8,
        boxShadow: isEvaluating
          ? `0 0 0 2px ${token.colorPrimaryBorder}`
          : "0 2px 8px rgba(0, 0, 0, 0.06)",
        opacity: isCollapsed && !isPinned ? 0.9 : 1,
      }}
      styles={{
        body: {
          padding: isCollapsed ? "12px 16px" : 16,
        },
      }}
      title={headerTitle}
      extra={headerExtra}
    >
      {bodyContent}
    </Card>
  );
};

export default TodoList;
