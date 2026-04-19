import React from "react";
import { Popconfirm, Switch, theme, Divider } from "antd";
import { Card } from "@/components/ui/card";
import { Space } from "@/components/ui/space";
import { Flex } from "@/components/ui/flex";
import { Typography } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { DeleteOutlined, WarningOutlined, RedoOutlined } from "@ant-design/icons";
import { APP_VERSION } from "@shared/constants/appVersion";

const { Text } = Typography;
const { useToken } = theme;

interface SystemSettingsAppTabProps {
  autoGenerateTitles: boolean;
  isUpdatingAutoTitlePreference: boolean;
  onAutoTitleToggle: (checked: boolean) => void;
  themeMode: "light" | "dark";
  onThemeModeChange: (mode: "light" | "dark") => void;
  vdiSafeMode: boolean;
  onVdiSafeModeToggle: (checked: boolean) => void;
  onClearLocalStorage: () => void;
  onResetApp: () => void;
  isResetting: boolean;
  darkModeKey: string;
}

const SystemSettingsAppTab: React.FC<SystemSettingsAppTabProps> = ({
  autoGenerateTitles,
  isUpdatingAutoTitlePreference,
  onAutoTitleToggle,
  themeMode,
  onThemeModeChange,
  vdiSafeMode,
  onVdiSafeModeToggle,
  onClearLocalStorage,
  onResetApp,
  isResetting,
  darkModeKey,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();

  return (
    <Card size="small" className="lotus-settings-card">
      <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
        <Flex align="center" gap={token.marginSM}>
          <Text strong>{t("settings.appTab.autoGenerateTitle")}</Text>
          <Switch
            checked={autoGenerateTitles}
            loading={isUpdatingAutoTitlePreference}
            onChange={onAutoTitleToggle}
          />
        </Flex>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t("settings.appTab.autoGenerateTitleDesc")}
        </Text>
        <Flex align="center" justify="space-between" gap={token.marginSM}>
          <Text strong>{t("settings.appTab.runningVersion", "Running version")}</Text>
          <Text code data-testid="settings-app-version">
            v{APP_VERSION}
          </Text>
        </Flex>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t(
            "settings.appTab.runningVersionDesc",
            "This is the currently running Lotus frontend version.",
          )}
        </Text>
        <Flex align="center" gap={token.marginSM}>
          <Text strong>{t("settings.appTab.darkMode")}</Text>
          <Switch
            data-testid="dark-mode-toggle"
            checked={themeMode === "dark"}
            onChange={(checked) => {
              const mode = checked ? "dark" : "light";
              onThemeModeChange(mode);
              localStorage.setItem(darkModeKey, mode);
            }}
          />
        </Flex>
        <Flex align="center" gap={token.marginSM}>
          <Text strong>{t("settings.appTab.vdiSafeMode", "Graphics compatibility mode")}</Text>
          <Switch
            data-testid="vdi-safe-mode-toggle"
            checked={vdiSafeMode}
            onChange={onVdiSafeModeToggle}
          />
        </Flex>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t(
            "settings.appTab.vdiSafeModeDesc",
            "Disables blur and glass effects that can break dropdowns and hover overlays in some virtual desktop, remote, or graphics-constrained environments.",
          )}
        </Text>
        <Popconfirm
          title={t("settings.appTab.clearLocalStorageTitle")}
          description={t("settings.appTab.clearLocalStorageDescription")}
          onConfirm={onClearLocalStorage}
          okText={t("settings.appTab.confirmClear")}
          cancelText={t("settings.appTab.cancel")}
          placement="top"
        >
          <Button block icon={<DeleteOutlined />} variant="destructive">
            {t("settings.appTab.clearLocalStorageButton")}
          </Button>
        </Popconfirm>

        <Divider style={{ margin: `${token.marginSM}px 0` }} />

        <Flex align="center" gap={token.marginSM}>
          <WarningOutlined style={{ color: token.colorError }} />
          <Text strong style={{ color: token.colorError }}>
            {t("settings.appTab.dangerZone")}
          </Text>
        </Flex>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t("settings.appTab.dangerDescription")}
        </Text>

        <Popconfirm
          title={t("settings.appTab.resetApplicationTitle")}
          description={
            <div>
              <p>{t("settings.appTab.resetApplicationIntro")}</p>
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li>{t("settings.appTab.resetStepDeleteAllSessions")}</li>
                <li>{t("settings.appTab.resetStepClearStorage")}</li>
                <li>{t("settings.appTab.resetStepResetConfig")}</li>
                <li>{t("settings.appTab.resetStepSetupFlow")}</li>
                <li>{t("settings.appTab.resetStepReload")}</li>
              </ul>
            </div>
          }
          onConfirm={onResetApp}
          okText={t("settings.appTab.resetConfirm")}
          cancelText={t("settings.appTab.cancel")}
          placement="top"
          okButtonProps={{ danger: true }}
        >
          <Button
            data-testid="reset-to-defaults"
            block
            icon={<RedoOutlined />}
            loading={isResetting}
            variant="destructive">
            {t("settings.appTab.resetButton")}
          </Button>
        </Popconfirm>
      </Space>
    </Card>
  );
};

export default SystemSettingsAppTab;
