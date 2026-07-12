import { useMemo, type ReactNode } from "react";
import { Button, Empty, Popconfirm, Space, Table, Tag, Tooltip, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { useTranslation } from "react-i18next";
import type {
  InstalledPluginView,
  PluginRegistered,
  PluginSource,
  PluginStatus,
} from "@services/plugins";

const { Text } = Typography;

interface PluginTableProps {
  plugins: InstalledPluginView[];
  loading?: boolean;
  onUpdate?: (plugin: InstalledPluginView) => void;
  onRemove?: (plugin: InstalledPluginView) => Promise<void> | void;
  isRemoving?: (id: string) => boolean;
}

// The "installing" status can mean an install is genuinely in progress, or it
// can be a crash leftover from a process that died mid-install (the API
// exposes no way to distinguish the two). Use a warning color so it stands
// out rather than reading as a calm, in-progress "processing" tag.
const statusColorMap: Record<PluginStatus, string> = {
  installing: "warning",
  installed: "success",
};

const renderSource = (source: PluginSource): string => {
  switch (source.type) {
    case "url":
      return `url: ${source.url}`;
    case "local_archive":
      return `local_archive: ${source.path}`;
    case "local_dir":
    default:
      return `local_dir: ${source.path}`;
  }
};

export const PluginTable: React.FC<PluginTableProps> = ({
  plugins,
  loading = false,
  onUpdate,
  onRemove,
  isRemoving,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const statusLabelMap: Record<PluginStatus, string> = useMemo(
    () => ({
      installing: t("settings.pluginsTab.status.installing"),
      installed: t("settings.pluginsTab.status.installed"),
    }),
    [t],
  );

  const renderRegistered = useMemo(
    () =>
      (registered: PluginRegistered | undefined): ReactNode => {
        const chips: ReactNode[] = [];

        if (registered?.mcp_server_ids?.length) {
          chips.push(
            <Tag key="mcp">
              {t("settings.pluginsTab.registered.mcpServers", {
                count: registered.mcp_server_ids.length,
              })}
            </Tag>,
          );
        }
        if (registered?.preset_ids?.length) {
          chips.push(
            <Tag key="presets">
              {t("settings.pluginsTab.registered.prompts", {
                count: registered.preset_ids.length,
              })}
            </Tag>,
          );
        }
        if (registered?.skill_dirs?.length) {
          chips.push(
            <Tag key="skills">
              {t("settings.pluginsTab.registered.skills", {
                count: registered.skill_dirs.length,
              })}
            </Tag>,
          );
        }
        if (registered?.workflow_filenames?.length) {
          chips.push(
            <Tag key="workflows">
              {t("settings.pluginsTab.registered.workflows", {
                count: registered.workflow_filenames.length,
              })}
            </Tag>,
          );
        }

        if (chips.length === 0) {
          return <Text type="secondary">—</Text>;
        }
        return (
          <Space size={4} wrap>
            {chips}
          </Space>
        );
      },
    [t],
  );

  const columns = useMemo<TableProps<InstalledPluginView>["columns"]>(
    () => [
      {
        key: "id",
        title: t("settings.pluginsTab.columns.id"),
        dataIndex: "id",
        width: 160,
      },
      {
        key: "name",
        title: t("settings.pluginsTab.columns.name"),
        render: (_, record) => record.name || record.id,
      },
      {
        key: "version",
        title: t("settings.pluginsTab.columns.version"),
        dataIndex: "version",
        width: 110,
      },
      {
        key: "status",
        title: t("settings.pluginsTab.columns.status"),
        width: 130,
        render: (_, record) => {
          const tag = (
            <Tag color={statusColorMap[record.status]}>{statusLabelMap[record.status]}</Tag>
          );
          if (record.status === "installing") {
            return (
              <Tooltip title={t("settings.pluginsTab.status.installingHint")}>
                <span>{tag}</span>
              </Tooltip>
            );
          }
          return tag;
        },
      },
      {
        key: "registered",
        title: t("settings.pluginsTab.columns.registered"),
        render: (_, record) => renderRegistered(record.registered),
      },
      {
        key: "source",
        title: t("settings.pluginsTab.columns.source"),
        render: (_, record) => <Text code>{renderSource(record.source)}</Text>,
      },
      {
        key: "actions",
        title: t("settings.pluginsTab.columns.actions"),
        width: 200,
        render: (_, record) => (
          <Space size={token.marginXS}>
            <Button size="small" onClick={() => onUpdate?.(record)}>
              {t("settings.pluginsTab.actions.update")}
            </Button>
            <Popconfirm
              title={t("settings.pluginsTab.remove.confirmTitle")}
              description={t("settings.pluginsTab.remove.confirmDescription", {
                name: record.name || record.id,
              })}
              onConfirm={() => onRemove?.(record)}
              okText={t("settings.pluginsTab.actions.remove")}
              okButtonProps={{
                danger: true,
                loading: isRemoving?.(record.id),
              }}
            >
              <Button size="small" danger loading={isRemoving?.(record.id)}>
                {t("settings.pluginsTab.actions.remove")}
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [isRemoving, onRemove, onUpdate, renderRegistered, statusLabelMap, t, token.marginXS],
  );

  return (
    <Table<InstalledPluginView>
      rowKey="id"
      columns={columns}
      dataSource={plugins}
      loading={loading}
      pagination={false}
      locale={{
        emptyText: (
          <Empty
            description={t("settings.pluginsTab.empty")}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ),
      }}
    />
  );
};
