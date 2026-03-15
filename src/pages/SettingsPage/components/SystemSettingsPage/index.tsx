import { useEffect, useState } from "react";
import { Button, Flex, Layout, Tabs, Typography, message, theme } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useChatManager } from "../../../ChatPage/hooks/useChatManager";
import { serviceFactory } from "../../../../services/common/ServiceFactory";
import {
  getSystemPromptEnhancement,
  setSystemPromptEnhancement,
} from "../../../../shared/utils/systemPromptEnhancement";
import {
  isMermaidEnhancementEnabled,
  setMermaidEnhancementEnabled,
} from "../../../../shared/utils/mermaidUtils";
import {
  isTodoEnhancementEnabled,
  setTodoEnhancementEnabled,
} from "../../../../shared/utils/todoEnhancementUtils";
import {
  isCopilotAskUserEnhancementEnabled,
  setCopilotAskUserEnhancementEnabled,
} from "../../../../shared/utils/copilotAskUserEnhancementUtils";
import SystemSettingsConfigTab from "./SystemSettingsConfigTab";
import SystemSettingsPromptsTab from "./SystemSettingsPromptsTab";
import SystemSettingsAppTab from "./SystemSettingsAppTab";
import SystemSettingsKeywordMaskingTab from "./SystemSettingsKeywordMaskingTab";
import SystemSettingsWorkflowsTab from "./SystemSettingsWorkflowsTab";
import SystemSettingsMcpTab from "./SystemSettingsMcpTab";
import SystemSettingsMetricsTab from "./SystemSettingsMetricsTab";
import SystemSettingsHooksTab from "./SystemSettingsHooksTab";
import MermaidSettingsTab from "./MermaidSettingsTab";
import SystemSettingsSchedulesTab from "./SystemSettingsSchedulesTab";
import SystemSettingsSessionsTab from "./SystemSettingsSessionsTab";
import { ProviderSettings } from "../ProviderSettings";
import { SkillManager } from "../../../../components/Skill";
import { useProviderStore } from "../../../ChatPage/store/slices/providerSlice";
import ModelLimitsSettings from "../../ModelLimitsSettings";
import type { AppLocale } from "../../../../shared/i18n/types";

const { Text } = Typography;
const { useToken } = theme;

const DARK_MODE_KEY = "bamboo_dark_mode";

