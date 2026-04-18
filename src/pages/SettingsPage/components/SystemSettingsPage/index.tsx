import { useEffect, useState } from "react";
import { Flex, Layout, Tabs, Typography, message, theme } from "antd";
import { Button } from "@/components/ui/button";
import type { TabsProps } from "antd";
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
  isTaskEnhancementEnabled,
  setTaskEnhancementEnabled,
} from "../../../../shared/utils/taskEnhancementUtils";
import {
  isCopilotConclusionWithOptionsEnhancementEnabled,
  setCopilotConclusionWithOptionsEnhancementEnabled,
} from "../../../../shared/utils/copilotConclusionWithOptionsEnhancementUtils";
import { isVdiSafeModeEnabled, setVdiSafeModeEnabled } from "../../../../shared/utils/vdiSafeMode";
import SystemSettingsConfigTab from "./SystemSettingsConfigTab";
import SystemSettingsPromptsTab from "./SystemSettingsPromptsTab";
import SystemSettingsAppTab from "./SystemSettingsAppTab";
import SystemSettingsKeywordMaskingTab from "./SystemSettingsKeywordMaskingTab";
import SystemSettingsEnvVarsTab from "./SystemSettingsEnvVarsTab";
import SystemSettingsWorkflowsTab from "./SystemSettingsWorkflowsTab";
import SystemSettingsMcpTab from "./SystemSettingsMcpTab";
import SystemSettingsMetricsTab from "./SystemSettingsMetricsTab";
import SystemSettingsHooksTab from "./SystemSettingsHooksTab";
import SystemSettingsSchedulesTab from "./SystemSettingsSchedulesTab";
import SystemSettingsSessionsTab from "./SystemSettingsSessionsTab";
import { ProviderSettings } from "../ProviderSettings";
import { SkillManager } from "../../../../components/Skill";
import { useProviderStore } from "../../../ChatPage/store/slices/providerSlice";
import ModelLimitsSettings from "../../ModelLimitsSettings";
import type { AppLocale } from "../../../../shared/i18n/types";
import { useSettingsViewStore } from "../../../../shared/store/settingsViewStore";
import {
  useExperienceModeStore,
  ADVANCED_ONLY_SETTINGS_TABS,
} from "../../../../shared/store/experienceModeStore";
import { APP_VERSION } from "../../../../shared/constants/appVersion";

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
    deleteAllChats,
    autoGenerateTitles,
    setAutoGenerateTitlesPreference,
    isUpdatingAutoTitlePreference,
  } = useChatManager();
  const [isResetting, setIsResetting] = useState(false);
  const [msgApi, contextHolder] = message.useMessage();
  const [promptEnhancement, setPromptEnhancement] = useState("");
  const [mermaidEnhancementEnabled, setMermaidEnhancementEnabledState] = useState(
    isMermaidEnhancementEnabled(),
  );
  const [taskEnhancementEnabled, setTaskEnhancementEnabledState] = useState(
    isTaskEnhancementEnabled(),
  );
  const [
    copilotConclusionWithOptionsEnhancementEnabled,
    setCopilotConclusionWithOptionsEnhancementEnabledState,
  ] = useState(isCopilotConclusionWithOptionsEnhancementEnabled());
  const [vdiSafeMode, setVdiSafeModeState] = useState(isVdiSafeModeEnabled());
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const showCopilotConclusionWithOptionsEnhancement = currentProvider === "copilot";
  const activeTabKey = useSettingsViewStore((state) => state.activeTabKey);
  const setActiveTabKey = useSettingsViewStore((state) => state.setActiveTabKey);
  const isAdvancedMode = useExperienceModeStore((state) => state.isAdvanced);
  const settingsHeaderTopOffsetPx = token.paddingSM;

  // Build grouped tab items
  const groupLabel = (key: string, label: string): NonNullable<TabsProps["items"]>[number] => ({
    key,
    label: (
      <Text
        type="secondary"
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          cursor: "default",
          userSelect: "none",
        }}
      >
        {label}
      </Text>
    ),
    disabled: true,
    children: null,
  });

  const tabLabel = (key: string, label: string) => (
    <span data-testid={`settings-tab-${key}`}>{label}</span>
  );

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
        error instanceof Error ? error.message : t("settings.notifications.resetFailed"),
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
    } catch {
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

  const handleTaskToggle = (checked: boolean) => {
    setTaskEnhancementEnabledState(checked);
    setTaskEnhancementEnabled(checked);
  };

  const handleCopilotConclusionWithOptionsToggle = (checked: boolean) => {
    setCopilotConclusionWithOptionsEnhancementEnabledState(checked);
    setCopilotConclusionWithOptionsEnhancementEnabled(checked);
  };

  const handleVdiSafeModeToggle = (checked: boolean) => {
    setVdiSafeModeState(checked);
    setVdiSafeModeEnabled(checked);
    window.dispatchEvent(new Event("lotus-vdi-safe-mode-change"));
    msgApi.success(
      checked
        ? t("settings.appTab.vdiSafeModeEnabled", "Graphics compatibility mode enabled")
        : t("settings.appTab.vdiSafeModeDisabled", "Graphics compatibility mode disabled"),
    );
  };

  useEffect(() => {
    setPromptEnhancement(getSystemPromptEnhancement());
    setMermaidEnhancementEnabledState(isMermaidEnhancementEnabled());
    setTaskEnhancementEnabledState(isTaskEnhancementEnabled());
    setCopilotConclusionWithOptionsEnhancementEnabledState(
      isCopilotConclusionWithOptionsEnhancementEnabled(),
    );
    setVdiSafeModeState(isVdiSafeModeEnabled());
  }, []);

  return (
    <Flex
      vertical
      role="region"
      aria-label={t("settings.page.title")}
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
          paddingTop: token.padding + settingsHeaderTopOffsetPx,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Flex align="center" gap={token.marginSM}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={onBack}
            aria-label={t("settings.page.back")}
          >
            {t("settings.page.back")}
          </Button>
          <Text strong data-testid="settings-page-title">
            {t("settings.page.title")}
          </Text>
        </Flex>
        <Text type="secondary" data-testid="settings-page-version">
          {t("settings.appTab.runningVersion", "Running version")}: v{APP_VERSION}
        </Text>
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
          activeKey={activeTabKey}
          onChange={(nextKey) => setActiveTabKey(nextKey as typeof activeTabKey)}
          items={[
            // ── AI ──
            groupLabel("group-ai", t("settings.page.groups.ai")),
            {
              key: "provider",
              label: tabLabel("provider", t("settings.page.tabs.provider")),
              children: <ProviderSettings />,
            },
            {
              key: "model-limits",
              label: tabLabel("model-limits", t("settings.page.tabs.modelLimits")),
              children: <ModelLimitsSettings />,
            },
            {
              key: "prompts",
              label: tabLabel("prompts", t("settings.page.tabs.prompts")),
              children: (
                <SystemSettingsPromptsTab
                  promptEnhancement={promptEnhancement}
                  onPromptEnhancementChange={setPromptEnhancement}
                  mermaidEnhancementEnabled={mermaidEnhancementEnabled}
                  taskEnhancementEnabled={taskEnhancementEnabled}
                  showCopilotConclusionWithOptionsEnhancement={
                    showCopilotConclusionWithOptionsEnhancement
                  }
                  copilotConclusionWithOptionsEnhancementEnabled={
                    copilotConclusionWithOptionsEnhancementEnabled
                  }
                  onMermaidToggle={handleMermaidToggle}
                  onTaskToggle={handleTaskToggle}
                  onCopilotConclusionWithOptionsToggle={handleCopilotConclusionWithOptionsToggle}
                  onSaveEnhancement={handleSaveEnhancement}
                />
              ),
            },
            // ── Tools & Extensions ──
            groupLabel("group-tools", t("settings.page.groups.toolsAndExtensions")),
            {
              key: "skills",
              label: tabLabel("skills", t("settings.page.tabs.skills")),
              children: <SkillManager />,
            },
            {
              key: "mcp",
              label: tabLabel("mcp", t("settings.page.tabs.mcp")),
              children: <SystemSettingsMcpTab />,
            },
            {
              key: "workflows",
              label: tabLabel("workflows", t("settings.page.tabs.workflows")),
              children: <SystemSettingsWorkflowsTab />,
            },
            {
              key: "hooks",
              label: tabLabel("hooks", t("settings.page.tabs.hooks")),
              children: <SystemSettingsHooksTab />,
            },
            // ── Security ──
            groupLabel("group-security", t("settings.page.groups.securityAndPrivacy")),
            {
              key: "masking",
              label: tabLabel("masking", t("settings.page.tabs.masking")),
              children: <SystemSettingsKeywordMaskingTab />,
            },
            {
              key: "env-vars",
              label: tabLabel("env-vars", t("settings.page.tabs.envVars")),
              children: <SystemSettingsEnvVarsTab />,
            },
            // ── Monitoring ──
            groupLabel("group-monitoring", t("settings.page.groups.monitoring")),
            {
              key: "metrics",
              label: tabLabel("metrics", t("settings.page.tabs.metrics")),
              children: <SystemSettingsMetricsTab />,
            },
            {
              key: "sessions",
              label: tabLabel("sessions", t("settings.page.tabs.sessions")),
              children: <SystemSettingsSessionsTab />,
            },
            // ── System ──
            groupLabel("group-system", t("settings.page.groups.system")),
            {
              key: "config",
              label: tabLabel("config", t("settings.page.tabs.config")),
              children: (
                <SystemSettingsConfigTab
                  msgApi={msgApi}
                  locale={locale}
                  onLocaleChange={onLocaleChange}
                />
              ),
            },
            {
              key: "schedules",
              label: tabLabel("schedules", t("settings.page.tabs.schedules")),
              children: <SystemSettingsSchedulesTab />,
            },
            {
              key: "app",
              label: tabLabel("app", t("settings.page.tabs.app")),
              children: (
                <SystemSettingsAppTab
                  autoGenerateTitles={autoGenerateTitles}
                  isUpdatingAutoTitlePreference={isUpdatingAutoTitlePreference}
                  onAutoTitleToggle={handleAutoTitleToggle}
                  themeMode={themeMode}
                  onThemeModeChange={onThemeModeChange}
                  vdiSafeMode={vdiSafeMode}
                  onVdiSafeModeToggle={handleVdiSafeModeToggle}
                  onClearLocalStorage={handleClearLocalStorage}
                  onResetApp={handleResetApp}
                  isResetting={isResetting}
                  darkModeKey={DARK_MODE_KEY}
                />
              ),
            },
          ].filter((item) => {
            // In simple mode, hide advanced-only tabs and their group headers
            if (!isAdvancedMode && item.key && ADVANCED_ONLY_SETTINGS_TABS.has(item.key)) {
              return false;
            }
            // Hide group headers that would be empty in simple mode
            if (!isAdvancedMode) {
              if (item.key === "group-security") return false; // masking + env-vars are advanced
              if (item.key === "group-monitoring") return false; // metrics + sessions are advanced
            }
            return true;
          })}
        />
      </Layout.Content>
    </Flex>
  );
};

export { SystemSettingsPage };
