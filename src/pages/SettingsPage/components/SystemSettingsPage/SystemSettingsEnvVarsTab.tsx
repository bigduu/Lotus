import React, { useCallback, useEffect, useState } from "react";
import {
  Button,
  Card,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import {
  DeleteOutlined,
  EditOutlined,
  LockOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  settingsService,
  EnvVarResponse,
  UpsertEnvVarRequest,
} from "../../../../services/config/SettingsService";

const { Text, Paragraph } = Typography;

const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Environment Variables management tab in System Settings.
 *
 * Allows users to create, edit, and delete environment variables
 * that are injected into Bash tool processes. Secret variables
 * are encrypted at rest.
 */
const SystemSettingsEnvVarsTab: React.FC = () => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<EnvVarResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [form] = Form.useForm();

  // ── Data fetching ───────────────────────────────────────────────

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await settingsService.getEnvVars();
      setEntries(res.entries);
    } catch (err: any) {
      message.error(
        t("settings.envVars.fetchError", "Failed to load environment variables"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  // ── CRUD ────────────────────────────────────────────────────────

  const handleSave = async (values: {
    name: string;
    value: string;
    secret: boolean;
    description?: string;
  }) => {
    const req: UpsertEnvVarRequest = {
      name: values.name.trim(),
      value: values.value,
      secret: values.secret ?? false,
      description: values.description?.trim() || undefined,
    };

    try {
      const res = await settingsService.upsertEnvVar(req);
      setEntries(res.entries);
      message.success(
        editingName
          ? t("settings.envVars.updated", "Variable updated")
          : t("settings.envVars.created", "Variable created"),
      );
      closeModal();
    } catch (err: any) {
      message.error(
        err?.message ||
          t("settings.envVars.saveError", "Failed to save variable"),
      );
    }
  };

  const handleDelete = async (name: string) => {
    try {
      const res = await settingsService.deleteEnvVar(name);
      setEntries(res.entries);
      message.success(t("settings.envVars.deleted", "Variable deleted"));
    } catch (err: any) {
      message.error(
        err?.message ||
          t("settings.envVars.deleteError", "Failed to delete variable"),
      );
    }
  };

  // ── Modal helpers ───────────────────────────────────────────────

  const openAddModal = () => {
    setEditingName(null);
    form.resetFields();
    form.setFieldsValue({ secret: false });
    setModalOpen(true);
  };

  const openEditModal = (entry: EnvVarResponse) => {
    setEditingName(entry.name);
    form.setFieldsValue({
      name: entry.name,
      value: "", // don't prefill secret values
      secret: entry.secret,
      description: entry.description ?? "",
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingName(null);
    form.resetFields();
  };

  // ── Table columns ───────────────────────────────────────────────

  const columns = [
    {
      title: t("settings.envVars.name", "Name"),
      dataIndex: "name",
      key: "name",
      render: (name: string) => <Text code>{name}</Text>,
    },
    {
      title: t("settings.envVars.value", "Value"),
      dataIndex: "value",
      key: "value",
      render: (value: string, record: EnvVarResponse) =>
        record.secret ? (
          <Text type="secondary">
            <LockOutlined style={{ marginRight: 4 }} />
            {record.has_value ? "••••••••" : t("settings.envVars.notSet", "(not set)")}
          </Text>
        ) : (
          <Text>{value || <Text type="secondary">{t("settings.envVars.empty", "(empty)")}</Text>}</Text>
        ),
    },
    {
      title: t("settings.envVars.type", "Type"),
      key: "secret",
      width: 100,
      render: (_: unknown, record: EnvVarResponse) =>
        record.secret ? (
          <Tag color="orange" icon={<LockOutlined />}>
            {t("settings.envVars.secret", "Secret")}
          </Tag>
        ) : (
          <Tag color="blue">{t("settings.envVars.plain", "Plain")}</Tag>
        ),
    },
    {
      title: t("settings.envVars.descriptionCol", "Description"),
      dataIndex: "description",
      key: "description",
      ellipsis: true,
      render: (desc?: string) =>
        desc ? (
          <Text type="secondary">{desc}</Text>
        ) : (
          <Text type="secondary" italic>
            —
          </Text>
        ),
    },
    {
      title: t("settings.envVars.actions", "Actions"),
      key: "actions",
      width: 120,
      render: (_: unknown, record: EnvVarResponse) => (
        <Space size="small">
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(record)}
          />
          <Popconfirm
            title={t(
              "settings.envVars.deleteConfirm",
              "Delete this variable?",
            )}
            onConfirm={() => handleDelete(record.name)}
            okText={t("settings.envVars.yes", "Yes")}
            cancelText={t("settings.envVars.no", "No")}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 900 }}>
      <Card
        title={t("settings.envVars.title", "Environment Variables")}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openAddModal}
          >
            {t("settings.envVars.addButton", "Add Variable")}
          </Button>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          {t(
            "settings.envVars.description",
            "Variables are injected into Bash tool processes. Secret variables are encrypted at rest.",
          )}
        </Paragraph>

        <Table
          dataSource={entries}
          columns={columns}
          rowKey="name"
          size="small"
          pagination={false}
          loading={loading}
          locale={{
            emptyText: t(
              "settings.envVars.noVars",
              "No environment variables configured",
            ),
          }}
        />
      </Card>

      {/* ── Add / Edit Modal ─────────────────────────────────────── */}
      <Modal
        title={
          editingName
            ? t("settings.envVars.editTitle", "Edit Variable")
            : t("settings.envVars.addTitle", "Add Environment Variable")
        }
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        okText={t("settings.envVars.save", "Save")}
        cancelText={t("settings.envVars.cancel", "Cancel")}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={{ secret: false }}
        >
          <Form.Item
            name="name"
            label={t("settings.envVars.name", "Name")}
            rules={[
              {
                required: true,
                message: t(
                  "settings.envVars.nameRequired",
                  "Variable name is required",
                ),
              },
              {
                pattern: ENV_VAR_NAME_RE,
                message: t(
                  "settings.envVars.nameInvalid",
                  "Must start with a letter or underscore, followed by letters, digits, or underscores",
                ),
              },
            ]}
          >
            <Input
              placeholder="GITHUB_TOKEN"
              disabled={editingName !== null}
              autoFocus={editingName === null}
            />
          </Form.Item>

          <Form.Item
            name="value"
            label={t("settings.envVars.value", "Value")}
            rules={[
              {
                required: editingName === null,
                message: t(
                  "settings.envVars.valueRequired",
                  "Value is required for new variables",
                ),
              },
            ]}
            extra={
              editingName
                ? t(
                    "settings.envVars.valueEditHint",
                    "Leave empty to keep the existing value",
                  )
                : undefined
            }
          >
            <Input.Password
              placeholder={
                editingName
                  ? t(
                      "settings.envVars.valuePlaceholderEdit",
                      "Enter new value or leave empty",
                    )
                  : t("settings.envVars.valuePlaceholder", "Enter value")
              }
              visibilityToggle
            />
          </Form.Item>

          <Form.Item
            name="secret"
            label={t("settings.envVars.secret", "Secret")}
            valuePropName="checked"
            extra={t(
              "settings.envVars.secretHint",
              "Secret variables are encrypted on disk and masked in the UI",
            )}
          >
            <Switch />
          </Form.Item>

          <Form.Item
            name="description"
            label={t("settings.envVars.descriptionField", "Description")}
          >
            <Input
              placeholder={t(
                "settings.envVars.descriptionPlaceholder",
                "Optional description",
              )}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SystemSettingsEnvVarsTab;
