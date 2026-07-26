import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  App as AntApp,
  Alert,
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
} from "antd";
import { DeleteOutlined, EditOutlined, LockOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  settingsService,
  EnvVarResponse,
  EnvVarsListResponse,
  UpsertEnvVarRequest,
} from "@services/config/SettingsService";
import { isApiError } from "@services/api/client";
import { reapplyConfigChanges } from "@shared/hooks/useConfigSectionDraft";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { redactConfigError } from "./ConfigSectionStatus";

const { Text, Paragraph } = Typography;

const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface EnvVarDraft {
  name: string;
  value: string;
  secret: boolean;
  description: string;
}

interface EnvVarMetadata {
  name: string;
  secret: boolean;
  configured: boolean;
  has_value: boolean;
  description?: string;
}

const emptyDraft = (name = ""): EnvVarDraft => ({
  name,
  value: "",
  secret: false,
  description: "",
});

const draftFromEntry = (entry: EnvVarResponse): EnvVarDraft => ({
  name: entry.name,
  value: "",
  secret: entry.secret,
  description: entry.description ?? "",
});

const metadataFromEntry = (entry: EnvVarResponse | undefined): EnvVarMetadata | null =>
  entry
    ? {
        name: entry.name,
        secret: entry.secret,
        configured: entry.configured,
        has_value: entry.has_value,
        description: entry.description,
      }
    : null;

const redactDraftForComparison = (draft: EnvVarDraft, clearRequested: boolean) => ({
  name: draft.name,
  secret: draft.secret,
  description: draft.description,
  ...(draft.value ? { value: "[replace requested]" } : {}),
  clear_requested: clearRequested,
});

const withoutSecretMasks = (response: EnvVarsListResponse): EnvVarsListResponse => ({
  ...response,
  entries: response.entries.map((entry) => (entry.secret ? { ...entry, value: "" } : entry)),
});

/**
 * Environment Variables management tab in System Settings.
 *
 * Allows users to create, edit, and delete environment variables
 * that are injected into Bash tool processes. Secret variables
 * are encrypted at rest.
 */
