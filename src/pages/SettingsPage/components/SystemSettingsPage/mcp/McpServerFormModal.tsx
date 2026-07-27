import { CodeOutlined, FormOutlined, MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  McpCredentialStatus,
  McpServerCredentialStatus,
} from "@services/config/configSections";
import {
  createDefaultMcpServerConfig,
  DEFAULT_HEALTHCHECK_INTERVAL_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SSE_CONNECT_TIMEOUT_MS,
  DEFAULT_STDIO_STARTUP_TIMEOUT_MS,
  type HeaderConfig,
  type McpServerConfig,
  type SseTransportConfig,
  type StdioTransportConfig,
  type StreamableHttpTransportConfig,
  type TransportConfig,
} from "@services/mcp";
import { configErrorMessage } from "@shared/utils/configErrors";

const { Text } = Typography;
const { TextArea } = Input;

type ModalMode = "create" | "edit";
type EditorMode = "form" | "json";

interface KeyValueEntry {
  key?: string;
  value?: string;
}

interface HeaderEntry {
  name?: string;
  value?: string;
}

interface McpServerFormValues {
  id: string;
  name?: string;
  enabled: boolean;
  transportType: TransportConfig["type"];
  command?: string;
  args: string[];
  envEntries: KeyValueEntry[];
  url?: string;
  headerEntries: HeaderEntry[];
  requestTimeoutMs: number;
  healthcheckIntervalMs: number;
  allowedTools: string[];
  deniedTools: string[];
}

interface McpServerFormModalProps {
  open: boolean;
  mode: ModalMode;
  initialConfig?: McpServerConfig | null;
  latestConfig?: McpServerConfig | null;
  currentRevision?: number | null;
  credentialStatus?: McpServerCredentialStatus;
  latestCredentialStatus?: McpServerCredentialStatus;
  confirmLoading?: boolean;
  onCancel: () => void;
  onSubmit: (config: McpServerConfig, expectedRevision?: number) => Promise<void> | void;
}

const emptyCredentialStatus = (): McpServerCredentialStatus => ({ env: {}, headers: {} });

const secretFreeConfig = (config: McpServerConfig | null | undefined): McpServerConfig | null => {
  if (!config) return null;
  return {
    ...config,
    transport:
      config.transport.type === "stdio"
        ? {
            ...config.transport,
            args: [...config.transport.args],
            env: Object.fromEntries(Object.keys(config.transport.env).map((name) => [name, ""])),
          }
        : {
            ...config.transport,
            headers: config.transport.headers.map((header) => ({
              ...header,
              value: "",
            })),
          },
    reconnect: config.reconnect ? { ...config.reconnect } : undefined,
    allowed_tools: [...config.allowed_tools],
    denied_tools: [...config.denied_tools],
  };
};

const toFormValues = (initialConfig: McpServerConfig | null | undefined): McpServerFormValues => {
  const config = initialConfig ?? createDefaultMcpServerConfig("");
  const transport = config.transport;

  const envEntries =
    transport.type === "stdio"
      ? Object.entries(transport.env ?? {}).map(([key, value]) => ({
          key,
          value,
        }))
      : [];

  const headerEntries =
    transport.type !== "stdio"
      ? transport.headers.map((header) => ({
          name: header.name,
          value: header.value,
        }))
      : [];

  return {
    id: config.id,
    name: config.name,
    enabled: config.enabled,
    transportType: transport.type,
    command: transport.type === "stdio" ? transport.command : undefined,
    args: transport.type === "stdio" ? transport.args : [],
    envEntries,
    url: transport.type !== "stdio" ? transport.url : undefined,
    headerEntries,
    requestTimeoutMs: config.request_timeout_ms || DEFAULT_REQUEST_TIMEOUT_MS,
    healthcheckIntervalMs: config.healthcheck_interval_ms || DEFAULT_HEALTHCHECK_INTERVAL_MS,
    allowedTools: config.allowed_tools || [],
    deniedTools: config.denied_tools || [],
  };
};

const entriesToRecord = (entries: KeyValueEntry[]): Record<string, string> => {
  return entries.reduce<Record<string, string>>((acc, entry) => {
    const key = entry.key?.trim();
    if (!key) {
      return acc;
    }
    acc[key] = entry.value ?? "";
    return acc;
  }, {});
};

