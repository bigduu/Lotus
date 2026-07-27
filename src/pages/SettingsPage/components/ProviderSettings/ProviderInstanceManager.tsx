import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
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
  Switch,
  Tooltip,
  Modal,
  Popconfirm,
} from "antd";
import {
  KeyOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  StarOutlined,
  StarFilled,
  LoginOutlined,
} from "@ant-design/icons";
import { settingsService } from "@services/config/SettingsService";
import { isAntdFormError } from "@shared/utils/formError";
import { configErrorMessage } from "@shared/utils/configErrors";
import type {
  ProviderType,
  ProviderInstance,
  CreateProviderInstanceRequest,
  UpdateProviderInstanceRequest,
} from "@shared/types/providerConfig";
import type { ProviderCredentialStatus } from "@services/config/configSections";
import { PROVIDER_LABELS } from "@shared/types/providerConfig";
import { PROVIDER_VENDOR_PRESETS } from "@shared/constants/providerPresets";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { ReasoningEffort } from "@services/chat/AgentService";
import { DeviceCodeModal } from "./DeviceCodeModal";
import { sanitizeInstanceConfigForForm } from "./providerInstanceUtils";
import { copyText } from "@shared/utils/clipboard";
import type { DeviceCodeInfo } from "./DeviceCodeModal";
import { theme } from "antd";
import { reapplyConfigChanges } from "@shared/hooks/useConfigSectionDraft";
import { ProviderCredentialStatusTag } from "./ProviderCredentialStatusTag";
import { isEnvironmentCredential } from "./providerCredentialStatus";

const { Password } = Input;
const { Text, Paragraph } = Typography;

const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];

const renderReasoningEffortSelect = (
  t: TFunction,
  props?: {
    value?: ReasoningEffort;
    onChange?: (value?: ReasoningEffort) => void;
    disabled?: boolean;
    size?: "small" | "middle" | "large";
    style?: React.CSSProperties;
  },
) => (
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
  >
    {REASONING_EFFORT_OPTIONS.map((option) => (
      <Select.Option key={option} value={option}>
        {t(`chat.input.reasoning.${option}`)}
      </Select.Option>
    ))}
  </Select>
);

const renderResponsesOnlyModelsField = (t: TFunction) => (
  <Form.Item
    name="responses_only_models"
    label={t("settings.providerTab.responsesOnlyModelsOptional")}
    extra={
      <>
        <div>{t("settings.providerTab.responsesOnlyHelp1")}</div>
        <div>{t("settings.providerTab.responsesOnlyHelp2")}</div>
      </>
    }
  >
    <Select
      mode="tags"
      tokenSeparators={[",", " ", "\n", "\t"]}
      placeholder={t("settings.providerTab.responsesOnlyModelsPlaceholder")}
      allowClear
    />
  </Form.Item>
);

const normalizeResponsesOnlyModels = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item): item is string => Boolean(item));
};

const withoutInstanceCredential = (
  values: Record<string, unknown> | null,
): Record<string, unknown> | null => {
  if (!values) return null;
  const safe = structuredClone(values);
  delete safe.api_key;
  delete safe.api_key_encrypted;
  return safe;
};

