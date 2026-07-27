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

const { Text, Paragraph } = Typography;

const SECRET_MASK = "****...****";

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
        const res = await settingsService.listNodes();
        if (seq !== fetchSeq.current) return; // superseded by a newer fetch
        setNodes(res.nodes);
        setClusters(res.clusters);
      } catch {
        // A background poll shouldn't spam errors; only surface an explicit load.
        if (!silent) message.error(t("settings.clusters.fetchError"));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [message, t],
  );

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

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
    // Secrets come back masked; only mask-preserve one the edited node ACTUALLY
    // had, so switching auth methods (password→key) or clearing an inline key on
    // a path-based node never stores the mask string as a bogus secret.
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
        private_key: preserve(existingKey, v.private_key)
          ? SECRET_MASK
          : v.private_key || undefined,
        private_key_path: v.private_key_path || undefined,
        passphrase: preserve(existingPass, v.passphrase) ? SECRET_MASK : v.passphrase || undefined,
      };
    } else {
      const existingPw = originalAuth?.method === "password" ? originalAuth.password : undefined;
      auth = {
        method: "password",
        password: preserve(existingPw, v.password) ? SECRET_MASK : v.password,
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
      const saved = editingId
        ? await settingsService.updateNode(editingId, req)
        : await settingsService.createNode(req);

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
            t("settings.clusters.membershipError"),
        );
        closeModal();
        fetchAll();
        return;
      }

      message.success(editingId ? t("settings.clusters.updated") : t("settings.clusters.created"));
      closeModal();
      fetchAll();
    } catch (err: unknown) {
      message.error(
        (err instanceof Error ? err.message : undefined) || t("settings.clusters.saveError"),
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
    try {
      await settingsService.deleteNode(id);
      message.success(t("settings.clusters.deleted"));
      fetchAll();
    } catch (err: unknown) {
      message.error(
        (err instanceof Error ? err.message : undefined) || t("settings.clusters.deleteError"),
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
          ? t("settings.clusters.testOk", { info: preflight })
          : t("settings.clusters.actionOk"),
      );
      fetchAll();
    } catch (err: unknown) {
      message.error(
        (err instanceof Error ? err.message : undefined) || t("settings.clusters.actionFailed"),
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
      setLogsText(res.logs || t("settings.clusters.logsEmpty"));
    } catch (err: unknown) {
      setLogsText(
        (err instanceof Error ? err.message : undefined) || t("settings.clusters.logsError"),
      );
    } finally {
      setLogsLoading(false);
    }
  };

  // ── Columns ──────────────────────────────────────────────────────

  const columns = [
    {
      title: t("settings.clusters.label"),
      dataIndex: "label",
      key: "label",
      render: (label: string, node: FabricNode) => (
        <Space>
          <CloudServerOutlined />
          <Text strong>{label}</Text>
          {!node.enabled && <Tag>{t("settings.clusters.disabled")}</Tag>}
        </Space>
      ),
    },
    {
      title: t("settings.clusters.target"),
      key: "target",
      render: (_: unknown, node: FabricNode) =>
        node.placement.type === "ssh" ? (
          <Text code>
            {node.placement.username}@{node.placement.host}:{node.placement.port}
          </Text>
        ) : (
          <Tag color="blue">{t("settings.clusters.local")}</Tag>
        ),
    },
    {
      title: t("settings.clusters.cluster"),
      key: "cluster",
      render: (_: unknown, node: FabricNode) => {
        const name = nodeClusterName.get(node.id);
        return name ? <Tag>{name}</Tag> : <Text type="secondary">—</Text>;
      },
    },
    {
      title: t("settings.clusters.status"),
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
                {t("settings.clusters.lastSeen", { ago: lastSeen })}
              </Text>
            )}
          </Space>
        );
      },
    },
    {
      title: t("settings.clusters.actions"),
      key: "actions",
      width: 320,
      render: (_: unknown, node: FabricNode) => (
        <Space size="small" wrap>
          <Button size="small" onClick={() => handleAction(node.id, "test")}>
            {t("settings.clusters.test")}
          </Button>
          <Button size="small" type="primary" ghost onClick={() => handleAction(node.id, "deploy")}>
            {t("settings.clusters.deploy")}
          </Button>
          <Button size="small" onClick={() => handleAction(node.id, "stop")}>
            {t("settings.clusters.stop")}
          </Button>
          <Button size="small" onClick={() => showLogs(node)}>
            {t("settings.clusters.logs")}
          </Button>
          <Button
            type="text"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEditModal(node)}
            aria-label={t("settings.clusters.edit")}
          />
          <Popconfirm
            title={t("settings.clusters.deleteConfirm")}
            onConfirm={() => handleDelete(node.id)}
            okText={t("settings.clusters.yes")}
            cancelText={t("settings.clusters.no")}
          >
            <Button
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              aria-label={t("settings.clusters.delete")}
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
        title={t("settings.clusters.title")}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>
            {t("settings.clusters.addButton")}
          </Button>
        }
      >
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          {t("settings.clusters.description")}
        </Paragraph>

        <Table
          dataSource={nodes}
          columns={columns}
          rowKey="id"
          size="small"
          pagination={false}
          loading={loading}
          locale={{ emptyText: t("settings.clusters.noNodes") }}
        />
      </Card>

      <Modal
        title={editingId ? t("settings.clusters.editTitle") : t("settings.clusters.addTitle")}
        open={modalOpen}
        onCancel={closeModal}
        onOk={() => form.submit()}
        okText={t("settings.clusters.save")}
        cancelText={t("settings.clusters.cancel")}
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSave}>
          <Form.Item
            name="label"
            label={t("settings.clusters.label")}
            rules={[
              {
                required: true,
                message: t("settings.clusters.labelRequired"),
              },
            ]}
          >
            <Input placeholder="gpu-1" autoFocus />
          </Form.Item>

          <Form.Item name="placement_type" label={t("settings.clusters.placement")}>
            <Select
              options={[
                { value: "ssh", label: t("settings.clusters.ssh") },
                { value: "local", label: t("settings.clusters.localhost") },
              ]}
            />
          </Form.Item>

          {isSshForm && (
            <>
              <Space.Compact block>
                <Form.Item
                  name="host"
                  label={t("settings.clusters.host")}
                  style={{ width: "70%" }}
                  rules={[
                    {
                      required: true,
                      message: t("settings.clusters.hostRequired"),
                    },
                  ]}
                >
                  <Input placeholder="10.0.0.5" />
                </Form.Item>
                <Form.Item name="port" label={t("settings.clusters.port")} style={{ width: "30%" }}>
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                </Form.Item>
              </Space.Compact>

              <Form.Item
                name="username"
                label={t("settings.clusters.username")}
                rules={[
                  {
                    required: true,
                    message: t("settings.clusters.usernameRequired"),
                  },
                ]}
              >
                <Input placeholder="deploy" />
              </Form.Item>

              <Form.Item name="auth_method" label={t("settings.clusters.authMethod")}>
                <Select
                  options={[
                    { value: "password", label: t("settings.clusters.password") },
                    {
                      value: "private_key",
                      label: t("settings.clusters.privateKey"),
                    },
                    {
                      value: "system_ssh_config",
                      label: t("settings.clusters.systemSsh"),
                    },
                  ]}
                />
              </Form.Item>

              {authMethod === "password" && (
                <Form.Item
                  name="password"
                  label={t("settings.clusters.password")}
                  extra={editingNode ? t("settings.clusters.secretEditHint") : undefined}
                  rules={[
                    {
                      required: !editingNode,
                      message: t("settings.clusters.passwordRequired"),
                    },
                  ]}
                >
                  <Input.Password
                    visibilityToggle
                    placeholder={editingNode ? t("settings.clusters.keepSecret") : undefined}
                  />
                </Form.Item>
              )}

              {authMethod === "private_key" && (
                <>
                  <Form.Item name="private_key_path" label={t("settings.clusters.privateKeyPath")}>
                    <Input placeholder="~/.ssh/id_ed25519" />
                  </Form.Item>
                  <Form.Item
                    name="private_key"
                    label={t("settings.clusters.privateKeyInline")}
                    dependencies={["private_key_path"]}
                    extra={editingNode ? t("settings.clusters.secretEditHint") : undefined}
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
                          throw new Error(t("settings.clusters.privateKeyRequired"));
                        },
                      },
                    ]}
                  >
                    <Input.TextArea rows={3} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                  </Form.Item>
                  <Form.Item name="passphrase" label={t("settings.clusters.passphrase")}>
                    <Input.Password visibilityToggle />
                  </Form.Item>
                </>
              )}
            </>
          )}

          <Form.Item
            name="artifact_path"
            label={t("settings.clusters.artifactPath")}
            extra={t("settings.clusters.artifactHint")}
          >
            <Input placeholder="/path/to/bamboo-linux-x64" />
          </Form.Item>

          <Form.Item name="default_role" label={t("settings.clusters.role")}>
            <Input placeholder="worker" />
          </Form.Item>

          <Form.Item
            name="auto_recover"
            label={t("settings.clusters.autoRecover")}
            valuePropName="checked"
            extra={t("settings.clusters.autoRecoverHint")}
          >
            <Switch />
          </Form.Item>

          <Form.Item name="cluster_name" label={t("settings.clusters.cluster")}>
            <Select
              allowClear
              showSearch
              mode="tags"
              maxCount={1}
              placeholder={t("settings.clusters.clusterPlaceholder")}
              options={clusters.map((c) => ({ value: c.name, label: c.name }))}
            />
          </Form.Item>

          <Form.Item name="enabled" label={t("settings.clusters.enabled")} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Logs drawer ───────────────────────────────────────────── */}
      <Modal
        title={t("settings.clusters.logsTitle", {
          label: logsNode?.label ?? "",
        })}
        open={logsOpen}
        onCancel={() => setLogsOpen(false)}
        onOk={() => logsNode && showLogs(logsNode)}
        okText={t("settings.clusters.refresh")}
        cancelText={t("settings.clusters.close")}
        width={760}
        destroyOnClose
      >
        {logsLoading ? (
          <Text type="secondary">{t("settings.clusters.loading")}</Text>
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
