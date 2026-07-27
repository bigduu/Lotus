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
  ConfigConflictError,
  type ConfigRevisionConflict,
  type ConfigSectionEnvelope,
  type CredentialStatus,
  type EnvSection,
  type EnvSectionEntry,
  type EnvVarMutation,
} from "@services/config/configSections";
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
  credential_ref?: string | null;
  description?: string;
}

type EnvCredentialState = "configured" | "from_env" | "missing" | "error";

const EMPTY_ENV_ENTRIES: EnvSection = [];

const emptyDraft = (name = ""): EnvVarDraft => ({
  name,
  value: "",
  secret: false,
  description: "",
});

const draftFromEntry = (entry: EnvSectionEntry): EnvVarDraft => ({
  name: entry.name,
  value: entry.secret ? "" : (entry.value ?? ""),
  secret: entry.secret,
  description: entry.description ?? "",
});

const metadataFromEntry = (entry: EnvSectionEntry | undefined): EnvVarMetadata | null =>
  entry
    ? {
        name: entry.name,
        secret: entry.secret,
        configured: entry.configured,
        credential_ref: entry.credential_ref,
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

const envCredentialState = (
  entry: EnvSectionEntry,
  status: CredentialStatus | undefined,
  credentialHealthError: boolean,
): EnvCredentialState => {
  if (credentialHealthError) return "error";
  if (status?.source === "environment") return "from_env";
  if (status?.configured) return "configured";
  if (entry.credential_ref && entry.configured && !status) return "error";
  return entry.configured ? "configured" : "missing";
};

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
  const [modalOpen, setModalOpen] = useState(false);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [modalBaseRevision, setModalBaseRevision] = useState<number | null>(null);
  const [modalDirty, setModalDirty] = useState(false);
  const [clearRequested, setClearRequested] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [saveConflict, setSaveConflict] = useState<ConfigRevisionConflict | null>(null);
  const [form] = Form.useForm();
  const latestEnvelopeRef = useRef<ConfigSectionEnvelope<EnvSection> | null>(null);
  const baseDraftRef = useRef<EnvVarDraft | null>(null);
  const baseMetadataRef = useRef<EnvVarMetadata | null>(null);
  const envSnapshot = useConfigSectionStore((state) => state.sections.env);
  const credentialsSnapshot = useConfigSectionStore((state) => state.sections.credentials);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const saveEnvVar = useConfigSectionStore((state) => state.saveEnvVar);
  const deleteEnvVar = useConfigSectionStore((state) => state.deleteEnvVar);
  const entries = envSnapshot.envelope?.data ?? EMPTY_ENV_ENTRIES;
  const revision = envSnapshot.envelope?.revision ?? null;
  const loading = envSnapshot.loading || credentialsSnapshot.loading;
  const credentialStatuses = new Map(
    (credentialsSnapshot.envelope?.data ?? []).map((status) => [status.credential_ref, status]),
  );
  const credentialHealthError =
    Boolean(credentialsSnapshot.error) ||
    (credentialsSnapshot.envelope !== null && credentialsSnapshot.envelope.status !== "healthy");

  // ── Data fetching ───────────────────────────────────────────────

  useEffect(() => {
    void Promise.all([loadSection("env"), loadSection("credentials")]).catch(() => undefined);
  }, [loadSection]);

  useEffect(() => {
    const envelope = envSnapshot.envelope;
    if (!envelope) return;
    if ((latestEnvelopeRef.current?.revision ?? -1) <= envelope.revision) {
      latestEnvelopeRef.current = envelope;
    }
  }, [envSnapshot.envelope]);

  // ── Modal helpers ───────────────────────────────────────────────

  const closeModal = useCallback(() => {
    setClearRequested(false);
    setShowComparison(false);
    setModalDirty(false);
    setSaveConflict(null);
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
    setSaveConflict(null);
    setEditingName(null);
    setModalBaseRevision(revision);
    baseDraftRef.current = structuredClone(values);
    baseMetadataRef.current = null;
    replaceFormValues(values);
    setModalOpen(true);
  };

  const openEditModal = (entry: EnvSectionEntry) => {
    if (revision === null) {
      message.error(t("settings.envVars.fetchError", "Failed to load environment variables"));
      return;
    }

    const values = draftFromEntry(entry);
    setClearRequested(false);
    setShowComparison(false);
    setModalDirty(false);
    setSaveConflict(null);
    setEditingName(entry.name);
    setModalBaseRevision(revision);
    baseDraftRef.current = structuredClone(values);
    baseMetadataRef.current = metadataFromEntry(entry);
    replaceFormValues(values);
    setModalOpen(true);
  };

  const adoptModalEnvelope = useCallback(
    (envelope: ConfigSectionEnvelope<EnvSection>, keepDraft: boolean) => {
      if (!modalOpen) return;

      const latestEntry = editingName
        ? envelope.data.find((entry) => entry.name === editingName)
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
      setModalBaseRevision(envelope.revision);
      setModalDirty(keepDraft);
      if (!keepDraft) setClearRequested(false);
      setShowComparison(false);
      setSaveConflict(null);
    },
    [closeModal, editingName, form, message, modalOpen, replaceFormValues, t],
  );

  const externalRevision =
    modalOpen && modalBaseRevision !== null && revision !== null && revision > modalBaseRevision
      ? revision
      : null;

  useEffect(() => {
    if (externalRevision === null || modalDirty || !latestEnvelopeRef.current) return;
    adoptModalEnvelope(latestEnvelopeRef.current, false);
  }, [adoptModalEnvelope, externalRevision, modalDirty]);

  const reloadModal = useCallback(async () => {
    try {
      const [latest] = await Promise.all([
        loadSection("env", { force: true }),
        loadSection("credentials", { force: true }),
      ]);
      adoptModalEnvelope(latest, false);
    } catch {
      message.error(t("settings.envVars.fetchError", "Failed to load environment variables"));
    }
  }, [adoptModalEnvelope, loadSection, message, t]);

  const reapplyModal = useCallback(() => {
    if (!latestEnvelopeRef.current) return;
    adoptModalEnvelope(latestEnvelopeRef.current, true);
  }, [adoptModalEnvelope]);

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
                ? latestEnvelopeRef.current?.data.find((entry) => entry.name === editingName)
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
    const req: EnvVarMutation = {
      name: values.name.trim(),
      ...(!editingName || values.value || clearRequested ? { value: values.value } : {}),
      secret: values.secret ?? false,
      description: values.description?.trim() || undefined,
    };

    try {
      await saveEnvVar(req, modalBaseRevision);
      message.success(
        editingName
          ? t("settings.envVars.updated", "Variable updated")
          : t("settings.envVars.created", "Variable created"),
      );
      closeModal();
    } catch (err: unknown) {
      if (err instanceof ConfigConflictError) {
        setModalDirty(true);
        setSaveConflict(err.conflict);
        await Promise.all([
          loadSection("env", { force: true }),
          loadSection("credentials", { force: true }),
        ]).catch(() => undefined);
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
      await deleteEnvVar(name, revision);
      message.success(t("settings.envVars.deleted", "Variable deleted"));
    } catch (err: unknown) {
      if (err instanceof ConfigConflictError) {
        await Promise.all([
          loadSection("env", { force: true }),
          loadSection("credentials", { force: true }),
        ]).catch(() => undefined);
      }
      message.error(
        (err instanceof Error ? err.message : undefined) ||
          t("settings.envVars.deleteError", "Failed to delete variable"),
      );
    }
  };

  const editingEntry = editingName
    ? entries.find((entry) => entry.name === editingName)
    : undefined;
  const editingCredentialState =
    editingEntry && editingEntry.secret
      ? envCredentialState(
          editingEntry,
          editingEntry.credential_ref
            ? credentialStatuses.get(editingEntry.credential_ref)
            : undefined,
          credentialHealthError,
        )
      : null;

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
      render: (value: string | undefined, record: EnvSectionEntry) => {
        if (!record.secret) {
          return (
            <Text>
              {value || <Text type="secondary">{t("settings.envVars.empty", "(empty)")}</Text>}
            </Text>
          );
        }
        const state = envCredentialState(
          record,
          record.credential_ref ? credentialStatuses.get(record.credential_ref) : undefined,
          credentialHealthError,
        );
        const labels: Record<EnvCredentialState, string> = {
          configured: t("settings.envVars.credentialConfigured", "Configured"),
          from_env: t("settings.envVars.credentialFromEnv", "From env"),
          missing: t("settings.envVars.credentialMissing", "Missing"),
          error: t("settings.envVars.credentialError", "Error"),
        };
        return (
          <Tag
            color={
              state === "error"
                ? "error"
                : state === "missing"
                  ? "warning"
                  : state === "from_env"
                    ? "processing"
                    : "success"
            }
          >
            <LockOutlined style={{ marginRight: 4 }} />
            {labels[state]}
          </Tag>
        );
      },
    },
    {
      title: t("settings.envVars.type", "Type"),
      key: "secret",
      width: 100,
      render: (_: unknown, record: EnvSectionEntry) =>
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
      render: (_: unknown, record: EnvSectionEntry) => (
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
        {externalRevision !== null || saveConflict ? (
          <Alert
            type="warning"
            showIcon
            message={
              saveConflict
                ? t("settings.envVars.revisionConflict", "Environment revision conflict")
                : t(
                    "settings.envVars.changedExternally",
                    "Environment variables changed externally",
                  )
            }
            description={
              saveConflict
                ? t(
                    "settings.envVars.revisionConflictDescription",
                    "Your draft expected revision {{expected}}; the server is at revision {{current}}. The draft was preserved.",
                    {
                      expected: saveConflict.expectedRevision,
                      current: saveConflict.currentRevision ?? externalRevision ?? "unknown",
                    },
                  )
                : t(
                    "settings.envVars.changedExternallyDescription",
                    "Your draft was preserved. Reload to discard it, compare revisions, or reapply it over the latest configuration.",
                  )
            }
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

        {editingCredentialState === "from_env" ? (
          <Alert
            type="info"
            showIcon
            message={t("settings.envVars.credentialFromEnv", "From env")}
            description={t(
              "settings.envVars.credentialFromEnvHelp",
              "The active value comes from the environment. It remains read-only unless you explicitly enter a replacement or clear the persisted binding.",
            )}
            style={{ marginBottom: 16 }}
          />
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
