import { debugLog } from "@shared/utils/debugFlags";
import React, { useCallback, useEffect, useState } from "react";
import {
  Form,
  Select,
  Input,
  Button,
  Card,
  message,
  Space,
  Divider,
  Typography,
  Alert,
  Tag,
  Spin,
  Switch,
  Tooltip,
  theme,
} from "antd";
import {
  SaveOutlined,
  KeyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoginOutlined,
  LogoutOutlined,
} from "@ant-design/icons";
import { DeviceCodeModal } from "./DeviceCodeModal";
import { isApiError } from "@services/api/client";
import {
  settingsService,
  type CopilotAuthStatus,
  type DeviceCodeInfo,
  type EnvVarResponse,
} from "@services/config/SettingsService";
import type { ProviderConfig, ProviderType } from "../../../ChatPage/types/providerConfig";
import {
  PROVIDER_LABELS,
  OPENAI_MODELS,
  ANTHROPIC_MODELS,
  GEMINI_MODELS,
  COPILOT_MODELS,
} from "../../../ChatPage/types/providerConfig";
import { modelService } from "@services/chat/ModelService";
import {
  ServiceFactory,
  type BambooConfigValidationIssue,
} from "../../../../services/common/ServiceFactory";
import { copyText } from "@shared/utils/clipboard";
import { useTranslation } from "react-i18next";

const { Option } = Select;
const { Password } = Input;
const { Text, Paragraph } = Typography;

const renderResponsesOnlyModelsHelp = (t: (key: string) => string) => (
  <Space direction="vertical" size={4}>
    <Text type="secondary">
      {t("settings.providerTab.responsesOnlyHelp1")} <Text code>/responses</Text>.
    </Text>
    <Text type="secondary">{t("settings.providerTab.responsesOnlyHelp2")}</Text>
  </Space>
);

type ModelProvider = "openai" | "anthropic" | "gemini" | "copilot";

type EditableProviderConfig<K extends ModelProvider = ModelProvider> = NonNullable<
  ProviderConfig["providers"][K]
> & {
  request_overrides_json?: string;
};

type EditableProviders = {
  [K in ModelProvider]?: EditableProviderConfig<K>;
};

type EditableProviderRecord = Record<ModelProvider, EditableProviderConfig | undefined>;

const MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "copilot",
] as const satisfies readonly ModelProvider[];

const formatModelsForSelect = (models: string[]) =>
  models.map((model) => ({
    value: model,
    label: model,
  }));

/**
 * Provider Settings Component
 *
 * Allows users to configure and switch between different LLM providers.
 */
