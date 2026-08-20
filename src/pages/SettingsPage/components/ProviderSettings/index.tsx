import { debugLog } from "@shared/utils/debugFlags";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  App as AntApp,
  Form,
  Select,
  Button,
  Card,
  Space,
  Divider,
  Typography,
  Spin,
  Tooltip,
  Alert,
  theme,
} from "antd";
import {
  SaveOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ReloadOutlined,
  CopyOutlined,
} from "@ant-design/icons";
import { settingsService } from "@services/config/SettingsService";
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
  ProviderSection,
} from "@services/config/configSections";
import { providerSectionToInstances } from "@services/config/providerSettings";
import { v4 as uuid } from "uuid";
import { reapplyConfigChanges } from "@shared/hooks/useConfigSectionDraft";
import { configErrorMessage } from "@shared/utils/configErrors";
import {
  buildProviderInstanceSettings,
  insertProviderInstance,
  removeProviderInstance,
} from "./providerSettingsPayload";

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
  providers: EditableProviders;
  defaults?: EditableDefaults;
};

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

const withoutProviderCredentials = (
  values: ProviderSettingsFormValues,
): ProviderSettingsFormValues => {
  const safe = structuredClone(values);
  for (const providerConfig of Object.values(safe.providers ?? {})) {
    if (!providerConfig || typeof providerConfig !== "object") continue;
    delete (providerConfig as Record<string, unknown>).api_key;
    delete (providerConfig as Record<string, unknown>).api_key_encrypted;
  }
  return safe;
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
  const [configLoaded, setConfigLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const baseFormRef = useRef<ProviderSettingsFormValues | null>(null);
  const [fetchingAllModels, setFetchingAllModels] = useState(false);

  // Provider instances are the only editable provider representation.
  const [instances, setInstances] = useState<ProviderInstance[]>([]);
  const [defaultInstanceId, setDefaultInstanceId] = useState<string | null>(null);

  const [modelAutoSaveStatus, setModelAutoSaveStatus] = useState<
    "idle" | "saving" | "success" | "error"
  >("idle");
  const [modelAutoSaveError, setModelAutoSaveError] = useState<string | null>(null);

  const buildProviderFormState = useCallback(
    (response: ProviderSection, memory?: BambooMemoryConfig | null) => {
      const instances = providerSectionToInstances(response);
      const providersWithEditorFields = instances.reduce<EditableProviders>((acc, instance) => {
        const editableConfig = {
          ...(instance.config as Record<string, unknown>),
        } as AnyEditableProviderConfig;
        delete (editableConfig as Record<string, unknown>).api_key;
        delete (editableConfig as Record<string, unknown>).api_key_encrypted;
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
      const nextForm = buildProviderFormState(response, memory);
      form.resetFields();
      form.setFieldsValue(nextForm);
      baseFormRef.current = structuredClone(nextForm);
      if (revision !== undefined) setBaseRevision(revision);
      setDirty(false);
      setConfigLoaded(true);
      setLoadError(null);
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

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const [providers, memory] = await Promise.all([
        loadSection("providers", { force: true }),
        loadSection("memory"),
      ]);
      debugLog("[Provider]", "Loaded provider section:", redactSensitive(providers.data));
      syncProviderState(providers.data, memory.data, providers.revision);
    } catch (error) {
      const errorMessage = configErrorMessage(error, t("settings.providerTab.loadConfigFailed"));
      setLoadError(errorMessage);
      message.error(t("settings.providerTab.loadConfigFailed"));
      console.error("Failed to load provider instances:", errorMessage);
    } finally {
      setLoading(false);
    }
  }, [loadSection, message, syncProviderState, t]);

  const commitProviderMutation = useCallback(
    async (
      mutate: (draft: ProviderSection) => void,
      credentialChanges: ProviderCredentialChanges,
      expectedRevision: number,
    ) => {
      const snapshot = useConfigSectionStore.getState().sections.providers.envelope;
      if (!snapshot) throw new Error("Load providers before saving them.");
      const draft = structuredClone(snapshot.data);
      mutate(draft);
      const saved = await saveProviderSettings(draft, credentialChanges, expectedRevision);
      const memory = useConfigSectionStore.getState().sections.memory.envelope?.data;
      if (dirty) {
        const nextInstances = providerSectionToInstances(saved.data);
        setInstances(nextInstances);
        setDefaultInstanceId(saved.data.default_provider_instance_id);
      } else {
        syncProviderState(saved.data, memory, saved.revision);
      }
    },
    [dirty, saveProviderSettings, syncProviderState],
  );

  const handleCreateInstance = useCallback(
    async (request: CreateProviderInstanceRequest, expectedRevision: number) => {
      const id = uuid();
      const { settings, credential } = buildProviderInstanceSettings(
        request.type,
        request.label,
        request.enabled,
        request.config,
      );
      await commitProviderMutation(
        (draft) => {
          insertProviderInstance(draft, id, settings);
        },
        credential
          ? {
              provider_instances: {
                [id]: { action: "replace", value: credential },
              },
            }
          : {},
        expectedRevision,
      );
    },
    [commitProviderMutation],
  );

  const handleUpdateInstance = useCallback(
    async (
      instanceId: string,
      request: UpdateProviderInstanceRequest,
      expectedRevision: number,
    ) => {
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
        { ...existingConfig, ...(request.config ?? {}) },
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
        expectedRevision,
      );
    },
    [commitProviderMutation],
  );

  const handleDeleteInstance = useCallback(
    async (instanceId: string, expectedRevision: number) => {
      await commitProviderMutation(
        (draft) => {
          removeProviderInstance(draft, instanceId);
        },
        {},
        expectedRevision,
      );
    },
    [commitProviderMutation],
  );

  const handleSetDefaultInstance = useCallback(
    async (instanceId: string, expectedRevision: number) => {
      await commitProviderMutation(
        (draft) => {
          if (!draft.provider_instances[instanceId]) {
            throw new Error(`Provider instance '${instanceId}' no longer exists.`);
          }
          draft.default_provider_instance_id = instanceId;
        },
        {},
        expectedRevision,
      );
    },
    [commitProviderMutation],
  );

  const handleClearInstanceCredential = useCallback(
    async (instanceId: string, expectedRevision: number) => {
      await commitProviderMutation(
        () => undefined,
        {
          provider_instances: {
            [instanceId]: { action: "clear" },
          },
        },
        expectedRevision,
      );
    },
    [commitProviderMutation],
  );

  useEffect(() => {
    void useProviderStore.getState().loadCatalog();
    void loadConfig();
  }, [loadConfig]);

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
    return configErrorMessage(error, t("settings.providerTab.unknownError"));
  };

  const handleSave = async (
    values: ProviderSettingsFormValues,
    options?: { showMessage?: boolean; throwOnError?: boolean },
  ) => {
    try {
      setLoading(true);
      const normalizedValues: ProviderSettingsFormValues = {
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

      const snapshot = useConfigSectionStore.getState().sections.providers.envelope;
      if (!snapshot) throw new Error("Load providers before saving them.");
      if (baseRevision === null) throw new Error("Provider revision is not loaded.");
      const payload: ProviderSection = {
        ...snapshot.data,
        defaults: normalizedValues.defaults as DefaultsConfig,
        features: {
          ...snapshot.data.features,
          ...(normalizedValues.features || {}),
          provider_model_ref: true,
        },
      };

      debugLog("[Provider]", "Saving provider section:", redactSensitive(payload));
      const saved = await saveProviderSettings(payload, {}, baseRevision);
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
      console.error("Failed to save configuration:", errorMessage);
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

      await useProviderStore.getState().loadProviderInstances();

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
      console.error("Failed to apply configuration:", errorMessage);
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
      const instance = instances.find((item) => item.id === providerIdOrType);
      if (!instance) {
        throw new Error(t("settings.providerTab.providerNotConfigured"));
      }
      if (!providerEnvelope) {
        throw new Error("Load providers before saving them.");
      }
      await handleUpdateInstance(
        instance.id,
        {
          label: instance.label,
          enabled: instance.enabled,
          config: {
            ...instance.config,
            reasoning_effort: value ?? null,
          },
        },
        providerEnvelope.revision,
      );
      await useProviderStore.getState().loadProviderInstances();
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

  // ── Unified model preferences ───────────────────────

  const renderModelPreferences = () => {
    const renderPicker = (field: ModelPreferenceField) => (
      <Form.Item noStyle shouldUpdate>
        {({ getFieldValue, setFieldValue }) => {
          const value = getFieldValue(["defaults", field]) as ProviderModelRef | undefined;
          return (
            <ProviderModelPicker
              value={value}
              dataTestId={`model-preference-${field}-picker`}
              appearance="contrast"
              disabled={modelAutoSaveStatus === "saving"}
              onChange={(ref) => {
                setFieldValue(["defaults", field], ref);
                void handleDefaultsModelChange(field, ref);
              }}
            />
          );
        }}
      </Form.Item>
    );

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

  // ── Main render ──────────────────────────────────────

  const externalRevision =
    dirty && providerEnvelope && baseRevision !== null && providerEnvelope.revision !== baseRevision
      ? providerEnvelope.revision
      : null;

  const compareProviderDraft = () => {
    if (!providerEnvelope || baseRevision === null) return;
    const safeDraft = withoutProviderCredentials(
      form.getFieldsValue(true) as ProviderSettingsFormValues,
    );
    const memory = useConfigSectionStore.getState().sections.memory.envelope?.data;
    const safeLatest = withoutProviderCredentials(
      buildProviderFormState(providerEnvelope.data, memory),
    );
    modal.info({
      title: t("settings.providerTab.compareChanges"),
      width: 760,
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>
            {t("settings.providerTab.compareRevision", {
              loaded: baseRevision,
              latest: providerEnvelope.revision,
            })}
          </Text>
          <pre style={{ maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {JSON.stringify({ draft: safeDraft, latest: safeLatest }, null, 2)}
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
    form.resetFields();
    form.setFieldsValue(rebased);
    baseFormRef.current = structuredClone(latestForm);
    setBaseRevision(providerEnvelope.revision);
    const nextInstances = providerSectionToInstances(providerEnvelope.data);
    setInstances(nextInstances);
    setDefaultInstanceId(providerEnvelope.data.default_provider_instance_id);
    message.info(t("settings.providerTab.draftReapplied"));
  };

  return (
    <Card title={t("settings.providerTab.title")} className="lotus-settings-card">
      <Spin spinning={loading && !configLoaded}>
        <Paragraph type="secondary">{t("settings.providerTab.description")}</Paragraph>

        {loadError && (
          <Alert
            type="error"
            showIcon
            data-testid="provider-instances-load-error"
            style={{ marginBottom: 16 }}
            message={t("settings.providerTab.loadConfigFailed")}
            description={loadError}
            action={
              <Button size="small" onClick={() => void loadConfig()} loading={loading}>
                {t("settings.providerTab.reloadLatest")}
              </Button>
            }
          />
        )}

        {externalRevision !== null && providerEnvelope && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t("settings.providerTab.externalRevisionTitle")}
            description={t("settings.providerTab.externalRevisionDescription", {
              loaded: baseRevision,
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
                  {t("settings.providerTab.reloadLatest")}
                </Button>
                <Button size="small" onClick={compareProviderDraft}>
                  {t("settings.providerTab.compareChanges")}
                </Button>
                <Button size="small" type="primary" onClick={reapplyProviderDraft}>
                  {t("settings.providerTab.reapplyDraft")}
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
              <CheckCircleOutlined
                style={{ color: "var(--lotus-chart-secondary)", marginLeft: 8 }}
              />
            )}
            {modelAutoSaveStatus === "error" && (
              <Tooltip title={modelAutoSaveError}>
                <CloseCircleOutlined
                  style={{ color: "var(--lotus-chart-danger)", marginLeft: 8 }}
                />
              </Tooltip>
            )}
          </div>

          {renderModelPreferences()}

          <ProviderInstanceManager
            instances={instances}
            latestInstances={
              providerEnvelope ? providerSectionToInstances(providerEnvelope.data) : instances
            }
            defaultInstanceId={defaultInstanceId}
            currentRevision={providerEnvelope?.revision ?? null}
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
      </Spin>
    </Card>
  );
};

export default ProviderSettings;