const SystemSettingsPage = ({
  themeMode,
  onThemeModeChange,
  locale,
  onLocaleChange,
  onBack,
}: {
  themeMode: "light" | "dark";
  onThemeModeChange: (mode: "light" | "dark") => void;
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
  onBack: () => void;
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const {
    deleteAllUnpinnedChats,
    deleteEmptyChats,
    deleteAllChats,
    autoGenerateTitles,
    setAutoGenerateTitlesPreference,
    isUpdatingAutoTitlePreference,
  } = useChatManager();
  const [isResetting, setIsResetting] = useState(false);
  const [msgApi, contextHolder] = message.useMessage();
  const [promptEnhancement, setPromptEnhancement] = useState("");
  const [mermaidEnhancementEnabled, setMermaidEnhancementEnabledState] =
    useState(isMermaidEnhancementEnabled());
  const [todoEnhancementEnabled, setTodoEnhancementEnabledState] = useState(
    isTodoEnhancementEnabled(),
  );
  const [
    copilotAskUserEnhancementEnabled,
    setCopilotAskUserEnhancementEnabledState,
  ] = useState(isCopilotAskUserEnhancementEnabled());
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const showCopilotAskUserEnhancement = currentProvider === "copilot";

  const handleDeleteAll = () => {
    void deleteAllUnpinnedChats();
    msgApi.success(t("settings.notifications.deleteAllSuccess"));
  };

  const handleDeleteEmpty = () => {
    void deleteEmptyChats();
    msgApi.success(t("settings.notifications.deleteEmptySuccess"));
  };

  const handleClearLocalStorage = () => {
    localStorage.clear();
    msgApi.success(t("settings.notifications.localStorageCleared"));
  };

  const handleResetApp = async () => {
    setIsResetting(true);
    try {
      // 1. Delete all chats (including pinned)
      await deleteAllChats();

      // 2. Reset setup status to force re-initialization on next launch
      await serviceFactory.resetSetupStatus();

      // 3. Reset config.json on backend
      await serviceFactory.resetBambooConfig();

      // 4. Clear localStorage
      localStorage.clear();

      msgApi.success(t("settings.notifications.resetSuccessReloading"));

      // 5. Reload the page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error("Failed to reset application:", error);
      msgApi.error(
        error instanceof Error
          ? error.message
          : t("settings.notifications.resetFailed"),
      );
      setIsResetting(false);
    }
  };

  const handleAutoTitleToggle = async (checked: boolean) => {
    try {
      await setAutoGenerateTitlesPreference(checked);
      msgApi.success(
        checked
          ? t("settings.notifications.autoTitleEnabled")
          : t("settings.notifications.autoTitleDisabled"),
      );
    } catch (error) {
      msgApi.error(t("settings.notifications.autoTitleUpdateFailed"));
    }
  };

  const handleSaveEnhancement = () => {
    setSystemPromptEnhancement(promptEnhancement);
    msgApi.success(t("settings.notifications.promptEnhancementSaved"));
  };

  const handleMermaidToggle = (checked: boolean) => {
    setMermaidEnhancementEnabledState(checked);
    setMermaidEnhancementEnabled(checked);
  };

  const handleTodoToggle = (checked: boolean) => {
    setTodoEnhancementEnabledState(checked);
    setTodoEnhancementEnabled(checked);
  };

  const handleCopilotAskUserToggle = (checked: boolean) => {
    setCopilotAskUserEnhancementEnabledState(checked);
    setCopilotAskUserEnhancementEnabled(checked);
  };

  useEffect(() => {
    setPromptEnhancement(getSystemPromptEnhancement());
    setMermaidEnhancementEnabledState(isMermaidEnhancementEnabled());
    setTodoEnhancementEnabledState(isTodoEnhancementEnabled());
    setCopilotAskUserEnhancementEnabledState(
      isCopilotAskUserEnhancementEnabled(),
    );
  }, []);

  return (
    <Flex
      vertical
      style={{
        height: "100vh",
        overflow: "hidden",
        background: token.colorBgContainer,
      }}
    >
      {contextHolder}
      <Flex
        align="center"
        justify="space-between"
        style={{
          padding: token.padding,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flex align="center" gap={token.marginSM}>
          <Button icon={<ArrowLeftOutlined />} onClick={onBack}>
            {t("settings.page.back")}
          </Button>
          <Text strong>{t("settings.page.title")}</Text>
        </Flex>
      </Flex>
      <Layout.Content
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
          padding: token.padding,
        }}
      >
        <Tabs
          tabPosition="left"
          items={[
            {
              key: "config",
              label: t("settings.page.tabs.config"),
              children: (
                <SystemSettingsConfigTab
                  msgApi={msgApi}
                  locale={locale}
                  onLocaleChange={onLocaleChange}
                />
              ),
            },
            {
              key: "prompts",
              label: t("settings.page.tabs.prompts"),
              children: (
                <SystemSettingsPromptsTab
                  promptEnhancement={promptEnhancement}
                  onPromptEnhancementChange={setPromptEnhancement}
                  mermaidEnhancementEnabled={mermaidEnhancementEnabled}
                  todoEnhancementEnabled={todoEnhancementEnabled}
                  showCopilotAskUserEnhancement={showCopilotAskUserEnhancement}
                  copilotAskUserEnhancementEnabled={
                    copilotAskUserEnhancementEnabled
                  }
                  onMermaidToggle={handleMermaidToggle}
                  onTodoToggle={handleTodoToggle}
                  onCopilotAskUserToggle={handleCopilotAskUserToggle}
                  onSaveEnhancement={handleSaveEnhancement}
                />
              ),
            },
            {
              key: "mermaid",
              label: t("settings.page.tabs.mermaid"),
              children: <MermaidSettingsTab />,
            },
            {
              key: "skills",
              label: t("settings.page.tabs.skills"),
              children: <SkillManager />,
            },
            {
              key: "workflows",
              label: t("settings.page.tabs.workflows"),
              children: <SystemSettingsWorkflowsTab />,
            },
            {
              key: "mcp",
              label: t("settings.page.tabs.mcp"),
              children: <SystemSettingsMcpTab />,
            },
            {
              key: "model-limits",
              label: t("settings.page.tabs.modelLimits"),
              children: <ModelLimitsSettings />,
            },
            {
              key: "metrics",
              label: t("settings.page.tabs.metrics"),
              children: <SystemSettingsMetricsTab />,
            },
            {
              key: "schedules",
              label: t("settings.page.tabs.schedules"),
              children: <SystemSettingsSchedulesTab />,
            },
            {
              key: "sessions",
              label: t("settings.page.tabs.sessions"),
              children: <SystemSettingsSessionsTab />,
            },
            {
              key: "app",
              label: t("settings.page.tabs.app"),
              children: (
                <SystemSettingsAppTab
                  autoGenerateTitles={autoGenerateTitles}
                  isUpdatingAutoTitlePreference={isUpdatingAutoTitlePreference}
                  onAutoTitleToggle={handleAutoTitleToggle}
                  themeMode={themeMode}
                  onThemeModeChange={onThemeModeChange}
                  onDeleteAll={handleDeleteAll}
                  onDeleteEmpty={handleDeleteEmpty}
                  onClearLocalStorage={handleClearLocalStorage}
                  onResetApp={handleResetApp}
                  isResetting={isResetting}
                  darkModeKey={DARK_MODE_KEY}
                />
              ),
            },
            {
              key: "provider",
              label: t("settings.page.tabs.provider"),
              children: <ProviderSettings />,
            },
            {
              key: "hooks",
              label: t("settings.page.tabs.hooks"),
              children: <SystemSettingsHooksTab />,
            },
            {
              key: "masking",
              label: t("settings.page.tabs.masking"),
              children: <SystemSettingsKeywordMaskingTab />,
            },
          ]}
        />
      </Layout.Content>
    </Flex>
  );
};

export { SystemSettingsPage };
