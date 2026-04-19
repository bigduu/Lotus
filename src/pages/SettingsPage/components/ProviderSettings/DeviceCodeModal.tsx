import React from "react";
import { Modal, Alert, Card, Tag } from "antd";
import { Space } from "@/components/ui/space";
import { Typography } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { CheckCircleOutlined, ClockCircleOutlined, CopyOutlined } from "@ant-design/icons";
import type { GlobalToken } from "antd/es/theme/interface";
import { useTranslation } from "react-i18next";

const { Text, Paragraph } = Typography;

export interface DeviceCodeInfo {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
}

interface DeviceCodeModalProps {
  open: boolean;
  onCancel: () => void;
  onComplete: () => void;
  onCopyCode: () => void;
  completingAuth: boolean;
  copiedUserCode: boolean;
  deviceCodeInfo: DeviceCodeInfo | null;
  timeRemaining: number;
  token: GlobalToken;
}

export const DeviceCodeModal: React.FC<DeviceCodeModalProps> = ({
  open,
  onCancel,
  onComplete,
  onCopyCode,
  completingAuth,
  copiedUserCode,
  deviceCodeInfo,
  timeRemaining,
  token,
}) => {
  const { t } = useTranslation();

  return (
    <Modal
      title={t("settings.providerTab.copilotAuthModalTitle")}
      open={open}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          {t("settings.providerTab.cancel")}
        </Button>,
        <Button key="complete" variant="default" onClick={onComplete} loading={completingAuth}>
          {t("settings.providerTab.completedAuthorization")}
        </Button>,
      ]}
    >
      {deviceCodeInfo && (
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Alert
            message={t("settings.providerTab.browserOpened")}
            description={
              <ol>
                <li>{t("settings.providerTab.authStep1")}</li>
                <li>{t("settings.providerTab.authStep2")}</li>
                <li>{t("settings.providerTab.authStep3")}</li>
              </ol>
            }
            type="info"
          />

          {/* Verification URL */}
          <Card size="small" className="lotus-settings-card">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Text type="secondary">{t("settings.providerTab.visitUrl")}</Text>
              <Space>
                <Text copyable={{ text: deviceCodeInfo.verification_uri }}>
                  {deviceCodeInfo.verification_uri}
                </Text>
              </Space>
            </Space>
          </Card>

          {/* User Code */}
          <Card
            style={{
              textAlign: "center",
              background: token.colorFillTertiary,
              borderColor: token.colorBorderSecondary,
            }}
          >
            <Space direction="vertical" style={{ width: "100%" }}>
              <Text type="secondary">{t("settings.providerTab.enterCode")}</Text>
              <Space>
                <Text
                  style={{
                    color: token.colorText,
                    fontSize: "32px",
                    fontFamily: "monospace",
                    fontWeight: "bold",
                    letterSpacing: "4px",
                  }}
                >
                  {deviceCodeInfo.user_code}
                </Text>
                <Button
                  icon={copiedUserCode ? <CheckCircleOutlined /> : <CopyOutlined />}
                  onClick={onCopyCode}
                  variant={copiedUserCode ? "outline" : "default"}
                >
                  {copiedUserCode
                    ? t("settings.providerTab.copied")
                    : t("settings.providerTab.copyCode")}
                </Button>
              </Space>
              <div style={{ marginTop: 8 }}>
                <Tag
                  color={timeRemaining < 60 ? "error" : timeRemaining < 180 ? "warning" : "success"}
                >
                  <ClockCircleOutlined style={{ marginRight: 4 }} />
                  Expires in {Math.floor(timeRemaining / 60)}:
                  {(timeRemaining % 60).toString().padStart(2, "0")}
                </Tag>
              </div>
            </Space>
          </Card>

          <Paragraph type="secondary">{t("settings.providerTab.afterContinueHint")}</Paragraph>
        </Space>
      )}
    </Modal>
  );
};
