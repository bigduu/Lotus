import React, { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Input, Space, Tag, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import type { ProxyAuthStatus } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";

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
  const proxyAuthStatus = useConfigSectionStore((state) => state.proxyAuthStatus);
  const isLoadingProxyAuthStatus = useConfigSectionStore((state) => state.proxyAuthLoading);
  const proxyAuthError = useConfigSectionStore((state) => state.proxyAuthError);
  const loadProxyAuthStatus = useConfigSectionStore((state) => state.loadProxyAuthStatus);
  const replaceProxyAuth = useConfigSectionStore((state) => state.replaceProxyAuth);
  const clearProxyAuth = useConfigSectionStore((state) => state.clearProxyAuth);

  const [proxyAuthForm, setProxyAuthForm] = useState({
    username: "",
    password: "",
  });
  const [isApplyingProxyAuth, setIsApplyingProxyAuth] = useState(false);
  const [baseProxyAuthStatus, setBaseProxyAuthStatus] = useState<ProxyAuthStatus | null>(null);
  const [proxyAuthDirty, setProxyAuthDirty] = useState(false);
  const [showProxyAuthComparison, setShowProxyAuthComparison] = useState(false);

  const adoptProxyAuthStatus = useCallback((status: ProxyAuthStatus) => {
    setBaseProxyAuthStatus(status);
    setProxyAuthForm({ username: "", password: "" });
    setProxyAuthDirty(false);
    setShowProxyAuthComparison(false);
  }, []);

  // Load proxy auth status (and allow manual refresh via Save/Reload buttons).
  useEffect(() => {
    void loadProxyAuthStatus();
  }, [loadProxyAuthStatus]);

  useEffect(() => {
    if (!proxyAuthStatus) return;
    if (!baseProxyAuthStatus) {
      adoptProxyAuthStatus(proxyAuthStatus);
      return;
    }
    if (proxyAuthStatus.revision <= baseProxyAuthStatus.revision || proxyAuthDirty) {
      return;
    }
    adoptProxyAuthStatus(proxyAuthStatus);
  }, [adoptProxyAuthStatus, baseProxyAuthStatus, proxyAuthDirty, proxyAuthStatus]);

  const handleApplyProxyAuth = async () => {
    const username = proxyAuthForm.username.trim();
    if (!username || !baseProxyAuthStatus) {
      return;
    }

    setIsApplyingProxyAuth(true);
    try {
      const status = await replaceProxyAuth(
        {
          username,
          password: proxyAuthForm.password,
        },
        baseProxyAuthStatus.revision,
      );
      adoptProxyAuthStatus(status);
    } catch (error) {
      console.error("Failed to apply proxy auth:", error);
    } finally {
      setIsApplyingProxyAuth(false);
    }
  };

  const handleClearProxyAuth = async () => {
    if (!baseProxyAuthStatus) return;
    setIsApplyingProxyAuth(true);
    try {
      const status = await clearProxyAuth(baseProxyAuthStatus.revision);
      adoptProxyAuthStatus(status);
    } catch (error) {
      console.error("Failed to clear proxy auth:", error);
    } finally {
      setIsApplyingProxyAuth(false);
    }
  };

  const handleReloadProxyAuth = async () => {
    try {
      const status = await loadProxyAuthStatus({ force: true });
      adoptProxyAuthStatus(status);
    } catch (error) {
      console.error("Failed to reload proxy auth:", error);
    }
  };

  const externalProxyAuthStatus =
    proxyAuthDirty &&
    proxyAuthStatus &&
    baseProxyAuthStatus &&
    proxyAuthStatus.revision > baseProxyAuthStatus.revision
      ? proxyAuthStatus
      : null;
  const configured = baseProxyAuthStatus?.configured ?? false;
  const fromEnvironment =
    configured &&
    (baseProxyAuthStatus?.source === "environment" || baseProxyAuthStatus?.source === "env");
  const proxyAuthLabel = proxyAuthError
    ? "Error"
    : fromEnvironment
      ? "From env"
      : configured
        ? "Configured"
        : "Missing";

  return (
    <Card
      size="small"
      title={<Text strong>{t("settings.networkCard.title")}</Text>}
      className="lotus-settings-card"
    >
      <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
        <Alert message={t("settings.networkCard.guideTip")} type="info" showIcon />
        {proxyAuthError && <Alert message={proxyAuthError} type="error" showIcon />}
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
            data-testid="https-proxy-url"
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
          <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
            <Space wrap>
              <Tag color={proxyAuthError ? "error" : configured ? "success" : "warning"}>
                {proxyAuthLabel}
              </Tag>
              {fromEnvironment ? (
                <Text type="secondary">
                  The environment value is read-only; only an explicit replacement is persisted.
                </Text>
              ) : null}
            </Space>

            {externalProxyAuthStatus ? (
              <Alert
                type="warning"
                showIcon
                message={`Proxy credentials changed externally (r${baseProxyAuthStatus?.revision} → r${externalProxyAuthStatus.revision})`}
                description="Your replacement draft was preserved. Reload to discard it, compare status, or reapply it to the latest revision."
                action={
                  <Space wrap>
                    <Button size="small" onClick={() => void handleReloadProxyAuth()}>
                      Reload
                    </Button>
                    <Button
                      size="small"
                      onClick={() => setShowProxyAuthComparison((current) => !current)}
                    >
                      Compare
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setBaseProxyAuthStatus(externalProxyAuthStatus);
                        setShowProxyAuthComparison(false);
                      }}
                    >
                      Reapply
                    </Button>
                  </Space>
                }
              />
            ) : null}

            {showProxyAuthComparison && externalProxyAuthStatus ? (
              <pre
                data-testid="proxy-auth-revision-comparison"
                style={{ maxHeight: 220, overflow: "auto", whiteSpace: "pre-wrap" }}
              >
                {JSON.stringify(
                  {
                    base: baseProxyAuthStatus,
                    draft: {
                      username: proxyAuthForm.username,
                      password: proxyAuthForm.password ? "[replace requested]" : "",
                    },
                    latest: externalProxyAuthStatus,
                  },
                  null,
                  2,
                )}
              </pre>
            ) : null}

            <Input
              data-testid="proxy-auth-username"
              placeholder={t("settings.networkCard.username")}
              value={proxyAuthForm.username}
              onChange={(e) => {
                setProxyAuthDirty(true);
                setProxyAuthForm((prev) => ({
                  ...prev,
                  username: e.target.value,
                }));
              }}
            />
            <Input.Password
              data-testid="proxy-auth-password"
              placeholder={t("settings.networkCard.password")}
              value={proxyAuthForm.password}
              onChange={(e) => {
                setProxyAuthDirty(true);
                setProxyAuthForm((prev) => ({
                  ...prev,
                  password: e.target.value,
                }));
              }}
            />
            <Space wrap>
              <Button
                data-testid="proxy-auth-apply"
                type="primary"
                onClick={handleApplyProxyAuth}
                loading={isApplyingProxyAuth || isLoadingProxyAuthStatus}
                disabled={!proxyAuthForm.username.trim() || !baseProxyAuthStatus}
              >
                {configured ? "Replace credentials" : t("settings.networkCard.apply")}
              </Button>
              {configured ? (
                <Button
                  data-testid="proxy-auth-clear"
                  onClick={handleClearProxyAuth}
                  loading={isApplyingProxyAuth || isLoadingProxyAuthStatus}
                  danger
                >
                  {t("settings.networkCard.clearCredentials")}
                </Button>
              ) : null}
            </Space>
          </Space>
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
