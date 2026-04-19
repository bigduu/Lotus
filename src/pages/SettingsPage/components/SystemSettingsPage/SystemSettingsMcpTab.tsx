import { CopyOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Card, Modal, Radio, Space, Tag, Input, Tooltip, message, theme } from "antd";
import { Typography } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ServerStatus,
  mcpService,
  type McpServer,
  type McpImportResponse,
} from "../../../../services/mcp";
import { useMcpSettings } from "./hooks/useMcpSettings";
import { McpServerTable } from "./mcp/McpServerTable";
import { McpServerFormModal } from "./mcp/McpServerFormModal";
import { McpToolList } from "./mcp/McpToolList";
import { copyText } from "@shared/utils/clipboard";

const { Text } = Typography;
const { useToken } = theme;
const { TextArea } = Input;

type ImportMode = "merge" | "replace";

const statusColorMap: Record<ServerStatus, string> = {
  [ServerStatus.Connecting]: "processing",
  [ServerStatus.Ready]: "success",
  [ServerStatus.Degraded]: "warning",
  [ServerStatus.Stopped]: "default",
  [ServerStatus.Error]: "error",
};

const makeStatusCounters = (): Record<ServerStatus, number> => ({
  [ServerStatus.Connecting]: 0,
  [ServerStatus.Ready]: 0,
  [ServerStatus.Degraded]: 0,
  [ServerStatus.Stopped]: 0,
  [ServerStatus.Error]: 0,
});

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

type MainstreamMcpServersChunk = {
  mcpServers: Record<string, unknown>;
};

const toMainstreamMcpServersChunk = (servers: McpServer[]): MainstreamMcpServersChunk => {
  const mcpServers: Record<string, unknown> = {};

  for (const server of servers) {
    const id = server.id?.trim();
    if (!id) continue;

    const enabled = server.enabled ?? server.config.enabled;
    const disabled = !enabled;

    const transport = server.config.transport;
    if (transport.type === "sse") {
      const headers: Record<string, string> = {};
      for (const h of transport.headers ?? []) {
        const name = h.name?.trim();
        if (!name) continue;
        headers[name] = h.value ?? "";
      }

      const entry: Record<string, unknown> = {
        url: transport.url,
      };
      if (disabled) entry.disabled = true;
      if (Object.keys(headers).length) entry.headers = headers;
      mcpServers[id] = entry;
      continue;
    }

    const entry: Record<string, unknown> = {
      command: transport.command,
    };
    if (disabled) entry.disabled = true;
    if (transport.args?.length) entry.args = transport.args;
    if (transport.cwd) entry.cwd = transport.cwd;
    if (transport.env && Object.keys(transport.env).length) entry.env = transport.env;
    mcpServers[id] = entry;
  }

  return { mcpServers };
};

