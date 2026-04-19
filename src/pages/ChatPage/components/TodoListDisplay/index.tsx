import React from "react";
import { List, Progress, theme } from "antd";
import { Tag } from "@/components/ui/tag";
import { Card } from "@/components/ui/card";
import { Space } from "@/components/ui/space";
import { Flex } from "@/components/ui/flex";
import { Typography } from "@/components/ui/typography";
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
} from "@ant-design/icons";
import { TaskListMsg, TaskItemStatus } from "../../types/todoList";

interface TaskListDisplayProps {
  taskList: TaskListMsg;
}

export const TodoListDisplay: React.FC<TaskListDisplayProps> = ({ taskList }) => {
  const { token } = theme.useToken();
  const { Text } = Typography;

  const getStatusTag = (status: TaskItemStatus) => {
    switch (status) {
      case "pending":
        return (
          <Tag icon={<ClockCircleOutlined />} color="default">
            Pending
          </Tag>
        );
      case "in_progress":
        return (
          <Tag icon={<LoadingOutlined spin />} color="processing">
            In Progress
          </Tag>
        );
      case "completed":
        return (
          <Tag icon={<CheckCircleOutlined />} color="success">
            Completed
          </Tag>
        );
      case "skipped":
        return (
          <Tag icon={<MinusCircleOutlined />} color="default">
            Skipped
          </Tag>
        );
      case "failed":
        return (
          <Tag icon={<CloseCircleOutlined />} color="error">
            Failed
          </Tag>
        );
      default:
        return null;
    }
  };

  const getListStatusTag = () => {
    switch (taskList.status) {
      case "active":
        return <Tag color="processing">Active</Tag>;
      case "completed":
        return <Tag color="success">Completed</Tag>;
      case "abandoned":
        return <Tag color="error">Abandoned</Tag>;
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
          <Text type="secondary">{completionPercentage}% Complete</Text>
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
                </Flex>
              </List.Item>
            );
          }}
        />

        <Flex align="center" justify="space-between" wrap="wrap" gap="small">
          <Text type="secondary" style={{ fontSize: 12 }}>
            {taskList.items.filter((i) => i.status === "completed").length} /{" "}
            {taskList.items.length} tasks completed
          </Text>
          {currentItem ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              Current: {currentItem.description}
            </Text>
          ) : null}
        </Flex>
      </Flex>
    </Card>
  );
};

export default TodoListDisplay;
