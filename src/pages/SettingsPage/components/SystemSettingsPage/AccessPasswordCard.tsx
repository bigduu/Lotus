import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Form, Input, Space, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import { serviceFactory } from "@services/common/ServiceFactory";
import { isAntdFormError } from "@shared/utils/formError";

const { Text } = Typography;
const { useToken } = theme;

interface AccessPasswordCardProps {
  msgApi: {
    success: (content: string) => void;
    error: (content: string) => void;
  };
}

export const AccessPasswordCard: React.FC<AccessPasswordCardProps> = ({ msgApi }) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [form] = Form.useForm<{
    currentPassword?: string;
    newPassword: string;
    confirmPassword: string;
  }>();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [localBypass, setLocalBypass] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const requiresCurrentPassword = passwordEnabled && !localBypass;

  const helperText = useMemo(() => {
    if (!passwordEnabled) {
      return t("settings.configTab.accessPassword.helperNotEnabled");
    }
    if (localBypass) {
      return t("settings.configTab.accessPassword.helperLocalBypass");
    }
    return t("settings.configTab.accessPassword.helperRemote");
  }, [localBypass, passwordEnabled, t]);

  const loadStatus = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const status = await serviceFactory.getAccessStatus();
      setPasswordEnabled(status.password_enabled);
      setLocalBypass(status.local_bypass);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t("settings.configTab.accessPassword.loadStatusFailed", "Failed to load access status");
      setLoadError(message);
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setIsSaving(true);

      await serviceFactory.updateAccessPassword({
        current_password: values.currentPassword?.trim() || undefined,
        new_password: values.newPassword.trim(),
      });

      msgApi.success(
        passwordEnabled
          ? t("settings.configTab.accessPassword.updated")
          : t("settings.configTab.accessPassword.enabled"),
      );
      form.resetFields();
      await loadStatus();
    } catch (error) {
      if (isAntdFormError(error)) {
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : t("settings.configTab.accessPassword.updateFailed", "Failed to update access password");
      msgApi.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card
      size="small"
      className="lotus-settings-card"
      title={<Text strong>{t("settings.configTab.accessPasswordTitle")}</Text>}
    >
      <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
        <Alert
          type={passwordEnabled ? "info" : "warning"}
          showIcon
          message={
            passwordEnabled
              ? t("settings.configTab.accessPassword.statusEnabled")
              : t("settings.configTab.accessPassword.statusDisabled")
          }
          description={helperText}
        />

        {loadError ? <Alert type="error" showIcon message={loadError} /> : null}

        <Form form={form} layout="vertical" disabled={isLoading || isSaving}>
          {requiresCurrentPassword ? (
            <Form.Item
              label={t("settings.configTab.accessPassword.currentPasswordLabel")}
              name="currentPassword"
              rules={[
                {
                  required: true,
                  message: t(
                    "settings.configTab.accessPassword.validation.currentPasswordRequired",
                  ),
                },
              ]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
          ) : null}

          <Form.Item
            label={
              passwordEnabled
                ? t("settings.configTab.accessPassword.newPasswordLabel")
                : t("settings.configTab.accessPassword.setPasswordLabel")
            }
            name="newPassword"
            rules={[
              {
                required: true,
                message: t("settings.configTab.accessPassword.validation.newPasswordRequired"),
              },
              {
                min: 4,
                message: t("settings.configTab.accessPassword.validation.minLength"),
              },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            label={t("settings.configTab.accessPassword.confirmPasswordLabel")}
            name="confirmPassword"
            dependencies={["newPassword"]}
            rules={[
              {
                required: true,
                message: t("settings.configTab.accessPassword.validation.confirmPasswordRequired"),
              },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("newPassword") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error(t("settings.configTab.accessPassword.validation.passwordMismatch")),
                  );
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Button type="primary" loading={isSaving} onClick={() => void handleSubmit()}>
            {passwordEnabled
              ? t("settings.configTab.accessPassword.updateAction")
              : t("settings.configTab.accessPassword.enableAction")}
          </Button>
        </Form>
      </Space>
    </Card>
  );
};

export default AccessPasswordCard;
