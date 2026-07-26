import { debugLog } from "@shared/utils/debugFlags";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
  Alert,
  Popconfirm,
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
  CopyOutlined,
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
  CreateProviderInstanceRequest,
  UpdateProviderInstanceRequest,
} from "@shared/types/providerConfig";
import { PROVIDER_LABELS } from "@shared/types/providerConfig";
import type { ProviderModelRef } from "@shared/types/providerModelRef";
import { type BambooMemoryConfig } from "@services/common/ServiceFactory";
import { copyText } from "@shared/utils/clipboard";
import { redactSensitive } from "@shared/utils/secrets";
import { isMaskedSecretValue } from "./providerInstanceUtils";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ProviderModelPicker } from "../../../ChatPage/components/ProviderModelPicker";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import type { ReasoningEffort } from "@services/chat/AgentService";
import { ProviderInstanceManager } from "./ProviderInstanceManager";
import { getBambooCompatibleProviderBaseUrls } from "@shared/utils/backendBaseUrl";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import type {
  ProviderCredentialChanges,
  ProviderCredentialStatus,
  ProviderInstanceSettings,
  ProviderSection,
} from "@services/config/configSections";
import { providerSectionToInstances } from "@services/config/providerSettings";
import { v4 as uuid } from "uuid";
import { reapplyConfigChanges } from "@shared/hooks/useConfigSectionDraft";

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

