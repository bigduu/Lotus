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
} from "../../../ChatPage/types/providerConfig";
import { PROVIDER_LABELS } from "../../../ChatPage/types/providerConfig";
import type { ProviderModelRef } from "../../../ChatPage/types/providerModelRef";
import {
  ServiceFactory,
  type BambooConfigValidationIssue,
} from "../../../../services/common/ServiceFactory";
import { copyText } from "@shared/utils/clipboard";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ProviderModelPicker } from "../../../ChatPage/components/ProviderModelPicker";
import { useProviderStore } from "../../../ChatPage/store/slices/providerSlice";
import type { ReasoningEffort } from "../../../ChatPage/services/AgentService";

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

type EditableProviders = {
  [K in ModelProvider]?: EditableProviderConfig<K>;
};

type EditableProvidersRecord = Partial<Record<ModelProvider, AnyEditableProviderConfig>>;

type EditableDefaults = DefaultsConfig & {
  chat: ProviderModelRef;
  fast?: ProviderModelRef;
  sub_agent?: ProviderModelRef;
  vision?: ProviderModelRef;
};

type ProviderSettingsFormValues = ProviderConfig & {
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
    placeholder={t("settings.providerTab.reasoningEffortDefault", "Default")}
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

      // Build defaults from providers.{provider}.model if defaults is missing
      // (backward compatibility with backend that stores model in providers).
      let defaults = response.defaults;
      if (!defaults?.chat?.model && response.provider && response.providers) {
        const providerName = response.provider as ModelProvider;
        const providerCfg = response.providers[providerName];
        const legacyModel = (providerCfg as { model?: string } | undefined)?.model;
        if (legacyModel) {
          defaults = {
            chat: {
              provider: providerName,
              model: legacyModel,
            },
          };
        }
      }

      const config: ProviderConfig = {
        provider: response.provider,
        defaults,
        providers: response.providers || {},
        features: response.features,
      };

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
        defaults: config.defaults,
      });
      setConfigLoaded(true);
    } catch (error) {
      message.error(t("settings.providerTab.loadConfigFailed"));
      console.error("Failed to load provider config:", error);
    } finally {
      setLoading(false);
    }
  }, [form, message, t]);

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
    void useProviderStore.getState().loadCatalog();
    void checkCopilotAuthStatus();
  }, [loadConfig, loadEnvVars, checkCopilotAuthStatus]);

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
        features: values.features,
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
            const messageText = `Invalid request_overrides JSON for ${p}: ${(error as Error).message}`;
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

      // Sync defaults.chat to providers.{provider}.model for backward compatibility
      // with the backend which reads model from providers.{provider}.model.
      const providersWithModel: EditableProviders = { ...(normalizedValues.providers || {}) };
      const activeProvider = normalizedValues.provider as ModelProvider;
      const defaultChatModel = normalizedValues.defaults?.chat;
      if (defaultChatModel?.model && activeProvider) {
        setLegacyProviderModel(providersWithModel, activeProvider, defaultChatModel.model);
      }

      const payload: Record<string, unknown> = {
        provider: normalizedValues.provider,
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
      const { useProviderStore } = await import("../../../ChatPage/store/slices/providerSlice");
      const { useAppStore } = await import("../../../ChatPage/store");

      const previousDefaultsChat = useProviderStore.getState().providerConfig.defaults?.chat;
      await useProviderStore.getState().loadProviderConfig();
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
    field: keyof Pick<EditableDefaults, "chat" | "fast" | "sub_agent" | "vision">,
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

  const handleProviderReasoningEffortChange = async () => {
    if (modelAutoSaveStatus === "saving") return;
    setModelAutoSaveStatus("saving");
    setModelAutoSaveError(null);
    try {
      const currentValues = form.getFieldsValue(true) as ProviderSettingsFormValues;
      await handleSave(currentValues, { showMessage: false, throwOnError: true });
      await handleApply({ showMessage: false, throwOnError: true });
      setModelAutoSaveStatus("success");
      message.success(t("settings.providerTab.reasoningEffortUpdated", "Reasoning effort updated"));
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      setModelAutoSaveStatus("error");
      setModelAutoSaveError(errorMessage);
      message.error(
        errorMessage
          ? `${t("settings.providerTab.updateReasoningEffortErrorPrefix", "Failed to update reasoning effort")}: ${errorMessage}`
          : t(
              "settings.providerTab.updateReasoningEffortFailed",
              "Failed to update reasoning effort",
            ),
      );
    }
  };

  const renderInlineProviderReasoningControl = (
    provider: ModelProvider | undefined,
    options?: {
      label?: string;
      helperText?: string;
      autoSave?: boolean;
      size?: "small" | "middle" | "large";
      marginTop?: number;
      dataTestId?: string;
    },
  ) => {
    if (!provider) return null;

    const providerLabel = PROVIDER_LABELS[provider as ProviderType];
    const reasoningValue = form.getFieldValue(["providers", provider, "reasoning_effort"]) as
      | ReasoningEffort
      | undefined;

    return (
      <div style={{ marginTop: options?.marginTop ?? 8 }}>
        <Space direction="vertical" size={4} style={{ width: "100%" }}>
          <Text strong>
            {options?.label ||
              `${providerLabel} · ${t("settings.providerTab.reasoningEffortOptional", "Reasoning Effort (Optional)")}`}
          </Text>
          {renderReasoningEffortSelect(t, {
            value: reasoningValue,
            disabled: modelAutoSaveStatus === "saving",
            size: options?.size,
            style: { width: "100%" },
            "data-testid": options?.dataTestId,
            onChange: (value) => {
              form.setFieldValue(["providers", provider, "reasoning_effort"], value);
              if (options?.autoSave) {
                void handleProviderReasoningEffortChange();
              }
            },
          })}
          <Text type="secondary">
            {options?.helperText ||
              t(
                "settings.providerTab.reasoningEffortHelp",
                "Default reasoning effort for requests sent through this provider.",
              )}
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
    const renderPicker = (
      field: keyof Pick<EditableDefaults, "chat" | "fast" | "sub_agent" | "vision">,
    ) => {
      const value = form.getFieldValue(["defaults", field]) as ProviderModelRef | undefined;
      return (
        <ProviderModelPicker
          value={value}
          disabled={modelAutoSaveStatus === "saving"}
          onChange={(ref) => {
            form.setFieldValue(["defaults", field], ref);
            void handleDefaultsModelChange(field, ref);
          }}
        />
      );
    };

    const renderPreferenceSection = (
      field: keyof Pick<EditableDefaults, "chat" | "fast" | "sub_agent" | "vision">,
      title: string,
      helpText?: string,
    ) => (
      <div>
        <Text strong>{title}</Text>
        <div style={{ marginTop: 8 }}>{renderPicker(field)}</div>
        <Form.Item noStyle shouldUpdate>
          {() => {
            const selectedModelRef = form.getFieldValue(["defaults", field]) as
              | ProviderModelRef
              | undefined;
            const selectedProvider = selectedModelRef?.provider as ModelProvider | undefined;
            return renderInlineProviderReasoningControl(selectedProvider, {
              autoSave: true,
              dataTestId: `model-preference-${field}-reasoning-effort`,
              label: selectedProvider
                ? `${PROVIDER_LABELS[selectedProvider as ProviderType]} · ${t(
                    "settings.providerTab.reasoningEffortOptional",
                    "Reasoning Effort (Optional)",
                  )}`
                : t("settings.providerTab.reasoningEffortOptional", "Reasoning Effort (Optional)"),
              helperText: t(
                "settings.providerTab.reasoningEffortHelp",
                "Default reasoning effort for requests sent through this provider.",
              ),
            });
          }}
        </Form.Item>
        {helpText ? <Text type="secondary">{helpText}</Text> : null}
      </div>
    );

    return (
      <Card
        size="small"
        title={t("settings.providerTab.modelPreferences", "模型偏好")}
        style={{ marginBottom: 16 }}
      >
        <Form.Item name={["defaults", "chat"]} noStyle preserve>
          <ProviderModelRefField />
        </Form.Item>
        <Form.Item name={["defaults", "fast"]} noStyle preserve>
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
            "sub_agent",
            t("settings.providerTab.subAgentModel", "Sub Agent Model (Optional)"),
            t(
              "settings.providerTab.subAgentModelHelp",
              "Default model for new Sub Agents. Uses Fast Model when not set.",
            ),
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
        label="Advanced Request Overrides (JSON)"
        extra={
          <Space direction="vertical" size={4}>
            <Text type="secondary">Customize provider request headers/body patch rules.</Text>
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
          style={{ fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
        />
      </Form.Item>
    );
  };

  const renderProviderPanel = (provider: ModelProvider) => {
    switch (provider) {
      case "openai":
        return (
          <>
            <Form.Item
              name={["providers", "openai", "api_key"]}
              label={t("settings.providerTab.openaiApiKey")}
              rules={[{ required: true, message: t("settings.providerTab.openaiApiKeyRequired") }]}
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
              name={["providers", "openai", "reasoning_effort"]}
              label={t(
                "settings.providerTab.reasoningEffortOptional",
                "Reasoning Effort (Optional)",
              )}
              extra={t(
                "settings.providerTab.reasoningEffortHelp",
                "Default reasoning effort for requests sent through this provider.",
              )}
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
                placeholder='e.g. "gpt-5.3-codex", "gpt-5*"'
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
              rules={[
                { required: true, message: t("settings.providerTab.anthropicApiKeyRequired") },
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
              name={["providers", "anthropic", "max_tokens"]}
              label={t("settings.providerTab.maxTokensOptional")}
              extra={t("settings.providerTab.maxTokensHelp")}
            >
              <Input type="number" placeholder="4096" min={1} max={100000} />
            </Form.Item>
            <Form.Item
              name={["providers", "anthropic", "reasoning_effort"]}
              label={t(
                "settings.providerTab.reasoningEffortOptional",
                "Reasoning Effort (Optional)",
              )}
              extra={t(
                "settings.providerTab.reasoningEffortHelp",
                "Default reasoning effort for requests sent through this provider.",
              )}
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
              rules={[{ required: true, message: t("settings.providerTab.geminiApiKeyRequired") }]}
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
              name={["providers", "gemini", "reasoning_effort"]}
              label={t(
                "settings.providerTab.reasoningEffortOptional",
                "Reasoning Effort (Optional)",
              )}
              extra={t(
                "settings.providerTab.reasoningEffortHelp",
                "Default reasoning effort for requests sent through this provider.",
              )}
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
              label={t(
                "settings.providerTab.reasoningEffortOptional",
                "Reasoning Effort (Optional)",
              )}
              extra={t(
                "settings.providerTab.reasoningEffortHelp",
                "Default reasoning effort for requests sent through this provider.",
              )}
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
                placeholder='e.g. "gpt-5.3-codex", "gpt-5*"'
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
              label="Bodhi API Key"
              rules={[{ required: true, message: "API key is required" }]}
            >
              <Input.Password
                data-testid="bodhi-api-key-input"
                placeholder="bhi_sk_..."
                prefix={<KeyOutlined />}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "bodhi", "base_url"]}
              label="Base URL"
              extra="Your Bodhi Server endpoint address"
            >
              <Input placeholder="http://localhost:8080" />
            </Form.Item>
            <Form.Item
              name={["providers", "bodhi", "target_provider"]}
              label="Target Provider"
              extra="Which upstream provider to route through Bodhi"
            >
              <Select placeholder="openai" allowClear>
                <Select.Option value="openai">OpenAI</Select.Option>
                <Select.Option value="anthropic">Anthropic</Select.Option>
                <Select.Option value="gemini">Gemini</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item
              name={["providers", "bodhi", "reasoning_effort"]}
              label={t(
                "settings.providerTab.reasoningEffortOptional",
                "Reasoning Effort (Optional)",
              )}
              extra={t(
                "settings.providerTab.reasoningEffortHelp",
                "Default reasoning effort for requests sent through this provider.",
              )}
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
        {/* Active provider selector */}
        <Form.Item
          name="provider"
          label={t("settings.providerTab.activeProvider")}
          rules={[{ required: true, message: t("settings.providerTab.selectProviderRequired") }]}
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
              (form.getFieldValue("provider") || currentProvider) as ModelProvider | undefined,
              {
                autoSave: true,
                size: "middle",
                marginTop: 0,
                dataTestId: "active-provider-reasoning-effort",
                label: t(
                  "settings.providerTab.activeProviderReasoningEffort",
                  "Active Provider Reasoning Effort",
                ),
                helperText: t(
                  "settings.providerTab.reasoningEffortHelp",
                  "Default reasoning effort for requests sent through this provider.",
                ),
              },
            )
          }
        </Form.Item>

        <Divider />

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

        {/* All providers in collapsible panels */}
        <Collapse
          defaultActiveKey={MODEL_PROVIDERS.filter((p) => isProviderConfigured(p))}
          ghost
          style={{ marginBottom: 16 }}
          items={MODEL_PROVIDERS.map((provider) => ({
            key: provider,
            label: renderPanelHeader(provider),
            children: renderProviderPanel(provider),
          }))}
        />

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