const entriesToHeaders = (entries: HeaderEntry[]): HeaderConfig[] => {
  return entries
    .filter((entry) => entry.name?.trim())
    .map((entry) => ({
      name: entry.name?.trim() || "",
      value: entry.value ?? "",
    }));
};

const toServerConfig = (
  values: McpServerFormValues,
  mode: ModalMode,
  initialConfig: McpServerConfig | null | undefined,
): McpServerConfig => {
  const serverId = mode === "edit" ? initialConfig?.id || values.id : values.id;
  const trimmedName = values.name?.trim();

  // NOTE: The form currently doesn't expose every config field. When editing,
  // preserve any fields that are not present in the submitted form values to
  // avoid unintentionally resetting them to defaults.
  const preservedRequestTimeoutMs =
    typeof values.requestTimeoutMs === "number"
      ? values.requestTimeoutMs
      : (initialConfig?.request_timeout_ms ?? DEFAULT_REQUEST_TIMEOUT_MS);

  const preservedHealthcheckIntervalMs =
    typeof values.healthcheckIntervalMs === "number"
      ? values.healthcheckIntervalMs
      : (initialConfig?.healthcheck_interval_ms ?? DEFAULT_HEALTHCHECK_INTERVAL_MS);

  const preservedAllowedTools = Array.isArray(values.allowedTools)
    ? values.allowedTools
    : (initialConfig?.allowed_tools ?? []);

  const preservedDeniedTools = Array.isArray(values.deniedTools)
    ? values.deniedTools
    : (initialConfig?.denied_tools ?? []);

  let transport: TransportConfig;
  if (values.transportType === "sse") {
    transport = {
      type: "sse",
      url: values.url?.trim() || "",
      headers: entriesToHeaders(values.headerEntries || []),
      connect_timeout_ms:
        initialConfig?.transport.type === "sse"
          ? (initialConfig.transport.connect_timeout_ms ?? DEFAULT_SSE_CONNECT_TIMEOUT_MS)
          : DEFAULT_SSE_CONNECT_TIMEOUT_MS,
    } satisfies SseTransportConfig;
  } else if (values.transportType === "streamable_http") {
    transport = {
      type: "streamable_http",
      url: values.url?.trim() || "",
      headers: entriesToHeaders(values.headerEntries || []),
      connect_timeout_ms:
        initialConfig?.transport.type === "streamable_http"
          ? (initialConfig.transport.connect_timeout_ms ?? DEFAULT_SSE_CONNECT_TIMEOUT_MS)
          : DEFAULT_SSE_CONNECT_TIMEOUT_MS,
    } satisfies StreamableHttpTransportConfig;
  } else {
    transport = {
      type: "stdio",
      command: values.command?.trim() || "",
      args: values.args || [],
      env: entriesToRecord(values.envEntries || []),
      cwd: initialConfig?.transport.type === "stdio" ? initialConfig.transport.cwd : undefined,
      startup_timeout_ms:
        initialConfig?.transport.type === "stdio"
          ? (initialConfig.transport.startup_timeout_ms ?? DEFAULT_STDIO_STARTUP_TIMEOUT_MS)
          : DEFAULT_STDIO_STARTUP_TIMEOUT_MS,
    } satisfies StdioTransportConfig;
  }

  return {
    id: serverId,
    name: trimmedName || undefined,
    enabled: values.enabled,
    transport,
    request_timeout_ms: preservedRequestTimeoutMs,
    healthcheck_interval_ms: preservedHealthcheckIntervalMs,
    allowed_tools: preservedAllowedTools,
    denied_tools: preservedDeniedTools,
    reconnect: initialConfig?.reconnect,
  };
};

const formatJson = (config: McpServerConfig | null | undefined): string => {
  if (!config) {
    return JSON.stringify(createDefaultMcpServerConfig(""), null, 2);
  }
  return JSON.stringify(secretFreeConfig(config), null, 2);
};