type ProviderSettingsFormValues = Omit<ProviderConfig, "provider" | "providers" | "defaults"> & {
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

const EMPTY_PROVIDER_CREDENTIAL_STATUS: Record<string, ProviderCredentialStatus> = {};

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

const buildProviderInstanceSettings = (
  type: ProviderType,
  label: string | undefined,
  enabled: boolean | undefined,
  rawConfig: Record<string, unknown>,
): { settings: ProviderInstanceSettings; credential?: string } => {
  const config = structuredClone(rawConfig);
  const apiKey = typeof config.api_key === "string" ? config.api_key.trim() : "";
  delete config.api_key;
  const settings: ProviderInstanceSettings = {
    provider_type: type,
    label: label?.trim() || PROVIDER_LABELS[type],
    enabled: enabled ?? true,
    base_url: config.base_url as string | null | undefined,
    model: config.model as string | null | undefined,
    fast_model: config.fast_model as string | null | undefined,
    vision_model: config.vision_model as string | null | undefined,
    reasoning_effort: config.reasoning_effort as
      | ProviderInstanceSettings["reasoning_effort"]
      | undefined,
    responses_only_models: config.responses_only_models as string[] | undefined,
    request_overrides: config.request_overrides as
      | ProviderInstanceSettings["request_overrides"]
      | undefined,
    target_provider: config.target_provider as
      | ProviderInstanceSettings["target_provider"]
      | undefined,
    thinking_replay_always: config.thinking_replay_always as boolean | null | undefined,
  };
  return {
    settings,
    credential: apiKey && !isMaskedSecretValue(apiKey) ? apiKey : undefined,
  };
};

const getLegacyMemoryBackgroundModel = (
  memory: BambooMemoryConfig | null | undefined,
): string | undefined => {
  const legacyValue = memory?.background_model?.trim();
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
  const { message, modal } = AntApp.useApp();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [applyingConfig, setApplyingConfig] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<ProviderType>("copilot");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const baseFormRef = useRef<ProviderSettingsFormValues | null>(null);
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

  const buildProviderFormState = useCallback(
    (response: ProviderSection, memory?: BambooMemoryConfig | null) => {
      const instances = providerSectionToInstances(response);
      const providersWithEditorFields = instances.reduce<EditableProviders>(
        (acc, instance) => {
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
        },
        structuredClone(response.providers) as EditableProviders,
      );

      for (const provider of MODEL_PROVIDERS) {
        const providerConfig = providersWithEditorFields[provider];
        if (
          providerConfig?.request_overrides &&
          typeof providerConfig.request_overrides === "object"
        ) {
          providerConfig.request_overrides_json = JSON.stringify(
            providerConfig.request_overrides,
            null,
            2,
          );
        }
      }

      let defaults = response.defaults ? ({ ...response.defaults } as EditableDefaults) : undefined;
      const defaultInstanceId = response.default_provider_instance_id;
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

      const legacyMemoryBackgroundModel = getLegacyMemoryBackgroundModel(memory);
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
        provider: response.provider,
        defaults,
        features: response.features,
        providers: providersWithEditorFields,
      };
    },
    [],
  );

  const syncProviderState = useCallback(
    (response: ProviderSection, memory?: BambooMemoryConfig | null, revision?: number) => {
      const nextInstances = providerSectionToInstances(response);
      setInstances(nextInstances);
      setDefaultInstanceId(response.default_provider_instance_id);
      setIsInstanceMode(nextInstances.length > 0);
      setCurrentProvider(response.provider as ProviderType);
      setProvidersWithStoredKey(
        new Set(
          MODEL_PROVIDERS.filter(
            (provider) => response.credential_status.providers[provider]?.configured,
          ),
        ),
      );
      setExpandedProviderPanels(
        Array.from(
          new Set([
            response.provider,
            ...MODEL_PROVIDERS.filter((provider) => Boolean(response.providers[provider])),
          ]),
        ),
      );
      const nextForm = buildProviderFormState(response, memory);
      form.setFieldsValue(nextForm);
      baseFormRef.current = structuredClone(nextForm);
      if (revision !== undefined) setBaseRevision(revision);
      setDirty(false);
      setConfigLoaded(true);
    },
    [buildProviderFormState, form],
  );
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const saveProviderSettings = useConfigSectionStore((state) => state.saveProviderSettings);
  const providerCredentialStatusById = useConfigSectionStore(
    (state) =>
      state.sections.providers.envelope?.data.credential_status.provider_instances ??
      EMPTY_PROVIDER_CREDENTIAL_STATUS,
  );
  const providerEnvelope = useConfigSectionStore((state) => state.sections.providers.envelope);

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
      const [providers, memory] = await Promise.all([
        loadSection("providers", { force: true }),
        loadSection("memory"),
      ]);
      debugLog("[Provider]", "Loaded provider section:", redactSensitive(providers.data));
      syncProviderState(providers.data, memory.data, providers.revision);
    } catch (error) {
      message.error(t("settings.providerTab.loadConfigFailed"));
      console.error("Failed to load provider config:", error);
    } finally {
      setLoading(false);
    }
  }, [loadSection, message, syncProviderState, t]);

  const loadEnvVars = useCallback(async () => {
    try {
      const response = await settingsService.getEnvVars();
      setEnvVarEntries(response.entries || []);
    } catch (error) {
      console.warn("Failed to load env vars for provider overrides:", error);
    }
  }, []);

  const commitProviderMutation = useCallback(
    async (
      mutate: (draft: ProviderSection) => void,
      credentialChanges: ProviderCredentialChanges = {},
    ) => {
      const snapshot = useConfigSectionStore.getState().sections.providers.envelope;
      if (!snapshot) throw new Error("Load providers before saving them.");
      const draft = structuredClone(snapshot.data);
      mutate(draft);
      const saved = await saveProviderSettings(draft, credentialChanges, snapshot.revision);
      const memory = useConfigSectionStore.getState().sections.memory.envelope?.data;
      if (dirty) {
        const nextInstances = providerSectionToInstances(saved.data);
        setInstances(nextInstances);
        setDefaultInstanceId(saved.data.default_provider_instance_id);
        setIsInstanceMode(nextInstances.length > 0);
        setProvidersWithStoredKey(
          new Set(
            MODEL_PROVIDERS.filter(
              (provider) => saved.data.credential_status.providers[provider]?.configured,
            ),
          ),
        );
        setBaseRevision(saved.revision);
      } else {
        syncProviderState(saved.data, memory, saved.revision);
      }
    },
    [dirty, saveProviderSettings, syncProviderState],
  );

  const handleCreateInstance = useCallback(
    async (request: CreateProviderInstanceRequest) => {
      const id = uuid();
      const { settings, credential } = buildProviderInstanceSettings(
        request.type,
        request.label,
        request.enabled,
        request.config,
      );
      await commitProviderMutation(
        (draft) => {
          draft.provider_instances[id] = settings;
        },
        credential
          ? {
              provider_instances: {
                [id]: { action: "replace", value: credential },
              },
            }
          : {},
      );
    },
    [commitProviderMutation],
  );

  const handleUpdateInstance = useCallback(
    async (instanceId: string, request: UpdateProviderInstanceRequest) => {
      const snapshot = useConfigSectionStore.getState().sections.providers.envelope;
      const existing = snapshot?.data.provider_instances[instanceId];
      if (!existing) throw new Error(`Provider instance '${instanceId}' no longer exists.`);
      const {
        provider_type: _providerType,
        label: _label,
        enabled: _enabled,
        ...existingConfig
      } = existing;
      const { settings, credential } = buildProviderInstanceSettings(
        existing.provider_type,
        request.label ?? existing.label ?? undefined,
        request.enabled ?? existing.enabled,
        request.config ?? existingConfig,
      );
      await commitProviderMutation(
        (draft) => {
          draft.provider_instances[instanceId] = settings;
        },
        credential
          ? {
              provider_instances: {
                [instanceId]: { action: "replace", value: credential },
              },
            }
          : {},
      );
    },
    [commitProviderMutation],
  );

  const handleDeleteInstance = useCallback(
    async (instanceId: string) => {
      await commitProviderMutation((draft) => {
        delete draft.provider_instances[instanceId];
        if (draft.default_provider_instance_id === instanceId) {
          draft.default_provider_instance_id = null;
        }
      });
    },
    [commitProviderMutation],
  );

  const handleSetDefaultInstance = useCallback(
    async (instanceId: string) => {
      await commitProviderMutation((draft) => {
        if (!draft.provider_instances[instanceId]) {
          throw new Error(`Provider instance '${instanceId}' no longer exists.`);
        }
        draft.default_provider_instance_id = instanceId;
      });
    },
    [commitProviderMutation],
  );

  const handleClearInstanceCredential = useCallback(
    async (instanceId: string) => {
      await commitProviderMutation(() => undefined, {
        provider_instances: {
          [instanceId]: { action: "clear" },
        },
      });
    },
    [commitProviderMutation],
  );

  const handleClearProviderCredential = useCallback(
    async (provider: ProviderType) => {
      await commitProviderMutation(() => undefined, {
        providers: {
          [provider]: { action: "clear" },
        },
      });
      message.success(t("settings.providerTab.credentialCleared", "Provider credential cleared"));
    },
    [commitProviderMutation, message, t],
  );

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
    void loadConfig();
  }, [loadConfig, loadEnvVars, checkCopilotAuthStatus]);

  useEffect(() => {
    if (!configLoaded || !providerEnvelope || providerEnvelope.revision === baseRevision || dirty) {
      return;
    }
    syncProviderState(
      providerEnvelope.data,
      useConfigSectionStore.getState().sections.memory.envelope?.data,
      providerEnvelope.revision,
    );
  }, [baseRevision, configLoaded, dirty, providerEnvelope, syncProviderState]);

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

  const handleSave = async (
    values: ProviderSettingsFormValues,
    options?: { showMessage?: boolean; throwOnError?: boolean },
  ) => {
    try {
      setLoading(true);
      const normalizedValues: ProviderSettingsFormValues = {
        provider: values.provider,
        defaults: values.defaults,
        providers: structuredClone(values.providers || {}),
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

      const credentialChanges: ProviderCredentialChanges = {};
      for (const p of MODEL_PROVIDERS) {
        const providerCfg = editableProviders[p] as Record<string, unknown> | undefined;
        if (!providerCfg || !("api_key" in providerCfg)) continue;
        const apiKey = providerCfg.api_key;
        if (typeof apiKey === "string" && apiKey.trim() && !isMaskedSecretValue(apiKey)) {
          credentialChanges.providers = {
            ...(credentialChanges.providers || {}),
            [p]: { action: "replace", value: apiKey },
          };
        }
        // Plaintext exists only in this local submit frame. The section data
        // and Zustand snapshot are always secret-free.
        delete providerCfg.api_key;
      }

      // Sync defaults.chat to providers.{provider}.model for backward compatibility
      // with the backend which reads model from providers.{provider}.model.
      const providersWithModel: EditableProviders = { ...(normalizedValues.providers || {}) };
      const activeProvider = normalizedValues.provider as ModelProvider;
      const defaultChatModel = normalizedValues.defaults?.chat;
      if (defaultChatModel?.model && activeProvider) {
        setLegacyProviderModel(providersWithModel, activeProvider, defaultChatModel.model);
      }

      const snapshot = useConfigSectionStore.getState().sections.providers.envelope;
      if (!snapshot) throw new Error("Load providers before saving them.");
      if (baseRevision === null) throw new Error("Provider revision is not loaded.");
      const payload: ProviderSection = {
        ...snapshot.data,
        provider: isInstanceMode
          ? snapshot.data.provider
          : normalizedValues.provider || currentProvider,
        providers: isInstanceMode
          ? snapshot.data.providers
          : (providersWithModel as ProviderSection["providers"]),
        defaults: normalizedValues.defaults as DefaultsConfig,
        features: {
          ...snapshot.data.features,
          ...(normalizedValues.features || {}),
          provider_model_ref: true,
        },
      };

      debugLog("[Provider]", "Saving provider section:", redactSensitive(payload));
      const saved = await saveProviderSettings(payload, credentialChanges, baseRevision);
      syncProviderState(
        saved.data,
        useConfigSectionStore.getState().sections.memory.envelope?.data,
        saved.revision,
      );

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
        await handleUpdateInstance(instance.id, {
          label: instance.label,
          enabled: instance.enabled,
          config: {
            ...instance.config,
            reasoning_effort: value ?? null,
          },
        });
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
      return providersWithStoredKey.has(provider) || Boolean(cfg.api_key);
    },
    [form, copilotAuthStatus, providersWithStoredKey],
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
    const clearStoredCredential = hasStoredKey && provider !== "copilot" && (
      <Popconfirm
        title={t(
          "settings.providerTab.confirmClearCredential",
          "Clear the stored credential for this provider?",
        )}
        onConfirm={() => void handleClearProviderCredential(provider)}
        okText={t("settings.providerTab.clear", "Clear")}
        cancelText={t("settings.providerTab.cancel", "Cancel")}
      >
        <Button danger size="small" style={{ marginBottom: 16 }}>
          {t("settings.providerTab.clearCredential", "Clear stored credential")}
        </Button>
      </Popconfirm>
    );

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
            {clearStoredCredential}
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
            {clearStoredCredential}
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
            {clearStoredCredential}
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
            {clearStoredCredential}
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

  const externalRevision =
    dirty && providerEnvelope && baseRevision !== null && providerEnvelope.revision !== baseRevision
      ? providerEnvelope.revision
      : null;

  const compareProviderDraft = () => {
    if (!providerEnvelope || baseRevision === null) return;
    const safeDraft = redactSensitive(form.getFieldsValue(true));
    modal.info({
      title: t("settings.providerTab.compareChanges", "Compare provider changes"),
      width: 760,
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>
            {t("settings.providerTab.compareRevision", {
              defaultValue: "Draft r{{base}} vs latest r{{latest}}",
              base: baseRevision,
              latest: providerEnvelope.revision,
            })}
          </Text>
          <pre style={{ maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {JSON.stringify({ draft: safeDraft, latest: providerEnvelope.data }, null, 2)}
          </pre>
        </Space>
      ),
    });
  };

  const reapplyProviderDraft = () => {
    if (!providerEnvelope || baseRevision === null || baseFormRef.current === null) return;
    const memory = useConfigSectionStore.getState().sections.memory.envelope?.data;
    const latestForm = buildProviderFormState(providerEnvelope.data, memory);
    const currentDraft = form.getFieldsValue(true) as ProviderSettingsFormValues;
    const rebased = reapplyConfigChanges(baseFormRef.current, currentDraft, latestForm);
    form.setFieldsValue(rebased);
    baseFormRef.current = structuredClone(latestForm);
    setBaseRevision(providerEnvelope.revision);
    setCurrentProvider((rebased.provider || providerEnvelope.data.provider) as ProviderType);
    const nextInstances = providerSectionToInstances(providerEnvelope.data);
    setInstances(nextInstances);
    setDefaultInstanceId(providerEnvelope.data.default_provider_instance_id);
    setIsInstanceMode(nextInstances.length > 0);
    setProvidersWithStoredKey(
      new Set(
        MODEL_PROVIDERS.filter(
          (provider) => providerEnvelope.data.credential_status.providers[provider]?.configured,
        ),
      ),
    );
    message.info(
      t("settings.providerTab.draftReapplied", "Draft kept and rebased onto the latest revision."),
    );
  };

  return (
    <Card
      title={t("settings.providerTab.title")}
      loading={loading && !configLoaded}
      className="lotus-settings-card"
    >
      <Paragraph type="secondary">{t("settings.providerTab.description")}</Paragraph>

      {externalRevision !== null && providerEnvelope && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={t(
            "settings.providerTab.externalRevisionTitle",
            "Provider configuration changed on disk",
          )}
          description={t("settings.providerTab.externalRevisionDescription", {
            defaultValue:
              "Your draft is based on revision {{base}}; revision {{latest}} is now available.",
            base: baseRevision,
            latest: externalRevision,
          })}
          action={
            <Space wrap>
              <Button
                size="small"
                onClick={() =>
                  syncProviderState(
                    providerEnvelope.data,
                    useConfigSectionStore.getState().sections.memory.envelope?.data,
                    providerEnvelope.revision,
                  )
                }
              >
                {t("settings.providerTab.reloadLatest", "Reload latest")}
              </Button>
              <Button size="small" onClick={compareProviderDraft}>
                {t("settings.providerTab.compareChanges", "Compare")}
              </Button>
              <Button size="small" type="primary" onClick={reapplyProviderDraft}>
                {t("settings.providerTab.reapplyDraft", "Reapply draft")}
              </Button>
            </Space>
          }
        />
      )}

      <Alert
        type="info"
        showIcon
        data-testid="bamboo-provider-api-guide"
        message={t("settings.providerTab.bambooApiGuideTitle")}
        description={
          <Space direction="vertical" size={8} style={{ width: "100%" }}>
            <Text>{t("settings.providerTab.bambooApiGuideDescription")}</Text>
            {getBambooCompatibleProviderBaseUrls().map(({ provider, url }) => (
              <div
                key={provider}
                style={{
                  display: "flex",
                  alignItems: "center",
                  columnGap: 8,
                  rowGap: 4,
                  flexWrap: "wrap",
                  minWidth: 0,
                }}
              >
                <Text strong style={{ minWidth: 76 }}>
                  {t(`settings.providerTab.bambooApiProviders.${provider}`)}
                </Text>
                <Text
                  code
                  data-testid={`bamboo-provider-api-${provider}`}
                  style={{ overflowWrap: "anywhere", minWidth: 0 }}
                >
                  {url}
                </Text>
                <Tooltip title={t("settings.providerTab.copyBambooApiUrl")}>
                  <Button
                    type="text"
                    size="small"
                    icon={<CopyOutlined />}
                    aria-label={t("settings.providerTab.copyBambooApiUrlFor", {
                      provider: t(`settings.providerTab.bambooApiProviders.${provider}`),
                    })}
                    onClick={async () => {
                      try {
                        await copyText(url);
                        message.success(t("settings.providerTab.bambooApiUrlCopied"));
                      } catch {
                        message.error(t("settings.providerTab.bambooApiUrlCopyFailed"));
                      }
                    }}
                  />
                </Tooltip>
              </div>
            ))}
            <Text type="secondary">{t("settings.providerTab.bambooApiGuideNote")}</Text>
          </Space>
        }
      />

      <Divider />

      <Form
        form={form}
        layout="vertical"
        onFinish={handleSaveAndApply}
        onValuesChange={() => setDirty(true)}
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

        {/* Built-in metadata remains editable until the first instance is
            configured; instance CRUD is always available. */}
        {!isInstanceMode && (
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
        <ProviderInstanceManager
          instances={instances}
          defaultInstanceId={defaultInstanceId}
          credentialStatusById={providerCredentialStatusById}
          onCreateInstance={handleCreateInstance}
          onUpdateInstance={handleUpdateInstance}
          onDeleteInstance={handleDeleteInstance}
          onSetDefaultInstance={handleSetDefaultInstance}
          onClearInstanceCredential={handleClearInstanceCredential}
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
