import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Space,
  Typography,
  Input,
  InputNumber,
  Button,
  theme,
  Alert,
  Select,
  List,
  Spin,
  Switch,
  Tabs,
} from "antd";
import { useTranslation } from "react-i18next";
import { NetworkSettingsCard } from "./NetworkSettingsCard";
import AccessPasswordCard from "./AccessPasswordCard";
import { serviceFactory } from "@services/common/ServiceFactory";
import type { BambooConfig } from "@services/common/ServiceFactory";
import type { AppLocale } from "@shared/i18n/types";

interface ConfigFormState extends BambooConfig {
  http_proxy: string;
  https_proxy: string;
  memory: {
    auto_dream_enabled: boolean;
  };
  subagents: {
    max_concurrent?: number;
    executor?: string;
    claude_code_binary?: string;
    claude_code_model?: string;
    claude_code_permission_mode?: string;
    claude_code_inherit_user_config?: boolean;
    claude_code_forward_env?: string[];
  };
}

type ConfigSaveSection = "network" | "memory" | "subagents";

const { Text } = Typography;
const { useToken } = theme;
const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:9562/v1";
const SUBAGENT_EXECUTOR_BUILT_IN = "bamboo_runtime";
const SUBAGENT_EXECUTOR_CLAUDE_CODE = "claude_code";
const CLAUDE_CODE_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
] as const;

const normalizeToolNames = (names: string[]): string[] =>
  [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))].sort();

const readDisabledTools = (
  bambooConfig: Awaited<ReturnType<typeof serviceFactory.getBambooConfig>>,
): string[] => {
  const rawDisabled = bambooConfig.tools?.disabled;
  if (!Array.isArray(rawDisabled)) {
    return [];
  }

  return normalizeToolNames(rawDisabled.filter((name): name is string => typeof name === "string"));
};

interface SystemSettingsConfigTabProps {
  msgApi: {
    success: (content: string) => void;
    error: (content: string) => void;
  };
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
}