const SystemSettingsEnvVarsTab: React.FC = () => {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [entries, setEntries] = useState<EnvVarResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [revision, setRevision] = useState<number | null>(null);
  const [modalBaseRevision, setModalBaseRevision] = useState<number | null>(null);
  const [modalDirty, setModalDirty] = useState(false);
  const [clearRequested, setClearRequested] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [form] = Form.useForm();
  const latestResponseRef = useRef<EnvVarsListResponse | null>(null);
  const baseDraftRef = useRef<EnvVarDraft | null>(null);
  const baseMetadataRef = useRef<EnvVarMetadata | null>(null);
  const pendingLoadsRef = useRef(0);
  const lastEnvSignalRevisionRef = useRef<number | null>(null);
  const envSnapshot = useConfigSectionStore((state) => state.sections.env);
  const loadSection = useConfigSectionStore((state) => state.loadSection);

  // ── Data fetching ───────────────────────────────────────────────

  const applyResponse = useCallback((response: EnvVarsListResponse) => {
    const sanitized = withoutSecretMasks(response);
    const latest = latestResponseRef.current;
    if (latest && sanitized.revision < latest.revision) return latest;

    latestResponseRef.current = sanitized;
    setEntries(sanitized.entries);
    setRevision(sanitized.revision);
    return sanitized;
  }, []);

  const fetchEntries = useCallback(async (): Promise<EnvVarsListResponse | null> => {
    pendingLoadsRef.current += 1;
    setLoading(true);
    try {
      const res = await settingsService.getEnvVars();
      return applyResponse(res);
    } catch {
      message.error(t("settings.envVars.fetchError", "Failed to load environment variables"));
      return null;
    } finally {
      pendingLoadsRef.current -= 1;
      if (pendingLoadsRef.current === 0) setLoading(false);
    }
  }, [applyResponse, message, t]);

  useEffect(() => {
    void fetchEntries();
    void loadSection("env").catch(() => undefined);
  }, [fetchEntries, loadSection]);

  useEffect(() => {
    const signalRevision = envSnapshot.envelope?.revision ?? null;
    if (signalRevision === null) return;

    const previous = lastEnvSignalRevisionRef.current;
    lastEnvSignalRevisionRef.current = signalRevision;
    if (previous !== null && signalRevision <= previous) return;

    void fetchEntries();
    // The typed section revision and credential transaction revision are
    // distinct counters; a new section envelope is only a refresh signal.
  }, [envSnapshot.envelope?.revision, fetchEntries]);

  // ── Modal helpers ───────────────────────────────────────────────

  const closeModal = useCallback(() => {
    setClearRequested(false);
    setShowComparison(false);
    setModalDirty(false);
    setModalBaseRevision(null);
    setModalOpen(false);
    setEditingName(null);
    baseDraftRef.current = null;
    baseMetadataRef.current = null;
    form.resetFields();
  }, [form]);

  const replaceFormValues = useCallback(
    (values: EnvVarDraft) => {
      // Reset first so a plaintext replacement can never survive adoption.
      form.resetFields();
      form.setFieldsValue(values);
    },
    [form],
  );

  const openAddModal = () => {
    if (revision === null) {
      message.error(t("settings.envVars.fetchError", "Failed to load environment variables"));
      return;
    }

    const values = emptyDraft();
    setClearRequested(false);
    setShowComparison(false);
    setModalDirty(false);
    setEditingName(null);
    setModalBaseRevision(revision);
    baseDraftRef.current = structuredClone(values);
    baseMetadataRef.current = null;
    replaceFormValues(values);
    setModalOpen(true);
  };

  const openEditModal = (entry: EnvVarResponse) => {
    if (revision === null) {
      message.error(t("settings.envVars.fetchError", "Failed to load environment variables"));
      return;
    }

    const values = draftFromEntry(entry);
    setClearRequested(false);
    setShowComparison(false);
    setModalDirty(false);
    setEditingName(entry.name);
    setModalBaseRevision(revision);
    baseDraftRef.current = structuredClone(values);
    baseMetadataRef.current = metadataFromEntry(entry);
    replaceFormValues(values);
    setModalOpen(true);
  };

  const adoptModalResponse = useCallback(
    (response: EnvVarsListResponse, keepDraft: boolean) => {
      if (!modalOpen) return;

      const latestEntry = editingName
        ? response.entries.find((entry) => entry.name === editingName)
        : undefined;
      if (editingName && !latestEntry && !keepDraft) {
        message.warning(
          t(
            "settings.envVars.removedExternally",
            "This environment variable no longer exists in the latest configuration.",
          ),
        );
        closeModal();
        return;
      }

      const latestValues = latestEntry
        ? draftFromEntry(latestEntry)
        : emptyDraft(editingName ?? "");
      const currentDraft = form.getFieldsValue(true) as EnvVarDraft;
      const nextValues =
        keepDraft && baseDraftRef.current
          ? reapplyConfigChanges(baseDraftRef.current, currentDraft, latestValues)
          : latestValues;

      replaceFormValues(nextValues);
      baseDraftRef.current = structuredClone(latestValues);
      baseMetadataRef.current = metadataFromEntry(latestEntry);
      setModalBaseRevision(response.revision);
      setModalDirty(keepDraft);
      if (!keepDraft) setClearRequested(false);
      setShowComparison(false);
    },
    [closeModal, editingName, form, message, modalOpen, replaceFormValues, t],
  );

  const externalRevision =
    modalOpen && modalBaseRevision !== null && revision !== null && revision > modalBaseRevision
      ? revision
      : null;

  useEffect(() => {
    if (externalRevision === null || modalDirty || !latestResponseRef.current) return;
    adoptModalResponse(latestResponseRef.current, false);
  }, [adoptModalResponse, externalRevision, modalDirty]);

  const reloadModal = useCallback(async () => {
    const latest = await fetchEntries();
    if (latest) adoptModalResponse(latest, false);
  }, [adoptModalResponse, fetchEntries]);

  const reapplyModal = useCallback(() => {
    if (!latestResponseRef.current) return;
    adoptModalResponse(latestResponseRef.current, true);
  }, [adoptModalResponse]);

  const comparison =
    showComparison && externalRevision !== null
      ? JSON.stringify(
          {
            revisions: {
              base: modalBaseRevision,
              latest: externalRevision,
            },
            base: baseMetadataRef.current,
            draft: redactDraftForComparison(
              form.getFieldsValue(true) as EnvVarDraft,
              clearRequested,
            ),
            latest: metadataFromEntry(
              editingName
                ? latestResponseRef.current?.entries.find((entry) => entry.name === editingName)
                : undefined,
            ),
          },
          null,
          2,
        )
      : null;

  // ── CRUD ────────────────────────────────────────────────────────

  const handleSave = async (values: {
    name: string;
    value: string;
    secret: boolean;
    description?: string;
  }) => {
    if (modalBaseRevision === null) {
      message.error(t("settings.envVars.fetchError", "Failed to load environment variables"));
      return;
    }
    const req: UpsertEnvVarRequest = {
      name: values.name.trim(),
      ...(!editingName || values.value || clearRequested ? { value: values.value } : {}),
      secret: values.secret ?? false,
      description: values.description?.trim() || undefined,
    };

    try {
      const res = await settingsService.upsertEnvVar(req, modalBaseRevision);
      applyResponse(res);
      message.success(
        editingName
          ? t("settings.envVars.updated", "Variable updated")
          : t("settings.envVars.created", "Variable created"),
      );
      closeModal();
    } catch (err: unknown) {
      if (isApiError(err) && err.status === 409) {
        setModalDirty(true);
        await fetchEntries();
      }
      message.error(
        (err instanceof Error ? err.message : undefined) ||
          t("settings.envVars.saveError", "Failed to save variable"),
      );
    }
  };

  const handleDelete = async (name: string) => {
    if (revision === null) return;
    try {
      const res = await settingsService.deleteEnvVar(name, revision);
      applyResponse(res);
      message.success(t("settings.envVars.deleted", "Variable deleted"));
    } catch (err: unknown) {
      if (isApiError(err) && err.status === 409) await fetchEntries();
      message.error(
        (err instanceof Error ? err.message : undefined) ||
          t("settings.envVars.deleteError", "Failed to delete variable"),
      );
    }
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
          <Tag color={envSnapshot.error ? "error" : record.configured ? "success" : "warning"}>
            <LockOutlined style={{ marginRight: 4 }} />
            {envSnapshot.error
              ? t("settings.envVars.credentialError", "Error")
              : record.configured
                ? t("settings.envVars.credentialConfigured", "Configured")
                : t("settings.envVars.credentialMissing", "Missing")}
          </Tag>
        ) : (
          <Text>
            {value || <Text type="secondary">{t("settings.envVars.empty", "(empty)")}</Text>}
          </Text>
        ),
    },
    {
      title: t("settings.envVars.type", "Type"),
      key: "secret",
      width: 100,
      render: (_: unknown, record: EnvVarResponse) =>
        record.secret ? (
          <Tag color="warning" icon={<LockOutlined />}>
            {t("settings.envVars.secret", "Secret")}
          </Tag>
        ) : (
          <Tag color="processing">{t("settings.envVars.plain", "Plain")}</Tag>
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
            aria-label={t("settings.envVars.edit", "Edit")}
          />
          <Popconfirm
            title={t("settings.envVars.deleteConfirm", "Delete this variable?")}
            onConfirm={() => handleDelete(record.name)}
            okText={t("settings.envVars.yes", "Yes")}
            cancelText={t("settings.envVars.no", "No")}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={t("settings.envVars.delete", "Delete")}
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
        className="lotus-settings-card"
        title={t("settings.envVars.title", "Environment Variables")}
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={openAddModal}
            disabled={revision === null}
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

        {envSnapshot.error ? (
          <Alert
            type="warning"
            showIcon
            message={redactConfigError(envSnapshot.error)}
            style={{ marginBottom: 12 }}
          />
        ) : null}

        <Table
          dataSource={entries}
          columns={columns}
          rowKey="name"
          size="small"
          pagination={false}
          loading={loading}
          locale={{
            emptyText: t("settings.envVars.noVars", "No environment variables configured"),
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
        {externalRevision !== null ? (
          <Alert
            type="warning"
            showIcon
            message={t(
              "settings.envVars.changedExternally",
              "Environment variables changed externally",
            )}
            description={t(
              "settings.envVars.changedExternallyDescription",
              "Your draft was preserved. Reload to discard it, compare revisions, or reapply it over the latest configuration.",
            )}
            action={
              <Space wrap>
                <Button size="small" onClick={() => void reloadModal()}>
                  {t("settings.envVars.reload", "Reload latest")}
                </Button>
                <Button size="small" onClick={() => setShowComparison((current) => !current)}>
                  {t("settings.envVars.compare", "Compare")}
                </Button>
                <Button size="small" onClick={reapplyModal}>
                  {t("settings.envVars.reapply", "Reapply")}
                </Button>
              </Space>
            }
            style={{ marginBottom: 16 }}
          />
        ) : null}

        {comparison ? (
          <pre
            data-testid="env-var-revision-comparison"
            style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap" }}
          >
            {comparison}
          </pre>
        ) : null}

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          onValuesChange={() => setModalDirty(true)}
          initialValues={{ secret: false }}
        >
          <Form.Item
            name="name"
            label={t("settings.envVars.name", "Name")}
            rules={[
              {
                required: true,
                message: t("settings.envVars.nameRequired", "Variable name is required"),
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
                message: t("settings.envVars.valueRequired", "Value is required for new variables"),
              },
            ]}
            extra={
              editingName
                ? t("settings.envVars.valueEditHint", "Leave empty to keep the existing value")
                : undefined
            }
          >
            <Input.Password
              placeholder={
                editingName
                  ? t("settings.envVars.valuePlaceholderEdit", "Enter new value or leave empty")
                  : t("settings.envVars.valuePlaceholder", "Enter value")
              }
              visibilityToggle
            />
          </Form.Item>
          {editingName ? (
            <Button
              size="small"
              danger={clearRequested}
              onClick={() => {
                setClearRequested((current) => !current);
                setModalDirty(true);
                form.setFieldValue("value", "");
              }}
              style={{ marginTop: -12, marginBottom: 12 }}
            >
              {clearRequested
                ? t("settings.envVars.valueWillBeCleared", "Value will be cleared")
                : t("settings.envVars.clearStoredValue", "Clear stored value")}
            </Button>
          ) : null}

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
              placeholder={t("settings.envVars.descriptionPlaceholder", "Optional description")}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default SystemSettingsEnvVarsTab;