const SystemSettingsMcpTab: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [msgApi, contextHolder] = message.useMessage();
  const {
    servers,
    selectedServerId,
    selectedServerTools,
    isLoadingServers,
    isMutatingConfig,
    isRefreshingAll,
    isSelectedServerToolsLoading,
    error,
    setSelectedServerId,
    addServer,
    updateServer,
    deleteServer,
    connectServer,
    disconnectServer,
    refreshServerTools,
    refreshAll,
    isServerActionLoading,
  } = useMcpSettings();

  const statusLabelMap: Record<ServerStatus, string> = useMemo(
    () => ({
      [ServerStatus.Connecting]: t("settings.mcpTab.status.connecting"),
      [ServerStatus.Ready]: t("settings.mcpTab.status.ready"),
      [ServerStatus.Degraded]: t("settings.mcpTab.status.degraded"),
      [ServerStatus.Stopped]: t("settings.mcpTab.status.stopped"),
      [ServerStatus.Error]: t("settings.mcpTab.status.error"),
    }),
    [t],
  );
  const statusHelpMap: Record<ServerStatus, string> = useMemo(
    () => ({
      [ServerStatus.Connecting]: t("settings.mcpTab.statusHelp.connecting"),
      [ServerStatus.Ready]: t("settings.mcpTab.statusHelp.ready"),
      [ServerStatus.Degraded]: t("settings.mcpTab.statusHelp.degraded"),
      [ServerStatus.Stopped]: t("settings.mcpTab.statusHelp.stopped"),
      [ServerStatus.Error]: t("settings.mcpTab.statusHelp.error"),
    }),
    [t],
  );

  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [serverModalMode, setServerModalMode] = useState<"create" | "edit">("create");
  const [editingServer, setEditingServer] = useState<McpServer | null>(null);

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [importJson, setImportJson] = useState<string>("");
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const selectedServer = useMemo(() => {
    if (!selectedServerId) {
      return null;
    }
    return servers.find((server) => server.id === selectedServerId) ?? null;
  }, [selectedServerId, servers]);

  const statusSummary = useMemo(() => {
    const byStatus = makeStatusCounters();
    let toolCount = 0;

    servers.forEach((server) => {
      const status = server.runtime?.status ?? ServerStatus.Stopped;
      byStatus[status] += 1;
      toolCount += server.runtime?.tool_count ?? 0;
    });

    return {
      byStatus,
      totalServers: servers.length,
      totalTools: toolCount,
    };
  }, [servers]);

  const neutralTagStyle = {
    background: token.colorFillSecondary,
    borderColor: token.colorBorderSecondary,
    color: token.colorTextSecondary,
  } as const;

  const handleDeleteServer = async (server: McpServer) => {
    try {
      await deleteServer(server.id);
      msgApi.success(t("settings.mcpTab.serverDeleted"));
    } catch (deleteError) {
      msgApi.error(getErrorMessage(deleteError, t("settings.mcpTab.deleteServerFailed")));
    }
  };

  const handleConnectServer = async (server: McpServer) => {
    try {
      await connectServer(server.id);
      msgApi.success(t("settings.mcpTab.connectedTo", { name: server.name || server.id }));
    } catch (connectError) {
      msgApi.error(getErrorMessage(connectError, t("settings.mcpTab.connectServerFailed")));
    }
  };

  const handleDisconnectServer = async (server: McpServer) => {
    try {
      await disconnectServer(server.id);
      msgApi.success(t("settings.mcpTab.disconnected", { name: server.name || server.id }));
    } catch (disconnectError) {
      msgApi.error(getErrorMessage(disconnectError, t("settings.mcpTab.disconnectServerFailed")));
    }
  };

  const handleRefreshServerTools = async (server: McpServer) => {
    try {
      await refreshServerTools(server.id);
      msgApi.success(
        t("settings.mcpTab.toolsRefreshedFor", {
          name: server.name || server.id,
        }),
      );
    } catch (refreshError) {
      msgApi.error(getErrorMessage(refreshError, t("settings.mcpTab.refreshToolsFailed")));
    }
  };

  const handleRefreshAll = async () => {
    try {
      await refreshAll();
      msgApi.success(t("settings.mcpTab.statusRefreshed"));
    } catch (refreshError) {
      msgApi.error(getErrorMessage(refreshError, t("settings.mcpTab.refreshStatusFailed")));
    }
  };

  const openCreateServerModal = () => {
    setEditingServer(null);
    setServerModalMode("create");
    setIsServerModalOpen(true);
  };

  const openEditServerModal = (server: McpServer) => {
    setEditingServer(server);
    setServerModalMode("edit");
    setIsServerModalOpen(true);
  };

  const handleSubmitServer = async (config: McpServer["config"]) => {
    try {
      if (serverModalMode === "edit") {
        if (!editingServer) {
          msgApi.error(t("settings.mcpTab.noServerForEditing"));
          return;
        }
        await updateServer(editingServer.id, config);
        msgApi.success(
          t("settings.mcpTab.savedServer", {
            name: editingServer.name || editingServer.id,
          }),
        );
      } else {
        await addServer(config);
        msgApi.success(t("settings.mcpTab.addedServer", { name: config.name || config.id }));
      }
      setIsServerModalOpen(false);
      setEditingServer(null);
    } catch (e) {
      msgApi.error(getErrorMessage(e, t("settings.mcpTab.saveServerFailed")));
    }
  };

  const openImportModal = () => {
    setIsImportOpen(true);
    setImportError(null);
    setImportMode("merge");
    setImportJson("");
  };

  const handleExport = async () => {
    const chunk = toMainstreamMcpServersChunk(servers);
    const text = JSON.stringify(chunk, null, 2);

    try {
      await copyText(text);
      msgApi.success(t("settings.mcpTab.copiedConfig"));
    } catch {
      // Clipboard can be blocked depending on platform/webview permissions.
      // Fall back to showing the exported JSON in the modal for manual copy.
      setIsImportOpen(true);
      setImportError(null);
      setImportMode("merge");
      setImportJson(text);
      msgApi.warning(t("settings.mcpTab.clipboardUnavailable"));
    }
  };

  const handleImport = async () => {
    setImportError(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(importJson);
    } catch (e) {
      setImportError(
        `${t("settings.mcpTab.invalidJsonPrefix")}: ${
          e instanceof Error ? e.message : t("settings.mcpTab.unknownError")
        }`,
      );
      return;
    }

    if (!parsed || typeof parsed !== "object") {
      setImportError(t("settings.mcpTab.jsonMustBeObject"));
      return;
    }

    const record = parsed as Record<string, unknown>;
    const mcpServers = record.mcpServers;
    if (!mcpServers || typeof mcpServers !== "object") {
      setImportError(t("settings.mcpTab.missingMcpServers"));
      return;
    }

    setIsImporting(true);
    try {
      const response: McpImportResponse = await mcpService.importServers({
        mcpServers,
        mode: importMode,
      });

      const startFailures = response.start_errors?.length ?? 0;
      msgApi.success(
        t("settings.mcpTab.importSummary", {
          count: response.server_ids.length,
          added: response.added,
          updated: response.updated,
          removed: response.removed,
          failed: startFailures,
        }),
      );
      if (startFailures) {
        msgApi.warning(t("settings.mcpTab.importStartFailures"));
      }

      setIsImportOpen(false);
      setImportJson("");
      await handleRefreshAll();
    } catch (error) {
      setImportError(getErrorMessage(error, t("settings.mcpTab.importFailed")));
      // Keep textarea content so the user can fix and retry.
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
      {contextHolder}
      {error ? <Alert type="error" showIcon message={error} /> : null}
      <Card size="small" title={t("settings.mcpTab.overviewTitle")}>
        <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
          <Text type="secondary">{t("settings.mcpTab.overviewDescription")}</Text>
          <Space wrap>
            <Tag style={neutralTagStyle}>
              {t("settings.mcpTab.totalServers", { count: statusSummary.totalServers })}
            </Tag>
            <Tag style={neutralTagStyle}>
              {t("settings.mcpTab.totalTools", { count: statusSummary.totalTools })}
            </Tag>
            {Object.values(ServerStatus).map((status) => (
              <Tooltip key={status} title={statusHelpMap[status]}>
                <Tag
                  color={status === ServerStatus.Stopped ? undefined : statusColorMap[status]}
                  style={{
                    cursor: "help",
                    ...(status === ServerStatus.Stopped ? neutralTagStyle : undefined),
                  }}
                >
                  {statusLabelMap[status]}: {statusSummary.byStatus[status]}
                </Tag>
              </Tooltip>
            ))}
          </Space>
          <Text type="secondary">{t("settings.mcpTab.statusGuideTitle")}</Text>
          <Space direction="vertical" size={2} style={{ width: "100%" }}>
            {Object.values(ServerStatus).map((status) => (
              <Text key={`guide-${status}`} type="secondary">
                <Tag
                  color={status === ServerStatus.Stopped ? undefined : statusColorMap[status]}
                  style={{
                    marginInlineEnd: 8,
                    ...(status === ServerStatus.Stopped ? neutralTagStyle : undefined),
                  }}
                >
                  {statusLabelMap[status]}
                </Tag>
                {statusHelpMap[status]}
              </Text>
            ))}
          </Space>
        </Space>
      </Card>
      <Card
        size="small"
        title={t("settings.mcpTab.serversTitle")}
        extra={
          <Space>
            <Button variant="default" onClick={openCreateServerModal}>
              {t("settings.mcpTab.addServer")}
            </Button>
            <Button
              icon={<ReloadOutlined />}
              loading={isRefreshingAll}
              onClick={() => {
                void handleRefreshAll();
              }}
            >
              {t("settings.mcpTab.refreshAll")}
            </Button>
            <Button icon={<CopyOutlined />} onClick={() => void handleExport()}>
              {t("settings.mcpTab.export")}
            </Button>
            <Button icon={<UploadOutlined />} onClick={openImportModal}>
              {t("settings.mcpTab.import")}
            </Button>
          </Space>
        }
      >
        <McpServerTable
          servers={servers}
          loading={isLoadingServers}
          selectedServerId={selectedServerId}
          onSelectServer={setSelectedServerId}
          onEditServer={openEditServerModal}
          onDeleteServer={handleDeleteServer}
          onConnectServer={handleConnectServer}
          onDisconnectServer={handleDisconnectServer}
          onRefreshTools={handleRefreshServerTools}
          isServerActionLoading={isServerActionLoading}
        />
      </Card>
      <McpToolList
        server={selectedServer}
        tools={selectedServerTools}
        loading={isSelectedServerToolsLoading}
      />
      <McpServerFormModal
        open={isServerModalOpen}
        mode={serverModalMode}
        initialConfig={editingServer?.config ?? null}
        confirmLoading={isMutatingConfig}
        onCancel={() => {
          if (isMutatingConfig) return;
          setIsServerModalOpen(false);
          setEditingServer(null);
        }}
        onSubmit={(config) => void handleSubmitServer(config)}
      />
      <Modal
        open={isImportOpen}
        title={t("settings.mcpTab.importModalTitle")}
        okText={t("settings.mcpTab.import")}
        onOk={() => void handleImport()}
        okButtonProps={{ loading: isImporting }}
        onCancel={() => {
          if (isImporting) return;
          setIsImportOpen(false);
          setImportError(null);
        }}
        width={800}
        destroyOnClose={false}
      >
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Text type="secondary">
            {t("settings.mcpTab.importHint")}
            <br />
            <Text
              code
            >{`{ "mcpServers": { "filesystem": { "command": "npx", "args": ["-y", "..."] } } }`}</Text>
          </Text>

          <Radio.Group
            value={importMode}
            onChange={(e) => setImportMode(e.target.value as ImportMode)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="merge">{t("settings.mcpTab.importModeMerge")}</Radio.Button>
            <Radio.Button value="replace">{t("settings.mcpTab.importModeReplace")}</Radio.Button>
          </Radio.Group>

          {importMode === "replace" ? (
            <Alert type="warning" showIcon message={t("settings.mcpTab.replaceWarning")} />
          ) : null}

          {importError ? <Alert type="error" showIcon message={importError} /> : null}

          <TextArea
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            rows={14}
            placeholder='{"mcpServers": { "filesystem": { "command": "...", "args": [], "env": {} } }}'
            spellCheck={false}
          />
        </Space>
      </Modal>
    </Space>
  );
};

export default SystemSettingsMcpTab;
