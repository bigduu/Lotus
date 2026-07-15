import { useEffect, useState } from "react";
import { Alert, Collapse, Form, Input, Modal, Segmented, Space, Switch } from "antd";
import { useTranslation } from "react-i18next";
import { isApiError } from "@services/api";
import type { PluginSource } from "@services/plugins";

type PluginSourceType = PluginSource["type"];

interface PluginSourceFormValues {
  sourceType: PluginSourceType;
  path?: string;
  url?: string;
  sha256?: string;
  allowUnverified?: boolean;
  allowUntrustedHost?: boolean;
  allowUnsigned?: boolean;
  insecure?: boolean;
}

export interface PluginInstallModalProps {
  open: boolean;
  mode: "install" | "update";
  /** Plugin id/name being updated. Only used when mode === "update". */
  pluginLabel?: string;
  /**
   * The plugin's current source, used to prefill the form in update mode so
   * the user does not have to retype the URL/path/sha256. Ignored in install
   * mode (the form always starts blank there).
   */
  initialSource?: PluginSource | null;
  onCancel: () => void;
  onSubmit: (source: PluginSource) => Promise<void>;
}

const DEFAULT_FORM_VALUES: PluginSourceFormValues = {
  sourceType: "url",
  path: "",
  url: "",
  sha256: "",
  allowUnverified: false,
  allowUntrustedHost: false,
  allowUnsigned: false,
  insecure: false,
};

const toSource = (values: PluginSourceFormValues): PluginSource => {
  if (values.sourceType === "url") {
    return {
      type: "url",
      url: values.url?.trim() || "",
      sha256: values.sha256?.trim() || undefined,
      // Trust-override flags are omitted (not sent as `false`) when unset —
      // the backend's own default for each is `false`/enforced, so an
      // omitted flag and an explicit `false` are equivalent on the wire;
      // omitting keeps the common (no-override) request body minimal.
      ...(values.allowUnverified ? { allow_unverified: true } : {}),
      ...(values.allowUntrustedHost ? { allow_untrusted_host: true } : {}),
      ...(values.allowUnsigned ? { allow_unsigned: true } : {}),
      ...(values.insecure ? { insecure: true } : {}),
    };
  }
  return {
    type: values.sourceType,
    path: values.path?.trim() || "",
  };
};

