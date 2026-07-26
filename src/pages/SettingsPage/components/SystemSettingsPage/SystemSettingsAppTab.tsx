import React from "react";
import {
  Alert,
  Button,
  Card,
  Divider,
  Flex,
  Popconfirm,
  Space,
  Switch,
  Typography,
  theme,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  DeleteOutlined,
  WarningOutlined,
  RedoOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { APP_VERSION } from "@shared/constants/appVersion";
import { resetOnboarding } from "@shared/components/FeatureGuide";
import {
  CONFIG_SECTION_IDS,
  type ConfigSectionId,
} from "@services/config/configSections";

const { Text } = Typography;
const { useToken } = theme;

export interface ResetSectionResult {
  section: ConfigSectionId;
  status: "success" | "failed";
  error?: string;
}

interface SystemSettingsAppTabProps {
  themeMode: "light" | "dark";
  onThemeModeChange: (mode: "light" | "dark") => void;
  vdiSafeMode: boolean;
  onVdiSafeModeToggle: (checked: boolean) => void;
  onClearLocalStorage: () => void;
  onResetApp: () => void;
  isResetting: boolean;
  resetSectionResults: ResetSectionResult[];
  darkModeKey: string;
}

const SystemSettingsAppTab: React.FC<SystemSettingsAppTabProps> = ({
  themeMode,
  onThemeModeChange,
  vdiSafeMode,
  onVdiSafeModeToggle,
  onClearLocalStorage,
  onResetApp,
  isResetting,
  resetSectionResults,
  darkModeKey,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();

  return (
    <Card size="small" className="lotus-settings-card">
      <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
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
        <Button
          block
          icon={<QuestionCircleOutlined />}
          onClick={() => {
            resetOnboarding();
            window.location.reload();
          }}
        >
          {t("settings.appTab.resetStepReplayGuide")}
        </Button>
        <Popconfirm
          title={t("settings.appTab.clearLocalStorageTitle")}
          description={t("settings.appTab.clearLocalStorageDescription")}
          onConfirm={onClearLocalStorage}
          okText={t("settings.appTab.confirmClear")}
          cancelText={t("settings.appTab.cancel")}
          placement="top"
        >
          <Button danger block icon={<DeleteOutlined />}>
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
                <li>
                  {t(
                    "settings.appTab.resetStepResetConfig",
                    "Reset these typed configuration sections and their owned credentials:",
                  )}
                  <ul style={{ margin: 0, paddingLeft: 16 }}>
                    {CONFIG_SECTION_IDS.map((section) => (
                      <li key={section}>
                        <code>{section}</code>
                      </li>
                    ))}
                  </ul>
                </li>
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
            danger
            block
            type="primary"
            icon={<RedoOutlined />}
            loading={isResetting}
          >
            {t("settings.appTab.resetButton")}
          </Button>
        </Popconfirm>
        {resetSectionResults.length > 0 && (
          <Alert
            data-testid="reset-section-results"
            type={resetSectionResults.some((result) => result.status === "failed") ? "error" : "info"}
            showIcon
            message={t("settings.appTab.resetSectionResults", "Configuration reset progress")}
            description={
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {resetSectionResults.map((result) => (
                  <li key={result.section}>
                    <Text
                      type={result.status === "failed" ? "danger" : "success"}
                      data-testid={`reset-result-${result.section}`}
                    >
                      <code>{result.section}</code>: {result.status}
                      {result.error ? ` — ${result.error}` : ""}
                    </Text>
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </Space>
    </Card>
  );
};

export default SystemSettingsAppTab;
