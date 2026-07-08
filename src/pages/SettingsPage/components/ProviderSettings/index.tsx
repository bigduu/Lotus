import { debugLog } from "@shared/utils/debugFlags";
import React, { useCallback, useEffect, useState } from "react";
import {
  App as AntApp,
  Form,
  Select,
  Input,
  Button,
  Card,
  Collapse,
  Space,
  Divider,
  Typography,
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
  ReloadOutlined,
} from "@ant-design/icons";
import { DeviceCodeModal } from "./DeviceCodeModal";
import { isApiError } from "@services/api/client";
import {
  settingsService,
  type CopilotAuthStatus,
  type DeviceCodeInfo,
  type EnvVarResponse,
} from "@services/config/SettingsService";
import type {
  ProviderConfig,
  ProviderType,
  DefaultsConfig,
  ProviderInstance,
  ProviderInstancesConfig,
} from "@shared/types/providerConfig";
import { PROVIDER_LABELS } from "@shared/types/providerConfig";
import type { ProviderModelRef } from "@shared/types/providerModelRef";
import {
  ServiceFactory,
  type BambooConfig,
  type BambooConfigValidationIssue,
} from "@services/common/ServiceFactory";
import { copyText } from "@shared/utils/clipboard";
import { isMaskedSecretValue } from "./providerInstanceUtils";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ProviderModelPicker } from "../../../ChatPage/components/ProviderModelPicker";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import type { ReasoningEffort } from "@services/chat/AgentService";
import { ProviderInstanceManager } from "./ProviderInstanceManager";

const { Password } = Input;
const { Text, Paragraph } = Typography;

type ModelProvider = "openai" | "anthropic" | "gemini" | "copilot" | "bodhi";

type EditableProviderConfig<K extends ModelProvider = ModelProvider> = Partial<
  NonNullable<ProviderConfig["providers"][K]>
> & {
  request_overrides_json?: string;
  // Legacy compatibility: backend may still read providers.{provider}.model.
  model?: string;
};

type AnyEditableProviderConfig =
  | EditableProviderConfig<"openai">
  | EditableProviderConfig<"anthropic">
  | EditableProviderConfig<"gemini">
  | EditableProviderConfig<"copilot">
  | EditableProviderConfig<"bodhi">;

type EditableProviders = Partial<Record<string, AnyEditableProviderConfig>>;

type EditableProvidersRecord = EditableProviders;

type EditableDefaults = Partial<DefaultsConfig> & {
  chat?: ProviderModelRef;
  fast?: ProviderModelRef;
  task_summary?: ProviderModelRef;
  memory_background?: ProviderModelRef;
  sub_agent?: ProviderModelRef;
  vision?: ProviderModelRef;
};

type ModelPreferenceField = keyof Pick<
  EditableDefaults,
  "chat" | "fast" | "task_summary" | "memory_background" | "sub_agent" | "vision"
>;

type ProviderSettingsFormValues = Omit<ProviderConfig, "provider" | "providers"> & {
  provider?: string;
  providers: EditableProviders;
  defaults?: EditableDefaults;
};

const MODEL_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "copilot",
  "bodhi",
] as const satisfies readonly ModelProvider[];

const ProviderModelRefField: React.FC<{
  value?: ProviderModelRef;
  onChange?: (value?: ProviderModelRef) => void;
}> = () => null;

const isCompleteProviderModelRef = (value: unknown): value is ProviderModelRef => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProviderModelRef>;
  return Boolean(candidate.provider?.trim() && candidate.model?.trim());
};

const setLegacyProviderModel = (
  providers: EditableProviders,
  provider: ModelProvider,
  model: string,
): void => {
  const mutableProviders = providers as EditableProvidersRecord;
  mutableProviders[provider] = {
    ...(mutableProviders[provider] ?? {}),
    model,
  } as AnyEditableProviderConfig;
};

const getLegacyMemoryBackgroundModel = (config: BambooConfig): string | undefined => {
  const legacyValue = config.memory?.background_model?.trim();
  return legacyValue ? legacyValue : undefined;
};

const getMemoryBackgroundFallbackProvider = (
  defaults: EditableDefaults | undefined,
  fallbackProvider?: string | null,
): string | undefined => {
  return (
    fallbackProvider ||
    defaults?.chat?.provider ||
    defaults?.fast?.provider ||
    defaults?.memory_background?.provider ||
    undefined
  );
};

const renderResponsesOnlyModelsHelp = (t: (key: string) => string) => (
  <Space direction="vertical" size={4}>
    <Text type="secondary">
      {t("settings.providerTab.responsesOnlyHelp1")} <Text code>/responses</Text>.
    </Text>
    <Text type="secondary">{t("settings.providerTab.responsesOnlyHelp2")}</Text>
  </Space>
);

const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];

type ReasoningEffortSelectProps = {
  value?: ReasoningEffort;
  onChange?: (value?: ReasoningEffort) => void;
  disabled?: boolean;
  size?: "small" | "middle" | "large";
  style?: React.CSSProperties;
  "data-testid"?: string;
};

const renderReasoningEffortSelect = (t: TFunction, props?: ReasoningEffortSelectProps) => (
  <Select
    placeholder={t("settings.providerTab.reasoningEffortDefault")}
    allowClear
    value={props?.value}
    onChange={
      props?.onChange
        ? (value) => props.onChange?.((value as ReasoningEffort | undefined) ?? undefined)
        : undefined
    }
    disabled={props?.disabled}
    size={props?.size}
    style={props?.style}
    data-testid={props?.["data-testid"]}
  >
    {REASONING_EFFORT_OPTIONS.map((option) => (
      <Select.Option key={option} value={option}>
        {t(`chat.input.reasoning.${option}`)}
      </Select.Option>
    ))}
  </Select>
);

