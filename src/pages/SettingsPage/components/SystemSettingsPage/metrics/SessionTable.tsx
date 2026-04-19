import { Table, Tooltip } from "antd";
import { Tag } from "@/components/ui/tag";
import { Button } from "@/components/ui/button";
import type { ColumnsType } from "antd/es/table";
import { useTranslation } from "react-i18next";

import type { SessionMetrics } from "../../../../../services/metrics";

interface SessionTableProps {
  sessions: SessionMetrics[];
  loading: boolean;
  onSelectSession: (sessionId: string) => void;
}

const formatDateTime = (value?: string | null): string => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString();
};

const formatDuration = (durationMs?: number | null): string => {
  if (!durationMs || durationMs <= 0) {
    return "-";
  }

  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }

  return `${seconds}s`;
};

const statusColor = (status: SessionMetrics["status"]): string => {
  switch (status) {
    case "completed":
      return "success";
    case "running":
      return "processing";
    case "error":
      return "error";
    case "cancelled":
      return "warning";
    default:
      return "default";
  }
};

const SessionTable: React.FC<SessionTableProps> = ({ sessions, loading, onSelectSession }) => {
  const { t } = useTranslation();
  const columns: ColumnsType<SessionMetrics> = [
    {
      title: t("settings.metricsTable.session.columns.session"),
      dataIndex: "session_id",
      key: "session_id",
      render: (value: string) => (
        <Tooltip title={value}>
          <span>{value.slice(0, 8)}...</span>
        </Tooltip>
      ),
      width: 120,
    },
    {
      title: t("settings.metricsTable.session.columns.model"),
      dataIndex: "model",
      key: "model",
      width: 160,
    },
    {
      title: t("settings.metricsTable.session.columns.status"),
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (value: SessionMetrics["status"]) => <Tag color={statusColor(value)}>{value}</Tag>,
    },
    {
      title: t("settings.metricsTable.session.columns.started"),
      dataIndex: "started_at",
      key: "started_at",
      render: (value: string) => formatDateTime(value),
      width: 200,
      sorter: (left, right) =>
        new Date(left.started_at).getTime() - new Date(right.started_at).getTime(),
      defaultSortOrder: "descend",
    },
    {
      title: t("settings.metricsTable.session.columns.duration"),
      dataIndex: "duration_ms",
      key: "duration_ms",
      render: (value?: number | null) => formatDuration(value),
      width: 120,
    },
    {
      title: t("settings.metricsTable.session.columns.tokens"),
      key: "tokens",
      render: (_, record) => record.total_token_usage.total_tokens.toLocaleString(),
      width: 120,
      sorter: (left, right) =>
        left.total_token_usage.total_tokens - right.total_token_usage.total_tokens,
    },
    {
      title: t("settings.metricsTable.session.columns.toolCalls"),
      dataIndex: "tool_call_count",
      key: "tool_call_count",
      width: 120,
      sorter: (left, right) => left.tool_call_count - right.tool_call_count,
    },
    {
      title: t("settings.metricsTable.session.columns.messages"),
      dataIndex: "message_count",
      key: "message_count",
      width: 120,
      sorter: (left, right) => left.message_count - right.message_count,
    },
    {
      title: t("settings.metricsTable.session.columns.action"),
      key: "action",
      fixed: "right",
      width: 120,
      render: (_, record) => (
        <Button
          variant="link"
          onClick={() => {
            onSelectSession(record.session_id);
          }}
        >
          {t("settings.metricsTable.session.view")}
        </Button>
      ),
    },
  ];

  return (
    <Table
      rowKey="session_id"
      size="small"
      className="lotus-metric-table"
      columns={columns}
      loading={loading}
      dataSource={sessions}
      pagination={{ pageSize: 10, showSizeChanger: false }}
      scroll={{ x: 1100 }}
    />
  );
};

export default SessionTable;