const validateJson = (
  json: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): { valid: true; config: McpServerConfig } | { valid: false; error: string } => {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return {
        valid: false,
        error: t("settings.mcpServerForm.jsonMustBeObject"),
      };
    }

    const record = parsed as Record<string, unknown>;

    // Common user flow: paste Claude Desktop-style config.
    // Bulk import is not supported in this modal (single server only).
    if (record.mcpServers && typeof record.mcpServers === "object") {
      return {
        valid: false,
        error: t("settings.mcpServerForm.detectedBulkConfig"),
      };
    }

    const id = typeof record.id === "string" ? record.id : "";
    if (!id.trim()) {
      return {
        valid: false,
        error: t("settings.mcpServerForm.missingIdField"),
      };
    }

    // Preferred (internal) format
    if (record.transport && typeof record.transport === "object") {
      const config = record as unknown as McpServerConfig;
      if (!config.transport || typeof config.transport !== "object") {
        return {
          valid: false,
          error: t("settings.mcpServerForm.missingTransportField"),
        };
      }
      return { valid: true, config };
    }

    // Mainstream MCP format (Claude Desktop-style): command/args/env/cwd OR url/headers
    const enabled =
      typeof record.enabled === "boolean"
        ? record.enabled
        : typeof record.disabled === "boolean"
          ? !record.disabled
          : true;

    const request_timeout_ms =
      typeof record.request_timeout_ms === "number"
        ? record.request_timeout_ms
        : DEFAULT_REQUEST_TIMEOUT_MS;
    const healthcheck_interval_ms =
      typeof record.healthcheck_interval_ms === "number"
        ? record.healthcheck_interval_ms
        : DEFAULT_HEALTHCHECK_INTERVAL_MS;

    const allowed_tools = Array.isArray(record.allowed_tools)
      ? record.allowed_tools.filter((item): item is string => typeof item === "string")
      : [];
    const denied_tools = Array.isArray(record.denied_tools)
      ? record.denied_tools.filter((item): item is string => typeof item === "string")
      : [];

    const name = typeof record.name === "string" ? record.name : undefined;

    if (typeof record.url === "string") {
      const headersRaw = record.headers;
      const headers: HeaderConfig[] = Array.isArray(headersRaw)
        ? headersRaw
            .map((item) => {
              if (!item || typeof item !== "object") return null;
              const pair = item as Record<string, unknown>;
              const headerName = typeof pair.name === "string" ? pair.name : "";
              const headerValue = typeof pair.value === "string" ? pair.value : "";
              if (!headerName.trim()) return null;
              return { name: headerName, value: headerValue };
            })
            .filter((item): item is HeaderConfig => Boolean(item))
        : headersRaw && typeof headersRaw === "object"
          ? Object.entries(headersRaw as Record<string, unknown>)
              .filter(([key]) => key.trim())
              .map(([key, value]) => ({
                name: key,
                value: typeof value === "string" ? value : "",
              }))
          : [];

      const connect_timeout_ms =
        typeof record.connect_timeout_ms === "number"
          ? record.connect_timeout_ms
          : DEFAULT_SSE_CONNECT_TIMEOUT_MS;
      const transportType =
        record.transport_kind === "streamable_http" || record.type === "streamable_http"
          ? "streamable_http"
          : "sse";

      return {
        valid: true,
        config: {
          id,
          name,
          enabled,
          transport:
            transportType === "streamable_http"
              ? {
                  type: "streamable_http",
                  url: record.url,
                  headers,
                  connect_timeout_ms,
                }
              : {
                  type: "sse",
                  url: record.url,
                  headers,
                  connect_timeout_ms,
                },
          request_timeout_ms,
          healthcheck_interval_ms,
          allowed_tools,
          denied_tools,
          reconnect: undefined,
        },
      };
    }

    if (typeof record.command === "string") {
      const args = Array.isArray(record.args)
        ? record.args.filter((item): item is string => typeof item === "string")
        : [];

      const envRaw = record.env;
      const env =
        envRaw && typeof envRaw === "object"
          ? Object.entries(envRaw as Record<string, unknown>).reduce<Record<string, string>>(
              (acc, [key, value]) => {
                if (typeof value === "string") {
                  acc[key] = value;
                }
                return acc;
              },
              {},
            )
          : {};

      const startup_timeout_ms =
        typeof record.startup_timeout_ms === "number"
          ? record.startup_timeout_ms
          : DEFAULT_STDIO_STARTUP_TIMEOUT_MS;

      return {
        valid: true,
        config: {
          id,
          name,
          enabled,
          transport: {
            type: "stdio",
            command: record.command,
            args,
            cwd: typeof record.cwd === "string" ? record.cwd : undefined,
            env,
            startup_timeout_ms,
          },
          request_timeout_ms,
          healthcheck_interval_ms,
          allowed_tools,
          denied_tools,
          reconnect: undefined,
        },
      };
    }

    return {
      valid: false,
      error: t("settings.mcpServerForm.missingTransportInfo"),
    };
  } catch (e) {
    return {
      valid: false,
      error: t("settings.mcpServerForm.invalidJson", {
        message: e instanceof Error ? e.message : t("settings.mcpServerForm.unknownError"),
      }),
    };
  }
};

