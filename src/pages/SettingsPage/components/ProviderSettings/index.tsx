import { debugLog } from "@shared/utils/debugFlags";
import React, { useCallback, useEffect, useState } from "react";
import {
  Form,
  Select,
  Input,
  Button,
  Card,
  Collapse,
  message,
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
  CopilotConfig,
} from "../../../ChatPage/types/providerConfig";
import { PROVIDER_LABELS } from "../../../ChatPage/types/providerConfig";
import {
  ServiceFactory,
  type BambooConfigValidationIssue,
} from "../../../../services/common/ServiceFactory";
import { copyText } from "@shared/utils/clipboard";
import { useTranslation } from "react-i18next";
import { CatalogModelSelect } from "./CatalogModelSelect";
import { useProviderStore } from "../../../ChatPage/store/slices/providerSlice";

const { Password } = Input;
const { Text, Paragraph } = Typography;

type ModelProvider = "openai" | "anthropic" | "gemini" | "copilot" | "bodhi";

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
  "bodhi",
] as const satisfies readonly ModelProvider[];

const renderResponsesOnlyModelsHelp = (t: (key: string) => string) => (
  <Space direction="vertical" size={4}>
    <Text type="secondary">
      {t("settings.providerTab.responsesOnlyHelp1")} <Text code>/responses</Text>.
    </Text>
    <Text type="secondary">{t("settings.providerTab.responsesOnlyHelp2")}</Text>
  </Space>
);

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
      const config: ProviderConfig = {
        provider: response.provider,
        providers: response.providers || {},
        features: response.features,
      };

      if (config.provider === "copilot") {
        const copilot = (config.providers.copilot ?? {}) as CopilotConfig & {
          request_overrides_json?: string;
        };
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
  }, [t]);

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

  const validateProviderPatch = async (values: ProviderConfig) => {
    const provider = (values.provider || currentProvider) as ProviderType;
    clearProviderValidationErrors(provider);
    try {
      const serviceFactory = ServiceFactory.getInstance();
      const result = await serviceFactory.validateBambooConfigPatch({
        provider: values.provider,
        providers: values.providers || {},
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
    values: ProviderConfig,
    options?: { showMessage?: boolean; throwOnError?: boolean },
  ) => {
    try {
      setLoading(true);
      const normalizedValues: ProviderConfig = {
        provider: values.provider,
        providers: { ...(values.providers || {}) },
        features: values.features,
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
              { name: ["providers", p, "request_overrides_json"], errors: [messageText] },
            ]);
            if (options?.showMessage !== false) message.error(messageText);
            if (options?.throwOnError) throw error;
            return;
          }
        }
        delete providerCfg.request_overrides_json;
      }

      const payload = {
        provider: normalizedValues.provider,
        providers: normalizedValues.providers || {},
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
      // Errors already shown
    }
  };

  // ── Auto-save model changes ──────────────────────────

  const handleModelChange = async (provider: ModelProvider, value: string | undefined) => {
    if (!value) return;
    if (modelAutoSaveStatus === "saving") return;
    setModelAutoSaveStatus("saving");
    setModelAutoSaveError(null);
    try {
      const currentValues = form.getFieldsValue(true) as ProviderConfig & {
        providers: EditableProviders;
      };
      const providers = (currentValues.providers || {}) as EditableProviders;
      const providerRecord = providers as EditableProviderRecord;
      providerRecord[provider] = { ...(providerRecord[provider] ?? {}), model: value };
      currentValues.providers = providers;
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

  const handleRoleModelChange = async (
    provider: ModelProvider,
    field: "fast_model" | "vision_model",
    value: string | undefined,
  ) => {
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
        [field]: value || undefined,
      };
      currentValues.providers = providers;
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

  // ── Render per-provider fields ───────────────────────

  const renderRoleModelFields = (provider: ModelProvider) => (
    <>
      <Form.Item
        name={["providers", provider, "fast_model"]}
        label={t("settings.providerTab.fastModel")}
        extra={<Text type="secondary">{t("settings.providerTab.fastModelHelp")}</Text>}
      >
        <CatalogModelSelect
          provider={provider}
          disabled={modelAutoSaveStatus === "saving"}
          placeholder={t("settings.providerTab.sameAsDefault")}
          onChange={(value) => handleRoleModelChange(provider, "fast_model", value)}
        />
      </Form.Item>
      <Form.Item
        name={["providers", provider, "vision_model"]}
        label={t("settings.providerTab.visionModel")}
        extra={<Text type="secondary">{t("settings.providerTab.visionModelHelp")}</Text>}
      >
        <CatalogModelSelect
          provider={provider}
          disabled={modelAutoSaveStatus === "saving"}
          placeholder={t("settings.providerTab.sameAsDefault")}
          onChange={(value) => handleRoleModelChange(provider, "vision_model", value)}
        />
      </Form.Item>
    </>
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
              name={["providers", "openai", "model"]}
              label={t("settings.providerTab.defaultModel")}
              rules={[{ required: true, message: t("settings.providerTab.selectModelRequired") }]}
            >
              <CatalogModelSelect
                provider="openai"
                disabled={modelAutoSaveStatus === "saving"}
                placeholder={t("settings.providerTab.selectModel")}
                onChange={(value) => handleModelChange("openai", value)}
              />
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
            {renderRoleModelFields("openai")}
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
              name={["providers", "anthropic", "model"]}
              label={t("settings.providerTab.defaultModel")}
              rules={[{ required: true, message: t("settings.providerTab.selectModelRequired") }]}
            >
              <CatalogModelSelect
                provider="anthropic"
                disabled={modelAutoSaveStatus === "saving"}
                placeholder={t("settings.providerTab.selectModel")}
                onChange={(value) => handleModelChange("anthropic", value)}
              />
            </Form.Item>
            <Form.Item
              name={["providers", "anthropic", "max_tokens"]}
              label={t("settings.providerTab.maxTokensOptional")}
              extra={t("settings.providerTab.maxTokensHelp")}
            >
              <Input type="number" placeholder="4096" min={1} max={100000} />
            </Form.Item>
            <Divider dashed />
            {renderRoleModelFields("anthropic")}
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
              name={["providers", "gemini", "model"]}
              label={t("settings.providerTab.defaultModel")}
              rules={[{ required: true, message: t("settings.providerTab.selectModelRequired") }]}
            >
              <CatalogModelSelect
                provider="gemini"
                disabled={modelAutoSaveStatus === "saving"}
                placeholder={t("settings.providerTab.selectModel")}
                onChange={(value) => handleModelChange("gemini", value)}
              />
            </Form.Item>
            <Divider dashed />
            {renderRoleModelFields("gemini")}
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
              name={["providers", "copilot", "model"]}
              label={t("settings.providerTab.defaultModel")}
              rules={[{ required: true, message: t("settings.providerTab.selectModelRequired") }]}
            >
              <CatalogModelSelect
                provider="copilot"
                disabled={modelAutoSaveStatus === "saving"}
                placeholder={t("settings.providerTab.selectModel")}
                onChange={(value) => handleModelChange("copilot", value)}
              />
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
            {renderRoleModelFields("copilot")}
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
              label="Reasoning Effort (optional)"
            >
              <Select placeholder="Default" allowClear>
                <Select.Option value="low">Low</Select.Option>
                <Select.Option value="medium">Medium</Select.Option>
                <Select.Option value="high">High</Select.Option>
                <Select.Option value="xhigh">Extra High</Select.Option>
                <Select.Option value="max">Max</Select.Option>
              </Select>
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
          <Select data-testid="provider-select" size="large">
            {(Object.keys(PROVIDER_LABELS) as ProviderType[]).map((key) => (
              <Select.Option key={key} value={key}>
                {PROVIDER_LABELS[key]}
              </Select.Option>
            ))}
          </Select>
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

        {/* All providers in collapsible panels */}
        <Collapse
          defaultActiveKey={MODEL_PROVIDERS.filter((p) => isProviderConfigured(p))}
          ghost
          style={{ marginBottom: 16 }}
        >
          {MODEL_PROVIDERS.map((provider) => (
            <Collapse.Panel key={provider} header={renderPanelHeader(provider)}>
              {renderProviderPanel(provider)}
            </Collapse.Panel>
          ))}
        </Collapse>

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
