import { ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Modal,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { MetricsGranularity, RoundMetrics } from "@services/metrics";
import { useUnifiedMetrics } from "./hooks/useUnifiedMetrics";
import UnifiedMetricsCards from "./metrics/UnifiedMetricsCards";
import UnifiedTimelineChart from "./metrics/UnifiedTimelineChart";
import ModelDistribution from "./metrics/ModelDistribution";
import SessionTable from "./metrics/SessionTable";
import ForwardEndpointDistribution from "./metrics/ForwardEndpointDistribution";
import ForwardRequestTable from "./metrics/ForwardRequestTable";
import SyncMismatchBreakdownCard from "./metrics/SyncMismatchBreakdownCard";

const { Text } = Typography;
const { useToken } = theme;

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

const UnifiedMetricsDashboard: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [startDate, setStartDate] = useState<string | undefined>(undefined);
  const [endDate, setEndDate] = useState<string | undefined>(undefined);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [days, setDays] = useState<number>(30);
  const [granularity, setGranularity] = useState<MetricsGranularity>("daily");

  const {
    chatSummary,
    forwardSummary,
    combinedSummary,
    memorySummary,
    modelMetrics,
    modelCatalog,
    sessions,
    sessionDetail,
    endpointMetrics,
    forwardRequests,
    timeline,
    isLoading,
    isRefreshing,
    isSessionDetailLoading,
    error,
    refresh,
    loadSessionDetail,
    clearSessionDetail,
  } = useUnifiedMetrics({
    filters: {
      startDate,
      endDate,
      model: selectedModel,
      days,
      granularity,
    },
  });

  const modelOptions = useMemo(
    () =>
      modelCatalog.map((model) => ({
        label: model,
        value: model,
      })),
    [modelCatalog],
  );

  const roundColumns: ColumnsType<RoundMetrics> = useMemo(
    () => [
      {
        title: t("settings.metricsDashboard.roundColumns.round"),
        dataIndex: "round_id",
        key: "round_id",
        render: (value: string) => `${value.slice(0, 8)}...`,
      },
      {
        title: t("settings.metricsDashboard.roundColumns.status"),
        dataIndex: "status",
        key: "status",
      },
      {
        title: t("settings.metricsDashboard.roundColumns.duration"),
        dataIndex: "duration_ms",
        key: "duration_ms",
        render: (value?: number | null) => formatDuration(value),
      },
      {
        title: t("settings.metricsDashboard.roundColumns.tokens"),
        key: "tokens",
        render: (_: unknown, round: RoundMetrics) =>
          round.token_usage.total_tokens.toLocaleString(),
      },
      {
        title: t("settings.metricsDashboard.roundColumns.toolCalls"),
        key: "tool_calls",
        render: (_: unknown, round: RoundMetrics) => round.tool_calls.length,
      },
    ],
    [t],
  );

  const selectedSession = sessionDetail?.session;

  if (isLoading) {
    return <Skeleton active paragraph={{ rows: 10 }} />;
  }

  return (
    <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
      {error ? <Alert type="error" showIcon message={error} /> : null}

      {/* Filters */}
      <Card
        size="small"
        title={t("settings.metricsDashboard.filtersTitle")}
        extra={
          <Button icon={<ReloadOutlined />} loading={isRefreshing} onClick={() => void refresh()}>
            {t("settings.metricsDashboard.refresh")}
          </Button>
        }
      >
        <Space wrap>
          <DatePicker
            placeholder={t("settings.metricsDashboard.startDate")}
            onChange={(value) => {
              setStartDate(value ? value.format("YYYY-MM-DD") : undefined);
            }}
          />
          <DatePicker
            placeholder={t("settings.metricsDashboard.endDate")}
            onChange={(value) => {
              setEndDate(value ? value.format("YYYY-MM-DD") : undefined);
            }}
          />
          <Select
            allowClear
            style={{ minWidth: 180 }}
            placeholder={t("settings.metricsDashboard.model")}
            value={selectedModel}
            options={modelOptions}
            onChange={(value) => {
              setSelectedModel(value);
            }}
          />
          <Select
            style={{ width: 120 }}
            value={days}
            options={[7, 14, 30, 90].map((value) => ({
              label: t("settings.metricsDashboard.daysOption", { value }),
              value,
            }))}
            onChange={(value) => {
              setDays(value);
            }}
          />
          <Select
            style={{ width: 140 }}
            value={granularity}
            options={[
              {
                label: t("settings.metricsDashboard.granularity.daily"),
                value: "daily",
              },
              {
                label: t("settings.metricsDashboard.granularity.weekly"),
                value: "weekly",
              },
              {
                label: t("settings.metricsDashboard.granularity.monthly"),
                value: "monthly",
              },
            ]}
            onChange={(value: MetricsGranularity) => {
              setGranularity(value);
            }}
          />
        </Space>
        {selectedModel ? (
          <Alert
            type="info"
            showIcon
            message={t("settings.metricsDashboard.memoryModelFilterNotice")}
            style={{ marginTop: token.marginSM }}
          />
        ) : null}
      </Card>

      {/* Unified Metrics Cards */}
      <UnifiedMetricsCards
        chatSummary={chatSummary}
        forwardSummary={forwardSummary}
        combinedSummary={combinedSummary}
        memorySummary={memorySummary}
        sessions={sessions}
        loading={isLoading}
        showSyncMismatches={!selectedModel}
      />

      {/* Charts Row */}
      <div
        style={{
          width: "100%",
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: token.marginMD,
        }}
      >
        <UnifiedTimelineChart data={timeline} loading={isLoading} />
        <ModelDistribution data={modelMetrics} loading={isLoading} />
      </div>

      {!selectedModel ? (
        <SyncMismatchBreakdownCard
          breakdown={chatSummary?.sync_mismatch_breakdown}
          loading={isLoading}
        />
      ) : null}

      {/* Forward Endpoint Distribution */}
      <ForwardEndpointDistribution data={endpointMetrics} loading={isLoading} />

      {/* Detailed Data Tabs */}
      <Card size="small" title={t("settings.metricsDashboard.detailedMetricsTitle")}>
        <Tabs
          items={[
            {
              key: "sessions",
              label: t("settings.metricsDashboard.chatSessionsLabel", {
                count: sessions.length,
              }),
              children: (
                <SessionTable
                  sessions={sessions}
                  loading={isLoading}
                  onSelectSession={(sessionId) => {
                    void loadSessionDetail(sessionId);
                  }}
                />
              ),
            },
            {
              key: "forward",
              label: t("settings.metricsDashboard.forwardTabLabel", {
                count: forwardRequests.length,
              }),
              children: <ForwardRequestTable requests={forwardRequests} loading={isLoading} />,
            },
          ]}
        />
      </Card>

      {/* Session Detail Modal */}
      <Modal
        title={t("settings.metricsDashboard.sessionMetricsTitle")}
        open={Boolean(sessionDetail)}
        onCancel={clearSessionDetail}
        onOk={clearSessionDetail}
        width={960}
        destroyOnClose
      >
        {isSessionDetailLoading ? (
          <Text>{t("settings.metricsDashboard.loadingSessionDetails")}</Text>
        ) : selectedSession ? (
          <Space direction="vertical" style={{ width: "100%" }} size={token.marginMD}>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item
                label={t("settings.metricsDashboard.sessionDetail.sessionId")}
                span={2}
              >
                {selectedSession.session_id}
              </Descriptions.Item>
              <Descriptions.Item label={t("settings.metricsDashboard.sessionDetail.model")}>
                {selectedSession.model}
              </Descriptions.Item>
              <Descriptions.Item label={t("settings.metricsDashboard.sessionDetail.status")}>
                {selectedSession.status}
              </Descriptions.Item>
              <Descriptions.Item label={t("settings.metricsDashboard.sessionDetail.duration")}>
                {formatDuration(selectedSession.duration_ms)}
              </Descriptions.Item>
              <Descriptions.Item label={t("settings.metricsDashboard.sessionDetail.messages")}>
                {selectedSession.message_count}
              </Descriptions.Item>
              <Descriptions.Item label={t("settings.metricsDashboard.sessionDetail.totalTokens")}>
                {selectedSession.total_token_usage.total_tokens.toLocaleString()}
              </Descriptions.Item>
              <Descriptions.Item label={t("settings.metricsDashboard.sessionDetail.toolCalls")}>
                {selectedSession.tool_call_count}
              </Descriptions.Item>
            </Descriptions>

            <Table
              rowKey="round_id"
              size="small"
              columns={roundColumns}
              dataSource={sessionDetail.rounds}
              pagination={{ pageSize: 6, showSizeChanger: false }}
            />
          </Space>
        ) : (
          <Text type="secondary">{t("settings.metricsDashboard.noDetail")}</Text>
        )}
      </Modal>
    </Space>
  );
};

export default UnifiedMetricsDashboard;