const toFormValues = (source: PluginSource): PluginSourceFormValues => {
  if (source.type === "url") {
    return {
      sourceType: "url",
      url: source.url,
      sha256: source.sha256 ?? "",
      path: "",
      allowUnverified: source.allow_unverified ?? false,
      allowUntrustedHost: source.allow_untrusted_host ?? false,
      allowUnsigned: source.allow_unsigned ?? false,
      insecure: source.insecure ?? false,
    };
  }
  return { sourceType: source.type, path: source.path, url: "", sha256: "" };
};

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export const PluginInstallModal: React.FC<PluginInstallModalProps> = ({
  open,
  mode,
  pluginLabel,
  initialSource,
  onCancel,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const [form] = Form.useForm<PluginSourceFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceType = Form.useWatch("sourceType", form) ?? "url";
  const allowUnverified = Form.useWatch("allowUnverified", form) ?? false;
  const allowUntrustedHost = Form.useWatch("allowUntrustedHost", form) ?? false;
  const allowUnsigned = Form.useWatch("allowUnsigned", form) ?? false;
  const insecure = Form.useWatch("insecure", form) ?? false;
  const hasTrustOverride = allowUnverified || allowUntrustedHost || allowUnsigned || insecure;

  useEffect(() => {
    if (!open) {
      return;
    }
    // In update mode, seed the form from the plugin's current source so the
    // user doesn't have to retype it. Install mode (or a missing source) always
    // starts blank, which also prevents a stale update-source from leaking into
    // a later install.
    form.setFieldsValue(
      mode === "update" && initialSource ? toFormValues(initialSource) : DEFAULT_FORM_VALUES,
    );
    setError(null);
    setSubmitting(false);
  }, [open, mode, initialSource, form]);

  const handleCancel = () => {
    if (submitting) {
      return;
    }
    form.resetFields();
    setError(null);
    onCancel();
  };

  const handleOk = async () => {
    let values: PluginSourceFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const source = toSource(values);
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(source);
      form.resetFields();
    } catch (submitError) {
      const fallback =
        mode === "install"
          ? t("settings.pluginsTab.install.genericError")
          : t("settings.pluginsTab.update.genericError");
      let message = getErrorMessage(submitError, fallback);
      if (isApiError(submitError)) {
        if (submitError.status === 404) {
          message = t("settings.pluginsTab.errors.notFound");
        } else if (submitError.status === 422) {
          message = t("settings.pluginsTab.errors.unsupportedPlatform");
        } else if (mode === "install" && submitError.status === 409) {
          message = `${message} ${t("settings.pluginsTab.errors.conflictHint")}`;
        }
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        mode === "install"
          ? t("settings.pluginsTab.install.title")
          : t("settings.pluginsTab.update.title", { name: pluginLabel ?? "" })
      }
      open={open}
      onCancel={handleCancel}
      onOk={() => void handleOk()}
      okText={
        mode === "install"
          ? t("settings.pluginsTab.install.confirm")
          : t("settings.pluginsTab.update.confirm")
      }
      confirmLoading={submitting}
      destroyOnClose
      forceRender
      width={560}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Alert
          type="warning"
          showIcon
          message={t("settings.pluginsTab.install.warningTitle")}
          description={t("settings.pluginsTab.install.warningDescription")}
        />

        {error ? (
          <Alert type="error" showIcon message={error} closable onClose={() => setError(null)} />
        ) : null}

        <Form<PluginSourceFormValues>
          layout="vertical"
          form={form}
          initialValues={DEFAULT_FORM_VALUES}
          preserve
        >
          <Form.Item name="sourceType" label={t("settings.pluginsTab.install.sourceType")}>
            <Segmented
              options={[
                {
                  label: t("settings.pluginsTab.install.sourceTypeOptions.url"),
                  value: "url",
                },
                {
                  label: t("settings.pluginsTab.install.sourceTypeOptions.localDir"),
                  value: "local_dir",
                },
                {
                  label: t("settings.pluginsTab.install.sourceTypeOptions.localArchive"),
                  value: "local_archive",
                },
              ]}
            />
          </Form.Item>

          {sourceType === "url" ? (
            <>
              <Form.Item
                name="url"
                label={t("settings.pluginsTab.install.url")}
                rules={[
                  { required: true, message: t("settings.pluginsTab.install.urlRequired") },
                  {
                    validator: async (_, value: string | undefined) => {
                      if (!value) {
                        return;
                      }
                      try {
                        new URL(value);
                      } catch {
                        throw new Error(t("settings.pluginsTab.install.urlInvalid"));
                      }
                    },
                  },
                ]}
              >
                <Input placeholder="https://example.com/plugin.zip" autoComplete="off" />
              </Form.Item>

              <Form.Item
                name="sha256"
                label={t("settings.pluginsTab.install.sha256")}
                extra={t("settings.pluginsTab.install.sha256Help")}
              >
                <Input placeholder="e3b0c44298fc1c149afbf4c8996fb92427ae41e4" autoComplete="off" />
              </Form.Item>

              <Collapse
                data-testid="install-advanced-trust"
                items={[
                  {
                    key: "advanced",
                    label: t("settings.pluginsTab.install.advanced.title"),
                    children: (
                      <Space direction="vertical" style={{ width: "100%" }} size="middle">
                        <Alert
                          type="error"
                          showIcon
                          message={t("settings.pluginsTab.install.advanced.warningTitle")}
                          description={t("settings.pluginsTab.install.advanced.warningDescription")}
                        />

                        <Form.Item
                          name="allowUntrustedHost"
                          valuePropName="checked"
                          label={t("settings.pluginsTab.install.advanced.allowUntrustedHost")}
                          extra={t("settings.pluginsTab.install.advanced.allowUntrustedHostHelp")}
                          style={{ marginBottom: 0 }}
                        >
                          <Switch data-testid="install-allow-untrusted-host" />
                        </Form.Item>

                        <Form.Item
                          name="allowUnsigned"
                          valuePropName="checked"
                          label={t("settings.pluginsTab.install.advanced.allowUnsigned")}
                          extra={t("settings.pluginsTab.install.advanced.allowUnsignedHelp")}
                          style={{ marginBottom: 0 }}
                        >
                          <Switch data-testid="install-allow-unsigned" />
                        </Form.Item>

                        <Form.Item
                          name="allowUnverified"
                          valuePropName="checked"
                          label={t("settings.pluginsTab.install.advanced.allowUnverified")}
                          extra={t("settings.pluginsTab.install.advanced.allowUnverifiedHelp")}
                          style={{ marginBottom: 0 }}
                        >
                          <Switch data-testid="install-allow-unverified" />
                        </Form.Item>

                        <Form.Item
                          name="insecure"
                          valuePropName="checked"
                          label={t("settings.pluginsTab.install.advanced.insecure")}
                          extra={t("settings.pluginsTab.install.advanced.insecureHelp")}
                          style={{ marginBottom: 0 }}
                        >
                          <Switch data-testid="install-insecure" />
                        </Form.Item>

                        {hasTrustOverride ? (
                          <Alert
                            type="warning"
                            showIcon
                            message={t("settings.pluginsTab.install.advanced.activeWarning")}
                          />
                        ) : null}
                      </Space>
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <Form.Item
              name="path"
              label={
                sourceType === "local_archive"
                  ? t("settings.pluginsTab.install.archivePath")
                  : t("settings.pluginsTab.install.dirPath")
              }
              rules={[{ required: true, message: t("settings.pluginsTab.install.pathRequired") }]}
            >
              <Input
                placeholder={
                  sourceType === "local_archive" ? "/path/to/plugin.zip" : "/path/to/plugin-dir"
                }
                autoComplete="off"
              />
            </Form.Item>
          )}
        </Form>
      </Space>
    </Modal>
  );
};