const REQUEST_OVERRIDES_PLACEHOLDER = `{
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

/**
 * Advanced request-overrides JSON textarea, shared across every provider
 * type in the instance modal. Mirrors the legacy single-provider tab's
 * field (`ProviderSettings/index.tsx` `renderRequestOverridesEditor`) —
 * same i18n keys, same monospace textarea, same "advanced" placement
 * behind a dashed divider at the end of the type-specific fields.
 */
const renderInstanceRequestOverridesField = (t: TFunction) => (
  <>
    <Divider dashed />
    <Form.Item
      name="request_overrides_json"
      label={t("settings.providerTab.advancedRequestOverrides")}
      extra={
        <Space direction="vertical" size={4}>
          <Text type="secondary">{t("settings.providerTab.advancedRequestOverridesHelp")}</Text>
          <Text type="secondary">
            {t("settings.providerTab.envVarInjection")}{" "}
            <Text code>{`{ "type": "env_ref", "name": "YOUR_ENV_NAME" }`}</Text>
          </Text>
        </Space>
      }
    >
      <Input.TextArea
        autoSize={{ minRows: 6, maxRows: 16 }}
        placeholder={REQUEST_OVERRIDES_PLACEHOLDER}
        style={{ fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
        data-testid="request-overrides-textarea"
      />
    </Form.Item>
  </>
);

/**
 * Renders config form fields for a provider type.
 * Used by the instance create/edit modal.
 */
const InstanceConfigFields: React.FC<{
  form: ReturnType<typeof Form.useForm>[0];
  type?: ProviderType;
  /** Editing an instance that already has a stored key: field stays empty, empty = keep. */
  hasStoredApiKey?: boolean;
}> = ({ type, hasStoredApiKey }) => {
  const { t } = useTranslation();

  if (!type) return null;

  const apiKeyRules = (requiredMessage: string) =>
    hasStoredApiKey ? [] : [{ required: true, message: requiredMessage }];
  const apiKeyPlaceholder = (defaultPlaceholder: string) =>
    hasStoredApiKey
      ? t("settings.providerTab.apiKeyKeepPlaceholder", "Configured — leave empty to keep")
      : defaultPlaceholder;

  switch (type) {
    case "openai":
      return (
        <>
          <Form.Item
            name="api_key"
            label={t("settings.providerTab.openaiApiKey")}
            rules={apiKeyRules(t("settings.providerTab.openaiApiKeyRequired"))}
          >
            <Input.Password
              placeholder={apiKeyPlaceholder(
                t("settings.providerTab.openaiApiKeyPlaceholder", "sk-..."),
              )}
              prefix={<KeyOutlined />}
              data-testid="instance-api-key-input"
            />
          </Form.Item>
          <Form.Item
            name="base_url"
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
            name="reasoning_effort"
            label={t("settings.providerTab.reasoningEffortOptional")}
            extra={t("settings.providerTab.reasoningEffortHelp")}
          >
            {renderReasoningEffortSelect(t)}
          </Form.Item>
          {renderResponsesOnlyModelsField(t)}
          {renderInstanceRequestOverridesField(t)}
        </>
      );
    case "anthropic":
      return (
        <>
          <Form.Item
            name="api_key"
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
            name="base_url"
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
            name="max_tokens"
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
            name="reasoning_effort"
            label={t("settings.providerTab.reasoningEffortOptional")}
            extra={t("settings.providerTab.reasoningEffortHelp")}
          >
            {renderReasoningEffortSelect(t)}
          </Form.Item>
          {renderInstanceRequestOverridesField(t)}
        </>
      );
    case "gemini":
      return (
        <>
          <Form.Item
            name="api_key"
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
            name="base_url"
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
            name="reasoning_effort"
            label={t("settings.providerTab.reasoningEffortOptional")}
            extra={t("settings.providerTab.reasoningEffortHelp")}
          >
            {renderReasoningEffortSelect(t)}
          </Form.Item>
          {renderInstanceRequestOverridesField(t)}
        </>
      );
    case "copilot":
      return (
        <>
          <Form.Item
            name="headless_auth"
            label={t("settings.providerTab.headlessAuth")}
            valuePropName="checked"
            extra={t("settings.providerTab.headlessAuthHelp")}
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="reasoning_effort"
            label={t("settings.providerTab.reasoningEffortOptional")}
            extra={t("settings.providerTab.reasoningEffortHelp")}
          >
            {renderReasoningEffortSelect(t)}
          </Form.Item>
          {renderResponsesOnlyModelsField(t)}
          {renderInstanceRequestOverridesField(t)}
        </>
      );
    case "bodhi":
      return (
        <>
          <Form.Item
            name="api_key"
            label={t("settings.providerTab.bodhiApiKey")}
            rules={apiKeyRules(t("settings.providerTab.apiKeyRequired"))}
          >
            <Input.Password
              placeholder={apiKeyPlaceholder(
                t("settings.providerTab.bodhiApiKeyPlaceholder", "bhi_sk_..."),
              )}
              prefix={<KeyOutlined />}
            />
          </Form.Item>
          <Form.Item
            name="base_url"
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
            name="target_provider"
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
            name="reasoning_effort"
            label={t("settings.providerTab.reasoningEffortOptional")}
            extra={t("settings.providerTab.reasoningEffortHelp")}
          >
            {renderReasoningEffortSelect(t)}
          </Form.Item>
          {renderInstanceRequestOverridesField(t)}
        </>
      );
    default:
      return null;
  }
};

/**
 * ProviderInstanceManager
 *
 * Manages provider instances in multi-instance mode.
 * Renders a list of instances with create/edit/delete/set-default actions.
 */
export const ProviderInstanceManager: React.FC<{
  instances: ProviderInstance[];
  latestInstances: ProviderInstance[];
  defaultInstanceId: string | null;
  currentRevision: number | null;
  credentialStatusById: Record<string, ProviderCredentialStatus>;
  onCreateInstance: (
    request: CreateProviderInstanceRequest,
    expectedRevision: number,
  ) => Promise<void>;
  onUpdateInstance: (
    instanceId: string,
    request: UpdateProviderInstanceRequest,
    expectedRevision: number,
  ) => Promise<void>;
  onDeleteInstance: (instanceId: string, expectedRevision: number) => Promise<void>;
  onSetDefaultInstance: (instanceId: string, expectedRevision: number) => Promise<void>;
  onClearInstanceCredential: (instanceId: string, expectedRevision: number) => Promise<void>;
}> = ({
  instances,
  latestInstances,
  defaultInstanceId,
  currentRevision,
  credentialStatusById,
  onCreateInstance,
  onUpdateInstance,
  onDeleteInstance,
  onSetDefaultInstance,
  onClearInstanceCredential,
}) => {
  const { t } = useTranslation();
  const { message, modal } = AntApp.useApp();
  const { token } = theme.useToken();
  const [instanceForm] = Form.useForm();

  const [instanceModalOpen, setInstanceModalOpen] = useState(false);
  const [editingInstance, setEditingInstance] = useState<ProviderInstance | null>(null);
  const [savingInstance, setSavingInstance] = useState(false);
  const [deletingInstanceId, setDeletingInstanceId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<ProviderType | undefined>(undefined);
  const [selectedPresetId, setSelectedPresetId] = useState<string | undefined>(undefined);
  const [modalBaseRevision, setModalBaseRevision] = useState<number | null>(null);
  const [modalDirty, setModalDirty] = useState(false);
  const baseInstanceFormRef = useRef<Record<string, unknown> | null>(null);

  // ── Copilot auth state ─────────────────────────────────
  const [deviceCodeInfo, setDeviceCodeInfo] = useState<DeviceCodeInfo | null>(null);
  const [isDeviceCodeModalVisible, setIsDeviceCodeModalVisible] = useState(false);
  const [completingAuth, setCompletingAuth] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [copiedUserCode, setCopiedUserCode] = useState(false);
  const [authenticatingCopilot, setAuthenticatingCopilot] = useState(false);
  const [copilotAuthStatus, setCopilotAuthStatus] = useState<
    "unknown" | "authenticated" | "not_authenticated"
  >("unknown");
  const [checkingCopilotAuth, setCheckingCopilotAuth] = useState(false);

  const buildInstanceFormValues = useCallback((instance: ProviderInstance) => {
    // `request_overrides` is represented in the form as a separate
    // stringified `request_overrides_json` textarea field (see
    // `renderInstanceRequestOverridesField`), never as the raw object —
    // leaving the raw key in the form values would let a stale copy of it
    // survive into the save payload even after the textarea is cleared.
    const {
      request_overrides,
      api_key: _apiKey,
      ...config
    } = sanitizeInstanceConfigForForm(instance.config as Record<string, unknown> | undefined);
    const values: Record<string, unknown> = {
      type: instance.type,
      label: instance.label,
      enabled: instance.enabled,
      ...config,
    };
    if (request_overrides && typeof request_overrides === "object") {
      values.request_overrides_json = JSON.stringify(request_overrides, null, 2);
    }
    return values;
  }, []);

  const handleOpenCreate = useCallback(() => {
    setEditingInstance(null);
    setSelectedType(undefined);
    setSelectedPresetId(undefined);
    setModalBaseRevision(currentRevision);
    setModalDirty(false);
    baseInstanceFormRef.current = { enabled: true };
    setInstanceModalOpen(true);
  }, [currentRevision]);

  /**
   * Applies a vendor preset to the form: pre-fills provider type + base URL
   * (and the label when it is still empty). The preset itself is UI-only
   * state and is never persisted. Clearing the select changes nothing.
   */
  const handleVendorPresetChange = useCallback(
    (presetId?: string) => {
      setSelectedPresetId(presetId);
      if (!presetId) return;
      const preset = PROVIDER_VENDOR_PRESETS.find((item) => item.id === presetId);
      if (!preset) return;
      setModalDirty(true);

      const patch: Record<string, unknown> = { base_url: preset.base_url };
      // The provider type is immutable while editing an existing instance
      // (the type select is disabled and updates never change `type`), so
      // only overwrite it when creating a new instance.
      if (!editingInstance) {
        patch.type = preset.provider_type;
        setSelectedType(preset.provider_type);
      }
      const currentLabel: unknown = instanceForm.getFieldValue("label");
      if (typeof currentLabel !== "string" || !currentLabel.trim()) {
        patch.label = preset.label;
      }
      instanceForm.setFieldsValue(patch);
    },
    [editingInstance, instanceForm],
  );

  // ── Copilot auth handlers ─────────────────────────────
  const handleCopilotAuthenticate = async () => {
    try {
      setAuthenticatingCopilot(true);
      const deviceCode = await settingsService.startCopilotAuth();
      setDeviceCodeInfo(deviceCode);
      setIsDeviceCodeModalVisible(true);
      setTimeRemaining(deviceCode.expires_in);
    } catch (error) {
      message.error(
        t("settings.providerTab.startCopilotAuthFailed", "Failed to start Copilot authentication"),
      );
      console.error(
        "Failed to start Copilot authentication:",
        configErrorMessage(error, "Failed to start Copilot authentication"),
      );
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
      message.success(
        t("settings.providerTab.copilotAuthSuccess", "Copilot authentication successful!"),
      );
      setIsDeviceCodeModalVisible(false);
      setDeviceCodeInfo(null);
      await checkCopilotAuthStatus();
    } catch (error) {
      message.error(
        t("settings.providerTab.completeAuthFailed", "Authentication completion failed"),
      );
      console.error(
        "Authentication completion failed:",
        configErrorMessage(error, "Authentication completion failed"),
      );
    } finally {
      setCompletingAuth(false);
    }
  };

  const handleCopyUserCode = async () => {
    if (deviceCodeInfo) {
      try {
        await copyText(deviceCodeInfo.user_code);
        setCopiedUserCode(true);
        message.success(t("settings.providerTab.userCodeCopied", "User code copied!"));
        setTimeout(() => setCopiedUserCode(false), 2000);
      } catch {
        message.error(t("settings.providerTab.copyCodeFailed", "Failed to copy code"));
      }
    }
  };

  const checkCopilotAuthStatus = useCallback(async () => {
    try {
      setCheckingCopilotAuth(true);
      const status = await settingsService.getCopilotAuthStatus();
      setCopilotAuthStatus(status.authenticated ? "authenticated" : "not_authenticated");
    } catch (error) {
      console.error(
        "Failed to check Copilot auth status:",
        configErrorMessage(error, "Failed to check Copilot authentication status"),
      );
      setCopilotAuthStatus("unknown");
    } finally {
      setCheckingCopilotAuth(false);
    }
  }, []);

  useEffect(() => {
    if (instanceModalOpen && selectedType === "copilot") {
      void checkCopilotAuthStatus();
    }
  }, [checkCopilotAuthStatus, instanceModalOpen, selectedType]);

  const handleInstanceModalOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        instanceForm.resetFields();
        setModalDirty(false);
        setModalBaseRevision(null);
        baseInstanceFormRef.current = null;
        return;
      }

      if (editingInstance) {
        const values = buildInstanceFormValues(editingInstance);
        instanceForm.setFieldsValue(values);
        baseInstanceFormRef.current = structuredClone(values);
        setSelectedType(editingInstance.type);
        return;
      }

      const values = { enabled: true };
      instanceForm.setFieldsValue(values);
      baseInstanceFormRef.current = structuredClone(values);
    },
    [buildInstanceFormValues, editingInstance, instanceForm],
  );

  const renderCopilotAuthCard = (buttonSize: "small" | "middle" | "large" = "small") => (
    <Card
      size="small"
      title={t("settings.providerTab.copilotAuth", "GitHub Copilot Authentication")}
      style={{ marginTop: 8 }}
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <Space>
          <Text strong>{t("settings.providerTab.authStatus", "Status:")}</Text>
          {copilotAuthStatus === "authenticated" ? (
            <Tag color="success">{t("settings.providerTab.authenticated", "Authenticated")}</Tag>
          ) : copilotAuthStatus === "not_authenticated" ? (
            <Tag color="warning">
              {t("settings.providerTab.notAuthenticated", "Not Authenticated")}
            </Tag>
          ) : (
            <Tag>{t("settings.providerTab.unknown", "Unknown")}</Tag>
          )}
          <Button
            type="text"
            size="small"
            onClick={() => void checkCopilotAuthStatus()}
            loading={checkingCopilotAuth}
          >
            {t("settings.providerTab.refreshStatus", "Refresh")}
          </Button>
        </Space>

        <Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {t(
            "settings.providerTab.copilotAuthHelp",
            "Copilot requires OAuth authentication. Click the button below to start the Device Code Flow.",
          )}
        </Paragraph>

        <Button
          type="primary"
          icon={<LoginOutlined />}
          onClick={() => void handleCopilotAuthenticate()}
          loading={authenticatingCopilot}
          size={buttonSize}
        >
          {t("settings.providerTab.authenticateCopilot", "Authenticate Copilot")}
        </Button>
      </Space>
    </Card>
  );

  const handleOpenEdit = useCallback(
    (instance: ProviderInstance) => {
      setEditingInstance(instance);
      setSelectedType(instance.type);
      setSelectedPresetId(undefined);
      setModalBaseRevision(currentRevision);
      setModalDirty(false);
      baseInstanceFormRef.current = structuredClone(buildInstanceFormValues(instance));
      setInstanceModalOpen(true);
    },
    [buildInstanceFormValues, currentRevision],
  );

  const latestEditingInstance = editingInstance
    ? (latestInstances.find((instance) => instance.id === editingInstance.id) ?? null)
    : null;
  const externalRevision =
    instanceModalOpen &&
    modalBaseRevision !== null &&
    currentRevision !== null &&
    currentRevision !== modalBaseRevision
      ? currentRevision
      : null;

  const adoptLatestInstanceForm = useCallback(
    (keepDraft: boolean) => {
      if (currentRevision === null) return false;

      const latestValues = editingInstance
        ? latestEditingInstance
          ? buildInstanceFormValues(latestEditingInstance)
          : null
        : { enabled: true };
      if (!latestValues) {
        message.warning(
          t(
            "settings.providerTab.instanceRemovedExternally",
            "This provider instance no longer exists in the latest configuration.",
          ),
        );
        return false;
      }

      const currentDraft = instanceForm.getFieldsValue(true) as Record<string, unknown>;
      const nextValues =
        keepDraft && baseInstanceFormRef.current
          ? reapplyConfigChanges(baseInstanceFormRef.current, currentDraft, latestValues)
          : latestValues;

      instanceForm.setFieldsValue(
        Object.fromEntries(Object.keys(currentDraft).map((key) => [key, undefined])),
      );
      instanceForm.setFieldsValue(nextValues);
      setSelectedType(nextValues.type as ProviderType | undefined);
      if (latestEditingInstance) setEditingInstance(latestEditingInstance);
      baseInstanceFormRef.current = structuredClone(latestValues);
      setModalBaseRevision(currentRevision);
      setModalDirty(keepDraft);
      return true;
    },
    [
      buildInstanceFormValues,
      currentRevision,
      editingInstance,
      instanceForm,
      latestEditingInstance,
      message,
      t,
    ],
  );

  useEffect(() => {
    if (externalRevision === null || modalDirty) return;
    adoptLatestInstanceForm(false);
  }, [adoptLatestInstanceForm, externalRevision, modalDirty]);

  const compareInstanceDraft = useCallback(() => {
    if (
      externalRevision === null ||
      modalBaseRevision === null ||
      baseInstanceFormRef.current === null
    ) {
      return;
    }

    const latestValues = editingInstance
      ? latestEditingInstance
        ? buildInstanceFormValues(latestEditingInstance)
        : null
      : { enabled: true };
    modal.info({
      title: t("settings.providerTab.compareChanges", "Compare changes"),
      width: 720,
      content: (
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Text>
            {t("settings.providerTab.compareRevision", {
              loaded: modalBaseRevision,
              latest: externalRevision,
            })}
          </Text>
          <pre style={{ maxHeight: 320, overflow: "auto", whiteSpace: "pre-wrap" }}>
            {JSON.stringify(
              {
                base: withoutInstanceCredential(baseInstanceFormRef.current),
                draft: withoutInstanceCredential(
                  instanceForm.getFieldsValue(true) as Record<string, unknown>,
                ),
                latest: withoutInstanceCredential(latestValues),
                credential: editingInstance
                  ? (credentialStatusById[editingInstance.id] ?? null)
                  : null,
              },
              null,
              2,
            )}
          </pre>
        </Space>
      ),
    });
  }, [
    buildInstanceFormValues,
    credentialStatusById,
    editingInstance,
    externalRevision,
    instanceForm,
    latestEditingInstance,
    modal,
    modalBaseRevision,
    t,
  ]);

  const handleSaveInstance = useCallback(async () => {
    try {
      const values = await instanceForm.validateFields();
      if (modalBaseRevision === null) {
        throw new Error(
          t(
            "settings.providerTab.providerRevisionMissing",
            "Provider revision is not loaded. Reload the configuration and try again.",
          ),
        );
      }
      setSavingInstance(true);

      const { type, label, enabled, request_overrides_json, ...configFields } = values;
      const config: Record<string, unknown> = sanitizeInstanceConfigForForm(configFields);

      if ("responses_only_models" in config) {
        config.responses_only_models = normalizeResponsesOnlyModels(config.responses_only_models);
      }

      if (typeof request_overrides_json === "string" && request_overrides_json.trim()) {
        try {
          config.request_overrides = JSON.parse(request_overrides_json);
        } catch (parseError) {
          const messageText = t("settings.providerTab.invalidRequestOverridesJson", {
            provider: PROVIDER_LABELS[type as ProviderType] || type,
            error: (parseError as Error).message,
          });
          instanceForm.setFields([{ name: "request_overrides_json", errors: [messageText] }]);
          message.error(messageText);
          return;
        }
      }

      // Empty api_key while editing means "keep the stored key" — omit the
      // field entirely (an empty string would fail backend validation).
      if (editingInstance && (typeof config.api_key !== "string" || !config.api_key.trim())) {
        delete config.api_key;
      }

      if (editingInstance) {
        const updateReq: UpdateProviderInstanceRequest = { label, enabled, config };
        await onUpdateInstance(editingInstance.id, updateReq, modalBaseRevision);
        message.success(t("settings.providerTab.instanceUpdated", "Provider instance updated"));
      } else {
        const createReq: CreateProviderInstanceRequest = {
          type,
          label: label || PROVIDER_LABELS[type as ProviderType] || type,
          enabled: enabled ?? true,
          config,
        };
        await onCreateInstance(createReq, modalBaseRevision);
        message.success(t("settings.providerTab.instanceCreated", "Provider instance created"));
      }

      setInstanceModalOpen(false);
      await useProviderStore.getState().loadProviderInstances();
    } catch (error) {
      if (!isAntdFormError(error)) {
        message.error(
          configErrorMessage(
            error,
            t("settings.providerTab.saveConfigFailed", "Failed to save provider instance"),
          ),
        );
      }
    } finally {
      setSavingInstance(false);
    }
  }, [
    editingInstance,
    instanceForm,
    message,
    modalBaseRevision,
    onCreateInstance,
    onUpdateInstance,
    t,
  ]);

  const handleDeleteInstance = useCallback(
    async (instanceId: string) => {
      try {
        if (currentRevision === null) {
          throw new Error(
            t(
              "settings.providerTab.providerRevisionMissing",
              "Provider revision is not loaded. Reload the configuration and try again.",
            ),
          );
        }
        setDeletingInstanceId(instanceId);
        await onDeleteInstance(instanceId, currentRevision);
        message.success(t("settings.providerTab.instanceDeleted", "Provider instance deleted"));
        await useProviderStore.getState().loadProviderInstances();
      } catch (error) {
        message.error(
          configErrorMessage(
            error,
            t("settings.providerTab.instanceDeleteFailed", "Failed to delete instance"),
          ),
        );
      } finally {
        setDeletingInstanceId(null);
      }
    },
    [currentRevision, onDeleteInstance, message, t],
  );

  const handleSetDefaultInstance = useCallback(
    async (instanceId: string) => {
      try {
        if (currentRevision === null) {
          throw new Error(
            t(
              "settings.providerTab.providerRevisionMissing",
              "Provider revision is not loaded. Reload the configuration and try again.",
            ),
          );
        }
        await onSetDefaultInstance(instanceId, currentRevision);
        message.success(t("settings.providerTab.defaultInstanceSet", "Default provider updated"));
        await useProviderStore.getState().loadProviderInstances();
      } catch (error) {
        message.error(
          configErrorMessage(
            error,
            t("settings.providerTab.defaultInstanceFailed", "Failed to set default"),
          ),
        );
      }
    },
    [currentRevision, onSetDefaultInstance, message, t],
  );

  const handleClearInstanceCredential = useCallback(async () => {
    if (!editingInstance) return;
    try {
      if (modalBaseRevision === null) {
        throw new Error(
          t(
            "settings.providerTab.providerRevisionMissing",
            "Provider revision is not loaded. Reload the configuration and try again.",
          ),
        );
      }
      setSavingInstance(true);
      await onClearInstanceCredential(editingInstance.id, modalBaseRevision);
      message.success(t("settings.providerTab.credentialCleared", "Provider credential cleared"));
      setInstanceModalOpen(false);
      await useProviderStore.getState().loadProviderInstances();
    } catch (error) {
      message.error(
        configErrorMessage(
          error,
          t("settings.providerTab.credentialClearFailed", "Failed to clear credential"),
        ),
      );
    } finally {
      setSavingInstance(false);
    }
  }, [editingInstance, message, modalBaseRevision, onClearInstanceCredential, t]);

  const selectedPreset = PROVIDER_VENDOR_PRESETS.find((item) => item.id === selectedPresetId);

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          marginBottom: 12,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text strong>{t("settings.providerTab.providerInstances", "Provider Instances")}</Text>
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          onClick={handleOpenCreate}
          data-testid="add-provider-instance"
        >
          {t("settings.providerTab.addInstance", "Add Provider")}
        </Button>
      </div>

      {instances.length === 0 && (
        <Paragraph type="secondary">
          {t(
            "settings.providerTab.noInstances",
            'No provider instances configured. Click "Add Provider" to create one.',
          )}
        </Paragraph>
      )}

      <Collapse
        ghost
        items={instances.map((instance) => {
          const isDefault = instance.id === defaultInstanceId;
          const typeLabel = PROVIDER_LABELS[instance.type] || instance.type;
          const credentialStatus = credentialStatusById[instance.id];
          return {
            key: instance.id,
            label: (
              <Space size="small">
                <span style={{ fontWeight: 500 }}>{instance.label || typeLabel}</span>
                <Tag color="processing" style={{ fontSize: 11 }}>
                  {typeLabel}
                </Tag>
                {instance.type !== "copilot" ? (
                  <ProviderCredentialStatusTag status={credentialStatus} />
                ) : null}
                {isDefault && (
                  <Tag color="gold" style={{ fontSize: 11 }}>
                    <StarFilled /> {t("settings.providerTab.default", "Default")}
                  </Tag>
                )}
                {!instance.enabled && (
                  <Tag color="default" style={{ fontSize: 11 }}>
                    {t("settings.providerTab.disabled", "Disabled")}
                  </Tag>
                )}
              </Space>
            ),
            extra: (
              <Space size={4} onClick={(e) => e.stopPropagation()}>
                {!isDefault && (
                  <Tooltip title={t("settings.providerTab.setDefault", "Set as default")}>
                    <Button
                      type="text"
                      size="small"
                      icon={<StarOutlined />}
                      onClick={() => void handleSetDefaultInstance(instance.id)}
                    />
                  </Tooltip>
                )}
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={() => handleOpenEdit(instance)}
                  data-testid={`edit-provider-instance-${instance.id}`}
                />
                <Popconfirm
                  title={t(
                    "settings.providerTab.confirmDeleteInstance",
                    "Delete this provider instance?",
                  )}
                  onConfirm={() => void handleDeleteInstance(instance.id)}
                  okText={t("settings.providerTab.delete", "Delete")}
                  cancelText={t("settings.providerTab.cancel", "Cancel")}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    loading={deletingInstanceId === instance.id}
                  />
                </Popconfirm>
              </Space>
            ),
            children: (
              <div>
                <Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  ID: <Text code>{instance.id}</Text> · Type: <Text code>{instance.type}</Text>
                </Paragraph>
                {instance.config && Object.keys(instance.config).length > 0 && (
                  <Card size="small" style={{ marginBottom: 8 }}>
                    {Object.entries(instance.config).map(([key, value]) => {
                      if (
                        key === "api_key" ||
                        key === "api_key_encrypted" ||
                        key === "credential_ref"
                      )
                        return null;
                      return (
                        <div key={key} style={{ marginBottom: 4 }}>
                          <Text type="secondary">{key}: </Text>
                          <Text>
                            {typeof value === "object" ? JSON.stringify(value) : String(value)}
                          </Text>
                        </div>
                      );
                    })}
                  </Card>
                )}
                {instance.type === "copilot" && renderCopilotAuthCard("small")}
              </div>
            ),
          };
        })}
      />

      {/* Create/Edit Instance Modal */}
      <Modal
        open={instanceModalOpen}
        title={
          editingInstance
            ? t("settings.providerTab.editInstance", "Edit Provider Instance")
            : t("settings.providerTab.createInstance", "Create Provider Instance")
        }
        onCancel={() => setInstanceModalOpen(false)}
        onOk={() => void handleSaveInstance()}
        afterOpenChange={handleInstanceModalOpenChange}
        confirmLoading={savingInstance}
        width={560}
        forceRender
        destroyOnClose
      >
        {externalRevision !== null && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={t(
              "settings.providerTab.externalRevisionTitle",
              "Provider settings changed externally",
            )}
            description={t("settings.providerTab.externalRevisionDescription", {
              loaded: modalBaseRevision,
              latest: externalRevision,
            })}
            action={
              <Space wrap>
                <Button size="small" onClick={() => adoptLatestInstanceForm(false)}>
                  {t("settings.providerTab.reloadLatest", "Reload latest")}
                </Button>
                <Button size="small" onClick={compareInstanceDraft}>
                  {t("settings.providerTab.compareChanges", "Compare changes")}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  onClick={() => {
                    if (adoptLatestInstanceForm(true)) {
                      message.info(
                        t(
                          "settings.providerTab.draftReapplied",
                          "Local draft reapplied to the latest revision",
                        ),
                      );
                    }
                  }}
                >
                  {t("settings.providerTab.reapplyDraft", "Reapply local draft")}
                </Button>
              </Space>
            }
          />
        )}
        <Form
          form={instanceForm}
          layout="vertical"
          preserve={false}
          onValuesChange={() => setModalDirty(true)}
        >
          <Form.Item
            label={t("settings.providerTab.vendorPreset", "Vendor Preset")}
            tooltip={t(
              "settings.providerTab.vendorPresetTooltip",
              "Prefills the provider type and base URL; the preset itself is not saved.",
            )}
            extra={
              selectedPreset && (
                <>
                  {selectedPreset.notes && <div>{selectedPreset.notes}</div>}
                  {selectedPreset.suggested_models.length > 0 && (
                    <div>
                      {t("settings.providerTab.vendorPresetModelsHint", {
                        defaultValue: "Popular models: {{models}}",
                        models: selectedPreset.suggested_models.join(", "),
                      })}
                    </div>
                  )}
                </>
              )
            }
          >
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder={t(
                "settings.providerTab.vendorPresetPlaceholder",
                "Select a vendor to prefill type and base URL",
              )}
              value={selectedPresetId}
              onChange={handleVendorPresetChange}
              options={PROVIDER_VENDOR_PRESETS.map((preset) => ({
                value: preset.id,
                label: preset.label,
              }))}
              data-testid="vendor-preset-select"
            />
          </Form.Item>

          <Form.Item
            name="type"
            label={t("settings.providerTab.providerType", "Provider Type")}
            rules={[
              {
                required: true,
                message: t("settings.providerTab.typeRequired", "Please select a provider type"),
              },
            ]}
          >
            <Select
              disabled={!!editingInstance}
              placeholder={t("settings.providerTab.selectType", "Select provider type")}
              onChange={(value: ProviderType) => setSelectedType(value)}
              data-testid="instance-type-select"
            >
              {(Object.entries(PROVIDER_LABELS) as [ProviderType, string][]).map(([key, label]) => (
                <Select.Option key={key} value={key}>
                  {label}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>

          <Form.Item
            name="label"
            label={t("settings.providerTab.instanceLabel", "Label")}
            extra={t("settings.providerTab.labelHelp", "A display name for this provider instance")}
          >
            <Input placeholder={t("settings.providerTab.labelPlaceholder", "My OpenAI Instance")} />
          </Form.Item>

          <Form.Item
            name="enabled"
            label={t("settings.providerTab.enabled", "Enabled")}
            valuePropName="checked"
            initialValue={true}
          >
            <Switch />
          </Form.Item>

          <Divider>{t("settings.providerTab.instanceConfig", "Configuration")}</Divider>

          {editingInstance && editingInstance.type !== "copilot" ? (
            <Space direction="vertical" size={4} style={{ marginBottom: 12 }}>
              <ProviderCredentialStatusTag status={credentialStatusById[editingInstance.id]} />
              {isEnvironmentCredential(credentialStatusById[editingInstance.id]) ? (
                <Text type="secondary">
                  {t(
                    "settings.providerTab.environmentCredentialHint",
                    "This credential comes from the environment. It remains read-only unless you explicitly replace it.",
                  )}
                </Text>
              ) : null}
            </Space>
          ) : null}

          <Form.Item noStyle shouldUpdate>
            {() => (
              <InstanceConfigFields
                form={instanceForm}
                type={selectedType}
                hasStoredApiKey={Boolean(
                  editingInstance && credentialStatusById[editingInstance.id]?.configured,
                )}
              />
            )}
          </Form.Item>

          {editingInstance &&
            editingInstance.type !== "copilot" &&
            credentialStatusById[editingInstance.id]?.configured &&
            !isEnvironmentCredential(credentialStatusById[editingInstance.id]) && (
              <Popconfirm
                title={t(
                  "settings.providerTab.confirmClearCredential",
                  "Clear the stored credential for this provider?",
                )}
                onConfirm={() => void handleClearInstanceCredential()}
                okText={t("settings.providerTab.clear", "Clear")}
                cancelText={t("settings.providerTab.cancel", "Cancel")}
              >
                <Button danger>
                  {t("settings.providerTab.clearCredential", "Clear stored credential")}
                </Button>
              </Popconfirm>
            )}

          {selectedType === "copilot" && renderCopilotAuthCard("middle")}
        </Form>
      </Modal>

      {/* Copilot Device Code Auth Modal */}
      <DeviceCodeModal
        open={isDeviceCodeModalVisible}
        onCancel={() => setIsDeviceCodeModalVisible(false)}
        onComplete={() => void handleCompleteAuth()}
        onCopyCode={() => void handleCopyUserCode()}
        completingAuth={completingAuth}
        copiedUserCode={copiedUserCode}
        deviceCodeInfo={deviceCodeInfo}
        timeRemaining={timeRemaining}
        token={token}
      />
    </div>
  );
};

export default ProviderInstanceManager;
