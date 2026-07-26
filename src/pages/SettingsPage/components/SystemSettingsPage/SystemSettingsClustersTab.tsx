import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntApp,
  Button,
  Card,
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
  settingsService,
  FabricNode,
  FabricCluster,
  NodePlacement,
  NodeStatus,
  NodeUpsertRequest,
  SshAuth,
} from "@services/config/SettingsService";
import { configSectionsService } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";

const { Text, Paragraph } = Typography;

/** Status → antd Tag color. */
const STATUS_COLOR: Record<NodeStatus, string> = {
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

const STATUS_POLL_MS = 30_000;

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

  const [nodes, setNodes] = useState<FabricNode[]>([]);
  const [clusters, setClusters] = useState<FabricCluster[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm<NodeFormValues>();
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsNode, setLogsNode] = useState<FabricNode | null>(null);
  const [logsText, setLogsText] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);
  const [credentialRevision, setCredentialRevision] = useState<number | null>(null);
  const clusterSnapshot = useConfigSectionStore((state) => state.sections["cluster-fabric"]);
  const loadSection = useConfigSectionStore((state) => state.loadSection);

  const placementType = Form.useWatch("placement_type", form);
  const authMethod = Form.useWatch("auth_method", form);

  // ── Data ─────────────────────────────────────────────────────────

  // Monotonic id so an out-of-order fetch (a slow poll resolving after a newer
  // load/poll) can't overwrite fresher data.
  const fetchSeq = useRef(0);

  const fetchAll = useCallback(
    async (silent = false) => {
      const seq = ++fetchSeq.current;
      if (!silent) setLoading(true);
      try {
        const [res, credentials] = await Promise.all([
          settingsService.listNodes(),
          configSectionsService.listCredentials(),
          loadSection("cluster-fabric", { force: true }).catch(() => undefined),
        ]);
        if (seq !== fetchSeq.current) return; // superseded by a newer fetch
        setNodes(res.nodes);
        setClusters(res.clusters);
        setCredentialRevision(credentials.revision);
      } catch {
        // A background poll shouldn't spam errors; only surface an explicit load.
        if (!silent) message.error(t("settings.clusters.fetchError", "Failed to load clusters"));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [loadSection, message, t],
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (clusterSnapshot.envelope) void fetchAll(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterSnapshot.envelope?.revision]);

  // Live status: silently re-poll while the tab is visible and no modal is open
  // (editing/logs), so health flips (running↔unreachable) + "last seen" refresh
  // without a manual reload. Also refreshes immediately on regaining visibility.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible" && !modalOpen && !logsOpen) {
        fetchAll(true);
      }
    };
    const timer = window.setInterval(tick, STATUS_POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fetchAll, modalOpen, logsOpen]);

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

  const openAddModal = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({
      placement_type: "ssh",
      port: 22,
      auth_method: "password",
      enabled: true,
    });
    setModalOpen(true);
  };

  const openEditModal = (node: FabricNode) => {
    setEditingId(node.id);
    const isSsh = node.placement.type === "ssh";
    const ssh = isSsh ? (node.placement as Extract<NodePlacement, { type: "ssh" }>) : undefined;
    form.setFieldsValue({
      label: node.label,
      placement_type: node.placement.type,
      host: ssh?.host,
      port: ssh?.port ?? 22,
      username: ssh?.username,
      auth_method: ssh?.auth.method ?? "password",
      // Secrets come back masked; leave blank so the user re-enters only to change.
      password: "",
      private_key: "",
      private_key_path: ssh?.auth.method === "private_key" ? ssh.auth.private_key_path : undefined,
      passphrase: "",
      artifact_path: node.deploy?.artifact_path,
      default_role: node.deploy?.default_role,
      auto_recover: node.deploy?.auto_recover ?? false,
      cluster_name: (() => {
        const n = nodeClusterName.get(node.id);
        return n ? [n] : [];
      })(),
      enabled: node.enabled,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingId(null);
    form.resetFields();
  };

  const buildPlacement = (v: NodeFormValues): NodePlacement => {
    if (v.placement_type === "local") return { type: "local" };
    // Secret fields stay blank. Omission preserves an existing credential;
    // switching auth methods or supplying a replacement is explicit.
    const original = editingId ? nodes.find((n) => n.id === editingId) : undefined;
    const originalAuth =
      original?.placement.type === "ssh"
        ? (original.placement as Extract<NodePlacement, { type: "ssh" }>).auth
        : undefined;
    const preserve = (existing: string | undefined, entered: string | undefined) =>
      Boolean(existing) && !entered;
    let auth: SshAuth;
    if (v.auth_method === "system_ssh_config") {
      auth = { method: "system_ssh_config" };
    } else if (v.auth_method === "private_key") {
      const existingKey =
        originalAuth?.method === "private_key" ? originalAuth.private_key : undefined;
      const existingPass =
        originalAuth?.method === "private_key" ? originalAuth.passphrase : undefined;
      auth = {
        method: "private_key",
        private_key: preserve(existingKey, v.private_key) ? undefined : v.private_key || undefined,
        private_key_path: v.private_key_path || undefined,
        passphrase: preserve(existingPass, v.passphrase) ? undefined : v.passphrase || undefined,
      };
    } else {
      const existingPw = originalAuth?.method === "password" ? originalAuth.password : undefined;
      auth = {
        method: "password",
        password: preserve(existingPw, v.password) ? undefined : v.password,
      };
    }
    return {
      type: "ssh",
      host: v.host?.trim() ?? "",
      port: v.port ?? 22,
      username: v.username?.trim() ?? "",
      auth,
    };
  };

  const handleSave = async (v: NodeFormValues) => {
    if (credentialRevision === null) {
      message.error(t("settings.clusters.fetchError", "Failed to load clusters"));
      return;
    }
    const req: NodeUpsertRequest = {
      label: v.label.trim(),
      placement: buildPlacement(v),
      enabled: v.enabled ?? true,
      deploy: {
        artifact_path: v.artifact_path?.trim() || undefined,
        default_role: v.default_role?.trim() || undefined,
        auto_recover: v.auto_recover ?? false,
      },
    };

    try {
      const result = editingId
        ? await settingsService.updateNode(editingId, req, credentialRevision)
        : await settingsService.createNode(req, credentialRevision);
      const saved = result.node;
      setCredentialRevision(result.revision);

      // The cluster Select uses tags-mode → value is an array; take the first.
      const clusterName = Array.isArray(v.cluster_name) ? v.cluster_name[0] : v.cluster_name;
      // The node is now persisted. Cluster membership is a SEPARATE set of writes;
      // a failure there must not be reported as a node-save failure (the save
      // succeeded), and we still refetch so the UI reflects what actually persisted.
      try {
        await applyClusterMembership(saved.id, clusterName);
      } catch (memErr: unknown) {
        message.warning(
          (memErr instanceof Error ? memErr.message : undefined) ||
            t(
              "settings.clusters.membershipError",
              "Node saved, but updating cluster membership failed",
            ),
        );
        closeModal();
        fetchAll();
        return;
      }

      message.success(
        editingId
          ? t("settings.clusters.updated", "Node updated")
          : t("settings.clusters.created", "Node created"),
      );
      closeModal();
      fetchAll();
    } catch (err: unknown) {
      message.error(
        (err instanceof Error ? err.message : undefined) ||
          t("settings.clusters.saveError", "Failed to save node"),
      );
    }
  };

  /** Ensure `nodeId` belongs to `clusterName` (creating the cluster if needed),
   *  and remove it from any other cluster. No-op when clusterName is empty. */
  const applyClusterMembership = async (nodeId: string, clusterName?: string) => {
    const target = clusterName?.trim();
    for (const c of clusters) {
      const isTarget = c.name === target;
      const has = c.node_ids.includes(nodeId);
      if (!isTarget && has) {
        await settingsService.updateCluster(c.name, {
          name: c.name,
          description: c.description,
          node_ids: c.node_ids.filter((id) => id !== nodeId),
        });
      }
    }
    if (!target) return;
    const existing = clusters.find((c) => c.name === target);
    if (existing) {
      if (!existing.node_ids.includes(nodeId)) {
        await settingsService.updateCluster(target, {
          name: target,
          description: existing.description,
          node_ids: [...existing.node_ids, nodeId],
        });
      }
    } else {
      await settingsService.createCluster({ name: target, node_ids: [nodeId] });
    }
  };

  // ── Row actions ──────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    if (credentialRevision === null) return;
    try {
      const result = await settingsService.deleteNode(id, credentialRevision);
      setCredentialRevision(result.revision);
      message.success(t("settings.clusters.deleted", "Node deleted"));
      fetchAll();
    } catch (err: unknown) {
      message.error(
        (err instanceof Error ? err.message : undefined) ||
          t("settings.clusters.deleteError", "Failed to delete node"),
      );
    }
  };

  const handleAction = async (id: string, action: "test" | "deploy" | "stop") => {
    try {
      const res = await settingsService.nodeAction(id, action);
      // `test` returns a preflight string (e.g. remote uname); surface it.
      const preflight =
        action === "test" && res && typeof res === "object" && "preflight" in res
          ? String((res as { preflight?: unknown }).preflight ?? "")
          : "";
      message.success(
        preflight
          ? t("settings.clusters.testOk", "Reachable: {{info}}", { info: preflight })
          : t("settings.clusters.actionOk", "Action triggered"),
      );
      fetchAll();
    } catch (err: unknown) {
      message.error(
        (err instanceof Error ? err.message : undefined) ||
          t("settings.clusters.actionFailed", "Action failed"),
      );
    }
  };

  const showLogs = async (node: FabricNode) => {
    setLogsNode(node);
    setLogsOpen(true);
    setLogsLoading(true);
    setLogsText("");
    try {
      const res = await settingsService.nodeLogs(node.id, 200);
      setLogsText(res.logs || t("settings.clusters.logsEmpty", "(no log output yet)"));
    } catch (err: unknown) {
      setLogsText(
        (err instanceof Error ? err.message : undefined) ||
          t("settings.clusters.logsError", "Failed to read logs"),
      );
    } finally {
      setLogsLoading(false);
    }
  };

  // ── Columns ──────────────────────────────────────────────────────

  const columns = [
    {
      title: t("settings.clusters.label", "Label"),
      dataIndex: "label",
      key: "label",
      render: (label: string, node: FabricNode) => (
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
      render: (_: unknown, node: FabricNode) =>
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
      render: (_: unknown, node: FabricNode) => {
        const name = nodeClusterName.get(node.id);
        return name ? <Tag>{name}</Tag> : <Text type="secondary">—</Text>;
      },
    },
    {
      title: t("settings.clusters.status", "Status"),
      key: "status",
      render: (_: unknown, node: FabricNode) => {
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
      render: (_: unknown, node: FabricNode) => (
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
  const editingNode = editingId ? nodes.find((n) => n.id === editingId) : undefined;

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
        <Form form={form} layout="vertical" onFinish={handleSave}>
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
                    editingNode
                      ? t(
                          "settings.clusters.secretEditHint",
                          "Leave empty to keep the existing secret",
                        )
                      : undefined
                  }
                  rules={[
                    {
                      required: !editingNode,
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
                      editingNode
                        ? t(
                            "settings.clusters.secretEditHint",
                            "Leave empty to keep the existing secret",
                          )
                        : undefined
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
                          // Editing a key-auth node with a stored secret → preserved on save.
                          const existing =
                            editingNode?.placement.type === "ssh"
                              ? (editingNode.placement as Extract<NodePlacement, { type: "ssh" }>)
                                  .auth
                              : undefined;
                          if (
                            existing?.method === "private_key" &&
                            (existing.private_key || existing.private_key_path)
                          ) {
                            return;
                          }
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
                  >
                    <Input.Password visibilityToggle />
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
