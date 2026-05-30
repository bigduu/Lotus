import React, { useState, useEffect } from "react";
import { Button, Card, Input, Space, Typography, Alert, theme } from "antd";
import { useTranslation } from "react-i18next";
import { useBambooConfigStore } from "../../../../shared/store/bambooConfigStore";

const { Text } = Typography;
const { useToken } = theme;

interface NetworkSettingsCardProps {
  httpProxy: string;
  httpsProxy: string;
  onHttpProxyChange: (value: string) => void;
  onHttpsProxyChange: (value: string) => void;
  onReload: () => void;
  onSave: () => void;
  isLoading: boolean;
}

export const NetworkSettingsCard: React.FC<NetworkSettingsCardProps> = ({
  httpProxy,
  httpsProxy,
  onHttpProxyChange,
  onHttpsProxyChange,
  onReload,
  onSave,
  isLoading,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const proxyAuthStatus = useBambooConfigStore((state) => state.proxyAuthStatus);
  const isLoadingProxyAuthStatus = useBambooConfigStore((state) => state.isLoadingProxyAuthStatus);
  const loadProxyAuthStatus = useBambooConfigStore((state) => state.loadProxyAuthStatus);
  const applyProxyAuth = useBambooConfigStore((state) => state.applyProxyAuth);
  const clearProxyAuth = useBambooConfigStore((state) => state.clearProxyAuth);

  const [proxyAuthForm, setProxyAuthForm] = useState({
    username: "",
    password: "",
  });
  const [isApplyingProxyAuth, setIsApplyingProxyAuth] = useState(false);

  // Load proxy auth status (and allow manual refresh via Save/Reload buttons).
  useEffect(() => {
    void loadProxyAuthStatus();
  }, [loadProxyAuthStatus]);

  const handleApplyProxyAuth = async () => {
    const username = proxyAuthForm.username.trim();
    if (!username) {
      return;
    }

    setIsApplyingProxyAuth(true);
    try {
      await applyProxyAuth({
        username,
        password: proxyAuthForm.password,
      });
      setProxyAuthForm({ username: "", password: "" });
    } catch (error) {
      console.error("Failed to apply proxy auth:", error);
    } finally {
      setIsApplyingProxyAuth(false);
    }
  };

  const handleClearProxyAuth = async () => {
    setIsApplyingProxyAuth(true);
    try {
      await clearProxyAuth();
    } catch (error) {
      console.error("Failed to clear proxy auth:", error);
    } finally {
      setIsApplyingProxyAuth(false);
    }
  };

  return (
    <Card
      size="small"
      title={<Text strong>{t("settings.networkCard.title")}</Text>}
      className="lotus-settings-card"
    >
      <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
        <Alert message={t("settings.networkCard.guideTip")} type="info" showIcon />
        {/* HTTP Proxy */}
        <Space direction="vertical" size={token.marginXXS} style={{ width: "100%" }}>
          <Text type="secondary">{t("settings.networkCard.httpProxy")}</Text>
          <Input
            data-testid="proxy-url"
            style={{ width: "100%" }}
            value={httpProxy}
            onChange={(e) => onHttpProxyChange(e.target.value)}
            placeholder={t("settings.networkCard.proxyPlaceholder")}
            disabled={isLoading}
          />
        </Space>

        {/* HTTPS Proxy */}
        <Space direction="vertical" size={token.marginXXS} style={{ width: "100%" }}>
          <Text type="secondary">{t("settings.networkCard.httpsProxy")}</Text>
          <Input
            style={{ width: "100%" }}
            value={httpsProxy}
            onChange={(e) => onHttpsProxyChange(e.target.value)}
            placeholder={t("settings.networkCard.proxyPlaceholder")}
            disabled={isLoading}
          />
        </Space>

        {/* Proxy Authentication */}
        <Card
          size="small"
          title={t("settings.networkCard.proxyAuthTitle")}
          className="lotus-settings-card"
          style={{ marginTop: token.marginSM }}
        >
          {proxyAuthStatus?.configured ? (
            <Space direction="vertical" style={{ width: "100%" }}>
              <Alert
                type="success"
                message={t("settings.networkCard.proxyConfiguredForUser", {
                  username: proxyAuthStatus.username ?? "",
                })}
                showIcon
              />
              <Button
                onClick={handleClearProxyAuth}
                loading={isApplyingProxyAuth || isLoadingProxyAuthStatus}
                danger
              >
                {t("settings.networkCard.clearCredentials")}
              </Button>
            </Space>
          ) : (
            <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
              <Input
                placeholder={t("settings.networkCard.username")}
                value={proxyAuthForm.username}
                onChange={(e) =>
                  setProxyAuthForm((prev) => ({
                    ...prev,
                    username: e.target.value,
                  }))
                }
              />
              <Input.Password
                placeholder={t("settings.networkCard.password")}
                value={proxyAuthForm.password}
                onChange={(e) =>
                  setProxyAuthForm((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
              />
              <Button
                type="primary"
                onClick={handleApplyProxyAuth}
                loading={isApplyingProxyAuth || isLoadingProxyAuthStatus}
                disabled={!proxyAuthForm.username.trim()}
              >
                {t("settings.networkCard.apply")}
              </Button>
            </Space>
          )}
        </Card>

        {/* Info */}
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t("settings.networkCard.credentialsStorageNote")}
        </Text>

        {/* Save buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: token.marginSM,
          }}
        >
          <Button
            onClick={() =>
              Promise.resolve(onReload()).finally(() => loadProxyAuthStatus({ force: true }))
            }
            disabled={isLoading}
          >
            {t("settings.networkCard.reload")}
          </Button>
          <Button
            data-testid="save-proxy-settings"
            type="primary"
            onClick={() =>
              Promise.resolve(onSave()).finally(() => loadProxyAuthStatus({ force: true }))
            }
            disabled={isLoading}
          >
            {t("settings.networkCard.save")}
          </Button>
        </div>
      </Space>
    </Card>
  );
};