export const ProviderSettings: React.FC = () => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [applyingConfig, setApplyingConfig] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<ProviderType>("copilot");
  const [configLoaded, setConfigLoaded] = useState(false);
  // Legacy-mode providers whose api_key is already configured (GET returned the
  // redaction placeholder). Their key field stays empty; empty = keep stored key.
  const [providersWithStoredKey, setProvidersWithStoredKey] = useState<Set<string>>(new Set());
  const [copilotAuthStatus, setCopilotAuthStatus] = useState<CopilotAuthStatus | null>(null);
  const [checkingCopilotAuth, setCheckingCopilotAuth] = useState(false);
  const [authenticatingCopilot, setAuthenticatingCopilot] = useState(false);
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<DeviceCodeInfo | null>(null);
  const [isDeviceCodeModalVisible, setIsDeviceCodeModalVisible] = useState(false);
  const [completingAuth, setCompletingAuth] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [copiedUserCode, setCopiedUserCode] = useState(false);
  const [envVarEntries, setEnvVarEntries] = useState<EnvVarResponse[]>([]);
  const [fetchingAllModels, setFetchingAllModels] = useState(false);

  // ── Multi-instance state ──────────────────────────────────────
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const [defaultInstanceId, setDefaultInstanceId] = useState<string | null>(null);
  const [isInstanceMode, setIsInstanceMode] = useState(false);
  const [expandedProviderPanels, setExpandedProviderPanels] = useState<string[]>([]);

  const [modelAutoSaveStatus, setModelAutoSaveStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [modelAutoSaveError, setModelAutoSaveError] = useState<string | null>(null);

  const buildInstanceModeFormState = useCallback(
    (response: ProviderInstancesConfig, bambooConfig?: BambooConfig) => {
      const instances = response.instances ?? [];
      const providersWithEditorFields = instances.reduce<EditableProviders>((acc, instance) => {
        const editableConfig = {
          ...(instance.config as Record<string, unknown>),
        } as AnyEditableProviderConfig;
        if (
          editableConfig.request_overrides &&
          typeof editableConfig.request_overrides === "object"
        ) {
          editableConfig.request_overrides_json = JSON.stringify(
            editableConfig.request_overrides,
            null,
            2,
          );
        }
        acc[instance.id] = editableConfig;
        return acc;
      }, {});

      let defaults = response.defaults ? ({ ...response.defaults } as EditableDefaults) : undefined;
      const defaultInstanceId = response.default_provider_instance_id ?? null;
      const defaultInstance = defaultInstanceId
        ? instances.find((instance) => instance.id === defaultInstanceId)
        : undefined;
      const defaultModel =
        typeof defaultInstance?.config.model === "string"
          ? defaultInstance.config.model.trim()
          : undefined;

      if (!isCompleteProviderModelRef(defaults?.chat) && defaultInstanceId && defaultModel) {
        defaults = {
          ...(defaults || {}),
          chat: { provider: defaultInstanceId, model: defaultModel },
        };
      }

      const legacyMemoryBackgroundModel = bambooConfig
        ? getLegacyMemoryBackgroundModel(bambooConfig)
        : undefined;
      const memoryBackgroundProvider = getMemoryBackgroundFallbackProvider(
        defaults,
        defaultInstanceId,
      );
      if (legacyMemoryBackgroundModel && !defaults?.memory_background && memoryBackgroundProvider) {
        defaults = {
          ...(defaults || {}),
          memory_background: {
            provider: memoryBackgroundProvider,
            model: legacyMemoryBackgroundModel,
          },
        };
      }

      return {
        defaults,
        features: response.features,
        providers: providersWithEditorFields,
      };
    },
    [],
  );

  const syncInstanceModeState = useCallback(
    (response: ProviderInstancesConfig, bambooConfig?: BambooConfig) => {
      setInstances(response.instances ?? []);
      setDefaultInstanceId(response.default_provider_instance_id ?? null);
      setIsInstanceMode(true);
      form.setFieldsValue(buildInstanceModeFormState(response, bambooConfig));
      setConfigLoaded(true);
    },
    [buildInstanceModeFormState, form],
  );

  const getProviderDisplayLabel = useCallback(
    (providerOrInstanceId?: string) => {
      if (!providerOrInstanceId?.trim()) return undefined;
      const instance = instances.find((item) => item.id === providerOrInstanceId);
      if (instance) {
        return instance.label || PROVIDER_LABELS[instance.type];
      }
      return PROVIDER_LABELS[providerOrInstanceId as ProviderType] || providerOrInstanceId;
    },
    [instances],
  );

  const getExpandedLegacyPanels = useCallback(
    (provider: string | undefined, providers: EditableProviders | undefined) => {
      const panels = new Set<string>();
      if (provider?.trim()) {
        panels.add(provider);
      }
      for (const key of MODEL_PROVIDERS) {
        const config = providers?.[key];
        if (!config) continue;
        if (Object.keys(config).length > 0) {
          panels.add(key);
        }
      }
      return Array.from(panels);
    },
    [],
  );

  useEffect(() => {
    if (modelAutoSaveStatus !== "success") return;
    const timer = setTimeout(() => {
      setModelAutoSaveStatus("idle");
      setModelAutoSaveError(null);
    }, 2000);
    return () => clearTimeout(timer);
  }, [modelAutoSaveStatus]);

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
      const [response, bambooConfig] = await Promise.all([
        settingsService.getProviderConfig(),
        ServiceFactory.getInstance()
          .getBambooConfig()
          .catch(() => ({}) as BambooConfig),
      ]);

      // Build defaults from providers.{provider}.model if defaults is missing
      // (backward compatibility with backend that stores model in providers).
      let defaults = response.defaults ? ({ ...response.defaults } as EditableDefaults) : undefined;
      if (!defaults?.chat?.model && response.provider && response.providers) {
        const providerName = response.provider as ModelProvider;
        const providerCfg = response.providers[providerName];
        const legacyModel = (providerCfg as { model?: string } | undefined)?.model;
        if (legacyModel) {
          defaults = {
            ...(defaults || {}),
            chat: {
              provider: providerName,
              model: legacyModel,
            },
          };
        }
      }

      const legacyMemoryBackgroundModel = getLegacyMemoryBackgroundModel(bambooConfig);
      const memoryBackgroundProvider = getMemoryBackgroundFallbackProvider(
        defaults,
        response.provider || null,
      );
      if (legacyMemoryBackgroundModel && !defaults?.memory_background && memoryBackgroundProvider) {
        defaults = {
          ...(defaults || {}),
          memory_background: {
            provider: memoryBackgroundProvider,
            model: legacyMemoryBackgroundModel,
          },
        };
      }

      const persistedDefaults = isCompleteProviderModelRef(defaults?.chat)
        ? (defaults as DefaultsConfig)
        : undefined;

      const config: ProviderConfig = {
        provider: response.provider,
        defaults: persistedDefaults,
        providers: response.providers || {},
        features: response.features,
      };

      debugLog("[Provider]", "Loaded provider config:", config);
      const providersWithEditorFields: EditableProviders = {
        ...(config.providers || {}),
      };
      const storedKeyProviders = new Set<string>();
      MODEL_PROVIDERS.forEach((provider) => {
        const providerCfg = providersWithEditorFields[provider];
        if (!providerCfg) return;
        // Never prefill the redaction placeholder into the editable field — an
        // incomplete paste over it (`****...****sk-new…`) used to silently keep
        // the old key (bamboo #430). Empty field = keep stored key.
        if (isMaskedSecretValue((providerCfg as Record<string, unknown>).api_key)) {
          storedKeyProviders.add(provider);
          delete (providerCfg as Record<string, unknown>).api_key;
        }
        if (providerCfg.request_overrides && typeof providerCfg.request_overrides === "object") {
          providerCfg.request_overrides_json = JSON.stringify(
            providerCfg.request_overrides,
            null,
            2,
          );
        }
      });
      setProvidersWithStoredKey(storedKeyProviders);

      setCurrentProvider(config.provider as ProviderType);
      setIsInstanceMode(false);
      setExpandedProviderPanels(
        getExpandedLegacyPanels(config.provider, providersWithEditorFields),
      );
      form.setFieldsValue({
        ...config,
        providers: providersWithEditorFields,
        defaults: config.defaults,
      });
      setConfigLoaded(true);
    } catch (error) {
      message.error(t("settings.providerTab.loadConfigFailed"));
      console.error("Failed to load provider config:", error);
    } finally {
      setLoading(false);
    }
  }, [form, getExpandedLegacyPanels, message, t]);

  const loadEnvVars = useCallback(async () => {
    try {
      const response = await settingsService.getEnvVars();
      setEnvVarEntries(response.entries || []);
    } catch (error) {
      console.warn("Failed to load env vars for provider overrides:", error);
    }
  }, []);

  const handleInstancesChanged = useCallback(async () => {
    try {
      const [response, bambooConfig] = await Promise.all([
        settingsService.getProviderInstances(),
        ServiceFactory.getInstance()
          .getBambooConfig()
          .catch(() => ({}) as BambooConfig),
      ]);
      if (!Array.isArray(response.instances)) {
        throw new Error("Provider instances API returned an invalid payload");
      }
      syncInstanceModeState(response, bambooConfig);
    } catch {
      // Will be reflected in empty state
    }
  }, [syncInstanceModeState]);

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
    void loadEnvVars();
    void useProviderStore.getState().loadCatalog();
    void checkCopilotAuthStatus();
    void (async () => {
      try {
        const [response, bambooConfig] = await Promise.all([
          settingsService.getProviderInstances(),
          ServiceFactory.getInstance()
            .getBambooConfig()
            .catch(() => ({}) as BambooConfig),
        ]);
        if (!Array.isArray(response.instances)) {
          throw new Error("Provider instances API returned an invalid payload");
        }
        syncInstanceModeState(response, bambooConfig);
      } catch {
        await loadConfig();
      }
    })();
  }, [loadConfig, loadEnvVars, checkCopilotAuthStatus, syncInstanceModeState]);

  // ── Copilot auth handlers ─────────────────────────────

  const handleCopilotAuthenticate = async () => {
    try {
      setAuthenticatingCopilot(true);
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
      await settingsService.completeCopilotAuth({
        device_code: deviceCodeInfo.device_code,
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

  // ── Fetch all models ─────────────────────────────────

  const handleFetchAllModels = useCallback(async () => {
    setFetchingAllModels(true);
    try {
      const result = await settingsService.fetchCatalogModels();
      await useProviderStore.getState().loadCatalog();
      const successCount = result.fetched.filter((r) => r.models && r.models.length > 0).length;
      const failCount = result.fetched.filter((r) => r.error).length;
      if (failCount > 0) {
        message.warning(
          t("settings.providerTab.fetchModelsPartialSuccess", {
            success: successCount,
            total: result.fetched.length,
          }),
        );
      } else {
        message.success(t("settings.providerTab.fetchModelsSuccess", { count: successCount }));
      }
    } catch {
      message.error(t("settings.providerTab.fetchModelsFailed"));
    } finally {
      setFetchingAllModels(false);
    }
  }, [message, t]);

  // ── Save / Apply helpers ─────────────────────────────

  const getErrorMessage = (error: unknown): string => {
    if (isApiError(error)) return error.message;
    if (error instanceof Error) return error.message;
    return t("settings.providerTab.unknownError");
  };

  const clearProviderValidationErrors = (provider: ProviderType) => {
    form.setFields([
      { name: ["provider"], errors: [] },
      { name: ["providers", provider, "api_key"], errors: [] },
      { name: ["defaults", "chat"], errors: [] },
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
        const direct = pathToName(issue.path);
        if (direct) return { name: direct, errors: [issue.message] };
        if (issue.message.toLowerCase().includes("api key")) {
          return { name: ["providers", provider, "api_key"], errors: [issue.message] };
        }
        return { name: ["provider"], errors: [issue.message] };
      })
      .filter(
        (field, index, arr) =>
          arr.findIndex((f) => JSON.stringify(f.name) === JSON.stringify(field.name)) === index,
      );
    if (fields.length) form.setFields(fields);
  };

  const validateProviderPatch = async (values: ProviderSettingsFormValues) => {
    const provider = (values.provider || currentProvider) as ProviderType;
    clearProviderValidationErrors(provider);
    try {
      const serviceFactory = ServiceFactory.getInstance();
      const result = await serviceFactory.validateBambooConfigPatch({
        provider: values.provider,
        providers: values.providers || {},
        defaults: values.defaults,
        features: {
          ...(values.features || {}),
          provider_model_ref: true,
        },
      });
      if (result.valid) return { valid: true };
      const providerIssues = result.errors?.provider || [];
      applyValidationIssuesToForm(providerIssues, provider);
      const first = providerIssues[0];
      return {
        valid: false,
        message: first?.message || t("settings.providerTab.invalidConfig"),
      };
    } catch (error) {
      console.warn("Config validation failed, falling back to save:", error);
      return { valid: true };
    }
  };

  const handleSave = async (
    values: ProviderSettingsFormValues,
    options?: { showMessage?: boolean; throwOnError?: boolean },
  ) => {
    try {
      setLoading(true);
      const normalizedValues: ProviderSettingsFormValues = {
        provider: values.provider,
        defaults: values.defaults,
        providers: { ...(values.providers || {}) },
        features: {
          ...(values.features || {}),
          provider_model_ref: true,
        },
      };
      const defaultChat = normalizedValues.defaults?.chat;
      if (!isCompleteProviderModelRef(defaultChat)) {
        const messageText = t("settings.providerTab.selectModelRequired");
        form.setFields([{ name: ["defaults", "chat"], errors: [messageText] }]);
        if (options?.showMessage !== false) message.error(messageText);
        if (options?.throwOnError) throw new Error(messageText);
        return;
      }

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
            const messageText = t("settings.providerTab.invalidRequestOverridesJson", {
              provider: p,
              error: (error as Error).message,
            });
            form.setFields([
              { name: ["providers", p, "request_overrides_json"], errors: [messageText] },
            ]);
            if (options?.showMessage !== false) message.error(messageText);
            if (options?.throwOnError) throw error;
            return;
          }
        }
        delete providerCfg.request_overrides_json;
      }

      // Never send an empty or placeholder api_key. Omission = keep the stored
      // key (the backend deep-merges the patch); an empty string would be an
      // explicit clear, and a placeholder would round-trip the redaction mask.
      for (const p of MODEL_PROVIDERS) {
        const providerCfg = editableProviders[p] as Record<string, unknown> | undefined;
        if (!providerCfg || !("api_key" in providerCfg)) continue;
        const apiKey = providerCfg.api_key;
        if (typeof apiKey !== "string" || !apiKey.trim() || isMaskedSecretValue(apiKey)) {
          delete providerCfg.api_key;
        }
      }

      // Sync defaults.chat to providers.{provider}.model for backward compatibility
      // with the backend which reads model from providers.{provider}.model.
      const providersWithModel: EditableProviders = { ...(normalizedValues.providers || {}) };
      const activeProvider = normalizedValues.provider as ModelProvider;
      const defaultChatModel = normalizedValues.defaults?.chat;
      if (defaultChatModel?.model && activeProvider) {
        setLegacyProviderModel(providersWithModel, activeProvider, defaultChatModel.model);
      }

      if (isInstanceMode) {
        const serviceFactory = ServiceFactory.getInstance();
        const instancePayload: BambooConfig = {
          defaults: normalizedValues.defaults,
          features: {
            ...(normalizedValues.features || {}),
            provider_model_ref: true,
          },
        };
        debugLog("[Provider]", "Saving instance-mode config:", instancePayload);
        await serviceFactory.setBambooConfig(instancePayload);
      } else {
        // ── Legacy save path ───────────────────────────────────────
        const provider = (normalizedValues.provider || currentProvider) as ProviderType;
        const payload: Record<string, unknown> = {
          provider,
          defaults: normalizedValues.defaults,
          providers: providersWithModel,
          features: normalizedValues.features,
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
      }

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
      const { useProviderStore } = await import("@shared/store/appStore/slices/providerSlice");
      const { useAppStore } = await import("@shared/store/appStore");

      const previousDefaultsChat = useProviderStore.getState().providerConfig.defaults?.chat;

      // In instance mode, reload instances; otherwise use the legacy endpoint.
      if (isInstanceMode) {
        await useProviderStore.getState().loadProviderInstances();
      } else {
        await useProviderStore.getState().loadProviderConfig();
      }

      const nextDefaultsChat = useProviderStore.getState().providerConfig.defaults?.chat;

      useProviderStore.getState().setSelectedModelRef(null);

      const currentSessionId = useAppStore.getState().currentSessionId;
      const currentChat = currentSessionId
        ? useAppStore.getState().chats.find((chat) => chat.id === currentSessionId) || null
        : null;

      const previousDefaultKey = previousDefaultsChat
        ? `${previousDefaultsChat.provider}/${previousDefaultsChat.model}`
        : null;
      const nextDefaultKey = nextDefaultsChat
        ? `${nextDefaultsChat.provider}/${nextDefaultsChat.model}`
        : null;
      const currentSessionModelRefKey = currentChat?.config?.model_ref
        ? `${currentChat.config.model_ref.provider}/${currentChat.config.model_ref.model}`
        : null;
      const currentSessionModel = currentChat?.config?.model?.trim() || null;

      const shouldSyncCurrentSessionToDefaults = Boolean(
        currentSessionId &&
          currentChat?.config &&
          nextDefaultsChat &&
          nextDefaultKey !== previousDefaultKey &&
          (!currentSessionModelRefKey || currentSessionModelRefKey === previousDefaultKey) &&
          (!currentSessionModel || currentSessionModel === previousDefaultsChat?.model),
      );

      if (
        shouldSyncCurrentSessionToDefaults &&
        currentSessionId &&
        currentChat?.config &&
        nextDefaultsChat
      ) {
        useAppStore.getState().updateSession(currentSessionId, {
          config: {
            ...currentChat.config,
            model: nextDefaultsChat.model,
            model_ref: nextDefaultsChat,
          },
        });
      }

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

  const handleSaveAndApply = async (_values: ProviderSettingsFormValues) => {
    try {
      const currentValues = form.getFieldsValue(true) as ProviderSettingsFormValues;
      await handleSave(currentValues, { throwOnError: true });
      await handleApply({ throwOnError: true });
    } catch {
      // Errors already shown
    }
  };

  // ── Auto-save model preference changes ──────────────────────────

  const handleDefaultsModelChange = async (
    field: ModelPreferenceField,
    value: ProviderModelRef | undefined,
  ) => {
    if (field === "chat" && !value) return;
    if (modelAutoSaveStatus === "saving") return;
    setModelAutoSaveStatus("saving");
    setModelAutoSaveError(null);
    try {
      const currentValues = form.getFieldsValue(true) as ProviderSettingsFormValues;
      const currentDefaults = currentValues.defaults;
      if (!currentDefaults?.chat) {
        throw new Error(t("settings.providerTab.selectModelRequired"));
      }
      currentValues.defaults = {
        ...currentDefaults,
        [field]: value,
      };
      await handleSave(currentValues, { showMessage: false, throwOnError: true });
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

  const handleProviderReasoningEffortChange = async (
    providerIdOrType: string,
    value?: ReasoningEffort,
  ) => {
    if (modelAutoSaveStatus === "saving") return;
    setModelAutoSaveStatus("saving");
    setModelAutoSaveError(null);
    try {
      if (isInstanceMode) {
        const instance = instances.find((item) => item.id === providerIdOrType);
        if (!instance) {
          throw new Error(t("settings.providerTab.providerNotConfigured"));
        }
        await settingsService.updateProviderInstance(instance.id, {
          config: { reasoning_effort: value ?? null },
        });
        await handleInstancesChanged();
        await useProviderStore.getState().loadProviderInstances();
      } else {
        const currentValues = form.getFieldsValue(true) as ProviderSettingsFormValues;
        await handleSave(currentValues, { showMessage: false, throwOnError: true });
        await handleApply({ showMessage: false, throwOnError: true });
      }
      setModelAutoSaveStatus("success");
      message.success(t("settings.providerTab.reasoningEffortUpdated"));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setModelAutoSaveStatus("error");
      setModelAutoSaveError(errorMessage);
      message.error(
        errorMessage
          ? `${t("settings.providerTab.updateReasoningEffortErrorPrefix")}: ${errorMessage}`
          : t("settings.providerTab.updateReasoningEffortFailed"),
      );
    }
  };

  const renderInlineProviderReasoningControl = (
    provider: string | undefined,
    options?: {
      label?: string;
      helperText?: string;
      autoSave?: boolean;
      size?: "small" | "middle" | "large";
      marginTop?: number;
      dataTestId?: string;
      emphasis?: "default" | "subtle";
      showProviderLabel?: boolean;
    },
  ) => {
    if (!provider) return null;

    const providerLabel = getProviderDisplayLabel(provider) || provider;
    const reasoningValue = form.getFieldValue(["providers", provider, "reasoning_effort"]) as
      | ReasoningEffort
      | undefined;
    const isSubtle = options?.emphasis === "subtle";
    const labelText = options?.label || t("settings.providerTab.reasoningEffortOptional");
    const helperText = options?.helperText || t("settings.providerTab.reasoningEffortHelp");

    return (
      <div style={{ marginTop: options?.marginTop ?? 8, width: "100%" }}>
        <Space direction="vertical" size={isSubtle ? 6 : 4} style={{ width: "100%" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Text
              strong={!isSubtle}
              type={isSubtle ? "secondary" : undefined}
              style={isSubtle ? { fontSize: token.fontSizeSM, lineHeight: 1.4 } : undefined}
            >
              {labelText}
            </Text>
            {options?.showProviderLabel ? (
              <Text type="secondary" style={{ fontSize: token.fontSizeSM, lineHeight: 1.4 }}>
                {providerLabel}
              </Text>
            ) : null}
          </div>
          {renderReasoningEffortSelect(t, {
            value: reasoningValue,
            disabled: modelAutoSaveStatus === "saving",
            size: options?.size ?? (isSubtle ? "small" : undefined),
            style: { width: "100%" },
            "data-testid": options?.dataTestId,
            onChange: (value) => {
              form.setFieldValue(["providers", provider, "reasoning_effort"], value);
              if (options?.autoSave) {
                void handleProviderReasoningEffortChange(provider, value);
              }
            },
          })}
          <Text
            type="secondary"
            style={isSubtle ? { fontSize: token.fontSizeSM, lineHeight: 1.5 } : undefined}
          >
            {helperText}
          </Text>
        </Space>
      </div>
    );
  };

  // ── Provider panel status ────────────────────────────

  const isProviderConfigured = useCallback(
    (provider: ModelProvider): boolean => {
      const cfg = form.getFieldValue(["providers", provider]);
      if (!cfg) return false;
      if (provider === "copilot") return copilotAuthStatus?.authenticated ?? false;
      return Boolean(cfg.api_key);
    },
    [form, copilotAuthStatus],
  );

  // ── Unified model preferences ───────────────────────

  const renderModelPreferences = () => {
    const renderPicker = (field: ModelPreferenceField) => {
      const value = form.getFieldValue(["defaults", field]) as ProviderModelRef | undefined;
      return (
        <ProviderModelPicker
          value={value}
          dataTestId={`model-preference-${field}-picker`}
          appearance="contrast"
          disabled={modelAutoSaveStatus === "saving"}
          onChange={(ref) => {
            form.setFieldValue(["defaults", field], ref);
            void handleDefaultsModelChange(field, ref);
          }}
        />
      );
    };

    const renderPreferenceSection = (
      field: ModelPreferenceField,
      title: string,
      helpText?: string,
    ) => (
      <div
        style={{
          width: "100%",
          display: "flex",
          alignItems: "flex-start",
          gap: token.marginLG,
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 420px", minWidth: 0 }}>
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text strong>{title}</Text>
            {renderPicker(field)}
            {helpText ? <Text type="secondary">{helpText}</Text> : null}
          </Space>
        </div>
        <div style={{ flex: "0 1 320px", minWidth: 280 }}>
          <Form.Item noStyle shouldUpdate>
            {() => {
              const selectedModelRef = form.getFieldValue(["defaults", field]) as
                | ProviderModelRef
                | undefined;
              const selectedProvider = selectedModelRef?.provider;
              return renderInlineProviderReasoningControl(selectedProvider, {
                autoSave: true,
                dataTestId: `model-preference-${field}-reasoning-effort`,
                label: t("settings.providerTab.reasoningEffortOptional"),
                helperText: t("settings.providerTab.reasoningEffortHelp"),
                marginTop: 0,
                size: "small",
                emphasis: "subtle",
                showProviderLabel: Boolean(selectedProvider),
              });
            }}
          </Form.Item>
        </div>
      </div>
    );

    return (
      <Card
        size="small"
        title={t("settings.providerTab.modelPreferences")}
        style={{ marginBottom: 16 }}
      >
        <Form.Item name={["defaults", "chat"]} noStyle preserve>
          <ProviderModelRefField />
        </Form.Item>
        <Form.Item name={["defaults", "fast"]} noStyle preserve>
          <ProviderModelRefField />
        </Form.Item>
        <Form.Item name={["defaults", "task_summary"]} noStyle preserve>
          <ProviderModelRefField />
        </Form.Item>
        <Form.Item name={["defaults", "memory_background"]} noStyle preserve>
          <ProviderModelRefField />
        </Form.Item>
        <Form.Item name={["defaults", "sub_agent"]} noStyle preserve>
          <ProviderModelRefField />
        </Form.Item>
        <Form.Item name={["defaults", "vision"]} noStyle preserve>
          <ProviderModelRefField />
        </Form.Item>
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          {renderPreferenceSection("chat", t("settings.providerTab.defaultModel"))}
          {renderPreferenceSection(
            "fast",
            t("settings.providerTab.fastModel"),
            t("settings.providerTab.fastModelHelp"),
          )}
          {renderPreferenceSection(
            "task_summary",
            t("settings.providerTab.taskSummaryModel"),
            t("settings.providerTab.taskSummaryModelHelp"),
          )}
          {renderPreferenceSection(
            "memory_background",
            t("settings.providerTab.memoryBackgroundModel"),
            t("settings.providerTab.memoryBackgroundModelHelp"),
          )}
          {renderPreferenceSection(
            "sub_agent",
            t("settings.providerTab.subAgentModel"),
            t("settings.providerTab.subAgentModelHelp"),
          )}
          {renderPreferenceSection(
            "vision",
            t("settings.providerTab.visionModel"),
            t("settings.providerTab.visionModelHelp"),
          )}
        </Space>
      </Card>
    );
  };

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
        label={t("settings.providerTab.advancedRequestOverrides")}
        extra={
          <Space direction="vertical" size={4}>
            <Text type="secondary">{t("settings.providerTab.advancedRequestOverridesHelp")}</Text>
            <Text type="secondary">
              {t("settings.providerTab.envVarInjection")}{" "}
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
          style={{ fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
        />
      </Form.Item>
    );
  };

  const renderProviderPanel = (provider: ModelProvider) => {
    const hasStoredKey = providersWithStoredKey.has(provider);
    const apiKeyRules = (requiredMessage: string) =>
      hasStoredKey ? [] : [{ required: true, message: requiredMessage }];
    const apiKeyPlaceholder = (defaultPlaceholder: string) =>
      hasStoredKey
        ? t("settings.providerTab.apiKeyKeepPlaceholder", "Configured — leave empty to keep")
        : defaultPlaceholder;

    switch (provider) {
      case "openai":
        return (
          <>
            <Form.Item
              name={["providers", "openai", "api_key"]}
              label={t("settings.providerTab.openaiApiKey")}
              rules={apiKeyRules(t("settings.providerTab.openaiApiKeyRequired"))}
            >
              <Input.Password
                data-testid="api-key-input"
                placeholder={apiKeyPlaceholder(
                  t("settings.providerTab.openaiApiKeyPlaceholder", "sk-..."),
                )}
                prefix={<KeyOutlined />}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "openai", "base_url"]}
              label={t("settings.providerTab.baseUrlOptional")}
              extra={t("settings.providerTab.openaiBaseUrlHelp")}
            >
              <Input
                placeholder={t(
                  "settings.providerTab.openaiBaseUrlPlaceholder",
                  "https://api.openai.com/v1",
                )}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "openai", "reasoning_effort"]}
              label={t("settings.providerTab.reasoningEffortOptional")}
              extra={t("settings.providerTab.reasoningEffortHelp")}
            >
              {renderReasoningEffortSelect(t)}
            </Form.Item>
            <Form.Item
              name={["providers", "openai", "responses_only_models"]}
              label={t("settings.providerTab.responsesOnlyModelsOptional")}
              extra={renderResponsesOnlyModelsHelp(t)}
            >
              <Select
                mode="tags"
                placeholder={t(
                  "settings.providerTab.responsesOnlyModelsPlaceholder",
                  'e.g. "gpt-5.3-codex", "gpt-5*"',
                )}
                tokenSeparators={[",", " ", "\n", "\t"]}
              />
            </Form.Item>
            <Divider dashed />
            {renderRequestOverridesEditor("openai")}
          </>
        );

      case "anthropic":
        return (
          <>
            <Form.Item
              name={["providers", "anthropic", "api_key"]}
              label={t("settings.providerTab.anthropicApiKey")}
              rules={apiKeyRules(t("settings.providerTab.anthropicApiKeyRequired"))}
            >
              <Password
                placeholder={apiKeyPlaceholder(
                  t("settings.providerTab.anthropicApiKeyPlaceholder", "sk-ant-..."),
                )}
                prefix={<KeyOutlined />}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "anthropic", "base_url"]}
              label={t("settings.providerTab.baseUrlOptional")}
              extra={t("settings.providerTab.anthropicBaseUrlHelp")}
            >
              <Input
                placeholder={t(
                  "settings.providerTab.anthropicBaseUrlPlaceholder",
                  "https://api.anthropic.com/v1",
                )}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "anthropic", "max_tokens"]}
              label={t("settings.providerTab.maxTokensOptional")}
              extra={t("settings.providerTab.maxTokensHelp")}
            >
              <Input
                type="number"
                placeholder={t("settings.providerTab.maxTokensPlaceholder", "4096")}
                min={1}
                max={100000}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "anthropic", "reasoning_effort"]}
              label={t("settings.providerTab.reasoningEffortOptional")}
              extra={t("settings.providerTab.reasoningEffortHelp")}
            >
              {renderReasoningEffortSelect(t)}
            </Form.Item>
            <Divider dashed />
            {renderRequestOverridesEditor("anthropic")}
          </>
        );

      case "gemini":
        return (
          <>
            <Form.Item
              name={["providers", "gemini", "api_key"]}
              label={t("settings.providerTab.geminiApiKey")}
              rules={apiKeyRules(t("settings.providerTab.geminiApiKeyRequired"))}
            >
              <Password
                placeholder={apiKeyPlaceholder(
                  t("settings.providerTab.geminiApiKeyPlaceholder", "AIza..."),
                )}
                prefix={<KeyOutlined />}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "gemini", "base_url"]}
              label={t("settings.providerTab.baseUrlOptional")}
              extra={t("settings.providerTab.geminiBaseUrlHelp")}
            >
              <Input
                placeholder={t(
                  "settings.providerTab.geminiBaseUrlPlaceholder",
                  "https://generativelanguage.googleapis.com/v1beta",
                )}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "gemini", "reasoning_effort"]}
              label={t("settings.providerTab.reasoningEffortOptional")}
              extra={t("settings.providerTab.reasoningEffortHelp")}
            >
              {renderReasoningEffortSelect(t)}
            </Form.Item>
            <Divider dashed />
            {renderRequestOverridesEditor("gemini")}
          </>
        );

      case "copilot": {
        return (
          <>
            <Card
              size="small"
              style={{ marginBottom: 16 }}
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
              name={["providers", "copilot", "reasoning_effort"]}
              label={t("settings.providerTab.reasoningEffortOptional")}
              extra={t("settings.providerTab.reasoningEffortHelp")}
            >
              {renderReasoningEffortSelect(t)}
            </Form.Item>

            <Form.Item
              name={["providers", "copilot", "responses_only_models"]}
              label={t("settings.providerTab.responsesOnlyModelsOptional")}
              extra={renderResponsesOnlyModelsHelp(t)}
            >
              <Select
                mode="tags"
                placeholder={t(
                  "settings.providerTab.responsesOnlyModelsPlaceholder",
                  'e.g. "gpt-5.3-codex", "gpt-5*"',
                )}
                tokenSeparators={[",", " ", "\n", "\t"]}
              />
            </Form.Item>

            <Divider dashed />
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

      case "bodhi":
        return (
          <>
            <Form.Item
              name={["providers", "bodhi", "api_key"]}
              label={t("settings.providerTab.bodhiApiKey")}
              rules={apiKeyRules(t("settings.providerTab.apiKeyRequired"))}
            >
              <Input.Password
                data-testid="bodhi-api-key-input"
                placeholder={apiKeyPlaceholder(
                  t("settings.providerTab.bodhiApiKeyPlaceholder", "bhi_sk_..."),
                )}
                prefix={<KeyOutlined />}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "bodhi", "base_url"]}
              label={t("settings.providerTab.bodhiBaseUrl")}
              extra={t("settings.providerTab.bodhiBaseUrlExtra")}
            >
              <Input
                placeholder={t(
                  "settings.providerTab.bodhiBaseUrlPlaceholder",
                  "http://localhost:8080",
                )}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "bodhi", "target_provider"]}
              label={t("settings.providerTab.targetProvider")}
              extra={t("settings.providerTab.targetProviderExtra")}
            >
              <Select
                placeholder={t("settings.providerTab.targetProviderPlaceholder", "openai")}
                allowClear
              >
                <Select.Option value="openai">OpenAI</Select.Option>
                <Select.Option value="anthropic">Anthropic</Select.Option>
                <Select.Option value="gemini">Gemini</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item
              name={["providers", "bodhi", "reasoning_effort"]}
              label={t("settings.providerTab.reasoningEffortOptional")}
              extra={t("settings.providerTab.reasoningEffortHelp")}
            >
              {renderReasoningEffortSelect(t)}
            </Form.Item>
            <Divider dashed />
            {renderRequestOverridesEditor("bodhi")}
          </>
        );

      default:
        return null;
    }
  };

  // ── Collapse panel header with status ────────────────

  const renderPanelHeader = (provider: ModelProvider) => {
    const configured = isProviderConfigured(provider);
    const label = PROVIDER_LABELS[provider as ProviderType];
    return (
      <Space size="small">
        <span style={{ fontWeight: 500 }}>{label}</span>
        {configured ? (
          <Tag color="success" style={{ fontSize: 11 }}>
            {t("settings.providerTab.authenticated")}
          </Tag>
        ) : (
          <Tag color="default" style={{ fontSize: 11 }}>
            {t("settings.providerTab.providerNotConfigured")}
          </Tag>
        )}
      </Space>
    );
  };

  // ── Main render ──────────────────────────────────────

  return (
    <Card
      title={t("settings.providerTab.title")}
      loading={loading && !configLoaded}
      className="lotus-settings-card"
    >
      <Paragraph type="secondary">{t("settings.providerTab.description")}</Paragraph>

      <Divider />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSaveAndApply}
        disabled={loading && !configLoaded}
      >
        {!isInstanceMode && (
          <>
            {/* Active provider selector */}
            <Form.Item
              name="provider"
              label={t("settings.providerTab.activeProvider")}
              rules={[
                { required: true, message: t("settings.providerTab.selectProviderRequired") },
              ]}
            >
              <Select
                data-testid="provider-select"
                size="large"
                onChange={(value) => setCurrentProvider(value as ProviderType)}
              >
                {(Object.keys(PROVIDER_LABELS) as ProviderType[]).map((key) => (
                  <Select.Option key={key} value={key}>
                    {PROVIDER_LABELS[key]}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>

            <Form.Item noStyle shouldUpdate>
              {() =>
                renderInlineProviderReasoningControl(
                  form.getFieldValue("provider") || currentProvider,
                  {
                    autoSave: true,
                    size: "middle",
                    marginTop: 0,
                    dataTestId: "active-provider-reasoning-effort",
                    label: t("settings.providerTab.activeProviderReasoningEffort"),
                    helperText: t("settings.providerTab.reasoningEffortHelp"),
                  },
                )
              }
            </Form.Item>

            <Divider />
          </>
        )}

        {/* Fetch all models button */}
        <div style={{ marginBottom: 16 }}>
          <Button
            icon={<ReloadOutlined />}
            onClick={handleFetchAllModels}
            loading={fetchingAllModels}
          >
            {fetchingAllModels
              ? t("settings.providerTab.fetchingAllModels")
              : t("settings.providerTab.fetchAllModels")}
          </Button>
          {modelAutoSaveStatus === "saving" && <Spin size="small" style={{ marginLeft: 8 }} />}
          {modelAutoSaveStatus === "success" && (
            <CheckCircleOutlined style={{ color: "var(--lotus-chart-secondary)", marginLeft: 8 }} />
          )}
          {modelAutoSaveStatus === "error" && (
            <Tooltip title={modelAutoSaveError}>
              <CloseCircleOutlined style={{ color: "var(--lotus-chart-danger)", marginLeft: 8 }} />
            </Tooltip>
          )}
        </div>

        {renderModelPreferences()}

        {/* Provider instances or legacy provider panels */}
        {isInstanceMode ? (
          <ProviderInstanceManager
            instances={instances}
            defaultInstanceId={defaultInstanceId}
            onInstancesChanged={handleInstancesChanged}
          />
        ) : (
          <Collapse
            activeKey={expandedProviderPanels}
            onChange={(activeKey) =>
              setExpandedProviderPanels(
                Array.isArray(activeKey)
                  ? activeKey.map(String)
                  : activeKey
                    ? [String(activeKey)]
                    : [],
              )
            }
            ghost
            style={{ marginBottom: 16 }}
            items={MODEL_PROVIDERS.map((provider) => ({
              key: provider,
              label: renderPanelHeader(provider),
              children: renderProviderPanel(provider),
            }))}
          />
        )}

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
