import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Card, Form, Input, Space, Typography, theme } from "antd";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { serviceFactory } from "../../../../services/common/ServiceFactory";

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
      return t(
        "settings.configTab.accessPassword.helperNotEnabled",
        "未设置访问密码。设置后，远程访问需要先输入密码，本地 loopback 访问可直接绕过。",
      );
    }
    if (localBypass) {
      return t(
        "settings.configTab.accessPassword.helperLocalBypass",
        "当前是本地访问，可直接修改访问密码，无需输入当前密码。",
      );
    }
    return t(
      "settings.configTab.accessPassword.helperRemote",
      "当前是远程访问。修改访问密码前，必须先输入当前密码。",
    );
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
          ? t("settings.configTab.accessPassword.updated", "访问密码已更新")
          : t("settings.configTab.accessPassword.enabled", "访问密码已设置"),
      );
      form.resetFields();
      await loadStatus();
    } catch (error) {
      if ((error as { errorFields?: unknown }).errorFields) {
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
      title={<Text strong>{t("settings.configTab.accessPasswordTitle", "访问密码")}</Text>}
    >
      <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
        <Alert
          type={passwordEnabled ? "info" : "warning"}
          showIcon
          message={
            passwordEnabled
              ? t("settings.configTab.accessPassword.statusEnabled", "访问密码已启用")
              : t("settings.configTab.accessPassword.statusDisabled", "访问密码未启用")
          }
          description={helperText}
        />

        {loadError ? <Alert type="error" showIcon message={loadError} /> : null}

        <Form form={form} layout="vertical" disabled={isLoading || isSaving}>
          {requiresCurrentPassword ? (
            <Form.Item
              label={t("settings.configTab.accessPassword.currentPasswordLabel", "当前密码")}
              name="currentPassword"
              rules={[
                {
                  required: true,
                  message: t(
                    "settings.configTab.accessPassword.validation.currentPasswordRequired",
                    "请输入当前密码",
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
                ? t("settings.configTab.accessPassword.newPasswordLabel", "新密码")
                : t("settings.configTab.accessPassword.setPasswordLabel", "设置密码")
            }
            name="newPassword"
            rules={[
              {
                required: true,
                message: t(
                  "settings.configTab.accessPassword.validation.newPasswordRequired",
                  "请输入新密码",
                ),
              },
              {
                min: 4,
                message: t(
                  "settings.configTab.accessPassword.validation.minLength",
                  "密码长度至少 4 位",
                ),
              },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            label={t("settings.configTab.accessPassword.confirmPasswordLabel", "确认密码")}
            name="confirmPassword"
            dependencies={["newPassword"]}
            rules={[
              {
                required: true,
                message: t(
                  "settings.configTab.accessPassword.validation.confirmPasswordRequired",
                  "请再次输入新密码",
                ),
              },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("newPassword") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error(
                      t(
                        "settings.configTab.accessPassword.validation.passwordMismatch",
                        "两次输入的密码不一致",
                      ),
                    ),
                  );
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Button variant="default" loading={isSaving} onClick={() => void handleSubmit()}>
            {passwordEnabled
              ? t("settings.configTab.accessPassword.updateAction", "更新访问密码")
              : t("settings.configTab.accessPassword.enableAction", "启用访问密码")}
          </Button>
        </Form>
      </Space>
    </Card>
  );
};

export default AccessPasswordCard;
