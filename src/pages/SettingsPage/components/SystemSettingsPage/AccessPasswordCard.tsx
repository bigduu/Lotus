import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Card, Form, Input, Popconfirm, Space, Tag, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import {
  ConfigConflictError,
  type AccessControlSection,
  type ConfigRevisionConflict,
} from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { configErrorMessage, redactConfigError } from "@shared/utils/configErrors";
import { isAntdFormError } from "@shared/utils/formError";

const { Text } = Typography;
const { useToken } = theme;

interface AccessPasswordCardProps {
  msgApi: {
    success: (content: string) => void;
    error: (content: string) => void;
  };
}

interface AccessPasswordForm {
  currentPassword?: string;
  newPassword: string;
  confirmPassword: string;
}

interface AccessMetadata {
  password_enabled: boolean;
  password_configured: boolean;
  source: string | null;
}

type AccessCredentialState = "configured" | "from_env" | "missing" | "error";

const accessMetadata = (
  access: AccessControlSection,
  source: string | null | undefined,
): AccessMetadata => ({
  password_enabled: access?.password_enabled ?? false,
  password_configured: access?.password_configured ?? false,
  source: source ?? null,
});

export const AccessPasswordCard: React.FC<AccessPasswordCardProps> = ({ msgApi }) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [form] = Form.useForm<AccessPasswordForm>();
  const [isSaving, setIsSaving] = useState(false);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [saveConflict, setSaveConflict] = useState<ConfigRevisionConflict | null>(null);
  const baseMetadataRef = useRef<AccessMetadata | null>(null);

  const accessSnapshot = useConfigSectionStore((state) => state.sections["access-control"]);
  const runtimeStatus = useConfigSectionStore((state) => state.accessRuntimeStatus);
  const runtimeLoading = useConfigSectionStore((state) => state.accessRuntimeLoading);
  const runtimeError = useConfigSectionStore((state) => state.accessRuntimeError);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const loadRuntimeStatus = useConfigSectionStore((state) => state.loadAccessRuntimeStatus);
  const replaceAccessPassword = useConfigSectionStore((state) => state.replaceAccessPassword);
  const clearAccessPassword = useConfigSectionStore((state) => state.clearAccessPassword);

  const envelope = accessSnapshot.envelope;
  const access = envelope?.data ?? null;
  const credentialState: AccessCredentialState =
    runtimeStatus?.credential_state ??
    (access?.password_credential_ref && access.password_configured
      ? "error"
      : access?.password_configured
        ? "configured"
        : "missing");
  const currentMetadata = useMemo(
    () => accessMetadata(access, runtimeStatus?.credential_source),
    [access, runtimeStatus?.credential_source],
  );
  const passwordEnabled = envelope
    ? Boolean(access?.password_enabled && access.password_configured)
    : (runtimeStatus?.password_enabled ?? false);
  const localBypass = runtimeStatus?.local_bypass ?? false;
  const requiresCurrentPassword = passwordEnabled && !localBypass;
  const isLoading = accessSnapshot.loading || runtimeLoading;
  const loadError = accessSnapshot.error ?? runtimeError;
  const sectionRevision = envelope?.revision ?? null;

  const helperText = useMemo(() => {
    if (credentialState === "from_env") {
      return t("settings.configTab.accessPassword.helperFromEnv");
    }
    if (!passwordEnabled) {
      return t("settings.configTab.accessPassword.helperNotEnabled");
    }
    if (localBypass) {
      return t("settings.configTab.accessPassword.helperLocalBypass");
    }
    return t("settings.configTab.accessPassword.helperRemote");
  }, [credentialState, localBypass, passwordEnabled, t]);

  const loadStatus = useCallback(
    async (force = false) => {
      await Promise.all([
        loadSection("access-control", force ? { force: true } : undefined),
        loadRuntimeStatus(force ? { force: true } : undefined),
      ]);
    },
    [loadRuntimeStatus, loadSection],
  );

  useEffect(() => {
    void loadStatus().catch(() => undefined);
  }, [loadStatus]);

  useEffect(() => {
    if (sectionRevision === null) return;
    if (baseRevision === null || !dirty) {
      setBaseRevision(sectionRevision);
      baseMetadataRef.current = currentMetadata;
      setSaveConflict(null);
      setShowComparison(false);
    }
  }, [baseRevision, currentMetadata, dirty, sectionRevision]);

  const externalRevision =
    dirty && baseRevision !== null && sectionRevision !== null && sectionRevision > baseRevision
      ? sectionRevision
      : null;

  const adoptLatest = useCallback(
    (keepDraft: boolean) => {
      const latest = useConfigSectionStore.getState().sections["access-control"].envelope;
      if (!latest) return;
      if (!keepDraft) form.resetFields();
      const status = useConfigSectionStore.getState().accessRuntimeStatus;
      baseMetadataRef.current = accessMetadata(latest.data, status?.credential_source);
      setBaseRevision(latest.revision);
      setDirty(keepDraft);
      setSaveConflict(null);
      setShowComparison(false);
    },
    [form],
  );

  const reloadLatest = useCallback(async () => {
    try {
      await loadStatus(true);
      adoptLatest(false);
    } catch (error) {
      msgApi.error(
        configErrorMessage(error, t("settings.configTab.accessPassword.loadStatusFailed")),
      );
    }
  }, [adoptLatest, loadStatus, msgApi, t]);

  const reapplyLatest = useCallback(async () => {
    try {
      await loadStatus(true);
      adoptLatest(true);
    } catch (error) {
      msgApi.error(
        configErrorMessage(error, t("settings.configTab.accessPassword.loadStatusFailed")),
      );
    }
  }, [adoptLatest, loadStatus, msgApi, t]);

  const comparison =
    showComparison && (externalRevision !== null || saveConflict)
      ? JSON.stringify(
          {
            revisions: {
              base: baseRevision,
              latest: sectionRevision ?? saveConflict?.currentRevision ?? "unknown",
            },
            base: baseMetadataRef.current,
            draft: {
              current_password: form.getFieldValue("currentPassword")
                ? "[provided]"
                : "[not provided]",
              new_password: form.getFieldValue("newPassword")
                ? "[replace requested]"
                : "[not provided]",
            },
            latest: currentMetadata,
          },
          null,
          2,
        )
      : null;

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (baseRevision === null) {
        throw new Error(t("settings.configTab.accessPassword.loadStatusFailed"));
      }
      setIsSaving(true);

      const result = await replaceAccessPassword(
        {
          current_password: values.currentPassword?.trim() || undefined,
          value: values.newPassword.trim(),
        },
        baseRevision,
      );

      msgApi.success(
        passwordEnabled
          ? t("settings.configTab.accessPassword.updated")
          : t("settings.configTab.accessPassword.enabled"),
      );
      form.resetFields();
      baseMetadataRef.current = accessMetadata(result.envelope.data, result.credential.source);
      setBaseRevision(result.envelope.revision);
      setDirty(false);
      setSaveConflict(null);
      setShowComparison(false);
    } catch (error) {
      if (isAntdFormError(error)) return;
      if (error instanceof ConfigConflictError) {
        setDirty(true);
        setSaveConflict(error.conflict);
        await loadStatus(true).catch(() => undefined);
      }
      msgApi.error(configErrorMessage(error, t("settings.configTab.accessPassword.updateFailed")));
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (baseRevision === null) {
      msgApi.error(t("settings.configTab.accessPassword.loadStatusFailed"));
      return;
    }
    const currentPassword = form.getFieldValue("currentPassword")?.trim();
    if (requiresCurrentPassword && !currentPassword) {
      form.setFields([
        {
          name: "currentPassword",
          errors: [t("settings.configTab.accessPassword.validation.currentPasswordRequired")],
        },
      ]);
      return;
    }

    try {
      setIsSaving(true);
      const result = await clearAccessPassword(
        { current_password: currentPassword || undefined },
        baseRevision,
      );
      msgApi.success(t("settings.configTab.accessPassword.cleared"));
      form.resetFields();
      baseMetadataRef.current = accessMetadata(result.envelope.data, result.credential.source);
      setBaseRevision(result.envelope.revision);
      setDirty(false);
      setSaveConflict(null);
      setShowComparison(false);
    } catch (error) {
      if (error instanceof ConfigConflictError) {
        setDirty(true);
        setSaveConflict(error.conflict);
        await loadStatus(true).catch(() => undefined);
      }
      msgApi.error(configErrorMessage(error, t("settings.configTab.accessPassword.clearFailed")));
    } finally {
      setIsSaving(false);
    }
  };

  const credentialLabels: Record<AccessCredentialState, string> = {
    configured: t("settings.configTab.accessPassword.credentialConfigured"),
    from_env: t("settings.configTab.accessPassword.credentialFromEnv"),
    missing: t("settings.configTab.accessPassword.credentialMissing"),
    error: t("settings.configTab.accessPassword.credentialError"),
  };

  return (
    <Card
      size="small"
      className="lotus-settings-card"
      title={<Text strong>{t("settings.configTab.accessPasswordTitle")}</Text>}
    >
      <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
        <Alert
          type={credentialState === "error" ? "error" : passwordEnabled ? "info" : "warning"}
          showIcon
          message={
            <Space wrap>
              <span>
                {passwordEnabled
                  ? t("settings.configTab.accessPassword.statusEnabled")
                  : t("settings.configTab.accessPassword.statusDisabled")}
              </span>
              <Tag
                color={
                  credentialState === "error"
                    ? "error"
                    : credentialState === "missing"
                      ? "warning"
                      : credentialState === "from_env"
                        ? "processing"
                        : "success"
                }
              >
                {credentialLabels[credentialState]}
              </Tag>
            </Space>
          }
          description={helperText}
        />

        {loadError ? <Alert type="error" showIcon message={redactConfigError(loadError)} /> : null}

        {externalRevision !== null || saveConflict ? (
          <Alert
            type="warning"
            showIcon
            message={
              saveConflict
                ? t("settings.configTab.accessPassword.revisionConflict")
                : t("settings.configTab.accessPassword.changedExternally")
            }
            description={
              saveConflict
                ? t("settings.configTab.accessPassword.revisionConflictDescription", {
                    expected: saveConflict.expectedRevision,
                    current: saveConflict.currentRevision ?? externalRevision ?? "unknown",
                  })
                : t("settings.configTab.accessPassword.changedExternallyDescription", {
                    base: baseRevision,
                    latest: externalRevision,
                  })
            }
            action={
              <Space wrap>
                <Button size="small" onClick={() => void reloadLatest()}>
                  {t("settings.configTab.accessPassword.reload")}
                </Button>
                <Button size="small" onClick={() => setShowComparison((current) => !current)}>
                  {t("settings.configTab.accessPassword.compare")}
                </Button>
                <Button size="small" onClick={() => void reapplyLatest()}>
                  {t("settings.configTab.accessPassword.reapply")}
                </Button>
              </Space>
            }
          />
        ) : null}

        {comparison ? (
          <pre
            data-testid="access-password-revision-comparison"
            style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap" }}
          >
            {comparison}
          </pre>
        ) : null}

        <Form
          form={form}
          layout="vertical"
          disabled={isLoading || isSaving}
          onValuesChange={() => setDirty(true)}
        >
          {requiresCurrentPassword ? (
            <Form.Item
              label={t("settings.configTab.accessPassword.currentPasswordLabel")}
              name="currentPassword"
              rules={[
                {
                  required: true,
                  message: t(
                    "settings.configTab.accessPassword.validation.currentPasswordRequired",
                  ),
                },
              ]}
            >
              <Input.Password autoComplete="current-password" />
            </Form.Item>
          ) : null}

          <Form.Item
            label={
              passwordEnabled
                ? t("settings.configTab.accessPassword.newPasswordLabel")
                : t("settings.configTab.accessPassword.setPasswordLabel")
            }
            name="newPassword"
            rules={[
              {
                required: true,
                message: t("settings.configTab.accessPassword.validation.newPasswordRequired"),
              },
              {
                min: 4,
                message: t("settings.configTab.accessPassword.validation.minLength"),
              },
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Form.Item
            label={t("settings.configTab.accessPassword.confirmPasswordLabel")}
            name="confirmPassword"
            dependencies={["newPassword"]}
            rules={[
              {
                required: true,
                message: t("settings.configTab.accessPassword.validation.confirmPasswordRequired"),
              },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue("newPassword") === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error(t("settings.configTab.accessPassword.validation.passwordMismatch")),
                  );
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>

          <Space wrap>
            <Button
              type="primary"
              loading={isSaving}
              disabled={baseRevision === null || externalRevision !== null || Boolean(saveConflict)}
              onClick={() => void handleSubmit()}
            >
              {passwordEnabled
                ? t("settings.configTab.accessPassword.updateAction")
                : t("settings.configTab.accessPassword.enableAction")}
            </Button>
            {passwordEnabled ? (
              <Popconfirm
                title={t("settings.configTab.accessPassword.clearConfirm")}
                description={t("settings.configTab.accessPassword.clearConfirmDescription")}
                onConfirm={() => handleClear()}
                okButtonProps={{ danger: true }}
              >
                <Button
                  danger
                  loading={isSaving}
                  disabled={
                    baseRevision === null || externalRevision !== null || Boolean(saveConflict)
                  }
                >
                  {t("settings.configTab.accessPassword.clearAction")}
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        </Form>
      </Space>
    </Card>
  );
};

export default AccessPasswordCard;
