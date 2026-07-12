import { useEffect, useState } from "react";
import { Alert, Form, Input, Modal, Segmented, Space } from "antd";
import { useTranslation } from "react-i18next";
import { isApiError } from "@services/api";
import type { PluginSource } from "@services/plugins";

type PluginSourceType = PluginSource["type"];

interface PluginSourceFormValues {
  sourceType: PluginSourceType;
  path?: string;
  url?: string;
  sha256?: string;
}

export interface PluginInstallModalProps {
  open: boolean;
  mode: "install" | "update";
  /** Plugin id/name being updated. Only used when mode === "update". */
  pluginLabel?: string;
  onCancel: () => void;
  onSubmit: (source: PluginSource) => Promise<void>;
}

const DEFAULT_FORM_VALUES: PluginSourceFormValues = {
  sourceType: "url",
  path: "",
  url: "",
  sha256: "",
};

const toSource = (values: PluginSourceFormValues): PluginSource => {
  if (values.sourceType === "url") {
    return {
      type: "url",
      url: values.url?.trim() || "",
      sha256: values.sha256?.trim() || undefined,
    };
  }
  return {
    type: values.sourceType,
    path: values.path?.trim() || "",
  };
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
  onCancel,
  onSubmit,
}) => {
  const { t } = useTranslation();
  const [form] = Form.useForm<PluginSourceFormValues>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceType = Form.useWatch("sourceType", form) ?? "url";

  useEffect(() => {
    if (!open) {
      return;
    }
    form.setFieldsValue(DEFAULT_FORM_VALUES);
    setError(null);
    setSubmitting(false);
  }, [open, form]);

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
      if (mode === "install" && isApiError(submitError) && submitError.status === 409) {
        message = `${message} ${t("settings.pluginsTab.errors.conflictHint")}`;
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
