import React from "react";
import { Card, Flex, List, Progress, Space, Tag, Typography, theme } from "antd";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { TaskListMsg, TaskItemStatus } from "../../types/todoList";
import { useTranslation } from "react-i18next";

interface TaskListDisplayProps {
  taskList: TaskListMsg;
}

export const TodoListDisplay: React.FC<TaskListDisplayProps> = ({ taskList }) => {
  const { token } = theme.useToken();
  const { Text } = Typography;
  const { t } = useTranslation();

  const getStatusTag = (status: TaskItemStatus) => {
    switch (status) {
      case "pending":
        return (
          <Tag icon={<ClockCircleOutlined />} color="default">
            {t("components.todoList.status.pending")}
          </Tag>
        );
      case "in_progress":
        return (
          <Tag icon={<LoadingOutlined spin />} color="processing">
            {t("components.todoList.status.inProgress")}
          </Tag>
        );
      case "completed":
        return (
          <Tag icon={<CheckCircleOutlined />} color="success">
            {t("components.todoList.status.completed")}
          </Tag>
        );
      case "skipped":
        return (
          <Tag icon={<MinusCircleOutlined />} color="default">
            {t("components.todoList.status.skipped")}
          </Tag>
        );
      case "failed":
        return (
          <Tag icon={<CloseCircleOutlined />} color="error">
            {t("components.todoList.status.failed")}
          </Tag>
        );
      default:
        return null;
    }
  };

  const getListStatusTag = () => {
    switch (taskList.status) {
      case "active":
        return <Tag color="processing">{t("components.todoList.listStatus.active")}</Tag>;
      case "completed":
        return <Tag color="success">{t("components.todoList.listStatus.completed")}</Tag>;
      case "abandoned":
        return <Tag color="error">{t("components.todoList.listStatus.abandoned")}</Tag>;
      default:
        return null;
    }
  };

  const completionPercentage = React.useMemo(() => {
    if (taskList.items.length === 0) return 0;
    const completed = taskList.items.filter((item) => item.status === "completed").length;
    return Math.round((completed / taskList.items.length) * 100);
  }, [taskList.items]);

  const currentItem = React.useMemo(() => {
    return taskList.items.find((item) => item.status === "in_progress");
  }, [taskList.items]);

  return (
    <Card
      size="small"
      styles={{ body: { padding: token.paddingSM } }}
      style={{ borderRadius: token.borderRadiusLG }}
    >
      <Flex vertical gap={token.marginSM}>
        <Flex align="center" justify="space-between" wrap="wrap" gap="small">
          <Space direction="vertical" size={2}>
            <Text strong>{taskList.title}</Text>
            {taskList.description ? <Text type="secondary">{taskList.description}</Text> : null}
          </Space>
          {getListStatusTag()}
        </Flex>

        <Space direction="vertical" size={4}>
          <Progress
            percent={completionPercentage}
            status={
              taskList.status === "completed"
                ? "success"
                : taskList.status === "abandoned"
                  ? "exception"
                  : "active"
            }
            showInfo
          />
          <Text type="secondary">
            {t("components.todoList.percentComplete", { percent: completionPercentage })}
          </Text>
        </Space>

        <List
          size="small"
          dataSource={taskList.items}
          renderItem={(item) => {
            const isCurrent = currentItem?.id === item.id;
            return (
              <List.Item
                style={{
                  borderRadius: token.borderRadius,
                  padding: token.paddingXS,
                  background: isCurrent ? token.colorPrimaryBg : "transparent",
                  border: "1px solid",
                  borderColor: isCurrent ? token.colorPrimaryBorder : token.colorBorderSecondary,
                }}
              >
                <Flex vertical style={{ width: "100%" }} gap={4}>
                  <Flex align="center" justify="space-between" wrap="wrap" gap={8}>
                    <Text>{item.description}</Text>
                    {getStatusTag(item.status)}
                  </Flex>
                  {item.status === "failed" && item.metadata?.error ? (
                    <Text type="danger" style={{ fontSize: 12 }}>
                      {item.metadata.error}
                    </Text>
                  ) : null}
                  {item.status === "completed" && item.summary ? (
                    <Text type="success" style={{ fontSize: 12 }}>
                      {item.summary}
                    </Text>
                  ) : null}
                </Flex>
              </List.Item>
            );
          }}
        />

        <Flex align="center" justify="space-between" wrap="wrap" gap="small">
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("components.todoList.progressLabel", {
              completed: taskList.items.filter((i) => i.status === "completed").length,
              total: taskList.items.length,
            })}
          </Text>
          {currentItem ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("components.todoList.currentLabel", { description: currentItem.description })}
            </Text>
          ) : null}
        </Flex>
      </Flex>
    </Card>
  );
};

export default TodoListDisplay;