export const SystemSettingsConfigTab: React.FC<SystemSettingsConfigTabProps> = ({
  msgApi,
  locale,
  onLocaleChange,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [config, setConfig] = useState<ConfigFormState>({
    http_proxy: "",
    https_proxy: "",
    memory: {
      auto_dream_enabled: false,
    },
    subagents: {},
  });
  const [backendBaseUrl, setBackendBaseUrl] = useState(DEFAULT_BACKEND_BASE_URL);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [savedDisabledTools, setSavedDisabledTools] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isToolsBusy, setIsToolsBusy] = useState(false);

  // Load config
  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const [bambooConfig, toolsResponse] = await Promise.all([
        serviceFactory.getBambooConfig(),
        serviceFactory.getBambooTools(),
      ]);
      setConfig({
        http_proxy: bambooConfig.http_proxy || "",
        https_proxy: bambooConfig.https_proxy || "",
        memory: {
          auto_dream_enabled: bambooConfig.memory?.auto_dream_enabled ?? false,
        },
        subagents: {
          max_concurrent: bambooConfig.subagents?.max_concurrent,
          executor: bambooConfig.subagents?.executor,
          claude_code_binary: bambooConfig.subagents?.claude_code_binary,
          claude_code_model: bambooConfig.subagents?.claude_code_model,
          claude_code_permission_mode: bambooConfig.subagents?.claude_code_permission_mode,
          claude_code_inherit_user_config:
            bambooConfig.subagents?.claude_code_inherit_user_config ?? false,
          claude_code_forward_env: normalizeToolNames(
            bambooConfig.subagents?.claude_code_forward_env ?? [],
          ),
        },
      });
      const nextDisabled = readDisabledTools(bambooConfig);
      setDisabledTools(nextDisabled);
      setSavedDisabledTools(nextDisabled);
      setAvailableTools(normalizeToolNames(toolsResponse.tools || []));
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

  const handleAutoDreamToggle = (checked: boolean) => {
    setConfig((prev) => ({
      ...prev,
      memory: {
        ...prev.memory,
        auto_dream_enabled: checked,
      },
    }));
  };

  const handleSubagentMaxConcurrentChange = (value: number | null) => {
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        max_concurrent: value !== null && Number.isFinite(value) && value > 0 ? value : undefined,
      },
    }));
  };

  const handleSubagentExecutorChange = (value: string) => {
    setConfig((prev) => ({
      ...prev,
      // Always store a concrete string (never `undefined`): the save patch
      // is deep-merged server-side (crates/infra/bamboo-config/src/patch.rs
      // `deep_merge_json`), so an OMITTED key means "leave unchanged," not
      // "clear." Sending the literal "bamboo_runtime" (which the backend
      // treats identically to an absent/`None` executor — see
      // bamboo-engine external_agents/runtime.rs) is what actually reverts
      // a previously-saved `claude_code` executor back to built-in.
      subagents: {
        ...prev.subagents,
        executor: value,
      },
    }));
  };

  const handleClaudeCodeBinaryChange = (value: string) => {
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        claude_code_binary: value.trim() || undefined,
      },
    }));
  };

  const handleClaudeCodeModelChange = (value: string) => {
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        claude_code_model: value.trim() || undefined,
      },
    }));
  };

  const handleClaudeCodePermissionModeChange = (value: string) => {
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        claude_code_permission_mode: value,
      },
    }));
  };

  const handleClaudeCodeInheritUserConfigToggle = (checked: boolean) => {
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        claude_code_inherit_user_config: checked,
      },
    }));
  };

  const handleClaudeCodeForwardEnvChange = (values: string[]) => {
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        claude_code_forward_env: normalizeToolNames(values),
      },
    }));
  };

  const handleSaveConfig = async (section: ConfigSaveSection) => {
    setIsLoading(true);
    try {
      let patch: BambooConfig;
      if (section === "network") {
        patch = {
          http_proxy: config.http_proxy,
          https_proxy: config.https_proxy,
        };
      } else if (section === "memory") {
        patch = {
          memory: { auto_dream_enabled: config.memory.auto_dream_enabled },
        };
      } else {
        const isClaudeCode = config.subagents.executor === SUBAGENT_EXECUTOR_CLAUDE_CODE;
        patch = {
          subagents: {
            max_concurrent: config.subagents.max_concurrent,
            executor: config.subagents.executor,
            claude_code_binary: isClaudeCode ? config.subagents.claude_code_binary : undefined,
            claude_code_model: isClaudeCode ? config.subagents.claude_code_model : undefined,
            claude_code_permission_mode: isClaudeCode
              ? config.subagents.claude_code_permission_mode
              : undefined,
            claude_code_inherit_user_config: isClaudeCode
              ? config.subagents.claude_code_inherit_user_config
              : undefined,
            claude_code_forward_env: isClaudeCode
              ? config.subagents.claude_code_forward_env
              : undefined,
          },
        };
      }

      const validation = await serviceFactory.validateBambooConfigPatch(patch);
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

      await serviceFactory.setBambooConfig(patch);
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
    setBackendBaseUrl(DEFAULT_BACKEND_BASE_URL);
    msgApi.success(t("settings.configTab.backendResetDefault"));
  };

  const handleToolEnabledChange = (toolName: string, enabled: boolean) => {
    setDisabledTools((previous) => {
      const next = new Set(previous);
      if (enabled) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      return normalizeToolNames([...next]);
    });
  };

  const handleReloadTools = async () => {
    setIsToolsBusy(true);
    try {
      const toolsResponse = await serviceFactory.getBambooTools();
      setAvailableTools(normalizeToolNames(toolsResponse.tools || []));
      msgApi.success(t("settings.configTab.toolsReloadSuccess"));
    } catch (error) {
      console.error("Failed to reload tools:", error);
      msgApi.error(t("settings.configTab.toolsLoadFailed"));
    } finally {
      setIsToolsBusy(false);
    }
  };

  const handleSaveTools = async () => {
    setIsToolsBusy(true);
    try {
      const nextDisabled = normalizeToolNames(disabledTools);
      await serviceFactory.setBambooConfig({
        tools: {
          disabled: nextDisabled,
        },
      });
      setDisabledTools(nextDisabled);
      setSavedDisabledTools(nextDisabled);
      msgApi.success(t("settings.configTab.toolsSaveSuccess"));
    } catch (error) {
      console.error("Failed to save tool settings:", error);
      msgApi.error(t("settings.configTab.toolsSaveFailed"));
    } finally {
      setIsToolsBusy(false);
    }
  };

  const hasToolChanges = JSON.stringify(disabledTools) !== JSON.stringify(savedDisabledTools);
  const disabledToolSet = new Set(disabledTools);

  return (
    <Spin spinning={isLoading} tip={t("settings.common.loading")}>
      <Tabs
        items={[
          {
            key: "general",
            label: t("settings.configTab.tabs.general"),
            children: (
              <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
                <NetworkSettingsCard
                  httpProxy={config.http_proxy}
                  httpsProxy={config.https_proxy}
                  onHttpProxyChange={handleHttpProxyChange}
                  onHttpsProxyChange={handleHttpsProxyChange}
                  onReload={loadConfig}
                  onSave={() => handleSaveConfig("network")}
                  isLoading={isLoading}
                />

                <Card
                  size="small"
                  className="lotus-settings-card"
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
                      {
                        label: t("settings.configTab.languageHindi"),
                        value: "hi-IN",
                      },
                    ]}
                    onChange={(value) => onLocaleChange(value as AppLocale)}
                  />
                </Card>

                <Card
                  size="small"
                  className="lotus-settings-card"
                  title={<Text strong>{t("settings.configTab.memoryTitle")}</Text>}
                >
                  <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
                    <Text type="secondary">{t("settings.configTab.memoryDescription")}</Text>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: token.marginMD,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <Text strong>{t("settings.configTab.autoDreamEnabled")}</Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            {t("settings.configTab.autoDreamEnabledHint")}
                          </Text>
                        </div>
                      </div>
                      <Switch
                        data-testid="auto-dream-toggle"
                        checked={config.memory.auto_dream_enabled}
                        onChange={handleAutoDreamToggle}
                      />
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Button
                        data-testid="save-memory-settings"
                        type="primary"
                        onClick={() => handleSaveConfig("memory")}
                        loading={isLoading}
                      >
                        {t("settings.configTab.save")}
                      </Button>
                    </div>
                  </Space>
                </Card>

                <Card
                  size="small"
                  className="lotus-settings-card"
                  title={<Text strong>{t("settings.configTab.subagentsTitle")}</Text>}
                >
                  <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
                    <Text type="secondary">{t("settings.configTab.subagentsDescription")}</Text>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: token.marginMD,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <Text strong>{t("settings.configTab.subagentMaxConcurrent")}</Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            {t("settings.configTab.subagentMaxConcurrentHint")}
                          </Text>
                        </div>
                      </div>
                      <InputNumber
                        data-testid="subagent-max-concurrent"
                        style={{ width: 120 }}
                        min={1}
                        step={1}
                        precision={0}
                        placeholder="8"
                        value={config.subagents.max_concurrent ?? null}
                        onChange={(value) =>
                          handleSubagentMaxConcurrentChange(
                            typeof value === "number" ? value : null,
                          )
                        }
                      />
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: token.marginMD,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <Text strong>{t("settings.configTab.subagentExecutor")}</Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            {t("settings.configTab.subagentExecutorHint")}
                          </Text>
                        </div>
                      </div>
                      <Select
                        data-testid="subagent-executor"
                        style={{ width: 260 }}
                        value={config.subagents.executor ?? SUBAGENT_EXECUTOR_BUILT_IN}
                        onChange={(value) => handleSubagentExecutorChange(value as string)}
                        options={[
                          {
                            label: t("settings.configTab.subagentExecutorBuiltIn"),
                            value: SUBAGENT_EXECUTOR_BUILT_IN,
                          },
                          {
                            label: t("settings.configTab.subagentExecutorClaudeCode"),
                            value: SUBAGENT_EXECUTOR_CLAUDE_CODE,
                          },
                        ]}
                      />
                    </div>

                    {config.subagents.executor === SUBAGENT_EXECUTOR_CLAUDE_CODE && (
                      <Space
                        direction="vertical"
                        size={token.marginMD}
                        style={{
                          width: "100%",
                          padding: token.paddingSM,
                          borderRadius: token.borderRadiusLG,
                          background: token.colorFillTertiary,
                        }}
                      >
                        <Alert
                          type="info"
                          showIcon
                          message={t("settings.configTab.claudeCodeExecutorNotice")}
                        />

                        <div>
                          <Text strong>{t("settings.configTab.claudeCodeBinary")}</Text>
                          <div>
                            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                              {t("settings.configTab.claudeCodeBinaryHint")}
                            </Text>
                          </div>
                          <Input
                            data-testid="claude-code-binary"
                            style={{ marginTop: token.marginXXS }}
                            placeholder={t("settings.configTab.claudeCodeBinaryPlaceholder")}
                            value={config.subagents.claude_code_binary ?? ""}
                            onChange={(e) => handleClaudeCodeBinaryChange(e.target.value)}
                          />
                        </div>

                        <div>
                          <Text strong>{t("settings.configTab.claudeCodeModel")}</Text>
                          <div>
                            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                              {t("settings.configTab.claudeCodeModelHint")}
                            </Text>
                          </div>
                          <Input
                            data-testid="claude-code-model"
                            style={{ marginTop: token.marginXXS }}
                            placeholder={t("settings.configTab.claudeCodeModelPlaceholder")}
                            value={config.subagents.claude_code_model ?? ""}
                            onChange={(e) => handleClaudeCodeModelChange(e.target.value)}
                          />
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: token.marginMD,
                            flexWrap: "wrap",
                          }}
                        >
                          <div>
                            <Text strong>{t("settings.configTab.claudeCodePermissionMode")}</Text>
                            <div>
                              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                {t("settings.configTab.claudeCodePermissionModeHint")}
                              </Text>
                            </div>
                          </div>
                          <Select
                            data-testid="claude-code-permission-mode"
                            style={{ width: 220 }}
                            value={config.subagents.claude_code_permission_mode ?? "default"}
                            onChange={(value) =>
                              handleClaudeCodePermissionModeChange(value as string)
                            }
                            options={CLAUDE_CODE_PERMISSION_MODES.map((mode) => ({
                              label: t(`settings.configTab.claudeCodePermissionModes.${mode}`),
                              value: mode,
                            }))}
                          />
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: token.marginMD,
                            flexWrap: "wrap",
                          }}
                        >
                          <div>
                            <Text strong>
                              {t("settings.configTab.claudeCodeInheritUserConfig")}
                            </Text>
                            <div>
                              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                {t("settings.configTab.claudeCodeInheritUserConfigHint")}
                              </Text>
                            </div>
                          </div>
                          <Switch
                            data-testid="claude-code-inherit-user-config"
                            checked={config.subagents.claude_code_inherit_user_config ?? false}
                            onChange={handleClaudeCodeInheritUserConfigToggle}
                          />
                        </div>

                        <div>
                          <Text strong>{t("settings.configTab.claudeCodeForwardEnv")}</Text>
                          <div>
                            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                              {t("settings.configTab.claudeCodeForwardEnvHint")}
                            </Text>
                          </div>
                          <Select<string[]>
                            data-testid="claude-code-forward-env"
                            mode="tags"
                            open={false}
                            tokenSeparators={[",", " "]}
                            style={{ width: "100%", marginTop: token.marginXXS }}
                            value={config.subagents.claude_code_forward_env ?? []}
                            onChange={(value) => handleClaudeCodeForwardEnvChange(value)}
                            placeholder={t("settings.configTab.claudeCodeForwardEnvPlaceholder")}
                          />
                        </div>
                      </Space>
                    )}

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Button
                        data-testid="save-subagent-settings"
                        type="primary"
                        onClick={() => handleSaveConfig("subagents")}
                        loading={isLoading}
                      >
                        {t("settings.configTab.save")}
                      </Button>
                    </div>
                  </Space>
                </Card>

                <Card
                  size="small"
                  title={<Text strong>{t("settings.configTab.backendApiBaseUrlTitle")}</Text>}
                >
                  <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                    <Space direction="vertical" size={token.marginXXS} style={{ width: "100%" }}>
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
                      <Button data-testid="reset-to-defaults" onClick={handleResetBackendUrl}>
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

                <AccessPasswordCard msgApi={msgApi} />
              </Space>
            ),
          },
          {
            key: "tools",
            label: t("settings.configTab.tabs.tools"),
            children: (
              <Card size="small" title={<Text strong>{t("settings.configTab.toolsTitle")}</Text>}>
                <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
                  <Text type="secondary">{t("settings.configTab.toolsDescription")}</Text>

                  {availableTools.length === 0 ? (
                    <Alert type="info" showIcon message={t("settings.configTab.toolsEmpty")} />
                  ) : (
                    <List
                      bordered
                      dataSource={availableTools}
                      renderItem={(toolName) => (
                        <List.Item
                          actions={[
                            <Switch
                              key={`${toolName}-switch`}
                              checked={!disabledToolSet.has(toolName)}
                              onChange={(enabled) => handleToolEnabledChange(toolName, enabled)}
                            />,
                          ]}
                        >
                          <Text code>{toolName}</Text>
                        </List.Item>
                      )}
                    />
                  )}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: token.marginSM,
                    }}
                  >
                    <Button onClick={handleReloadTools} loading={isToolsBusy}>
                      {t("settings.configTab.reloadTools")}
                    </Button>
                    <Button
                      type="primary"
                      onClick={handleSaveTools}
                      loading={isToolsBusy}
                      disabled={!hasToolChanges}
                    >
                      {t("settings.configTab.save")}
                    </Button>
                  </div>
                </Space>
              </Card>
            ),
          },
        ]}
      />
    </Spin>
  );
};

export default SystemSettingsConfigTab;
