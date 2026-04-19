import React from "react";
import { Card, Space, Descriptions, theme, Tag, Flex } from "antd";
import { Typography } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { CheckOutlined, CloseOutlined, ToolOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

const { Text, Title } = Typography;

export interface ApprovalData {
  tool_call: string;
  parameters: Array<{ name: string; value: string }>;
  approval?: boolean;
  approval_status?: "pending" | "approved" | "rejected";
  display_preference?: "Visible" | "Collapsible" | "Hidden";
}

interface ApprovalCardProps {
  data: ApprovalData;
  onApprove: () => void;
  onReject: () => void;
  disabled?: boolean;
}

const ApprovalCard: React.FC<ApprovalCardProps> = ({
  data,
  onApprove,
  onReject,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const items = data.parameters.map((param, index) => ({
    key: index.toString(),
    label: param.name,
    children: (
      <Text code style={{ fontSize: token.fontSizeSM }}>
        {param.value}
      </Text>
    ),
  }));

  return (
    <Card
      size="small"
      style={{
        backgroundColor: token.colorInfoBg,
        borderColor: token.colorInfoBorder,
        borderRadius: token.borderRadiusLG,
      }}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Flex vertical>
          <Title level={5} style={{ margin: 0, color: token.colorInfo }}>
            <ToolOutlined style={{ marginRight: 6 }} />
            {t("components.approval.executionRequest")}
          </Title>
          <Space align="center" size="small">
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {t("components.approval.aiWantsExecute")}
            </Text>
            {data.approval_status && (
              <Tag
                color={
                  data.approval_status === "approved"
                    ? "success"
                    : data.approval_status === "rejected"
                      ? "error"
                      : "warning"
                }
              >
                {data.approval_status.toUpperCase()}
              </Tag>
            )}
          </Space>
        </Flex>

        <Flex align="center" gap={token.marginXS} wrap="wrap">
          <Text strong>{t("components.approval.workflow")}:</Text>
          <Text code style={{ fontSize: token.fontSize }}>
            {data.tool_call}
          </Text>
        </Flex>

        {data.parameters.length > 0 && (
          <Flex vertical>
            <Text strong style={{ marginBottom: token.marginXS, display: "block" }}>
              {t("common.parameters")}:
            </Text>
            <Descriptions
              size="small"
              column={1}
              items={items}
              style={{
                backgroundColor: token.colorBgContainer,
                borderRadius: token.borderRadius,
              }}
            />
          </Flex>
        )}

        <Space style={{ width: "100%", justifyContent: "center" }}>
          <Button
            variant="default"
            icon={<CheckOutlined />}
            onClick={onApprove}
            disabled={
              disabled || data.approval_status === "approved" || data.approval_status === "rejected"
            }
            style={{
              backgroundColor: token.colorSuccess,
              borderColor: token.colorSuccess,
            }}
          >
            {t("common.approve")}
          </Button>
          <Button
            icon={<CloseOutlined />}
            onClick={onReject}
            disabled={
              disabled || data.approval_status === "approved" || data.approval_status === "rejected"
            }
            variant="destructive"
          >
            {t("common.reject")}
          </Button>
        </Space>
      </Space>
    </Card>
  );
};

export default ApprovalCard;
