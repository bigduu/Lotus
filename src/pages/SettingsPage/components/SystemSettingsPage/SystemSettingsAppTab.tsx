import React from "react";
import {
  Button,
  Card,
  Flex,
  Popconfirm,
  Space,
  Switch,
  Typography,
  theme,
  Divider,
} from "antd";
import { useTranslation } from "react-i18next";
import {
  DeleteOutlined,
  WarningOutlined,
  RedoOutlined,
} from "@ant-design/icons";

const { Text } = Typography;
const { useToken } = theme;

interface SystemSettingsAppTabProps {
  autoGenerateTitles: boolean;
  isUpdatingAutoTitlePreference: boolean;
  onAutoTitleToggle: (checked: boolean) => void;
  themeMode: "light" | "dark";
  onThemeModeChange: (mode: "light" | "dark") => void;
  onDeleteAll: () => void;
  onDeleteEmpty: () => void;
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
  onDeleteAll,
  onDeleteEmpty,
  onClearLocalStorage,
  onResetApp,
  isResetting,
  darkModeKey,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();

  return (
    <Card size="small">
      <Space
        direction="vertical"
        size={token.marginSM}
        style={{ width: "100%" }}
      >
        <Flex align="center" gap={token.marginSM}>
          <Text strong>{t("settings.appTab.autoGenerateTitle")}</Text>
          <Switch
            checked={autoGenerateTitles}
            loading={isUpdatingAutoTitlePreference}
            onChange={onAutoTitleToggle}
            checkedChildren={t("settings.appTab.switchOn")}
            unCheckedChildren={t("settings.appTab.switchOff")}
          />
        </Flex>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t("settings.appTab.autoGenerateTitleDesc")}
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
            checkedChildren={t("settings.appTab.darkModeDark")}
            unCheckedChildren={t("settings.appTab.darkModeLight")}
          />
        </Flex>
        <Popconfirm
          title={t("settings.appTab.deleteAllTitle")}
          description={t("settings.appTab.deleteAllDescription")}
          onConfirm={onDeleteAll}
          okText={t("settings.appTab.confirmDeleteAll")}
          cancelText={t("settings.appTab.cancel")}
          placement="top"
        >
          <Button danger block icon={<DeleteOutlined />}>
            {t("settings.appTab.deleteAllButton")}
          </Button>
        </Popconfirm>
        <Popconfirm
          title={t("settings.appTab.deleteEmptyTitle")}
          description={t("settings.appTab.deleteEmptyDescription")}
          onConfirm={onDeleteEmpty}
          okText={t("settings.appTab.confirmDeleteEmpty")}
          cancelText={t("settings.appTab.cancel")}
          placement="top"
        >
          <Button danger block icon={<DeleteOutlined />}>
            {t("settings.appTab.deleteEmptyButton")}
          </Button>
        </Popconfirm>
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
            danger
            block
            type="primary"
            icon={<RedoOutlined />}
            loading={isResetting}
          >
            {t("settings.appTab.resetButton")}
          </Button>
        </Popconfirm>
      </Space>
    </Card>
  );
};

export default SystemSettingsAppTab;
