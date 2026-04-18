import { useMemo } from "react";
import { Popconfirm, Space, Table, Tag, Tooltip, theme } from "antd";
import { Button } from "@/components/ui/button";
import type { TableProps } from "antd";
import { ServerStatus, type McpServer } from "@services/mcp";
import type { McpServerAction } from "../hooks/useMcpSettings";
import { useTranslation } from "react-i18next";

interface McpServerTableProps {
  servers: McpServer[];
  loading?: boolean;
  selectedServerId?: string | null;
  onSelectServer?: (serverId: string) => void;
  onEditServer?: (server: McpServer) => void;
  onDeleteServer?: (server: McpServer) => Promise<void> | void;
  onConnectServer?: (server: McpServer) => Promise<void> | void;
  onDisconnectServer?: (server: McpServer) => Promise<void> | void;
  onRefreshTools?: (server: McpServer) => Promise<void> | void;
  isServerActionLoading?: (serverId: string, action: McpServerAction) => boolean;
}

const statusColorMap: Record<ServerStatus, string> = {
  [ServerStatus.Connecting]: "blue",
  [ServerStatus.Ready]: "green",
  [ServerStatus.Degraded]: "orange",
  [ServerStatus.Stopped]: "default",
  [ServerStatus.Error]: "red",
};

const isConnectedStatus = (status: ServerStatus): boolean =>
  status === ServerStatus.Connecting ||
  status === ServerStatus.Ready ||
  status === ServerStatus.Degraded;

const summarizeStatusError = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
};

export const McpServerTable: React.FC<McpServerTableProps> = ({
  servers,
  loading = false,
  selectedServerId,
  onSelectServer,
  onEditServer,
  onDeleteServer,
  onConnectServer,
  onDisconnectServer,
  onRefreshTools,
  isServerActionLoading,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
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

  const columns = useMemo<TableProps<McpServer>["columns"]>(
    () => [
      {
        key: "name",
        title: t("settings.mcpServerTable.columns.name"),
        render: (_, record) => record.name || record.id,
      },
      {
        key: "transport",
        title: t("settings.mcpServerTable.columns.transportType"),
        render: (_, record) =>
          record.config.transport.type === "sse"
            ? t("settings.mcpServerTable.transportOptions.sse")
            : t("settings.mcpServerTable.transportOptions.stdio"),
        width: 140,
      },
      {
        key: "status",
        title: t("settings.mcpServerTable.columns.status"),
        render: (_, record) => {
          const status = record.runtime?.status ?? ServerStatus.Stopped;
          const statusError = summarizeStatusError(record.runtime?.last_error);
          const statusHelp = statusHelpMap[status];
          const statusLabelMap: Record<ServerStatus, string> = {
            [ServerStatus.Connecting]: t("settings.mcpTab.status.connecting"),
            [ServerStatus.Ready]: t("settings.mcpTab.status.ready"),
            [ServerStatus.Degraded]: t("settings.mcpTab.status.degraded"),
            [ServerStatus.Stopped]: t("settings.mcpTab.status.stopped"),
            [ServerStatus.Error]: t("settings.mcpTab.status.error"),
          };
          return (
            <Tooltip
              title={
                statusError
                  ? `${statusHelp} ${t("settings.mcpTab.statusLastError", {
                      error: statusError,
                    })}`
                  : statusHelp
              }
            >
              <Tag
                color={status === ServerStatus.Stopped ? undefined : statusColorMap[status]}
                style={{
                  marginInlineEnd: 0,
                  cursor: "help",
                  ...(status === ServerStatus.Stopped
                    ? {
                        background: token.colorFillSecondary,
                        borderColor: token.colorBorderSecondary,
                        color: token.colorTextSecondary,
                      }
                    : undefined),
                }}
              >
                {statusLabelMap[status]}
              </Tag>
            </Tooltip>
          );
        },
        width: 120,
      },
      {
        key: "toolCount",
        title: t("settings.mcpServerTable.columns.toolCount"),
        render: (_, record) => record.runtime?.tool_count ?? 0,
        width: 100,
      },
      {
        key: "actions",
        title: t("settings.mcpServerTable.columns.actions"),
        width: 360,
        render: (_, record) => {
          const status = record.runtime?.status ?? ServerStatus.Stopped;
          const isConnected = isConnectedStatus(status);
          return (
            <Space size={token.marginXS}>
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditServer?.(record);
                }}
              >
                {t("settings.mcpServerTable.actions.edit")}
              </Button>
              <Popconfirm
                title={t("settings.mcpServerTable.deleteTitle")}
                description={t("settings.mcpServerTable.deleteDescription", {
                  name: record.name || record.id,
                })}
                onConfirm={() => onDeleteServer?.(record)}
                okText={t("settings.mcpServerTable.actions.delete")}
                okButtonProps={{
                  danger: true,
                  loading: isServerActionLoading?.(record.id, "delete"),
                }}
              >
                <Button
                  size="sm"
                  loading={isServerActionLoading?.(record.id, "delete")}
                  onClick={(e) => e.stopPropagation()}
                  variant="destructive"
                >
                  {t("settings.mcpServerTable.actions.delete")}
                </Button>
              </Popconfirm>
              {isConnected ? (
                <Button
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDisconnectServer?.(record);
                  }}
                  loading={isServerActionLoading?.(record.id, "disconnect")}
                >
                  {t("settings.mcpServerTable.actions.disconnect")}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="default"
                  ghost
                  onClick={(e) => {
                    e.stopPropagation();
                    onConnectServer?.(record);
                  }}
                  loading={isServerActionLoading?.(record.id, "connect")}
                >
                  {t("settings.mcpServerTable.actions.connect")}
                </Button>
              )}
              <Button
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onRefreshTools?.(record);
                }}
                loading={isServerActionLoading?.(record.id, "refresh")}
              >
                {t("settings.mcpServerTable.actions.refreshTools")}
              </Button>
            </Space>
          );
        },
      },
    ],
    [
      isServerActionLoading,
      onConnectServer,
      onDeleteServer,
      onDisconnectServer,
      onEditServer,
      onRefreshTools,
      statusHelpMap,
      t,
      token.colorBorderSecondary,
      token.colorFillSecondary,
      token.colorTextSecondary,
      token.marginXS,
    ],
  );

  return (
    <Table<McpServer>
      rowKey="id"
      columns={columns}
      dataSource={servers}
      loading={loading}
      pagination={false}
      locale={{ emptyText: t("settings.mcpServerTable.empty") }}
      onRow={(record) => ({
        onClick: () => onSelectServer?.(record.id),
        style: {
          cursor: onSelectServer ? "pointer" : "default",
          backgroundColor: selectedServerId === record.id ? token.colorFillSecondary : undefined,
        },
      })}
    />
  );
};
