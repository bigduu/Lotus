import { useMemo, type ReactNode } from "react";
import { Button, Empty, Popconfirm, Space, Table, Tag, Tooltip, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { useTranslation } from "react-i18next";
import type {
  InstalledPluginView,
  PluginRegistered,
  PluginSource,
  PluginStatus,
  ServiceState,
  ServiceStatusView,
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

// Supervised service-plugin lifecycle state (bamboo PR #482, issue #479).
// This is status VISIBILITY only — the backend exposes no manual
// start/stop/restart endpoint (only list/install/update/remove under
// `/api/v1/plugins`), so there is deliberately no action button here.
const serviceStateColorMap: Record<ServiceState, string> = {
  starting: "processing",
  running: "success",
  degraded: "warning",
  crashed: "error",
  restarting: "processing",
  stopping: "warning",
  stopped: "default",
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

/**
 * Trust-outcome badge(s) for one installed plugin's source (issue #51),
 * reflecting exactly what the backend's `PluginSource::Url` provenance
 * record (bamboo PRs #449/#450/#465/#483) carries — nothing here is
 * inferred/guessed:
 *
 * - Only `url` sources carry a trust outcome at all — `local_dir`/
 *   `local_archive` installs are the user's own filesystem, outside this
 *   policy (see `bamboo-server`'s `plugin_source.rs`), so those render "—".
 * - `insecure: true` (the aggregate `--insecure` / `plugin_trust.enforcement:
 *   off` opt-out) is surfaced first/alone — it means every other layer was
 *   waived for this install, so a separate "unsigned"/"untrusted host" tag
 *   alongside it would be redundant.
 * - Otherwise: `signed_by` (a verified publisher key label) renders a
 *   positive "Signed" tag; its absence always means `allow_unsigned: true`
 *   (the backend refuses an unsigned URL install otherwise) so that renders
 *   a warning "Unsigned" tag.
 * - `allow_untrusted_host` / (`allow_unverified` with no `sha256`) are
 *   additional, independent audit flags surfaced as their own tags when set.
 * - A `url` source with none of the above sitting alongside a verified
 *   signature reads as fully verified ("Verified").
 */
const renderTrustBadges = (
  source: PluginSource,
  t: (key: string, options?: Record<string, unknown>) => string,
): ReactNode => {
  if (source.type !== "url") {
    return <Text type="secondary">—</Text>;
  }

  if (source.insecure) {
    return (
      <Tag color="error" key="insecure">
        {t("settings.pluginsTab.trust.insecure")}
      </Tag>
    );
  }

  const tags: ReactNode[] = [];
  if (source.signed_by) {
    tags.push(
      <Tag color="success" key="signed">
        {t("settings.pluginsTab.trust.signedBy", { label: source.signed_by })}
      </Tag>,
    );
  } else if (source.allow_unsigned) {
    tags.push(
      <Tag color="warning" key="unsigned">
        {t("settings.pluginsTab.trust.unsigned")}
      </Tag>,
    );
  }
  if (source.allow_untrusted_host) {
    tags.push(
      <Tag color="warning" key="untrusted-host">
        {t("settings.pluginsTab.trust.untrustedHost")}
      </Tag>,
    );
  }
  if (source.allow_unverified && !source.sha256) {
    tags.push(<Tag key="unverified">{t("settings.pluginsTab.trust.unverifiedChecksum")}</Tag>);
  }

  if (tags.length === 0) {
    tags.push(
      <Tag color="success" key="verified">
        {t("settings.pluginsTab.trust.verified")}
      </Tag>,
    );
  }

  return (
    <Space size={4} wrap>
      {tags}
    </Space>
  );
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
        if (registered?.service_ids?.length) {
          chips.push(
            <Tag key="services">
              {t("settings.pluginsTab.registered.services", {
                count: registered.service_ids.length,
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

  const serviceStateLabelMap: Record<ServiceState, string> = useMemo(
    () => ({
      starting: t("settings.pluginsTab.serviceStatus.state.starting"),
      running: t("settings.pluginsTab.serviceStatus.state.running"),
      degraded: t("settings.pluginsTab.serviceStatus.state.degraded"),
      crashed: t("settings.pluginsTab.serviceStatus.state.crashed"),
      restarting: t("settings.pluginsTab.serviceStatus.state.restarting"),
      stopping: t("settings.pluginsTab.serviceStatus.state.stopping"),
      stopped: t("settings.pluginsTab.serviceStatus.state.stopped"),
    }),
    [t],
  );

  // One tag per supervised service, colored by its live `ServiceState`; a
  // tooltip surfaces pid/restart_count/last_error (issue #52) without
  // needing an expandable row, following this table's existing "installing"
  // status Tooltip idiom above.
  const renderServiceStatus = useMemo(
    () =>
      (serviceStatus: ServiceStatusView[] | undefined): ReactNode => {
        if (!serviceStatus?.length) {
          return <Text type="secondary">—</Text>;
        }

        const tags = serviceStatus.map((service) => {
          const detailLines: string[] = [
            t("settings.pluginsTab.serviceStatus.tooltip.id", { id: service.id }),
            t("settings.pluginsTab.serviceStatus.tooltip.restartCount", {
              count: service.restart_count,
            }),
          ];
          if (service.pid !== undefined) {
            detailLines.push(
              t("settings.pluginsTab.serviceStatus.tooltip.pid", { pid: service.pid }),
            );
          }
          if (service.last_error) {
            detailLines.push(
              t("settings.pluginsTab.serviceStatus.tooltip.lastError", {
                error: service.last_error,
              }),
            );
          }

          return (
            <Tooltip
              key={service.id}
              title={
                <Space direction="vertical" size={0}>
                  {detailLines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </Space>
              }
            >
              <Tag color={serviceStateColorMap[service.state]}>
                {serviceStateLabelMap[service.state]}
              </Tag>
            </Tooltip>
          );
        });

        return (
          <Space size={4} wrap>
            {tags}
          </Space>
        );
      },
    [serviceStateLabelMap, t],
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
        key: "serviceStatus",
        title: t("settings.pluginsTab.columns.serviceStatus"),
        render: (_, record) => renderServiceStatus(record.service_status),
      },
      {
        key: "source",
        title: t("settings.pluginsTab.columns.source"),
        render: (_, record) => <Text code>{renderSource(record.source)}</Text>,
      },
      {
        key: "trust",
        title: t("settings.pluginsTab.columns.trust"),
        render: (_, record) => renderTrustBadges(record.source, t),
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
    [
      isRemoving,
      onRemove,
      onUpdate,
      renderRegistered,
      renderServiceStatus,
      statusLabelMap,
      t,
      token.marginXS,
    ],
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
