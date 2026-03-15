import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Space,
  Typography,
  Input,
  Button,
  theme,
  Alert,
  Select,
} from "antd";
import { useTranslation } from "react-i18next";
import { NetworkSettingsCard } from "./NetworkSettingsCard";
import { ModelMappingCard } from "./ModelMappingCard";
import { serviceFactory } from "../../../../services/common/ServiceFactory";
import type { AppLocale } from "../../../../shared/i18n/types";

const { Text } = Typography;
const { useToken } = theme;

interface SystemSettingsConfigTabProps {
  msgApi: {
    success: (content: string) => void;
    error: (content: string) => void;
  };
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
}

export const SystemSettingsConfigTab: React.FC<
  SystemSettingsConfigTabProps
> = ({ msgApi, locale, onLocaleChange }) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [config, setConfig] = useState({
    http_proxy: "",
    https_proxy: "",
  });
  const [backendBaseUrl, setBackendBaseUrl] = useState(
    "http://127.0.0.1:9562/v1",
  );
  const [isLoading, setIsLoading] = useState(false);

  // Load config
  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const bambooConfig = await serviceFactory.getBambooConfig();
      setConfig({
        http_proxy: bambooConfig.http_proxy || "",
        https_proxy: bambooConfig.https_proxy || "",
      });
    } catch (error) {
      console.error("Failed to load config:", error);
      msgApi.error(t("settings.configTab.loadConfigFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [msgApi, t]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Handlers
  const handleHttpProxyChange = (value: string) => {
    setConfig((prev) => ({ ...prev, http_proxy: value }));
  };

  const handleHttpsProxyChange = (value: string) => {
    setConfig((prev) => ({ ...prev, https_proxy: value }));
  };

  const handleSaveConfig = async () => {
    setIsLoading(true);
    try {
      const validation = await serviceFactory.validateBambooConfigPatch(config);
      if (!validation.valid) {
        const proxyIssue = validation.errors?.proxy?.[0];
        const issue =
          proxyIssue ??
          Object.values(validation.errors || {})
            .flat()
            .filter(Boolean)[0];
        msgApi.error(issue?.message || t("settings.configTab.invalidConfig"));
        return;
      }

      await serviceFactory.setBambooConfig(config);
      msgApi.success(t("settings.configTab.saveConfigSuccess"));
    } catch (error) {
      console.error("Failed to save config:", error);
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : t("settings.configTab.saveConfigFailed");
      msgApi.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveBackendUrl = async () => {
    msgApi.success(t("settings.configTab.backendSaved"));
  };

  const handleResetBackendUrl = () => {
    setBackendBaseUrl("http://127.0.0.1:9562/v1");
    msgApi.success(t("settings.configTab.backendResetDefault"));
  };

  return (
    <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
      {/* Info Banner */}
      <Alert
        message={t("settings.configTab.providerMovedTitle")}
        description={t("settings.configTab.providerMovedDescription")}
        type="info"
        showIcon
        closable
      />

      {/* Network Settings */}
      <NetworkSettingsCard
        httpProxy={config.http_proxy}
        httpsProxy={config.https_proxy}
        onHttpProxyChange={handleHttpProxyChange}
        onHttpsProxyChange={handleHttpsProxyChange}
        onReload={loadConfig}
        onSave={handleSaveConfig}
        isLoading={isLoading}
      />

      {/* Model Mapping */}
      <ModelMappingCard />

      <Card
        size="small"
        title={<Text strong>{t("settings.configTab.language")}</Text>}
      >
        <Select
          value={locale}
          style={{ width: 260 }}
          options={[
            {
              label: t("settings.configTab.languageEnglish"),
              value: "en-US",
            },
            {
              label: t("settings.configTab.languageChinese"),
              value: "zh-CN",
            },
            {
              label: t("settings.configTab.languageTraditionalChinese"),
              value: "zh-TW",
            },
            {
              label: t("settings.configTab.languageFrench"),
              value: "fr-FR",
            },
            {
              label: t("settings.configTab.languageJapanese"),
              value: "ja-JP",
            },
          ]}
          onChange={(value) => onLocaleChange(value as AppLocale)}
        />
      </Card>

      {/* Backend Settings */}
      <Card
        size="small"
        title={
          <Text strong>{t("settings.configTab.backendApiBaseUrlTitle")}</Text>
        }
      >
        <Space
          direction="vertical"
          size={token.marginSM}
          style={{ width: "100%" }}
        >
          <Space
            direction="vertical"
            size={token.marginXXS}
            style={{ width: "100%" }}
          >
            <Input
              style={{ width: "100%" }}
              value={backendBaseUrl}
              onChange={(e) => setBackendBaseUrl(e.target.value)}
              placeholder={t("settings.configTab.backendApiPlaceholder")}
            />
          </Space>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {t("settings.configTab.backendApiHint")}
          </Text>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: token.marginSM,
            }}
          >
            <Button
              data-testid="reset-to-defaults"
              onClick={handleResetBackendUrl}
            >
              {t("settings.configTab.resetToDefault")}
            </Button>
            <Button
              data-testid="save-api-settings"
              type="primary"
              onClick={handleSaveBackendUrl}
            >
              {t("settings.configTab.save")}
            </Button>
          </div>
        </Space>
      </Card>
    </Space>
  );
};

export default SystemSettingsConfigTab;
