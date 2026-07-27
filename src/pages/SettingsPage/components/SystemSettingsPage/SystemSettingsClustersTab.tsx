import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { CloudServerOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  ConfigConflictError,
  configSectionsService,
  type ClusterCredentialAction,
  type ClusterCredentialFieldStatus,
  type ClusterFabricCluster,
  type ClusterFabricNode,
  type ClusterNodeMutation,
  type ClusterNodePlacement,
  type ClusterNodeStatus,
  type ConfigRevisionConflict,
  type ConfigSectionEnvelope,
} from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { reapplyConfigChanges } from "@shared/hooks/useConfigSectionDraft";
import { configErrorMessage } from "@shared/utils/configErrors";

const { Text, Paragraph } = Typography;

const EMPTY_CLUSTER_NODES: ClusterFabricNode[] = [];
const EMPTY_CLUSTER_DEFINITIONS: ClusterFabricCluster[] = [];

/** Status → antd Tag color. */
const STATUS_COLOR: Record<ClusterNodeStatus, string> = {
  not_deployed: "default",
  deploying: "processing",
  running: "success",
  unreachable: "warning",
  stopped: "default",
  failed: "error",
};

/** Coarse "N ago" from an RFC3339 timestamp (recomputed each render / poll). */
const sinceLabel = (iso?: string): string => {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

interface NodeFormValues {
  label: string;
  placement_type: "local" | "ssh";
  host?: string;
  port?: number;
  username?: string;
  auth_method?: "system_ssh_config" | "password" | "private_key";
  password?: string;
  private_key?: string;
  private_key_path?: string;
  passphrase?: string;
  artifact_path?: string;
  default_role?: string;
  auto_recover?: boolean;
  // tags-mode Select yields string[]; setFieldsValue seeds it as a string.
  cluster_name?: string | string[];
  enabled: boolean;
}

const emptyNodeDraft = (): NodeFormValues => ({
  label: "",
  placement_type: "ssh",
  port: 22,
  auth_method: "password",
  password: "",
  private_key: "",
  passphrase: "",
  cluster_name: [],
  auto_recover: false,
  enabled: true,
});

const draftFromNode = (node: ClusterFabricNode, clusterName?: string): NodeFormValues => {
  const ssh =
    node.placement.type === "ssh"
      ? (node.placement as Extract<ClusterNodePlacement, { type: "ssh" }>)
      : undefined;
  return {
    label: node.label,
    placement_type: node.placement.type,
    host: ssh?.host,
    port: ssh?.port ?? 22,
    username: ssh?.username,
    auth_method: ssh?.auth.method ?? "password",
    password: "",
    private_key: "",
    private_key_path: ssh?.auth.method === "private_key" ? ssh.auth.private_key_path : undefined,
    passphrase: "",
    artifact_path: node.deploy?.artifact_path,
    default_role: node.deploy?.default_role,
    auto_recover: node.deploy?.auto_recover ?? false,
    cluster_name: clusterName ? [clusterName] : [],
    enabled: node.enabled,
  };
};

const redactNodeDraft = (draft: NodeFormValues, clearPassphrase: boolean) => ({
  ...draft,
  password: draft.password ? "[replace requested]" : "",
  private_key: draft.private_key ? "[replace requested]" : "",
  passphrase: draft.passphrase ? "[replace requested]" : "",
  clearPassphrase,
});

const selectedClusterNames = (value: string | string[] | undefined): string[] => {
  const raw = Array.isArray(value) ? value : value ? [value] : [];
  return raw
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, 1);
};

const keepCredential: ClusterCredentialAction = { action: "keep" };
const clearCredential: ClusterCredentialAction = { action: "clear" };

/**
 * Remote Cluster Fabric management tab.
 *
 * Register/maintain nodes (local or SSH-reachable machines) grouped into
 * clusters. SSH credentials are encrypted at rest by the backend and never
 * leave it. Per-row Test (connect preflight), Deploy, Stop, and Logs drive the
 * backend deploy engine; all SSH happens server-side.
 */
