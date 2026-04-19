import type { GlobalToken } from "antd/es/theme/interface";
import React, { useState } from "react";
import { useAppStore } from "../../pages/ChatPage/store";
import { Card, List, Tag, Progress, Badge, Tooltip, Space, Alert, theme } from "antd";
import { Typography } from "@/components/ui/typography";
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

const { Text } = Typography;

// Type definitions (matching backend)
export interface TaskItem {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "blocked";
  depends_on: string[];
  notes: string;
  tool_calls_count?: number;
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

export const TodoList: React.FC<TaskListPanelProps> = ({ sessionId, initialCollapsed = true }) => {
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

  return (
    <Card
      size="small"
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
      title={
        <Space onClick={toggleCollapse} style={{ cursor: "pointer", width: "100%" }}>
          <UnorderedListOutlined style={{ color: token.colorPrimary }} />
          <Text strong style={{ fontSize: 15 }}>
            {title || t("components.todoList.title")}
          </Text>
          {isEvaluating && (
            <Tag icon={<SyncOutlined spin />} color="processing">
              {t("components.todoList.evaluating")}
            </Tag>
          )}
          {!isCollapsed && progress.total > 0 && (
            <Badge
              count={`${progress.completed}/${progress.total}`}
              style={{
                backgroundColor: isCompleted ? token.colorSuccess : token.colorPrimary,
              }}
            />
          )}
        </Space>
      }
      extra={
        <Space>
          {progress.total > 0 && isCollapsed && (
            <Text type="secondary" style={{ fontSize: 13 }}>
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
                fontSize: 16,
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
      }
    >
      {!isCollapsed && (
        <>
          {/* Evaluation reasoning banner */}
          {evaluationReasoning && (
            <Alert
              icon={<RobotOutlined />}
              message={t("components.todoList.llmEvaluation")}
              description={evaluationReasoning}
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}

          {/* Progress bar */}
          {progress.total > 0 && (
            <div style={{ marginBottom: 16 }}>
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
            dataSource={items}
            renderItem={(item) => {
              const status = statusConfig[item.status];
              const isActive = activeItemId === item.id;
              const statusText = t(status.textKey);

              return (
                <List.Item
                  style={{
                    padding: "12px 0",
                    borderLeft: isActive
                      ? `3px solid ${token.colorPrimary}`
                      : "3px solid transparent",
                    paddingLeft: isActive ? 12 : 15,
                    backgroundColor: isActive ? token.colorPrimaryBg : "transparent",
                    borderRadius: 4,
                    marginBottom: 4,
                  }}
                >
                  <div style={{ width: "100%" }}>
                    <Space align="start" style={{ width: "100%" }}>
                      <Tooltip title={statusText}>
                        <span style={{ color: status.color, fontSize: 16 }}>{status.icon}</span>
                      </Tooltip>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={{
                            textDecoration: item.status === "completed" ? "line-through" : "none",
                            color:
                              item.status === "completed"
                                ? token.colorTextSecondary
                                : token.colorText,
                            fontWeight: isActive ? 500 : 400,
                          }}
                        >
                          {item.description}
                        </Text>

                        {/* Meta info */}
                        <div style={{ marginTop: 4 }}>
                          <Space size={8} wrap>
                            <Tag color={status.tagColor}>{statusText}</Tag>

                            {/* Tool calls count */}
                            {item.tool_calls_count !== undefined && item.tool_calls_count > 0 && (
                              <Tag icon={<ToolOutlined />} color="processing">
                                {item.tool_calls_count} {t("components.todoList.tools")}
                              </Tag>
                            )}

                            {/* Dependencies */}
                            {item.depends_on.length > 0 && (
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
                        </div>

                        {/* Notes */}
                        {item.notes && (
                          <Text
                            type="secondary"
                            style={{
                              display: "block",
                              marginTop: 6,
                              fontSize: 12,
                              padding: "4px 8px",
                              backgroundColor: token.colorFillQuaternary,
                              borderRadius: 4,
                            }}
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
      )}
    </Card>
  );
};

export default TodoList;
