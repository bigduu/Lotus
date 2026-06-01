import { Badge, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";

import type { ForwardRequestMetrics } from "@services/metrics";
import { renderMetricNumber } from "./metricNumberFormatting";

const { Text } = Typography;

interface ForwardRequestTableProps {
  requests: ForwardRequestMetrics[];
  loading: boolean;
}

const formatDuration = (durationMs?: number | null): string => {
  if (!durationMs || durationMs <= 0) {
    return "-";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
};

const formatTimestamp = (timestamp: string): string => {
  const date = new Date(timestamp);
  return date.toLocaleString();
};

const ForwardRequestTable: React.FC<ForwardRequestTableProps> = ({ requests, loading }) => {
  const { t } = useTranslation();
  const columns: ColumnsType<ForwardRequestMetrics> = [
    {
      title: t("settings.metricsTable.forward.columns.id"),
      dataIndex: "forward_id",
      key: "forward_id",
      width: 120,
      render: (value: string) => (
        <Text style={{ fontSize: 12 }} copyable>
          {value.slice(0, 8)}...
        </Text>
      ),
    },
    {
      title: t("settings.metricsTable.forward.columns.endpoint"),
      dataIndex: "endpoint",
      key: "endpoint",
      width: 150,
      render: (value: string) => <Tag color="processing">{value.split(".").pop() || value}</Tag>,
    },
    {
      title: t("settings.metricsTable.forward.columns.model"),
      dataIndex: "model",
      key: "model",
      width: 120,
    },
    {
      title: t("settings.metricsTable.forward.columns.type"),
      dataIndex: "is_stream",
      key: "is_stream",
      width: 80,
      render: (value: boolean) => (
        <Tag color={value ? "purple" : "processing"}>
          {value
            ? t("settings.metricsTable.forward.typeStream")
            : t("settings.metricsTable.forward.typeSync")}
        </Tag>
      ),
    },
    {
      title: t("settings.metricsTable.forward.columns.status"),
      key: "status",
      width: 100,
      render: (_, record) => {
        const statusColor =
          record.status === "success" ? "success" : record.status === "error" ? "error" : "default";

        return (
          <Badge
            status={statusColor as "success" | "error" | "default"}
            text={
              record.status_code ? (
                <span>
                  {record.status}
                  <Text type="secondary" style={{ marginLeft: 4 }}>
                    ({record.status_code})
                  </Text>
                </span>
              ) : (
                record.status || "-"
              )
            }
          />
        );
      },
    },
    {
      title: t("settings.metricsTable.forward.columns.tokens"),
      key: "tokens",
      width: 100,
      render: (_, record) =>
        record.token_usage ? (
          <Text>{renderMetricNumber(record.token_usage.total_tokens)}</Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
    {
      title: t("settings.metricsTable.forward.columns.duration"),
      dataIndex: "duration_ms",
      key: "duration_ms",
      width: 100,
      render: (value?: number | null) => formatDuration(value),
    },
    {
      title: t("settings.metricsTable.forward.columns.started"),
      dataIndex: "started_at",
      key: "started_at",
      width: 160,
      render: (value: string) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {formatTimestamp(value)}
        </Text>
      ),
    },
    {
      title: t("settings.metricsTable.forward.columns.error"),
      dataIndex: "error",
      key: "error",
      width: 200,
      render: (value?: string | null) =>
        value ? (
          <Text type="danger" ellipsis style={{ maxWidth: 180 }}>
            {value}
          </Text>
        ) : (
          <Text type="secondary">-</Text>
        ),
    },
  ];

  return (
    <Table
      rowKey="forward_id"
      className="lotus-metric-table"
      columns={columns}
      dataSource={requests}
      loading={loading}
      size="small"
      pagination={{
        pageSize: 10,
        showSizeChanger: true,
        showTotal: (total) => t("settings.metricsTable.forward.totalRequests", { total }),
        pageSizeOptions: ["10", "20", "50", "100"],
      }}
      scroll={{ x: 1200 }}
      locale={{
        emptyText: t("settings.metricsTable.forward.empty"),
      }}
    />
  );
};

export default ForwardRequestTable;