const SystemSettingsClustersTab: React.FC = () => {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalBaseRevision, setModalBaseRevision] = useState<number | null>(null);
  const [modalDirty, setModalDirty] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [clearPassphrase, setClearPassphrase] = useState(false);
  const [saveConflict, setSaveConflict] = useState<ConfigRevisionConflict | null>(null);
  const [form] = Form.useForm<NodeFormValues>();
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsNode, setLogsNode] = useState<ClusterFabricNode | null>(null);
  const [logsText, setLogsText] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const baseDraftRef = useRef<NodeFormValues | null>(null);
  const clusterSnapshot = useConfigSectionStore((state) => state.sections["cluster-fabric"]);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const saveClusterNode = useConfigSectionStore((state) => state.saveClusterNode);
  const deleteClusterNode = useConfigSectionStore((state) => state.deleteClusterNode);
  const runClusterNodeAction = useConfigSectionStore((state) => state.runClusterNodeAction);
  const envelope = clusterSnapshot.envelope;
  const nodes = envelope?.data.nodes ?? EMPTY_CLUSTER_NODES;
  const clusters = envelope?.data.clusters ?? EMPTY_CLUSTER_DEFINITIONS;
  const loading = clusterSnapshot.loading && !envelope;

  const placementType = Form.useWatch("placement_type", form);
  const authMethod = Form.useWatch("auth_method", form);

  // ── Data ─────────────────────────────────────────────────────────

  useEffect(() => {
    void loadSection("cluster-fabric").catch(() => {
      message.error(t("settings.clusters.fetchError", "Failed to load clusters"));
    });
  }, [loadSection, message, t]);

  // Map node id → its cluster name (first membership wins) for the table.
  const nodeClusterName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clusters) {
      for (const id of c.node_ids) {
        if (!map.has(id)) map.set(id, c.name);
      }
    }
    return map;
  }, [clusters]);

  // ── Modal ────────────────────────────────────────────────────────

  const replaceFormValues = useCallback(
    (values: NodeFormValues) => {
      form.resetFields();
      form.setFieldsValue(values);
    },
    [form],
  );

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingId(null);
    setModalBaseRevision(null);
    setModalDirty(false);
    setShowComparison(false);
    setClearPassphrase(false);
    setSaveConflict(null);
    baseDraftRef.current = null;
    form.resetFields();
  }, [form]);

  const openAddModal = () => {
    if (!envelope) {
      message.error(t("settings.clusters.fetchError", "Failed to load clusters"));
      return;
    }
    const values = emptyNodeDraft();
    setEditingId(null);
    setModalBaseRevision(envelope.revision);
    setModalDirty(false);
    setShowComparison(false);
    setClearPassphrase(false);
    setSaveConflict(null);
    baseDraftRef.current = structuredClone(values);
    replaceFormValues(values);
    setModalOpen(true);
  };

  const openEditModal = (node: ClusterFabricNode) => {
    if (!envelope) {
      message.error(t("settings.clusters.fetchError", "Failed to load clusters"));
      return;
    }
    const values = draftFromNode(node, nodeClusterName.get(node.id));
    setEditingId(node.id);
    setModalBaseRevision(envelope.revision);
    setModalDirty(false);
    setShowComparison(false);
    setClearPassphrase(false);
    setSaveConflict(null);
    baseDraftRef.current = structuredClone(values);
    replaceFormValues(values);
    setModalOpen(true);
  };

  const adoptModalEnvelope = useCallback(
    (
      latestEnvelope: ConfigSectionEnvelope<NonNullable<typeof envelope>["data"]>,
      keepDraft: boolean,
    ) => {
      if (!modalOpen) return;
      const latestNode = editingId
        ? latestEnvelope.data.nodes.find((node) => node.id === editingId)
        : null;
      if (editingId && !latestNode) {
        message.warning(
          t(
            "settings.clusters.removedExternally",
            "This cluster node no longer exists in the latest configuration.",
          ),
        );
        closeModal();
        return;
      }
      const latestClusterName = editingId
        ? latestEnvelope.data.clusters.find((cluster) => cluster.node_ids.includes(editingId))?.name
        : undefined;
      const latestDraft = latestNode
        ? draftFromNode(latestNode, latestClusterName)
        : emptyNodeDraft();
      const currentDraft = form.getFieldsValue(true) as NodeFormValues;
      const nextDraft =
        keepDraft && baseDraftRef.current
          ? reapplyConfigChanges(baseDraftRef.current, currentDraft, latestDraft)
          : latestDraft;

      replaceFormValues(nextDraft);
      baseDraftRef.current = structuredClone(latestDraft);
      setModalBaseRevision(latestEnvelope.revision);
      setModalDirty(keepDraft);
      if (!keepDraft) setClearPassphrase(false);
      setShowComparison(false);
      setSaveConflict(null);
    },
    [closeModal, editingId, form, message, modalOpen, replaceFormValues, t],
  );

  useEffect(() => {
    if (
      !modalOpen ||
      modalDirty ||
      !envelope ||
      modalBaseRevision === null ||
      envelope.revision <= modalBaseRevision
    ) {
      return;
    }
    adoptModalEnvelope(envelope, false);
  }, [adoptModalEnvelope, envelope, modalBaseRevision, modalDirty, modalOpen]);

  const externalRevision =
    modalOpen && envelope && modalBaseRevision !== null && envelope.revision > modalBaseRevision
      ? envelope.revision
      : null;

  const reloadModal = useCallback(async () => {
    try {
      const latest = await loadSection("cluster-fabric", { force: true });
      adoptModalEnvelope(latest, false);
    } catch (error) {
      message.error(
        configErrorMessage(error, t("settings.clusters.fetchError", "Failed to load clusters")),
      );
    }
  }, [adoptModalEnvelope, loadSection, message, t]);

  const reapplyModal = useCallback(async () => {
    try {
      const latest = await loadSection("cluster-fabric", { force: true });
      adoptModalEnvelope(latest, true);
    } catch (error) {
      message.error(
        configErrorMessage(error, t("settings.clusters.fetchError", "Failed to load clusters")),
      );
    }
  }, [adoptModalEnvelope, loadSection, message, t]);

  const comparison =
    showComparison && externalRevision !== null && envelope && baseDraftRef.current
      ? JSON.stringify(
          {
            revisions: { base: modalBaseRevision, latest: envelope.revision },
            base: redactNodeDraft(baseDraftRef.current, false),
            draft: redactNodeDraft(form.getFieldsValue(true) as NodeFormValues, clearPassphrase),
            latest: editingId
              ? (() => {
                  const latest = envelope.data.nodes.find((node) => node.id === editingId);
                  const clusterName = envelope.data.clusters.find((cluster) =>
                    cluster.node_ids.includes(editingId),
                  )?.name;
                  return latest ? redactNodeDraft(draftFromNode(latest, clusterName), false) : null;
                })()
              : redactNodeDraft(emptyNodeDraft(), false),
          },
          null,
          2,
        )
      : null;

  const buildPlacement = (values: NodeFormValues): ClusterNodePlacement => {
    if (values.placement_type === "local") return { type: "local" };
    const existingPlacement = editingId
      ? nodes.find((node) => node.id === editingId)?.placement
      : undefined;
    const auth =
      values.auth_method === "system_ssh_config"
        ? ({ method: "system_ssh_config" } as const)
        : values.auth_method === "private_key"
          ? ({
              method: "private_key",
              ...(values.private_key_path?.trim()
                ? { private_key_path: values.private_key_path.trim() }
                : {}),
            } as const)
          : ({ method: "password" } as const);
    return {
      type: "ssh",
      host: values.host?.trim() ?? "",
      port: values.port ?? 22,
      username: values.username?.trim() ?? "",
      auth,
      ...(existingPlacement?.type === "ssh" && existingPlacement.host_key_fingerprint
        ? { host_key_fingerprint: existingPlacement.host_key_fingerprint }
        : {}),
    };
  };

  const buildCredentialChanges = (
    values: NodeFormValues,
  ): ClusterNodeMutation["credential_changes"] => {
    if (values.placement_type === "local" || values.auth_method === "system_ssh_config") {
      return {
        password: clearCredential,
        private_key: clearCredential,
        passphrase: clearCredential,
      };
    }
    if (values.auth_method === "private_key") {
      const privateKey = values.private_key?.trim();
      const passphrase = values.passphrase?.trim();
      return {
        password: clearCredential,
        private_key: values.private_key_path?.trim()
          ? clearCredential
          : privateKey
            ? { action: "replace", value: privateKey }
            : keepCredential,
        passphrase: clearPassphrase
          ? clearCredential
          : passphrase
            ? { action: "replace", value: passphrase }
            : keepCredential,
      };
    }
    const password = values.password?.trim();
    return {
      password: password ? { action: "replace", value: password } : keepCredential,
      private_key: clearCredential,
      passphrase: clearCredential,
    };
  };

  const handleSave = async (values: NodeFormValues) => {
    if (modalBaseRevision === null) {
      message.error(t("settings.clusters.fetchError", "Failed to load clusters"));
      return;
    }
    const request: ClusterNodeMutation = {
      label: values.label.trim(),
      placement: buildPlacement(values),
      trust_level: nodes.find((node) => node.id === editingId)?.trust_level ?? "trusted",
      enabled: values.enabled ?? true,
      deploy: {
        ...(nodes.find((node) => node.id === editingId)?.deploy ?? {}),
        artifact_path: values.artifact_path?.trim() || undefined,
        default_role: values.default_role?.trim() || undefined,
        auto_recover: values.auto_recover ?? false,
      },
      credential_changes: buildCredentialChanges(values),
      membership: { cluster_names: selectedClusterNames(values.cluster_name) },
    };

    try {
      await saveClusterNode(editingId, request, modalBaseRevision);
      message.success(
        editingId
          ? t("settings.clusters.updated", "Node updated")
          : t("settings.clusters.created", "Node created"),
      );
      closeModal();
    } catch (error: unknown) {
      if (error instanceof ConfigConflictError) {
        setModalDirty(true);
        setSaveConflict(error.conflict);
        try {
          await loadSection("cluster-fabric", { force: true });
        } catch {
          // Keep the original conflict visible when the diagnostic refresh fails.
        }
      }
      message.error(
        configErrorMessage(error, t("settings.clusters.saveError", "Failed to save node")),
      );
    }
  };

  // ── Row actions ──────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    if (!envelope) return;
    try {
      await deleteClusterNode(id, envelope.revision);
      message.success(t("settings.clusters.deleted", "Node deleted"));
    } catch (err: unknown) {
      message.error(
        configErrorMessage(err, t("settings.clusters.deleteError", "Failed to delete node")),
      );
    }
  };

  const handleAction = async (id: string, action: "test" | "deploy" | "stop") => {
    if (!envelope) return;
    try {
      const res = await runClusterNodeAction(id, action, envelope.revision);
      // `test` returns a preflight string (e.g. remote uname); surface it.
      const preflight = action === "test" ? (res.preflight ?? "") : "";
      message.success(
        preflight
          ? t("settings.clusters.testOk", "Reachable: {{info}}", { info: preflight })
          : t("settings.clusters.actionOk", "Action triggered"),
      );
    } catch (err: unknown) {
      message.error(configErrorMessage(err, t("settings.clusters.actionFailed", "Action failed")));
    }
  };

  const showLogs = async (node: ClusterFabricNode) => {
    setLogsNode(node);
    setLogsOpen(true);
    setLogsLoading(true);
    setLogsText("");
    try {
      const res = await configSectionsService.getClusterNodeLogs(node.id, 200);
      setLogsText(res.logs || t("settings.clusters.logsEmpty", "(no log output yet)"));
    } catch (err: unknown) {
      setLogsText(configErrorMessage(err, t("settings.clusters.logsError", "Failed to read logs")));
    } finally {
      setLogsLoading(false);
    }
  };

  // ── Columns ──────────────────────────────────────────────────────

  const editingNode = editingId ? nodes.find((node) => node.id === editingId) : undefined;
  const editingCredentialStatus = editingId
    ? envelope?.data.credential_status[editingId]
    : undefined;
  const isConfiguredCredential = (status: ClusterCredentialFieldStatus | undefined): boolean =>
    status?.state === "configured" || status?.state === "from_env";
  const credentialStatusBadge = (
    label: string,
    status: ClusterCredentialFieldStatus | undefined,
  ) => {
    if (!status) return null;
    const stateLabel = {
      configured: t("settings.clusters.credentialConfigured", "Configured"),
      from_env: t("settings.clusters.credentialFromEnv", "From env"),
      missing: t("settings.clusters.credentialMissing", "Missing"),
      error: t("settings.clusters.credentialError", "Error"),
    }[status.state];
    const color = {
      configured: "success",
      from_env: "processing",
      missing: "warning",
      error: "error",
    }[status.state];
    return (
      <Flex gap={8} align="center" wrap="wrap">
        <Text type="secondary">{label}</Text>
        <Tag color={color}>{stateLabel}</Tag>
        {status.state === "from_env" ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t(
              "settings.clusters.environmentCredentialHint",
              "The environment value is read-only; only an explicit replacement is persisted.",
            )}
          </Text>
        ) : null}
      </Flex>
    );
  };

  const columns = [
    {
      title: t("settings.clusters.label", "Label"),
      dataIndex: "label",
      key: "label",
      render: (label: string, node: ClusterFabricNode) => (
        <Space>
          <CloudServerOutlined />
          <Text strong>{label}</Text>
          {!node.enabled && <Tag>{t("settings.clusters.disabled", "disabled")}</Tag>}
        </Space>
      ),
    },
    {
      title: t("settings.clusters.target", "Target"),
      key: "target",
      render: (_: unknown, node: ClusterFabricNode) =>
        node.placement.type === "ssh" ? (
          <Text code>
            {node.placement.username}@{node.placement.host}:{node.placement.port}
          </Text>
        ) : (
          <Tag color="blue">{t("settings.clusters.local", "local")}</Tag>
        ),
    },
    {
      title: t("settings.clusters.cluster", "Cluster"),
      key: "cluster",
      render: (_: unknown, node: ClusterFabricNode) => {
        const name = nodeClusterName.get(node.id);
        return name ? <Tag>{name}</Tag> : <Text type="secondary">—</Text>;
      },
    },
    {
      title: t("settings.clusters.status", "Status"),
      key: "status",
      render: (_: unknown, node: ClusterFabricNode) => {
        const status = node.state?.status ?? "not_deployed";
        const lastError = node.state?.last_error;
        const lastSeen = sinceLabel(node.state?.last_health);
        const tag = <Tag color={STATUS_COLOR[status]}>{status.replace(/_/g, " ")}</Tag>;
        return (
          <Space direction="vertical" size={0}>
            {lastError && (status === "unreachable" || status === "failed") ? (
              <Tooltip title={lastError}>{tag}</Tooltip>
            ) : (
              tag
            )}
            {lastSeen && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t("settings.clusters.lastSeen", "seen {{ago}}", { ago: lastSeen })}
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: t("settings.clusters.actions", "Actions"),
      key: "actions",
      width: 320,
      render: (_: unknown, node: ClusterFabricNode) => (
        <Space size="small" wrap>
          <Button size="small" onClick={() => handleAction(node.id, "test")}>
            {t("settings.clusters.test", "Test")}
          </Button>
          <Button size="small" type="primary" ghost onClick={() => handleAction(node.id, "deploy")}>
            {t("settings.clusters.deploy", "Deploy")}
          </Button>
          <Button size="small" onClick={() => handleAction(node.id, "stop")}>
            {t("settings.clusters.stop", "Stop")}
          </Button>
          <Button size="small" onClick={() => showLogs(node)}>
            {t("settings.clusters.logs", "Logs")}
          </Button>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(node)}
            aria-label={t("settings.clusters.edit", "Edit")}
          />
          <Popconfirm
            title={t("settings.clusters.deleteConfirm", "Delete this node?")}
            onConfirm={() => handleDelete(node.id)}
            okText={t("settings.clusters.yes", "Yes")}
            cancelText={t("settings.clusters.no", "No")}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={t("settings.clusters.delete", "Delete")}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const isSshForm = placementType !== "local";

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1000 }}>
      <Card
        className="lotus-settings-card"
        title={t("settings.clusters.title", "Remote Clusters")}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
            {t("settings.clusters.addButton", "Add Node")}
          </Button>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          {t(
            "settings.clusters.description",
            "Register machines (local or over SSH) to deploy worker agents onto. SSH credentials are encrypted at rest and never sent to the agent. Deploy/Test/Stop are wired but the deploy engine ships in a later phase.",
          )}
        </Paragraph>

        <Table
          dataSource={nodes}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={false}
          loading={loading}
          locale={{ emptyText: t("settings.clusters.noNodes", "No nodes registered") }}
        />
      </Card>

      <Modal
        title={
          editingId
            ? t("settings.clusters.editTitle", "Edit Node")
            : t("settings.clusters.addTitle", "Add Node")
        }
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        okText={t("settings.clusters.save", "Save")}
        cancelText={t("settings.clusters.cancel", "Cancel")}
        width={560}
        destroyOnClose
      >
        {externalRevision !== null || saveConflict ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message={
              saveConflict
                ? t("settings.clusters.revisionConflict", "Cluster revision conflict")
                : t(
                    "settings.clusters.changedExternally",
                    "Cluster configuration changed externally",
                  )
            }
            description={
              saveConflict
                ? t(
                    "settings.clusters.revisionConflictDescription",
                    "Your draft expected revision {{expected}}; the server is at revision {{current}}. The draft was preserved.",
                    {
                      expected: saveConflict.expectedRevision,
                      current: saveConflict.currentRevision ?? externalRevision ?? "unknown",
                    },
                  )
                : t(
                    "settings.clusters.changedExternallyDescription",
                    "Revision {{base}} changed to {{latest}}. Your unsaved node draft was preserved.",
                    { base: modalBaseRevision, latest: externalRevision },
                  )
            }
            action={
              <Flex gap={8} wrap="wrap">
                <Button size="small" onClick={() => void reloadModal()}>
                  {t("settings.clusters.reload", "Reload")}
                </Button>
                <Button size="small" onClick={() => setShowComparison((current) => !current)}>
                  {t("settings.clusters.compare", "Compare")}
                </Button>
                <Button size="small" type="primary" onClick={() => void reapplyModal()}>
                  {t("settings.clusters.reapply", "Reapply")}
                </Button>
              </Flex>
            }
          />
        ) : null}

        {comparison ? (
          <pre
            data-testid="cluster-revision-comparison"
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
        >
          <Form.Item
            name="label"
            label={t("settings.clusters.label", "Label")}
            rules={[
              {
                required: true,
                message: t("settings.clusters.labelRequired", "Label is required"),
              },
            ]}
          >
            <Input placeholder="gpu-1" autoFocus />
          </Form.Item>

          <Form.Item name="placement_type" label={t("settings.clusters.placement", "Placement")}>
            <Select
              options={[
                { value: "ssh", label: t("settings.clusters.ssh", "SSH (remote)") },
                { value: "local", label: t("settings.clusters.localhost", "Local (this host)") },
              ]}
            />
          </Form.Item>

          {isSshForm && (
            <>
              <Space.Compact block>
                <Form.Item
                  name="host"
                  label={t("settings.clusters.host", "Host")}
                  style={{ width: "70%" }}
                  rules={[
                    {
                      required: true,
                      message: t("settings.clusters.hostRequired", "Host is required"),
                    },
                  ]}
                >
                  <Input placeholder="10.0.0.5" />
                </Form.Item>
                <Form.Item
                  name="port"
                  label={t("settings.clusters.port", "Port")}
                  style={{ width: "30%" }}
                >
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                </Form.Item>
              </Space.Compact>

              <Form.Item
                name="username"
                label={t("settings.clusters.username", "Username")}
                rules={[
                  {
                    required: true,
                    message: t("settings.clusters.usernameRequired", "Username is required"),
                  },
                ]}
              >
                <Input placeholder="deploy" />
              </Form.Item>

              <Form.Item
                name="auth_method"
                label={t("settings.clusters.authMethod", "Auth method")}
              >
                <Select
                  options={[
                    { value: "password", label: t("settings.clusters.password", "Password") },
                    {
                      value: "private_key",
                      label: t("settings.clusters.privateKey", "Private key"),
                    },
                    {
                      value: "system_ssh_config",
                      label: t("settings.clusters.systemSsh", "Use host's SSH config"),
                    },
                  ]}
                />
              </Form.Item>

              {authMethod === "password" && (
                <Form.Item
                  name="password"
                  label={t("settings.clusters.password", "Password")}
                  extra={
                    editingNode ? (
                      <Space direction="vertical" size={4}>
                        {credentialStatusBadge(
                          t("settings.clusters.password", "Password"),
                          editingCredentialStatus?.password,
                        )}
                        <Text type="secondary">
                          {t(
                            "settings.clusters.secretEditHint",
                            "Leave empty to keep the existing secret",
                          )}
                        </Text>
                      </Space>
                    ) : undefined
                  }
                  rules={[
                    {
                      required: !isConfiguredCredential(editingCredentialStatus?.password),
                      message: t("settings.clusters.passwordRequired", "Password is required"),
                    },
                  ]}
                >
                  <Input.Password
                    visibilityToggle
                    placeholder={
                      editingNode
                        ? t("settings.clusters.keepSecret", "Enter new password or leave empty")
                        : undefined
                    }
                  />
                </Form.Item>
              )}

              {authMethod === "private_key" && (
                <>
                  <Form.Item
                    name="private_key_path"
                    label={t(
                      "settings.clusters.privateKeyPath",
                      "Private key file path (on this host)",
                    )}
                  >
                    <Input placeholder="~/.ssh/id_ed25519" />
                  </Form.Item>
                  <Form.Item
                    name="private_key"
                    label={t("settings.clusters.privateKeyInline", "…or paste key (PEM)")}
                    dependencies={["private_key_path"]}
                    extra={
                      editingNode ? (
                        <Space direction="vertical" size={4}>
                          {credentialStatusBadge(
                            t("settings.clusters.privateKey", "Private key"),
                            editingCredentialStatus?.private_key,
                          )}
                          <Text type="secondary">
                            {t(
                              "settings.clusters.secretEditHint",
                              "Leave empty to keep the existing secret",
                            )}
                          </Text>
                        </Space>
                      ) : undefined
                    }
                    rules={[
                      {
                        validator: async () => {
                          const path = (
                            form.getFieldValue("private_key_path") as string | undefined
                          )?.trim();
                          const inline = (
                            form.getFieldValue("private_key") as string | undefined
                          )?.trim();
                          if (path || inline) return;
                          if (isConfiguredCredential(editingCredentialStatus?.private_key)) return;
                          throw new Error(
                            t(
                              "settings.clusters.privateKeyRequired",
                              "Provide a key file path or paste a private key",
                            ),
                          );
                        },
                      },
                    ]}
                  >
                    <Input.TextArea rows={3} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                  </Form.Item>
                  <Form.Item
                    name="passphrase"
                    label={t("settings.clusters.passphrase", "Passphrase")}
                    extra={
                      editingNode ? (
                        <Space direction="vertical" size={4}>
                          {credentialStatusBadge(
                            t("settings.clusters.passphrase", "Passphrase"),
                            editingCredentialStatus?.passphrase,
                          )}
                          {isConfiguredCredential(editingCredentialStatus?.passphrase) ? (
                            <Button
                              size="small"
                              danger={clearPassphrase}
                              onClick={() => {
                                setClearPassphrase((current) => !current);
                                form.setFieldValue("passphrase", "");
                                setModalDirty(true);
                              }}
                            >
                              {clearPassphrase
                                ? t(
                                    "settings.clusters.passphraseWillClear",
                                    "Passphrase will be cleared",
                                  )
                                : t("settings.clusters.clearPassphrase", "Clear stored passphrase")}
                            </Button>
                          ) : null}
                        </Space>
                      ) : undefined
                    }
                  >
                    <Input.Password
                      visibilityToggle
                      disabled={clearPassphrase}
                      onChange={() => {
                        if (clearPassphrase) setClearPassphrase(false);
                      }}
                    />
                  </Form.Item>
                </>
              )}
            </>
          )}

          <Form.Item
            name="artifact_path"
            label={t("settings.clusters.artifactPath", "Artifact path (binary to upload)")}
            extra={t(
              "settings.clusters.artifactHint",
              "Path on this host to the correct-arch bamboo binary; used at deploy time (P2).",
            )}
          >
            <Input placeholder="/path/to/bamboo-linux-x64" />
          </Form.Item>

          <Form.Item name="default_role" label={t("settings.clusters.role", "Default role")}>
            <Input placeholder="worker" />
          </Form.Item>

          <Form.Item
            name="auto_recover"
            label={t("settings.clusters.autoRecover", "Auto-recover")}
            valuePropName="checked"
            extra={t(
              "settings.clusters.autoRecoverHint",
              "Redeploy this node automatically if the health monitor finds its worker gone.",
            )}
          >
            <Switch />
          </Form.Item>

          <Form.Item name="cluster_name" label={t("settings.clusters.cluster", "Cluster")}>
            <Select
              allowClear
              showSearch
              mode="tags"
              maxCount={1}
              placeholder={t("settings.clusters.clusterPlaceholder", "Pick or type a cluster name")}
              options={clusters.map((c) => ({ value: c.name, label: c.name }))}
            />
          </Form.Item>

          <Form.Item
            name="enabled"
            label={t("settings.clusters.enabled", "Enabled")}
            valuePropName="checked"
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Logs drawer ───────────────────────────────────────────── */}
      <Modal
        title={t("settings.clusters.logsTitle", "Logs — {{label}}", {
          label: logsNode?.label ?? "",
        })}
        open={logsOpen}
        onCancel={() => setLogsOpen(false)}
        onOk={() => logsNode && showLogs(logsNode)}
        okText={t("settings.clusters.refresh", "Refresh")}
        cancelText={t("settings.clusters.close", "Close")}
        width={760}
        destroyOnClose
      >
        {logsLoading ? (
          <Text type="secondary">{t("settings.clusters.loading", "Loading…")}</Text>
        ) : (
          <pre
            style={{
              maxHeight: 420,
              overflow: "auto",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: 0,
            }}
          >
            {logsText}
          </pre>
        )}
      </Modal>
    </div>
  );
};

export default SystemSettingsClustersTab;