export const McpServerFormModal: React.FC<McpServerFormModalProps> = ({
  open,
  mode,
  initialConfig,
  latestConfig,
  currentRevision = null,
  credentialStatus,
  latestCredentialStatus,
  confirmLoading = false,
  onCancel,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const [form] = Form.useForm<McpServerFormValues>();
  const [editorMode, setEditorMode] = useState<EditorMode>("form");
  const [jsonValue, setJsonValue] = useState<string>("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [baseConfig, setBaseConfig] = useState<McpServerConfig | null>(null);
  const [activeCredentialStatus, setActiveCredentialStatus] =
    useState<McpServerCredentialStatus>(emptyCredentialStatus);
  const [showComparison, setShowComparison] = useState(false);
  const wasOpenRef = useRef(false);

  const transportType = Form.useWatch("transportType", form) ?? "stdio";
  const envEntries = Form.useWatch("envEntries", form) ?? [];
  const headerEntries = Form.useWatch("headerEntries", form) ?? [];

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;

    const capturedConfig = secretFreeConfig(initialConfig);
    setBaseConfig(capturedConfig);
    setBaseRevision(mode === "edit" ? currentRevision : null);
    setActiveCredentialStatus(credentialStatus ?? emptyCredentialStatus());
    form.setFieldsValue(toFormValues(capturedConfig));
    setJsonValue(formatJson(capturedConfig));
    setJsonError(null);
    setEditorMode("form");
    setShowComparison(false);
  }, [credentialStatus, currentRevision, form, initialConfig, mode, open]);

  const hasExternalRevision =
    mode === "edit" &&
    baseRevision !== null &&
    currentRevision !== null &&
    currentRevision > baseRevision;

  const getDraftConfig = (): McpServerConfig | null => {
    if (editorMode === "json") {
      const result = validateJson(jsonValue, t);
      return result.valid ? result.config : null;
    }
    return toServerConfig(form.getFieldsValue(true), mode, baseConfig);
  };

  const handleReloadLatest = () => {
    const nextConfig = secretFreeConfig(latestConfig);
    if (!nextConfig || currentRevision === null) return;
    setBaseConfig(nextConfig);
    setBaseRevision(currentRevision);
    setActiveCredentialStatus(latestCredentialStatus ?? emptyCredentialStatus());
    form.setFieldsValue(toFormValues(nextConfig));
    setJsonValue(formatJson(nextConfig));
    setJsonError(null);
    setShowComparison(false);
  };

  const handleReapplyDraft = () => {
    const nextConfig = secretFreeConfig(latestConfig);
    if (!nextConfig || currentRevision === null) return;
    setBaseConfig(nextConfig);
    setBaseRevision(currentRevision);
    setActiveCredentialStatus(latestCredentialStatus ?? emptyCredentialStatus());
    setShowComparison(false);
  };

  const handleCancel = () => {
    form.resetFields();
    setJsonValue("");
    setJsonError(null);
    setShowComparison(false);
    onCancel();
  };

  const handleOk = async () => {
    if (editorMode === "json") {
      const result = validateJson(jsonValue, t);
      if (!result.valid) {
        setJsonError(result.error);
        return;
      }
      setJsonError(null);
      try {
        if (mode === "edit") {
          await onSubmit(result.config, baseRevision ?? undefined);
        } else {
          await onSubmit(result.config);
        }
        setJsonValue("");
      } catch (error) {
        console.error(
          "MCP server JSON submission error:",
          configErrorMessage(error, "MCP server submission failed"),
        );
      }
      return;
    }

    try {
      const values = await form.validateFields();
      const config = toServerConfig(values, mode, baseConfig);
      if (mode === "edit") {
        await onSubmit(config, baseRevision ?? undefined);
      } else {
        await onSubmit(config);
      }
      form.resetFields();
    } catch (error) {
      console.error(
        "MCP server form submission error:",
        configErrorMessage(error, "MCP server submission failed"),
      );
    }
  };

  const handleJsonChange = (value: string) => {
    setJsonValue(value);
    if (jsonError) {
      const result = validateJson(value, t);
      if (result.valid) {
        setJsonError(null);
      }
    }
  };

  const switchMode = (newMode: EditorMode) => {
    if (newMode === "json") {
      // Sync form values to JSON
      try {
        const values = form.getFieldsValue();
        const config = toServerConfig(values, mode, baseConfig);
        setJsonValue(JSON.stringify(config, null, 2));
      } catch {
        setJsonValue(formatJson(baseConfig));
      }
    } else {
      // Sync JSON to form (if valid)
      const result = validateJson(jsonValue, t);
      if (result.valid) {
        form.setFieldsValue(toFormValues(result.config));
      }
    }
    setEditorMode(newMode);
    setJsonError(null);
  };

  const credentialDetails = (
    status: McpCredentialStatus | undefined,
    candidateValue: string | undefined,
  ) => {
    const fromEnvironment =
      status?.configured && (status.source === "environment" || status.source === "env");
    const statusLabel = fromEnvironment
      ? t("settings.mcpServerForm.credentialFromEnv")
      : status?.configured
        ? t("settings.mcpServerForm.credentialConfigured")
        : t("settings.mcpServerForm.credentialMissing");
    const actionLabel = candidateValue
      ? t("settings.mcpServerForm.credentialReplace")
      : status?.configured
        ? t("settings.mcpServerForm.credentialKeep")
        : t("settings.mcpServerForm.credentialMissingHelp");

    return (
      <Space size="small" wrap>
        <Tag color={status?.configured ? "success" : "warning"}>{statusLabel}</Tag>
        <Text type="secondary">{actionLabel}</Text>
      </Space>
    );
  };

  const credentialStatusLines = [
    ...Object.entries(activeCredentialStatus.env).map(([name, status]) => ({
      key: `env.${name}`,
      status,
    })),
    ...Object.entries(activeCredentialStatus.headers).map(([name, status]) => ({
      key: `headers.${name}`,
      status,
    })),
  ];

  const comparison = showComparison
    ? JSON.stringify(
        {
          baseRevision,
          latestRevision: currentRevision,
          base: secretFreeConfig(baseConfig),
          draft: secretFreeConfig(getDraftConfig()),
          latest: secretFreeConfig(latestConfig),
          credentialStatus: {
            base: activeCredentialStatus,
            latest: latestCredentialStatus ?? emptyCredentialStatus(),
          },
        },
        null,
        2,
      )
    : "";

  return (
    <Modal
      title={
        mode === "edit"
          ? t("settings.mcpServerForm.editTitle")
          : t("settings.mcpServerForm.addTitle")
      }
      open={open}
      onCancel={handleCancel}
      onOk={() => {
        void handleOk();
      }}
      okText={t("settings.mcpServerForm.save")}
      destroyOnClose
      forceRender
      confirmLoading={confirmLoading}
      width={720}
    >
      {hasExternalRevision ? (
        <Alert
          type="warning"
          showIcon
          message={t("settings.mcpServerForm.externalRevisionTitle")}
          description={t("settings.mcpServerForm.externalRevisionDescription", {
            loaded: baseRevision,
            latest: currentRevision,
          })}
          action={
            <Space wrap>
              <Button size="small" onClick={handleReloadLatest} disabled={!latestConfig}>
                {t("settings.mcpServerForm.reloadLatest")}
              </Button>
              <Button size="small" onClick={() => setShowComparison((visible) => !visible)}>
                {t("settings.mcpServerForm.compareChanges")}
              </Button>
              <Button size="small" onClick={handleReapplyDraft} disabled={!latestConfig}>
                {t("settings.mcpServerForm.reapplyDraft")}
              </Button>
            </Space>
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {showComparison ? (
        <pre
          data-testid="mcp-server-revision-comparison"
          style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap" }}
        >
          {comparison}
        </pre>
      ) : null}

      <div style={{ marginBottom: 16 }}>
        <Radio.Group
          value={editorMode}
          onChange={(e) => switchMode(e.target.value as EditorMode)}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="form">
            <FormOutlined /> {t("settings.mcpServerForm.modeForm")}
          </Radio.Button>
          <Radio.Button value="json">
            <CodeOutlined /> {t("settings.mcpServerForm.modeJson")}
          </Radio.Button>
        </Radio.Group>
      </div>

      {editorMode === "json" && jsonError && (
        <Alert
          type="error"
          message={t("settings.mcpServerForm.jsonError")}
          description={jsonError}
          showIcon
          style={{ marginBottom: 16 }}
          closable
          onClose={() => setJsonError(null)}
        />
      )}

      {editorMode === "json" ? (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message={t("settings.mcpServerForm.jsonCredentialTitle")}
            description={
              <Space direction="vertical" size={2}>
                <Text>{t("settings.mcpServerForm.jsonCredentialGuidance")}</Text>
                {credentialStatusLines.map(({ key, status }) => (
                  <Text key={key} code>
                    {key}:{" "}
                    {status.configured
                      ? status.source === "environment" || status.source === "env"
                        ? t("settings.mcpServerForm.credentialFromEnv")
                        : t("settings.mcpServerForm.credentialConfigured")
                      : t("settings.mcpServerForm.credentialMissing")}
                  </Text>
                ))}
              </Space>
            }
          />
          <TextArea
            value={jsonValue}
            onChange={(e) => handleJsonChange(e.target.value)}
            rows={20}
            style={{ fontFamily: "monospace", fontSize: 13 }}
            placeholder={JSON.stringify(createDefaultMcpServerConfig("example-server"), null, 2)}
          />
        </Space>
      ) : (
        <Form<McpServerFormValues> layout="vertical" form={form} preserve>
          <Form.Item
            name="id"
            label={t("settings.mcpServerForm.serverId")}
            rules={[
              {
                required: true,
                message: t("settings.mcpServerForm.serverIdRequired"),
              },
              {
                pattern: /^[a-zA-Z0-9_-]+$/,
                message: t("settings.mcpServerForm.serverIdPatternError"),
              },
            ]}
          >
            <Input placeholder="filesystem" disabled={mode === "edit"} autoComplete="off" />
          </Form.Item>

          <Form.Item name="name" label={t("settings.mcpServerForm.displayName")}>
            <Input placeholder="Filesystem MCP" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="enabled"
            label={t("settings.mcpServerForm.enabled")}
            valuePropName="checked"
            extra={t("settings.mcpServerForm.enabledHelp")}
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name="transportType"
            label={t("settings.mcpServerForm.transportType")}
            rules={[
              {
                required: true,
                message: t("settings.mcpServerForm.transportTypeRequired"),
              },
            ]}
          >
            <Select
              options={[
                {
                  label: t("settings.mcpServerForm.transportOptions.stdio"),
                  value: "stdio",
                },
                {
                  label: t("settings.mcpServerForm.transportOptions.sse"),
                  value: "sse",
                },
                {
                  label: t("settings.mcpServerForm.transportOptions.streamableHttp"),
                  value: "streamable_http",
                },
              ]}
            />
          </Form.Item>

          {transportType === "stdio" ? (
            <>
              <Form.Item
                name="command"
                label={t("settings.mcpServerForm.command")}
                rules={[
                  {
                    required: true,
                    message: t("settings.mcpServerForm.commandRequired"),
                  },
                ]}
              >
                <Input placeholder="npx" autoComplete="off" />
              </Form.Item>

              <Form.Item name="args" label={t("settings.mcpServerForm.arguments")}>
                <Select
                  mode="tags"
                  tokenSeparators={[","]}
                  placeholder={t("settings.mcpServerForm.argumentsPlaceholder")}
                  open={false}
                />
              </Form.Item>

              <Form.List name="envEntries">
                {(fields, { add, remove }) => (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Space
                      align="center"
                      style={{ justifyContent: "space-between", width: "100%" }}
                    >
                      <Text strong>{t("settings.mcpServerForm.envVars")}</Text>
                      <Button
                        icon={<PlusOutlined />}
                        onClick={() => add({ key: "", value: "" })}
                        type="dashed"
                      >
                        {t("settings.mcpServerForm.addEnv")}
                      </Button>
                    </Space>

                    {fields.map(({ key: fieldKey, ...field }) => {
                      const entry = envEntries[field.name];
                      const name = entry?.key?.trim() ?? "";
                      const status = activeCredentialStatus.env[name];
                      return (
                        <Space key={fieldKey} align="start" style={{ display: "flex" }}>
                          <Form.Item
                            {...field}
                            name={[field.name, "key"]}
                            rules={[
                              {
                                required: true,
                                message: t("settings.mcpServerForm.keyRequired"),
                              },
                            ]}
                          >
                            <Input placeholder="MCP_ROOT" autoComplete="off" />
                          </Form.Item>
                          <Form.Item
                            {...field}
                            name={[field.name, "value"]}
                            extra={credentialDetails(status, entry?.value)}
                          >
                            <Input.Password
                              placeholder={t("settings.mcpServerForm.secretValuePlaceholder")}
                              autoComplete="new-password"
                              visibilityToggle={false}
                            />
                          </Form.Item>
                          <Button
                            danger
                            type="default"
                            icon={<MinusCircleOutlined />}
                            onClick={() => remove(field.name)}
                            aria-label={t("settings.mcpServerForm.clearCredentialAria", {
                              name: name || t("settings.mcpServerForm.unnamedCredential"),
                            })}
                          >
                            {t("settings.mcpServerForm.clearCredential")}
                          </Button>
                        </Space>
                      );
                    })}
                  </Space>
                )}
              </Form.List>
            </>
          ) : (
            <>
              <Form.Item
                name="url"
                label={
                  transportType === "streamable_http"
                    ? t("settings.mcpServerForm.streamableHttpUrl")
                    : t("settings.mcpServerForm.sseUrl")
                }
                rules={[
                  {
                    required: true,
                    message:
                      transportType === "streamable_http"
                        ? t("settings.mcpServerForm.streamableHttpUrlRequired")
                        : t("settings.mcpServerForm.sseUrlRequired"),
                  },
                  {
                    validator: async (_, value: string | undefined) => {
                      if (!value) {
                        return;
                      }
                      try {
                        new URL(value);
                      } catch {
                        throw new Error(t("settings.mcpServerForm.validUrlRequired"));
                      }
                    },
                  },
                ]}
              >
                <Input
                  placeholder={
                    transportType === "streamable_http"
                      ? "http://localhost:4000/mcp"
                      : "http://localhost:4000/sse"
                  }
                  autoComplete="off"
                />
              </Form.Item>

              <Form.List name="headerEntries">
                {(fields, { add, remove }) => (
                  <Space direction="vertical" style={{ width: "100%" }}>
                    <Space
                      align="center"
                      style={{ justifyContent: "space-between", width: "100%" }}
                    >
                      <Text strong>{t("settings.mcpServerForm.headers")}</Text>
                      <Button
                        icon={<PlusOutlined />}
                        onClick={() => add({ name: "", value: "" })}
                        type="dashed"
                      >
                        {t("settings.mcpServerForm.addHeader")}
                      </Button>
                    </Space>

                    {fields.map(({ key: fieldKey, ...field }) => {
                      const entry = headerEntries[field.name];
                      const name = entry?.name?.trim() ?? "";
                      const status = activeCredentialStatus.headers[name];
                      return (
                        <Space key={fieldKey} align="start" style={{ display: "flex" }}>
                          <Form.Item
                            {...field}
                            name={[field.name, "name"]}
                            rules={[
                              {
                                required: true,
                                message: t("settings.mcpServerForm.headerNameRequired"),
                              },
                            ]}
                          >
                            <Input placeholder="Authorization" autoComplete="off" />
                          </Form.Item>
                          <Form.Item
                            {...field}
                            name={[field.name, "value"]}
                            extra={credentialDetails(status, entry?.value)}
                          >
                            <Input.Password
                              placeholder={t("settings.mcpServerForm.secretValuePlaceholder")}
                              autoComplete="new-password"
                              visibilityToggle={false}
                            />
                          </Form.Item>
                          <Button
                            danger
                            type="default"
                            icon={<MinusCircleOutlined />}
                            onClick={() => remove(field.name)}
                            aria-label={t("settings.mcpServerForm.clearCredentialAria", {
                              name: name || t("settings.mcpServerForm.unnamedCredential"),
                            })}
                          >
                            {t("settings.mcpServerForm.clearCredential")}
                          </Button>
                        </Space>
                      );
                    })}
                  </Space>
                )}
              </Form.List>
            </>
          )}
        </Form>
      )}
    </Modal>
  );
};