export const ProviderSettings: React.FC = () => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [applyingConfig, setApplyingConfig] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<ProviderType>("copilot");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [copilotAuthStatus, setCopilotAuthStatus] = useState<CopilotAuthStatus | null>(null);
  const [checkingCopilotAuth, setCheckingCopilotAuth] = useState(false);
  const [authenticatingCopilot, setAuthenticatingCopilot] = useState(false);
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<DeviceCodeInfo | null>(null);
  const [isDeviceCodeModalVisible, setIsDeviceCodeModalVisible] = useState(false);
  const [completingAuth, setCompletingAuth] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [copiedUserCode, setCopiedUserCode] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [availableModels, setAvailableModels] = useState<Array<{ value: string; label: string }>>(
    [],
  );
  const [modelsFetchError, setModelsFetchError] = useState<string | null>(null);
  const [hasTriedFetchModels, setHasTriedFetchModels] = useState(false);
  const [envVarEntries, setEnvVarEntries] = useState<EnvVarResponse[]>([]);

  const [modelAutoSaveStatus, setModelAutoSaveStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [modelAutoSaveError, setModelAutoSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (modelAutoSaveStatus !== "success") return;

    const timer = setTimeout(() => {
      setModelAutoSaveStatus("idle");
      setModelAutoSaveError(null);
    }, 2000);

    return () => clearTimeout(timer);
  }, [modelAutoSaveStatus]);

  // If the user edits provider credentials, clear the model cache and allow
  // auto-fetch to run again the next time the dropdown opens.
  const openaiApiKey = Form.useWatch(["providers", "openai", "api_key"], form);
  const openaiBaseUrl = Form.useWatch(["providers", "openai", "base_url"], form);
  const anthropicApiKey = Form.useWatch(["providers", "anthropic", "api_key"], form);
  const anthropicBaseUrl = Form.useWatch(["providers", "anthropic", "base_url"], form);
  const geminiApiKey = Form.useWatch(["providers", "gemini", "api_key"], form);
  const geminiBaseUrl = Form.useWatch(["providers", "gemini", "base_url"], form);

  useEffect(() => {
    if (currentProvider !== "openai") return;
    setAvailableModels([]);
    setModelsFetchError(null);
    setHasTriedFetchModels(false);
  }, [currentProvider, openaiApiKey, openaiBaseUrl]);

  useEffect(() => {
    if (currentProvider !== "anthropic") return;
    setAvailableModels([]);
    setModelsFetchError(null);
    setHasTriedFetchModels(false);
  }, [currentProvider, anthropicApiKey, anthropicBaseUrl]);

  useEffect(() => {
    if (currentProvider !== "gemini") return;
    setAvailableModels([]);
    setModelsFetchError(null);
    setHasTriedFetchModels(false);
  }, [currentProvider, geminiApiKey, geminiBaseUrl]);

  // Countdown timer for device code expiration
  useEffect(() => {
    if (!isDeviceCodeModalVisible || !deviceCodeInfo) {
      setTimeRemaining(0);
      return;
    }

    setTimeRemaining(deviceCodeInfo.expires_in);

    const timer = setInterval(() => {
      setTimeRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [isDeviceCodeModalVisible, deviceCodeInfo]);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const response = await settingsService.getProviderConfig();

      // Transform backend response to frontend format
      // Backend returns: { provider, providers: { openai: {...} } }
      // Frontend expects: { provider, providers: { openai: {...} } }
      const config: ProviderConfig = {
        provider: response.provider,
        providers: response.providers || {},
      };

      // Copilot needs a model selected for the UI to enable chat. If the backend
      // config doesn't include one yet, default to a sensible option.
      if (config.provider === "copilot") {
        const copilot = (config.providers.copilot ?? {}) as EditableProviderConfig;
        if (!copilot.model) {
          config.providers.copilot = { ...copilot, model: "gpt-4o" };
        }
      }

      debugLog("[Provider]", "Loaded provider config:", config);
      const providersWithEditorFields: EditableProviders = {
        ...(config.providers || {}),
      };
      MODEL_PROVIDERS.forEach((provider) => {
        const providerCfg = providersWithEditorFields[provider];
        if (!providerCfg) return;
        if (providerCfg.request_overrides && typeof providerCfg.request_overrides === "object") {
          providerCfg.request_overrides_json = JSON.stringify(
            providerCfg.request_overrides,
            null,
            2,
          );
        }
      });

      setCurrentProvider(config.provider as ProviderType);
      form.setFieldsValue({
        ...config,
        providers: providersWithEditorFields,
      });
      setConfigLoaded(true);
    } catch (error) {
      message.error(t("settings.providerTab.loadConfigFailed"));
      console.error("Failed to load provider config:", error);
    } finally {
      setLoading(false);
    }
  }, [form, t]);

  const loadEnvVars = useCallback(async () => {
    try {
      const response = await settingsService.getEnvVars();
      setEnvVarEntries(response.entries || []);
    } catch (error) {
      console.warn("Failed to load env vars for provider overrides:", error);
    }
  }, []);

  const checkCopilotAuthStatus = useCallback(async () => {
    try {
      setCheckingCopilotAuth(true);
      const status = await settingsService.getCopilotAuthStatus();
      setCopilotAuthStatus(status);
    } catch (error) {
      console.error("Failed to check Copilot auth status:", error);
      setCopilotAuthStatus({
        authenticated: false,
        message: t("settings.providerTab.checkStatusFailed"),
      });
    } finally {
      setCheckingCopilotAuth(false);
    }
  }, [t]);

  useEffect(() => {
    void loadConfig();
    void loadEnvVars();
  }, [loadConfig, loadEnvVars]);

  useEffect(() => {
    if (currentProvider === "copilot") {
      void checkCopilotAuthStatus();
    }
  }, [currentProvider, checkCopilotAuthStatus]);

  const handleCopilotAuthenticate = async () => {
    try {
      setAuthenticatingCopilot(true);
      // Start authentication - get device code
      const deviceCode = await settingsService.startCopilotAuth();
      setDeviceCodeInfo(deviceCode);
      setIsDeviceCodeModalVisible(true);
    } catch (error) {
      message.error(t("settings.providerTab.startCopilotAuthFailed"));
      console.error("Failed to start Copilot authentication:", error);
    } finally {
      setAuthenticatingCopilot(false);
    }
  };

  const handleCompleteAuth = async () => {
    if (!deviceCodeInfo) return;

    try {
      setCompletingAuth(true);
      // Complete authentication - poll for token
      await settingsService.completeCopilotAuth({
        device_code: deviceCodeInfo.device_code, // Use the actual device code, not user code!
        interval: deviceCodeInfo.interval || 5,
        expires_in: deviceCodeInfo.expires_in,
      });
      message.success(t("settings.providerTab.copilotAuthSuccess"));
      setIsDeviceCodeModalVisible(false);
      setDeviceCodeInfo(null);
      await checkCopilotAuthStatus();
    } catch (error) {
      message.error(t("settings.providerTab.completeAuthFailed"));
      console.error("Authentication completion failed:", error);
    } finally {
      setCompletingAuth(false);
    }
  };

  // Note: Browser is opened automatically by backend when starting auth

  const handleCopyUserCode = async () => {
    if (deviceCodeInfo) {
      try {
        await copyText(deviceCodeInfo.user_code);
        setCopiedUserCode(true);
        message.success(t("settings.providerTab.userCodeCopied"));
        setTimeout(() => setCopiedUserCode(false), 2000);
      } catch {
        message.error(
          `${t("settings.providerTab.copyCodeFailedPrefix")} ${deviceCodeInfo.user_code}`,
        );
      }
    }
  };

  const handleCopilotLogout = async () => {
    try {
      setAuthenticatingCopilot(true);
      await settingsService.logoutCopilot();
      message.success(t("settings.providerTab.logoutSuccess"));
      await checkCopilotAuthStatus();
    } catch (error) {
      message.error(t("settings.providerTab.logoutFailed"));
      console.error("Failed to logout:", error);
    } finally {
      setAuthenticatingCopilot(false);
    }
  };

  const handleProviderChange = (value: ProviderType) => {
    setCurrentProvider(value);
    form.setFieldsValue({ provider: value });
    setAvailableModels([]); // Clear models when switching provider
    setModelsFetchError(null);
    setHasTriedFetchModels(false);
    setModelAutoSaveStatus("idle");
    setModelAutoSaveError(null);
  };

  const getErrorMessage = (error: unknown): string => {
    if (isApiError(error)) return error.message;
    if (error instanceof Error) return error.message;
    return t("settings.providerTab.unknownError");
  };

  const clearProviderValidationErrors = (provider: ProviderType) => {
    // Clear the most common provider-scoped fields to avoid stale errors.
    form.setFields([
      { name: ["provider"], errors: [] },
      { name: ["providers", provider, "api_key"], errors: [] },
      { name: ["providers", provider, "model"], errors: [] },
    ]);
  };

  const pathToName = (path: string): Array<string | number> | null => {
    const trimmed = path.trim();
    if (!trimmed) return null;
    if (trimmed.includes(".")) return trimmed.split(".").filter(Boolean);
    if (trimmed === "provider") return ["provider"];
    if (trimmed === "provider/providers") return ["provider"];
    return null;
  };

  const applyValidationIssuesToForm = (
    issues: BambooConfigValidationIssue[],
    provider: ProviderType,
  ) => {
    if (!issues.length) return;

    const fields: Parameters<typeof form.setFields>[0] = issues
      .map((issue) => {
        // Prefer backend-provided paths (e.g. providers.openai.api_key).
        const direct = pathToName(issue.path);
        if (direct) {
          return { name: direct, errors: [issue.message] };
        }

        // Fallback mapping for older/less specific server errors.
        if (issue.message.toLowerCase().includes("api key")) {
          return {
            name: ["providers", provider, "api_key"],
            errors: [issue.message],
          };
        }

        return { name: ["provider"], errors: [issue.message] };
      })
      // De-dupe by name to avoid antd warnings.
      .filter(
        (field, index, arr) =>
          arr.findIndex((f) => JSON.stringify(f.name) === JSON.stringify(field.name)) === index,
      );

    if (fields.length) {
      form.setFields(fields);
    }
  };

  const validateProviderPatch = async (
    values: ProviderConfig,
  ): Promise<{
    valid: boolean;
    message?: string;
  }> => {
    const provider = (values.provider || currentProvider) as ProviderType;
    clearProviderValidationErrors(provider);

    try {
      const serviceFactory = ServiceFactory.getInstance();
      const result = await serviceFactory.validateBambooConfigPatch({
        provider: values.provider,
        providers: values.providers || {},
      });

      if (result.valid) {
        return { valid: true };
      }

      const providerIssues = result.errors?.provider || [];
      applyValidationIssuesToForm(providerIssues, provider);
      const first = providerIssues[0];
      return {
        valid: false,
        message: first?.message || t("settings.providerTab.invalidConfig"),
      };
    } catch (error) {
      // Validation is best-effort; if it fails (network/server mismatch), fall back to strict
      // backend validation on save.
      console.warn("Config validation failed, falling back to save:", error);
      return { valid: true };
    }
  };

  const handleFetchProviderModels = async (
    provider: ModelProvider,
    options?: {
      force?: boolean;
      showMessage?: boolean;
    },
  ) => {
    const providerLabel: Record<ModelProvider, string> = {
      openai: t("settings.providerTab.providerNames.openai"),
      anthropic: t("settings.providerTab.providerNames.anthropic"),
      gemini: t("settings.providerTab.providerNames.gemini"),
      copilot: t("settings.providerTab.providerNames.copilot"),
    };
    const fallbackMessage =
      provider === "copilot"
        ? t("settings.providerTab.fetchModelsCopilotFailed")
        : t("settings.providerTab.fetchModelsFailed");

    if (!options?.force && availableModels.length > 0) return;

    try {
      setFetchingModels(true);
      setModelsFetchError(null);
      setHasTriedFetchModels(true);

      const models =
        provider === "copilot"
          ? await modelService.getModels()
          : await settingsService.fetchProviderModels(provider);
      const formattedModels = formatModelsForSelect(models);

      setAvailableModels(formattedModels);

      if (provider === "copilot" && formattedModels.length === 0) {
        const msg = t("settings.providerTab.noModelsReturned");
        setModelsFetchError(msg);
        if (options?.showMessage !== false) message.warning(msg);
        return;
      }

      if (options?.showMessage !== false) {
        message.success(
          t("settings.providerTab.foundModels", {
            count: formattedModels.length,
          }),
        );
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setModelsFetchError(errorMessage);
      if (options?.showMessage !== false) {
        message.error(
          errorMessage
            ? `${t("settings.providerTab.fetchModelsErrorPrefix")}: ${errorMessage}`
            : fallbackMessage,
        );
      }
      console.error(`Failed to fetch ${providerLabel[provider]} models:`, error);
    } finally {
      setFetchingModels(false);
    }
  };

  const handleSave = async (
    values: ProviderConfig,
    options?: { showMessage?: boolean; throwOnError?: boolean },
  ) => {
    try {
      setLoading(true);

      const normalizedValues: ProviderConfig = {
        provider: values.provider,
        providers: { ...(values.providers || {}) },
      };
      const editableProviders = normalizedValues.providers as EditableProviders;
      for (const p of MODEL_PROVIDERS) {
        const providerCfg = editableProviders[p];
        if (!providerCfg) continue;

        const rawJson = providerCfg.request_overrides_json;
        if (typeof rawJson !== "string") continue;

        const trimmed = rawJson.trim();
        if (!trimmed) {
          delete providerCfg.request_overrides;
        } else {
          try {
            providerCfg.request_overrides = JSON.parse(trimmed);
          } catch (error) {
            const messageText = `Invalid request_overrides JSON for ${p}: ${(error as Error).message}`;
            form.setFields([
              {
                name: ["providers", p, "request_overrides_json"],
                errors: [messageText],
              },
            ]);
            if (options?.showMessage !== false) {
              message.error(messageText);
            }
            if (options?.throwOnError) throw error;
            return;
          }
        }
        delete providerCfg.request_overrides_json;
      }

      // Transform frontend format to backend format
      // Frontend has: { provider, providers: { openai: {...} } }
      // Backend expects: { provider, providers: { openai: {...} } }
      const payload = {
        provider: normalizedValues.provider,
        providers: normalizedValues.providers || {},
      };

      const validation = await validateProviderPatch(normalizedValues);
      if (!validation.valid) {
        const errorMessage = validation.message || t("settings.providerTab.invalidConfig");
        if (options?.showMessage !== false) {
          message.error(`${t("settings.providerTab.invalidConfigPrefix")}: ${errorMessage}`);
        }
        if (options?.throwOnError) throw new Error(errorMessage);
        return;
      }

      debugLog("[Provider]", "Saving provider config:", payload);
      await settingsService.saveProviderConfig(payload);
      if (options?.showMessage !== false) {
        message.success(t("settings.providerTab.saveConfigSuccess"));
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (options?.showMessage !== false) {
        message.error(
          errorMessage
            ? `${t("settings.providerTab.saveConfigErrorPrefix")}: ${errorMessage}`
            : t("settings.providerTab.saveConfigFailed"),
        );
      }
      console.error("Failed to save configuration:", error);
      if (options?.throwOnError) throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async (options?: { showMessage?: boolean; throwOnError?: boolean }) => {
    try {
      setApplyingConfig(true);

      // POST /bamboo/settings/provider already saves the config and reloads the provider
      // on the backend. Here we just refresh the frontend store so useActiveModel()
      // reflects the updated provider/model immediately.
      const { useProviderStore } = await import("../../../ChatPage/store/slices/providerSlice");
      await useProviderStore.getState().loadProviderConfig();

      if (options?.showMessage !== false) {
        message.success(t("settings.providerTab.applyConfigSuccess"));
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      if (options?.showMessage !== false) {
        message.error(
          errorMessage
            ? `${t("settings.providerTab.applyConfigErrorPrefix")}: ${errorMessage}`
            : t("settings.providerTab.applyConfigFailed"),
        );
      }
      console.error("Failed to apply configuration:", error);
      if (options?.throwOnError) throw error;
    } finally {
      setApplyingConfig(false);
    }
  };

  const handleSaveAndApply = async (values: ProviderConfig) => {
    try {
      await handleSave(values, { throwOnError: true });
      await handleApply({ throwOnError: true });
    } catch {
      // Errors already shown via handleSave/handleApply
    }
  };

  const handleFetchModelsWithSave = async (
    provider: ModelProvider,
    options?: { force?: boolean },
  ) => {
    // If we already have models and this isn't an explicit refresh, do nothing.
    if (!options?.force && availableModels.length > 0) return;

    // Ensure latest API key/base URL is persisted before we fetch models.
    try {
      const values = form.getFieldsValue(true) as ProviderConfig;
      await handleSave(values, {
        showMessage: false,
        throwOnError: true,
      });
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setModelsFetchError(errorMessage);
      setHasTriedFetchModels(true);
      message.error(
        errorMessage
          ? `${t("settings.providerTab.saveConfigErrorPrefix")}: ${errorMessage}`
          : t("settings.providerTab.saveConfigFailed"),
      );
      return;
    }

    await handleFetchProviderModels(provider, { force: options?.force });
  };

  const handleModelDropdownOpen = async (provider: ModelProvider, open: boolean) => {
    if (!open) return;
    if (fetchingModels) return;
    if (availableModels.length > 0) return;
    if (hasTriedFetchModels && modelsFetchError) return;

    await handleFetchModelsWithSave(provider);
  };

  const handleModelChange = async (provider: ModelProvider, value: string | undefined) => {
    if (!value) return; // Don't auto-save cleared values
    if (modelAutoSaveStatus === "saving") return;

    setModelAutoSaveStatus("saving");
    setModelAutoSaveError(null);

    try {
      const currentValues = form.getFieldsValue(true) as ProviderConfig & {
        providers: EditableProviders;
      };

      // Ensure we save with the newly-selected model even if Form's internal
      // update hasn't propagated yet.
      const providers = (currentValues.providers || {}) as EditableProviders;
      const providerRecord = providers as EditableProviderRecord;
      providerRecord[provider] = {
        ...(providerRecord[provider] ?? {}),
        model: value,
      };
      currentValues.providers = providers;

      await handleSave(currentValues, {
        showMessage: false,
        throwOnError: true,
      });
      await handleApply({ showMessage: false, throwOnError: true });

      setModelAutoSaveStatus("success");
      message.success(t("settings.providerTab.modelUpdated"));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setModelAutoSaveStatus("error");
      setModelAutoSaveError(errorMessage);
      message.error(
        errorMessage
          ? `${t("settings.providerTab.updateModelErrorPrefix")}: ${errorMessage}`
          : t("settings.providerTab.updateModelFailed"),
      );
    }
  };

  const handleRoleModelChange = async (
    provider: ModelProvider,
    field: "fast_model" | "vision_model",
    value: string | undefined,
  ) => {
    // Auto-save role model changes (same as default model)
    if (modelAutoSaveStatus === "saving") return;

    setModelAutoSaveStatus("saving");
    setModelAutoSaveError(null);

    try {
      const currentValues = form.getFieldsValue(true) as ProviderConfig & {
        providers: EditableProviders;
      };
      const providers = (currentValues.providers || {}) as EditableProviders;
      const providerRecord = providers as EditableProviderRecord;
      providerRecord[provider] = {
        ...(providerRecord[provider] ?? {}),
        [field]: value || undefined, // clear → undefined (falls back to default)
      };
      currentValues.providers = providers;

      await handleSave(currentValues, {
        showMessage: false,
        throwOnError: true,
      });
      await handleApply({ showMessage: false, throwOnError: true });

      setModelAutoSaveStatus("success");
      message.success(t("settings.providerTab.modelUpdated"));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setModelAutoSaveStatus("error");
      setModelAutoSaveError(errorMessage);
      message.error(
        errorMessage
          ? `${t("settings.providerTab.updateModelErrorPrefix")}: ${errorMessage}`
          : t("settings.providerTab.updateModelFailed"),
      );
    }
  };

  const renderRoleModelFields = (
    provider: ModelProvider,
    fallbackModels: ReadonlyArray<{ value: string; label: string }>,
  ) => {
    const models = availableModels.length > 0 ? availableModels : fallbackModels;
    return (
      <>
        <Form.Item
          name={["providers", provider, "fast_model"]}
          label={t("settings.providerTab.fastModel")}
          extra={<Text type="secondary">{t("settings.providerTab.fastModelHelp")}</Text>}
        >
          <Select
            placeholder={t("settings.providerTab.sameAsDefault")}
            allowClear
            showSearch
            loading={fetchingModels}
            disabled={modelAutoSaveStatus === "saving"}
            notFoundContent={fetchingModels ? <Spin size="small" /> : null}
            onDropdownVisibleChange={(open) => handleModelDropdownOpen(provider, open)}
            onChange={(value) => handleRoleModelChange(provider, "fast_model", value)}
          >
            {models.map((model) => (
              <Option key={model.value} value={model.value}>
                {model.label}
              </Option>
            ))}
          </Select>
        </Form.Item>
        <Form.Item
          name={["providers", provider, "vision_model"]}
          label={t("settings.providerTab.visionModel")}
          extra={<Text type="secondary">{t("settings.providerTab.visionModelHelp")}</Text>}
        >
          <Select
            placeholder={t("settings.providerTab.sameAsDefault")}
            allowClear
            showSearch
            loading={fetchingModels}
            disabled={modelAutoSaveStatus === "saving"}
            notFoundContent={fetchingModels ? <Spin size="small" /> : null}
            onDropdownVisibleChange={(open) => handleModelDropdownOpen(provider, open)}
            onChange={(value) => handleRoleModelChange(provider, "vision_model", value)}
          >
            {models.map((model) => (
              <Option key={model.value} value={model.value}>
                {model.label}
              </Option>
            ))}
          </Select>
        </Form.Item>
      </>
    );
  };

  const renderModelFetchExtra = (provider: ModelProvider, sourceLabel: "API" | "backend") => (
    <Space direction="vertical" size={4}>
      <Space size="small">
        <Button
          type="link"
          size="small"
          onClick={() => handleFetchModelsWithSave(provider, { force: true })}
          loading={fetchingModels}
          style={{ padding: 0 }}
        >
          {fetchingModels
            ? t("settings.providerTab.fetchingModels")
            : availableModels.length > 0
              ? t("settings.providerTab.refreshModelsFrom", {
                  source: sourceLabel,
                })
              : t("settings.providerTab.fetchModelsFrom", {
                  source: sourceLabel,
                })}
        </Button>
        {modelAutoSaveStatus === "saving" && <Spin size="small" />}
        {modelAutoSaveStatus === "success" && (
          <CheckCircleOutlined style={{ color: "var(--lotus-chart-secondary)" }} />
        )}
        {modelAutoSaveStatus === "error" && (
          <Tooltip title={modelAutoSaveError || t("settings.providerTab.saveModelChangeFailed")}>
            <CloseCircleOutlined style={{ color: "var(--lotus-chart-danger)" }} />
          </Tooltip>
        )}
      </Space>
      {modelsFetchError && (
        <Space size="small">
          <Tooltip title={modelsFetchError}>
            <Text type="danger">{t("settings.providerTab.fetchModelsFailedShort")}</Text>
          </Tooltip>
          <Button
            size="small"
            onClick={() => handleFetchModelsWithSave(provider, { force: true })}
            loading={fetchingModels}
          >
            {t("settings.providerTab.retry")}
          </Button>
        </Space>
      )}
    </Space>
  );

  const renderRequestOverridesEditor = (provider: ModelProvider) => {
    const envNames = envVarEntries.map((entry) => entry.name);
    const placeholder = `{
  "common": {
    "headers": {
      "x-request-id": { "type": "generated", "generator": "uuid" },
      "x-tenant": { "type": "env_ref", "name": "TENANT_ID" }
    }
  },
  "rules": [
    {
      "model_pattern": "gpt-5*",
      "scope": {
        "body_patch": [
          { "path": "metadata.trace_id", "op": "set", "value": { "type": "generated", "generator": "uuid" } }
        ]
      }
    }
  ]
}`;

    return (
      <Form.Item
        name={["providers", provider, "request_overrides_json"]}
        label="Advanced Request Overrides (JSON)"
        extra={
          <Space direction="vertical" size={4}>
            <Text type="secondary">
              Customize provider request headers/body patch rules. Supports endpoint scoping and
              model-based rules.
            </Text>
            <Text type="secondary">
              Env var injection:{" "}
              <Text code>{`{ "type": "env_ref", "name": "YOUR_ENV_NAME" }`}</Text>
            </Text>
            {envNames.length > 0 && (
              <Space wrap size={[6, 6]}>
                {envNames.map((name) => (
                  <Tag key={name}>{name}</Tag>
                ))}
              </Space>
            )}
          </Space>
        }
      >
        <Input.TextArea
          autoSize={{ minRows: 8, maxRows: 20 }}
          placeholder={placeholder}
          style={{
            fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          }}
        />
      </Form.Item>
    );
  };

  const renderProviderFields = () => {
    switch (currentProvider) {
      case "openai":
        return (
          <>
            <Alert
              message={t("settings.providerTab.openaiConfigTitle")}
              description={t("settings.providerTab.openaiConfigDescription")}
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Form.Item
              name={["providers", "openai", "api_key"]}
              label={t("settings.providerTab.openaiApiKey")}
              rules={[
                {
                  required: true,
                  message: t("settings.providerTab.openaiApiKeyRequired"),
                },
              ]}
            >
              <Input.Password
                data-testid="api-key-input"
                placeholder="sk-..."
                prefix={<KeyOutlined />}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "openai", "base_url"]}
              label={t("settings.providerTab.baseUrlOptional")}
              extra={t("settings.providerTab.openaiBaseUrlHelp")}
            >
              <Input placeholder="https://api.openai.com/v1" />
            </Form.Item>
            <Form.Item
              name={["providers", "openai", "model"]}
              label={t("settings.providerTab.defaultModel")}
              rules={[
                {
                  required: true,
                  message: t("settings.providerTab.selectModelRequired"),
                },
              ]}
              extra={renderModelFetchExtra("openai", "API")}
            >
              <Select
                placeholder={t("settings.providerTab.selectModel")}
                allowClear
                showSearch
                loading={fetchingModels}
                disabled={modelAutoSaveStatus === "saving"}
                notFoundContent={fetchingModels ? <Spin size="small" /> : null}
                onDropdownVisibleChange={(open) => handleModelDropdownOpen("openai", open)}
                onChange={(value) => handleModelChange("openai", value)}
              >
                {(availableModels.length > 0 ? availableModels : OPENAI_MODELS).map((model) => (
                  <Option key={model.value} value={model.value}>
                    {model.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name={["providers", "openai", "responses_only_models"]}
              label={t("settings.providerTab.responsesOnlyModelsOptional")}
              extra={renderResponsesOnlyModelsHelp(t)}
            >
              <Select
                mode="tags"
                placeholder='e.g. "gpt-5.3-codex", "gpt-5*"'
                tokenSeparators={[",", " ", "\n", "\t"]}
              />
            </Form.Item>

            <Divider dashed />
            {renderRoleModelFields("openai", OPENAI_MODELS)}
            {renderRequestOverridesEditor("openai")}
          </>
        );

      case "anthropic":
        return (
          <>
            <Alert
              message={t("settings.providerTab.anthropicConfigTitle")}
              description={t("settings.providerTab.anthropicConfigDescription")}
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Form.Item
              name={["providers", "anthropic", "api_key"]}
              label={t("settings.providerTab.anthropicApiKey")}
              rules={[
                {
                  required: true,
                  message: t("settings.providerTab.anthropicApiKeyRequired"),
                },
              ]}
            >
              <Password placeholder="sk-ant-..." prefix={<KeyOutlined />} />
            </Form.Item>
            <Form.Item
              name={["providers", "anthropic", "base_url"]}
              label={t("settings.providerTab.baseUrlOptional")}
              extra={t("settings.providerTab.anthropicBaseUrlHelp")}
            >
              <Input placeholder="https://api.anthropic.com/v1" />
            </Form.Item>
            <Form.Item
              name={["providers", "anthropic", "model"]}
              label={t("settings.providerTab.defaultModel")}
              rules={[
                {
                  required: true,
                  message: t("settings.providerTab.selectModelRequired"),
                },
              ]}
              extra={renderModelFetchExtra("anthropic", "API")}
            >
              <Select
                placeholder={t("settings.providerTab.selectModel")}
                allowClear
                showSearch
                loading={fetchingModels}
                disabled={modelAutoSaveStatus === "saving"}
                notFoundContent={fetchingModels ? <Spin size="small" /> : null}
                onDropdownVisibleChange={(open) => handleModelDropdownOpen("anthropic", open)}
                onChange={(value) => handleModelChange("anthropic", value)}
              >
                {(availableModels.length > 0 ? availableModels : ANTHROPIC_MODELS).map((model) => (
                  <Option key={model.value} value={model.value}>
                    {model.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item
              name={["providers", "anthropic", "max_tokens"]}
              label={t("settings.providerTab.maxTokensOptional")}
              extra={t("settings.providerTab.maxTokensHelp")}
            >
              <Input type="number" placeholder="4096" min={1} max={100000} />
            </Form.Item>

            <Divider dashed />
            {renderRoleModelFields("anthropic", ANTHROPIC_MODELS)}
            {renderRequestOverridesEditor("anthropic")}
          </>
        );

      case "gemini":
        return (
          <>
            <Alert
              message={t("settings.providerTab.geminiConfigTitle")}
              description={t("settings.providerTab.geminiConfigDescription")}
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
            <Form.Item
              name={["providers", "gemini", "api_key"]}
              label={t("settings.providerTab.geminiApiKey")}
              rules={[
                {
                  required: true,
                  message: t("settings.providerTab.geminiApiKeyRequired"),
                },
              ]}
            >
              <Password placeholder="AIza..." prefix={<KeyOutlined />} />
            </Form.Item>
            <Form.Item
              name={["providers", "gemini", "base_url"]}
              label={t("settings.providerTab.baseUrlOptional")}
              extra={t("settings.providerTab.geminiBaseUrlHelp")}
            >
              <Input placeholder="https://generativelanguage.googleapis.com/v1beta" />
            </Form.Item>
            <Form.Item
              name={["providers", "gemini", "model"]}
              label={t("settings.providerTab.defaultModel")}
              rules={[
                {
                  required: true,
                  message: t("settings.providerTab.selectModelRequired"),
                },
              ]}
              extra={renderModelFetchExtra("gemini", "API")}
            >
              <Select
                placeholder={t("settings.providerTab.selectModel")}
                allowClear
                showSearch
                loading={fetchingModels}
                disabled={modelAutoSaveStatus === "saving"}
                notFoundContent={fetchingModels ? <Spin size="small" /> : null}
                onDropdownVisibleChange={(open) => handleModelDropdownOpen("gemini", open)}
                onChange={(value) => handleModelChange("gemini", value)}
              >
                {(availableModels.length > 0 ? availableModels : GEMINI_MODELS).map((model) => (
                  <Option key={model.value} value={model.value}>
                    {model.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Divider dashed />
            {renderRoleModelFields("gemini", GEMINI_MODELS)}
            {renderRequestOverridesEditor("gemini")}
          </>
        );

      case "copilot": {
        const configuredCopilotModel = form.getFieldValue(["providers", "copilot", "model"]) as
          | string
          | undefined;

        // Prefer the real /v1/models list. If it's not loaded yet, keep showing the currently
        // configured model so the Select doesn't appear blank.
        const copilotModelOptions =
          availableModels.length > 0
            ? availableModels
            : configuredCopilotModel
              ? [
                  {
                    value: configuredCopilotModel,
                    label: configuredCopilotModel,
                  },
                ]
              : [];

        return (
          <>
            <Alert
              message={t("settings.providerTab.copilotConfigTitle")}
              description={t("settings.providerTab.copilotConfigDescription")}
              type="info"
              showIcon
            />

            <Card
              size="small"
              style={{ marginTop: 16, marginBottom: 16 }}
              title={t("settings.providerTab.authStatusTitle")}
              extra={
                checkingCopilotAuth ? (
                  <Spin size="small" />
                ) : copilotAuthStatus?.authenticated ? (
                  <Tag icon={<CheckCircleOutlined />} color="success">
                    {t("settings.providerTab.authenticated")}
                  </Tag>
                ) : (
                  <Tag icon={<CloseCircleOutlined />} color="error">
                    {t("settings.providerTab.notAuthenticated")}
                  </Tag>
                )
              }
            >
              {copilotAuthStatus?.message && (
                <Paragraph type="secondary" style={{ marginBottom: 16 }}>
                  {copilotAuthStatus.message}
                </Paragraph>
              )}

              <Space>
                {copilotAuthStatus?.authenticated ? (
                  <Button
                    danger
                    icon={<LogoutOutlined />}
                    onClick={handleCopilotLogout}
                    loading={authenticatingCopilot}
                  >
                    {t("settings.providerTab.logoutCopilot")}
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    icon={<LoginOutlined />}
                    onClick={handleCopilotAuthenticate}
                    loading={authenticatingCopilot}
                  >
                    {t("settings.providerTab.authenticateCopilot")}
                  </Button>
                )}
                <Button onClick={checkCopilotAuthStatus} loading={checkingCopilotAuth}>
                  {t("settings.providerTab.refreshStatus")}
                </Button>
              </Space>
            </Card>

            <Form.Item
              name={["providers", "copilot", "headless_auth"]}
              label={t("settings.providerTab.headlessAuth")}
              valuePropName="checked"
              extra={t("settings.providerTab.headlessAuthHelp")}
            >
              <Switch />
            </Form.Item>

            <Form.Item
              name={["providers", "copilot", "model"]}
              label={t("settings.providerTab.defaultModel")}
              rules={[
                {
                  required: true,
                  message: t("settings.providerTab.selectModelRequired"),
                },
              ]}
              extra={renderModelFetchExtra("copilot", "backend")}
            >
              <Select
                placeholder={t("settings.providerTab.selectModel")}
                allowClear
                showSearch
                loading={fetchingModels}
                disabled={modelAutoSaveStatus === "saving"}
                notFoundContent={
                  fetchingModels ? (
                    <Spin size="small" />
                  ) : (
                    <Text type="secondary">
                      {copilotAuthStatus?.authenticated
                        ? t("settings.providerTab.noModelsLoaded")
                        : t("settings.providerTab.authFirstThenFetch")}
                    </Text>
                  )
                }
                onDropdownVisibleChange={(open) => handleModelDropdownOpen("copilot", open)}
                onChange={(value) => handleModelChange("copilot", value)}
              >
                {copilotModelOptions.map((model) => (
                  <Option key={model.value} value={model.value}>
                    {model.label}
                  </Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item
              name={["providers", "copilot", "responses_only_models"]}
              label={t("settings.providerTab.responsesOnlyModelsOptional")}
              extra={renderResponsesOnlyModelsHelp(t)}
            >
              <Select
                mode="tags"
                placeholder='e.g. "gpt-5.3-codex", "gpt-5*"'
                tokenSeparators={[",", " ", "\n", "\t"]}
              />
            </Form.Item>

            <Divider dashed />
            {renderRoleModelFields("copilot", COPILOT_MODELS)}
            {renderRequestOverridesEditor("copilot")}

            <Paragraph type="secondary">
              {t("settings.providerTab.copilotUsageTitle")}
              <ul style={{ marginTop: 8, marginBottom: 0 }}>
                <li>{t("settings.providerTab.copilotUsageStep1")}</li>
                <li>{t("settings.providerTab.copilotUsageStep2")}</li>
                <li>{t("settings.providerTab.copilotUsageStep3")}</li>
              </ul>
            </Paragraph>
          </>
        );
      }

      default:
        return null;
    }
  };

  return (
    <Card
      title={t("settings.providerTab.title")}
      loading={loading && !configLoaded}
      className="lotus-settings-card"
      extra={
        <Text type="secondary">
          {t("settings.providerTab.currentProvider")}:{" "}
          <Text strong>{PROVIDER_LABELS[currentProvider]}</Text>
        </Text>
      }
    >
      <Paragraph type="secondary">{t("settings.providerTab.description")}</Paragraph>

      <Divider />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSaveAndApply}
        disabled={loading && !configLoaded}
      >
        <Form.Item
          name="provider"
          label={t("settings.providerTab.activeProvider")}
          rules={[
            {
              required: true,
              message: t("settings.providerTab.selectProviderRequired"),
            },
          ]}
        >
          <Select data-testid="provider-select" onChange={handleProviderChange} size="large">
            {(Object.keys(PROVIDER_LABELS) as ProviderType[]).map((key) => (
              <Option key={key} value={key}>
                {PROVIDER_LABELS[key]}
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Divider />

        {renderProviderFields()}

        <Divider />

        <Space size="middle">
          <Button
            data-testid="save-api-settings"
            type="primary"
            htmlType="submit"
            icon={<SaveOutlined />}
            loading={loading || applyingConfig}
            size="large"
          >
            {t("settings.providerTab.saveAndApply")}
          </Button>
        </Space>
      </Form>

      {/* Device Code Modal for Copilot Authentication */}
      <DeviceCodeModal
        open={isDeviceCodeModalVisible}
        onCancel={() => setIsDeviceCodeModalVisible(false)}
        onComplete={handleCompleteAuth}
        onCopyCode={handleCopyUserCode}
        completingAuth={completingAuth}
        copiedUserCode={copiedUserCode}
        deviceCodeInfo={deviceCodeInfo}
        timeRemaining={timeRemaining}
        token={token}
      />
    </Card>
  );
};

export default ProviderSettings;
