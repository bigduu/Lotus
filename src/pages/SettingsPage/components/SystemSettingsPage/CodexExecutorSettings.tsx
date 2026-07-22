import React, { useState } from "react";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Input,
  Radio,
  Select,
  Space,
  Switch,
  Typography,
  theme,
} from "antd";
import { useTranslation } from "react-i18next";

import {
  serviceFactory,
  type BambooConfigValidationIssue,
  type BambooSubagentsConfig,
  type CodexCliDiscoveryResponse,
} from "@services/common/ServiceFactory";

const { Text } = Typography;

const CODEX_AUTH_MODES = ["bamboo", "inherit", "api_key", "custom"] as const;
const MAPPED_POLICY = "__mapped__";

interface CodexExecutorSettingsProps {
  value: BambooSubagentsConfig;
  validationIssues: BambooConfigValidationIssue[];
  onChange: (patch: Partial<BambooSubagentsConfig>) => void;
}

const Field: React.FC<{
  label: React.ReactNode;
  hint: React.ReactNode;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div>
    <Text strong>{label}</Text>
    <div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {hint}
      </Text>
    </div>
    <div style={{ marginTop: 6 }}>{children}</div>
  </div>
);

export const CodexExecutorSettings: React.FC<CodexExecutorSettingsProps> = ({
  value,
  validationIssues,
  onChange,
}) => {
  const { t } = useTranslation();
  const { modal } = App.useApp();
  const { token } = theme.useToken();
  const [isDetecting, setIsDetecting] = useState(false);
  const [discovery, setDiscovery] = useState<CodexCliDiscoveryResponse | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);

  const authMode = value.codex_auth_mode ?? "bamboo";
  const sandbox = value.codex_sandbox ?? MAPPED_POLICY;
  const approvalPolicy = value.codex_approval_policy ?? MAPPED_POLICY;
  const isCustom = authMode === "custom";
  const isApiKey = authMode === "api_key";
  const dangerRequested = sandbox === "danger-full-access";
  const networkChecked = dangerRequested || (value.codex_network_access ?? false);

  const detectBinary = async () => {
    setIsDetecting(true);
    setDetectionError(null);
    try {
      const result = await serviceFactory.detectCodexCli(value.codex_binary ?? undefined);
      setDiscovery(result);
      onChange({ codex_binary: result.path });
    } catch (error) {
      setDiscovery(null);
      setDetectionError(
        error instanceof Error && error.message.trim()
          ? error.message
          : t("settings.configTab.codex.detectFailed"),
      );
    } finally {
      setIsDetecting(false);
    }
  };

  const changeAuthMode = (next: (typeof CODEX_AUTH_MODES)[number]) => {
    const withoutOpenAiKey = (value.codex_forward_env ?? []).filter(
      (name) => name !== "OPENAI_API_KEY",
    );
    onChange({
      codex_auth_mode: next,
      codex_base_url: next === "custom" ? value.codex_base_url : undefined,
      codex_provider_key_ref: next === "custom" ? value.codex_provider_key_ref : undefined,
      codex_wire_api: next === "custom" ? "responses" : undefined,
      codex_forward_env:
        next === "api_key" ? [...withoutOpenAiKey, "OPENAI_API_KEY"] : withoutOpenAiKey,
    });
  };

  const changeSandbox = (next: string) => {
    onChange({
      codex_sandbox:
        next === MAPPED_POLICY
          ? undefined
          : (next as NonNullable<BambooSubagentsConfig["codex_sandbox"]>),
      codex_network_access: next === "read-only" ? false : value.codex_network_access,
      codex_allow_danger_bypass:
        next === "danger-full-access" ? value.codex_allow_danger_bypass : false,
    });
  };

  const changeDangerBypass = (checked: boolean) => {
    if (!checked) {
      onChange({ codex_allow_danger_bypass: false });
      return;
    }
    modal.confirm({
      title: t("settings.configTab.codex.dangerConfirmTitle"),
      content: t("settings.configTab.codex.dangerConfirmDescription"),
      okText: t("settings.configTab.codex.dangerConfirmAction"),
      cancelText: t("common.cancel"),
      okButtonProps: { danger: true },
      onOk: () => onChange({ codex_allow_danger_bypass: true }),
    });
  };

  return (
    <Space
      direction="vertical"
      size={token.marginMD}
      style={{ width: "100%", paddingLeft: token.paddingSM }}
      data-testid="codex-executor-settings"
    >
      <Alert
        type="info"
        showIcon
        message={t("settings.configTab.codex.notice")}
        description={t("settings.configTab.codex.noticeDescription")}
      />

      <Field
        label={t("settings.configTab.codex.binary")}
        hint={t("settings.configTab.codex.binaryHint")}
      >
        <Space.Compact style={{ width: "100%" }}>
          <Input
            data-testid="codex-binary"
            value={value.codex_binary ?? ""}
            placeholder={t("settings.configTab.codex.binaryPlaceholder")}
            onChange={(event) => {
              setDiscovery(null);
              setDetectionError(null);
              onChange({ codex_binary: event.target.value.trim() || undefined });
            }}
          />
          <Button data-testid="codex-detect" loading={isDetecting} onClick={detectBinary}>
            {t("settings.configTab.codex.detect")}
          </Button>
        </Space.Compact>
      </Field>

      {discovery && (
        <Alert
          data-testid="codex-detection-success"
          type="success"
          showIcon
          message={t("settings.configTab.codex.detected", {
            path: discovery.path,
            version: discovery.version,
          })}
        />
      )}
      {detectionError && (
        <Alert data-testid="codex-detection-error" type="error" showIcon message={detectionError} />
      )}

      <Field
        label={t("settings.configTab.codex.model")}
        hint={t("settings.configTab.codex.modelHint")}
      >
        <Input
          data-testid="codex-model"
          value={value.codex_model ?? ""}
          placeholder={t("settings.configTab.codex.modelPlaceholder")}
          onChange={(event) => onChange({ codex_model: event.target.value.trim() || undefined })}
        />
      </Field>

      <Field
        label={t("settings.configTab.codex.authMode")}
        hint={t("settings.configTab.codex.authModeHint")}
      >
        <Radio.Group
          data-testid="codex-auth-mode"
          value={authMode}
          onChange={(event) => changeAuthMode(event.target.value)}
        >
          <Space direction="vertical">
            {CODEX_AUTH_MODES.map((mode) => (
              <Radio key={mode} value={mode}>
                <Space direction="vertical" size={0}>
                  <Text>{t(`settings.configTab.codex.authModes.${mode}.label`)}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t(`settings.configTab.codex.authModes.${mode}.billing`)}
                  </Text>
                </Space>
              </Radio>
            ))}
          </Space>
        </Radio.Group>
      </Field>

      {isApiKey && (
        <Alert type="warning" showIcon message={t("settings.configTab.codex.apiKeyEnvironment")} />
      )}

      {isCustom && (
        <>
          <Field
            label={t("settings.configTab.codex.baseUrl")}
            hint={t("settings.configTab.codex.baseUrlHint")}
          >
            <Input
              data-testid="codex-base-url"
              value={value.codex_base_url ?? ""}
              placeholder="https://provider.example/v1"
              onChange={(event) =>
                onChange({ codex_base_url: event.target.value.trim() || undefined })
              }
            />
          </Field>
          <Field
            label={t("settings.configTab.codex.providerKeyRef")}
            hint={t("settings.configTab.codex.providerKeyRefHint")}
          >
            <Input
              data-testid="codex-provider-key-ref"
              value={value.codex_provider_key_ref ?? ""}
              placeholder="provider.openai.api_key"
              onChange={(event) =>
                onChange({ codex_provider_key_ref: event.target.value.trim() || undefined })
              }
            />
          </Field>
          <Field
            label={t("settings.configTab.codex.wireApi")}
            hint={t("settings.configTab.codex.wireApiHint")}
          >
            <Input data-testid="codex-wire-api" value="responses" disabled />
          </Field>
        </>
      )}

      <Field
        label={t("settings.configTab.codex.forwardEnv")}
        hint={t("settings.configTab.codex.forwardEnvHint")}
      >
        <Select
          data-testid="codex-forward-env"
          mode="tags"
          style={{ width: "100%" }}
          value={value.codex_forward_env ?? []}
          tokenSeparators={[",", " "]}
          placeholder={t("settings.configTab.codex.forwardEnvPlaceholder")}
          onChange={(names) => {
            const normalized = [
              ...new Set(names.map((name) => name.trim()).filter(Boolean)),
            ].sort();
            onChange({
              codex_forward_env: isApiKey
                ? [...normalized.filter((name) => name !== "OPENAI_API_KEY"), "OPENAI_API_KEY"]
                : normalized.filter((name) => name !== "OPENAI_API_KEY"),
            });
          }}
        />
      </Field>

      <Field
        label={t("settings.configTab.codex.sandbox")}
        hint={t("settings.configTab.codex.sandboxHint")}
      >
        <Select
          data-testid="codex-sandbox"
          style={{ width: "100%" }}
          value={sandbox}
          onChange={changeSandbox}
          options={[
            {
              value: MAPPED_POLICY,
              label: t("settings.configTab.codex.sandboxes.mapped"),
            },
            { value: "read-only", label: t("settings.configTab.codex.sandboxes.readOnly") },
            {
              value: "workspace-write",
              label: t("settings.configTab.codex.sandboxes.workspaceWrite"),
            },
            {
              value: "danger-full-access",
              label: t("settings.configTab.codex.sandboxes.dangerFullAccess"),
            },
          ]}
        />
      </Field>

      <Field
        label={t("settings.configTab.codex.approvalPolicy")}
        hint={t("settings.configTab.codex.approvalPolicyHint")}
      >
        <Select
          data-testid="codex-approval-policy"
          style={{ width: "100%" }}
          value={approvalPolicy}
          onChange={(next) =>
            onChange({
              codex_approval_policy:
                next === MAPPED_POLICY
                  ? undefined
                  : (next as NonNullable<BambooSubagentsConfig["codex_approval_policy"]>),
            })
          }
          options={[
            {
              value: MAPPED_POLICY,
              label: t("settings.configTab.codex.approvalPolicies.mapped"),
            },
            { value: "never", label: t("settings.configTab.codex.approvalPolicies.never") },
            {
              value: "on-failure",
              label: t("settings.configTab.codex.approvalPolicies.onFailure"),
            },
          ]}
        />
      </Field>

      <div style={{ display: "flex", justifyContent: "space-between", gap: token.marginMD }}>
        <div>
          <Text strong>{t("settings.configTab.codex.networkAccess")}</Text>
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("settings.configTab.codex.networkAccessHint")}
            </Text>
          </div>
        </div>
        <Switch
          data-testid="codex-network-access"
          checked={networkChecked}
          disabled={sandbox === "read-only" || dangerRequested}
          onChange={(checked) => onChange({ codex_network_access: checked })}
        />
      </div>

      <Checkbox
        data-testid="codex-danger-bypass"
        checked={value.codex_allow_danger_bypass ?? false}
        disabled={!dangerRequested}
        onChange={(event) => changeDangerBypass(event.target.checked)}
      >
        <Space direction="vertical" size={0}>
          <Text type="danger">{t("settings.configTab.codex.allowDangerBypass")}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("settings.configTab.codex.allowDangerBypassHint")}
          </Text>
        </Space>
      </Checkbox>

      {validationIssues.length > 0 && (
        <Alert
          data-testid="codex-validation-errors"
          type="error"
          showIcon
          message={t("settings.configTab.codex.validationFailed")}
          description={
            <ul style={{ margin: 0, paddingLeft: token.paddingLG }}>
              {validationIssues.map((issue) => (
                <li key={`${issue.path}:${issue.message}`}>
                  <Text type="danger">
                    {issue.path}: {issue.message}
                  </Text>
                </li>
              ))}
            </ul>
          }
        />
      )}
    </Space>
  );
};

export default CodexExecutorSettings;
