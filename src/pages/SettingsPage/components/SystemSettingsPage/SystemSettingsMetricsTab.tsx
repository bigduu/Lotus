import { useThemeStore } from "@shared/store/themeStore";
import { ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";

import type {
  DailyMetrics,
  MetricsGranularity,
  PeriodMetrics,
  RoundMetrics,
} from "@services/metrics";
import { useForwardMetrics } from "./hooks/useForwardMetrics";
import { useMetrics } from "./hooks/useMetrics";
import { useMetricsUsage } from "./hooks/useMetricsUsage";
import ForwardEndpointDistribution from "./metrics/ForwardEndpointDistribution";
import ForwardMetricsCards from "./metrics/ForwardMetricsCards";
import ForwardRequestTable from "./metrics/ForwardRequestTable";
import MemoryMetricsCards from "./metrics/MemoryMetricsCards";
import MemoryTrendChart from "./metrics/MemoryTrendChart";
import MetricCards from "./metrics/MetricCards";
import ModelDistribution from "./metrics/ModelDistribution";
import SessionTable from "./metrics/SessionTable";
import SyncMismatchBreakdownCard from "./metrics/SyncMismatchBreakdownCard";
import TokenChart from "./metrics/TokenChart";
import TopUsageBarCard from "./metrics/TopUsageBarCard";
import UsageBreakdownCards from "./metrics/UsageBreakdownCards";
import {
  formatMetricCompactNumber,
  formatMetricExactNumber,
  renderMetricNumber,
  statisticNumberFormatter,
} from "./metrics/metricNumberFormatting";

const { Text } = Typography;
const { useToken } = theme;

const asTimelineLabel = (item: DailyMetrics | PeriodMetrics): string => {
  if ("date" in item) {
    return item.date;
  }
  return item.label;
};

const heatColorForValue = (value: number, maxValue: number): string => {
  if (maxValue <= 0 || value <= 0) {
    return "var(--lotus-heat-0)";
  }

  const ratio = value / maxValue;

  if (ratio >= 0.8) {
    return "var(--lotus-heat-4)";
  }
  if (ratio >= 0.6) {
    return "var(--lotus-heat-3)";
  }
  if (ratio >= 0.4) {
    return "var(--lotus-heat-2)";
  }
  if (ratio >= 0.2) {
    return "var(--lotus-heat-1)";
  }
  return "var(--lotus-heat-0)";
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

const formatTimestamp = (value?: string | null): string => {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const formatBreakdownText = (input?: Record<string, number> | null): string => {
  const entries = Object.entries(input ?? {}).sort((left, right) => right[1] - left[1]);
  if (entries.length === 0) {
    return "-";
  }

  return entries
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${formatMetricExactNumber(value)}`)
    .join(" • ");
};

const responsiveGridStyle = (gap: number, minWidth = 320): CSSProperties => ({
  width: "100%",
  display: "grid",
  gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`,
  gap,
});

/**
 * Tracks whether the metrics dashboard is actually on screen: visible in the
 * viewport (the Settings page keeps inactive tabs mounted but `display:none`)
 * and the document/tab is foregrounded. Used to pause all metrics fetching +
 * polling while the dashboard is hidden, instead of hammering the endpoints
 * every refresh interval forever. Defaults to active so data still loads in
 * environments without IntersectionObserver (e.g. jsdom tests).
 */
const useMetricsActive = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      return;
    }

    let inView = true;
    let documentVisible = typeof document === "undefined" || document.visibilityState === "visible";
    const sync = () => setActive(inView && documentVisible);

    const observer = new IntersectionObserver((entries) => {
      inView = entries.some((entry) => entry.isIntersecting);
      sync();
    });
    observer.observe(element);

    const onVisibilityChange = () => {
      documentVisible = document.visibilityState === "visible";
      sync();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    sync();

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return { ref, active };
};

const SystemSettingsMetricsTab: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const isDark = useThemeStore((s) => s.themeMode) === "dark";
  const [startDate, setStartDate] = useState<string | undefined>(undefined);
  const [endDate, setEndDate] = useState<string | undefined>(undefined);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [days, setDays] = useState<number>(30);
  const [granularity, setGranularity] = useState<MetricsGranularity>("daily");

  // Only fetch/poll while the dashboard is actually visible on screen.
  const { ref: rootRef, active } = useMetricsActive();

  const {
    summary,
    modelMetrics,
    modelCatalog,
    sessions,
    timeline,
    memorySummary,
    memoryTimeline,
    sessionDetail,
    isLoading,
    isRefreshing,
    isSessionDetailLoading,
    error,
    refresh,
    loadSessionDetail,
    clearSessionDetail,
  } = useMetrics({
    enabled: active,
    filters: {
      startDate,
      endDate,
      model: selectedModel,
      days,
      granularity,
    },
  });

  const {
    summary: forwardSummary,
    endpointMetrics,
    requests: forwardRequests,
    isLoading: isForwardLoading,
    isRefreshing: isForwardRefreshing,
    error: forwardError,
    refresh: refreshForward,
  } = useForwardMetrics({
    enabled: active,
    filters: {
      startDate,
      endDate,
      days,
      model: selectedModel,
    },
  });

  const {
    data: usageSummary,
    isLoading: isUsageLoading,
    isRefreshing: isUsageRefreshing,
    error: usageError,
    refresh: refreshUsage,
  } = useMetricsUsage({
    enabled: active,
    filters: {
      startDate,
      endDate,
      days,
      model: selectedModel,
    },
  });

  const tokenChartData = useMemo(
    () =>
      timeline.map((item) => ({
        label: asTimelineLabel(item),
        promptTokens: item.total_token_usage.prompt_tokens,
        completionTokens: item.total_token_usage.completion_tokens,
        totalTokens: item.total_token_usage.total_tokens,
      })),
    [timeline],
  );

  const modelOptions = useMemo(
    () =>
      modelCatalog.map((model) => ({
        label: model,
        value: model,
      })),
    [modelCatalog],
  );

  const activityData = useMemo(() => {
    const points = timeline.map((item) => ({
      label: asTimelineLabel(item),
      sessions: item.total_sessions,
      tokens: item.total_token_usage.total_tokens,
    }));

    const maxSessions = points.reduce((maxValue, point) => Math.max(maxValue, point.sessions), 0);

    return { points, maxSessions };
  }, [timeline]);

  const p95ForwardDuration = useMemo(() => {
    const durations = forwardRequests
      .map((request) => request.duration_ms)
      .filter((duration): duration is number => typeof duration === "number" && duration > 0)
      .sort((left, right) => left - right);

    if (durations.length === 0) {
      return null;
    }

    const index = Math.ceil(durations.length * 0.95) - 1;
    return durations[Math.max(0, Math.min(index, durations.length - 1))];
  }, [forwardRequests]);

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
          renderMetricNumber(round.token_usage.total_tokens),
      },
      {
        title: t("settings.metricsDashboard.roundColumns.toolCalls"),
        key: "tool_calls",
        render: (_: unknown, round: RoundMetrics) => round.tool_calls.length,
      },
    ],
    [t],
  );

  const compactStats = useMemo(() => {
    const totalSessions = summary?.total_sessions ?? 0;
    const totalSessionTokens = summary?.total_tokens.total_tokens ?? 0;
    const totalToolCalls = summary?.total_tool_calls ?? 0;
    const activeSessions = summary?.active_sessions ?? 0;
    const totalRounds = sessions.reduce((sum, session) => sum + session.total_rounds, 0);
    const totalSavedTokens = summary?.total_tokens_saved ?? 0;
    const toolContextTokensSaved = summary?.tool_context_tokens_saved ?? 0;
    const nonToolCompressionTokensSaved = summary?.non_tool_compression_tokens_saved ?? 0;
    const promptCachedToolOutputs = summary?.prompt_cached_tool_outputs ?? 0;
    const totalCompressionEvents = summary?.total_compression_events ?? 0;

    const totalForwardRequests = forwardSummary?.total_requests ?? 0;
    const totalForwardTokens = forwardSummary?.total_tokens.total_tokens ?? 0;
    const failedForwardRequests = forwardSummary?.failed_requests ?? 0;
    const streamedForwardRequests = forwardRequests.filter((request) => request.is_stream).length;

    const activeRate = totalSessions > 0 ? (activeSessions / totalSessions) * 100 : 0;
    const errorRate =
      totalForwardRequests > 0 ? (failedForwardRequests / totalForwardRequests) * 100 : 0;
    const streamRate =
      forwardRequests.length > 0 ? (streamedForwardRequests / forwardRequests.length) * 100 : 0;
    const savedTokenRatio =
      totalSessionTokens > 0
        ? Number(((totalSavedTokens / totalSessionTokens) * 100).toFixed(1))
        : 0;
    const toolSavedShare =
      totalSavedTokens > 0
        ? Number(((toolContextTokensSaved / totalSavedTokens) * 100).toFixed(1))
        : 0;

    return [
      {
        title: t("settings.metricsDashboard.compactStats.avgTokensPerSession"),
        value: totalSessions > 0 ? Math.round(totalSessionTokens / totalSessions) : 0,
      },
      {
        title: t("settings.metricsDashboard.compactStats.savedTokens"),
        value: totalSavedTokens,
      },
      {
        title: t("settings.metricsDashboard.compactStats.toolContextSavedTokens"),
        value: toolContextTokensSaved,
      },
      {
        title: t("settings.metricsDashboard.compactStats.nonToolCompressionSavedTokens"),
        value: nonToolCompressionTokensSaved,
      },
      {
        title: t("settings.metricsDashboard.compactStats.savedTokenRatio"),
        value: savedTokenRatio,
        suffix: "%",
      },
      {
        title: t("settings.metricsDashboard.compactStats.toolSavedShare"),
        value: toolSavedShare,
        suffix: "%",
      },
      {
        title: t("settings.metricsDashboard.compactStats.promptCachedToolOutputs"),
        value: promptCachedToolOutputs,
      },
      {
        title: t("settings.metricsDashboard.compactStats.compressionEvents"),
        value: totalCompressionEvents,
      },
      {
        title: t("settings.metricsDashboard.compactStats.avgRoundsPerSession"),
        value: totalSessions > 0 ? Number((totalRounds / totalSessions).toFixed(2)) : 0,
      },
      {
        title: t("settings.metricsDashboard.compactStats.toolCallsPerSession"),
        value: totalSessions > 0 ? Number((totalToolCalls / totalSessions).toFixed(2)) : 0,
      },
      {
        title: t("settings.metricsDashboard.compactStats.activeSessionRate"),
        value: Number(activeRate.toFixed(1)),
        suffix: "%",
      },
      {
        title: t("settings.metricsDashboard.compactStats.avgTokensPerForward"),
        value: totalForwardRequests > 0 ? Math.round(totalForwardTokens / totalForwardRequests) : 0,
      },
      {
        title: t("settings.metricsDashboard.compactStats.forwardErrorRate"),
        value: Number(errorRate.toFixed(1)),
        suffix: "%",
      },
      {
        title: t("settings.metricsDashboard.compactStats.streamingRatio"),
        value: Number(streamRate.toFixed(1)),
        suffix: "%",
      },
      {
        title: t("settings.metricsDashboard.compactStats.p95ForwardLatency"),
        value: formatDuration(p95ForwardDuration),
      },
      {
        title: t("settings.metricsDashboard.compactStats.modelCoverage"),
        value: modelMetrics.length,
      },
      {
        title: t("settings.metricsDashboard.compactStats.endpointCoverage"),
        value: endpointMetrics.length,
      },
    ];
  }, [
    endpointMetrics.length,
    forwardRequests,
    forwardSummary,
    modelMetrics.length,
    p95ForwardDuration,
    sessions,
    summary,
    t,
  ]);

  const forwardPerformanceStats = useMemo(() => {
    const totalForwardRequests = forwardSummary?.total_requests ?? 0;
    const failedForwardRequests = forwardSummary?.failed_requests ?? 0;
    const streamedForwardRequests = forwardRequests.filter((request) => request.is_stream).length;
    const streamRate =
      forwardRequests.length > 0 ? (streamedForwardRequests / forwardRequests.length) * 100 : 0;
    const errorRate =
      totalForwardRequests > 0 ? (failedForwardRequests / totalForwardRequests) * 100 : 0;

    return [
      {
        title: t("settings.metricsDashboard.forward.performance.p95Latency"),
        value: formatDuration(p95ForwardDuration),
      },
      {
        title: t("settings.metricsDashboard.forward.performance.errorRate"),
        value: Number(errorRate.toFixed(1)),
        suffix: "%",
      },
      {
        title: t("settings.metricsDashboard.forward.performance.streamingRatio"),
        value: Number(streamRate.toFixed(1)),
        suffix: "%",
      },
      {
        title: t("settings.metricsDashboard.forward.performance.endpointCoverage"),
        value: endpointMetrics.length,
      },
    ];
  }, [endpointMetrics.length, forwardRequests, forwardSummary, p95ForwardDuration, t]);

  const usageMixData = useMemo(
    () =>
      usageSummary
        ? [
            {
              label: t("settings.metricsDashboard.skillsAndMcp.mix.coreTools"),
              count: usageSummary.core_tool_calls,
            },
            {
              label: t("settings.metricsDashboard.skillsAndMcp.mix.skillLoads"),
              count: usageSummary.skill_load_calls,
            },
            {
              label: t("settings.metricsDashboard.skillsAndMcp.mix.mcpCalls"),
              count: usageSummary.mcp_calls,
            },
          ].filter((item) => item.count > 0)
        : [],
    [t, usageSummary],
  );

  const topSkillData = useMemo(
    () =>
      (usageSummary?.top_skills ?? []).map((item) => ({
        label: item.skill_id,
        count: item.count,
      })),
    [usageSummary],
  );

  const topMcpServerData = useMemo(
    () =>
      (usageSummary?.top_mcp_servers ?? []).map((item) => ({
        label: item.server_id,
        count: item.count,
        meta: t("settings.metricsDashboard.skillsAndMcp.meta.uniqueTools", {
          count: item.unique_tools,
        }),
      })),
    [t, usageSummary],
  );

  const topMcpToolData = useMemo(
    () =>
      (usageSummary?.top_mcp_tools ?? []).map((item) => ({
        label: item.tool_name,
        count: item.count,
        meta: item.server_id,
      })),
    [usageSummary],
  );

  const topCoreToolData = useMemo(
    () =>
      (usageSummary?.top_core_tools ?? []).map((item) => ({
        label: item.name,
        count: item.count,
      })),
    [usageSummary],
  );

  const selectedSession = sessionDetail?.session;
  const isDashboardRefreshing = isRefreshing || isForwardRefreshing || isUsageRefreshing;

  return (
    <div ref={rootRef} style={{ width: "100%" }}>
      <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        {forwardError ? <Alert type="error" showIcon message={forwardError} /> : null}
        {usageError ? <Alert type="error" showIcon message={usageError} /> : null}

        <Card
          size="small"
          title={t("settings.metricsDashboard.filtersTitle")}
          extra={
            <Button
              icon={<ReloadOutlined />}
              loading={isDashboardRefreshing}
              onClick={() => {
                void refresh();
                void refreshForward();
                void refreshUsage();
              }}
            >
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
        </Card>

        <Card size="small" title={t("settings.metricsDashboard.dashboardTitle")}>
          <Tabs
            size="small"
            destroyInactiveTabPane
            items={[
              {
                key: "overview",
                label: t("settings.metricsDashboard.tabs.overview"),
                children: (
                  <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                    <Card
                      size="small"
                      className="lotus-metric-card"
                      title={t("settings.metricsDashboard.overviewSections.scaleTitle")}
                      extra={
                        <Text type="secondary">
                          {t("settings.metricsDashboard.overviewSections.scaleSubtitle")}
                        </Text>
                      }
                    >
                      <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                        <MetricCards
                          summary={summary}
                          sessions={sessions}
                          loading={isLoading}
                          showSyncMismatches={!selectedModel}
                        />
                        <ForwardMetricsCards summary={forwardSummary} loading={isForwardLoading} />
                        <UsageBreakdownCards summary={usageSummary} loading={isUsageLoading} />
                        <MemoryMetricsCards summary={memorySummary} loading={isLoading} />
                      </Space>
                    </Card>
                    <Card
                      size="small"
                      className="lotus-metric-card"
                      title={t("settings.metricsDashboard.overviewSections.efficiencyTitle")}
                      extra={
                        <Text type="secondary">
                          {t("settings.metricsDashboard.overviewSections.efficiencySubtitle")}
                        </Text>
                      }
                    >
                      <Row gutter={[token.marginSM, token.marginSM]}>
                        {compactStats.map((metric) => (
                          <Col key={metric.title} xs={24} sm={12} md={8} xl={6}>
                            <div
                              style={{
                                borderRadius: token.borderRadiusSM,
                                padding: token.paddingXS,
                                background: isDark
                                  ? "rgba(255, 255, 255, 0.05)"
                                  : "rgba(255, 255, 255, 0.82)",
                                border: isDark
                                  ? "1px solid rgba(255,255,255,0.08)"
                                  : "1px solid rgba(148,163,184,0.18)",
                              }}
                            >
                              <Statistic
                                title={metric.title}
                                value={metric.value}
                                suffix={metric.suffix}
                                formatter={
                                  typeof metric.value === "number"
                                    ? statisticNumberFormatter
                                    : undefined
                                }
                                valueStyle={{ fontSize: token.fontSizeHeading4 }}
                              />
                            </div>
                          </Col>
                        ))}
                      </Row>
                      <Text
                        type="secondary"
                        style={{ display: "block", marginTop: token.marginXS }}
                      >
                        {t("settings.metricsDashboard.efficiencyHint")}
                      </Text>
                    </Card>
                  </Space>
                ),
              },
              {
                key: "chat",
                label: t("settings.metricsDashboard.tabs.chat"),
                children: (
                  <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                    <MetricCards
                      summary={summary}
                      sessions={sessions}
                      loading={isLoading}
                      showSyncMismatches={!selectedModel}
                    />
                    <div style={responsiveGridStyle(token.marginSM, 360)}>
                      <TokenChart data={tokenChartData} loading={isLoading} />
                      <ModelDistribution data={modelMetrics} loading={isLoading} />
                    </div>
                    <div style={responsiveGridStyle(token.marginSM, 360)}>
                      {!selectedModel ? (
                        <SyncMismatchBreakdownCard
                          breakdown={summary?.sync_mismatch_breakdown}
                          loading={isLoading}
                        />
                      ) : null}
                      <Card
                        size="small"
                        className="lotus-metric-card"
                        title={t("settings.metricsDashboard.activityHeatmapTitle")}
                      >
                        {activityData.points.length === 0 ? (
                          <Text type="secondary">{t("settings.metricsDashboard.noActivity")}</Text>
                        ) : (
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                              gap: token.marginXS,
                            }}
                          >
                            {activityData.points.map((point) => (
                              <div
                                key={point.label}
                                style={{
                                  borderRadius: token.borderRadiusSM,
                                  padding: token.paddingXS,
                                  background: heatColorForValue(
                                    point.sessions,
                                    activityData.maxSessions,
                                  ),
                                  minHeight: 64,
                                  color:
                                    point.sessions > 0
                                      ? "var(--lotus-metric-text-strong)"
                                      : token.colorTextSecondary,
                                }}
                              >
                                <div style={{ fontSize: 12, lineHeight: 1.2 }}>{point.label}</div>
                                <div style={{ fontWeight: 600, marginTop: 4 }}>
                                  {t("settings.metricsDashboard.sessionsCount", {
                                    count: point.sessions,
                                  })}
                                </div>
                                <div style={{ fontSize: 12 }}>
                                  {t("settings.metricsDashboard.tokensAmount", {
                                    value: formatMetricCompactNumber(point.tokens),
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </Card>
                    </div>
                  </Space>
                ),
              },
              {
                key: "skills-and-mcp",
                label: t("settings.metricsDashboard.tabs.skillsAndMcp"),
                children: (
                  <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                    <UsageBreakdownCards summary={usageSummary} loading={isUsageLoading} />
                    <div style={responsiveGridStyle(token.marginSM, 360)}>
                      <TopUsageBarCard
                        title={t("settings.metricsDashboard.skillsAndMcp.usageMixTitle")}
                        subtitle={t("settings.metricsDashboard.skillsAndMcp.usageMixSubtitle")}
                        emptyText={t("settings.metricsDashboard.skillsAndMcp.noUsageMix")}
                        data={usageMixData}
                        loading={isUsageLoading}
                        color="var(--lotus-chart-primary)"
                      />
                      <TopUsageBarCard
                        title={t("settings.metricsDashboard.skillsAndMcp.topSkillsTitle")}
                        subtitle={t("settings.metricsDashboard.skillsAndMcp.topSkillsSubtitle")}
                        emptyText={t("settings.metricsDashboard.skillsAndMcp.noSkills")}
                        data={topSkillData}
                        loading={isUsageLoading}
                        color="var(--lotus-chart-purple)"
                      />
                      <TopUsageBarCard
                        title={t("settings.metricsDashboard.skillsAndMcp.topMcpServersTitle")}
                        subtitle={t("settings.metricsDashboard.skillsAndMcp.topMcpServersSubtitle")}
                        emptyText={t("settings.metricsDashboard.skillsAndMcp.noMcpServers")}
                        data={topMcpServerData}
                        loading={isUsageLoading}
                        color="var(--lotus-chart-cyan)"
                      />
                      <TopUsageBarCard
                        title={t("settings.metricsDashboard.skillsAndMcp.topMcpToolsTitle")}
                        subtitle={t("settings.metricsDashboard.skillsAndMcp.topMcpToolsSubtitle")}
                        emptyText={t("settings.metricsDashboard.skillsAndMcp.noMcpTools")}
                        data={topMcpToolData}
                        loading={isUsageLoading}
                        color="var(--lotus-chart-accent)"
                      />
                      <TopUsageBarCard
                        title={t("settings.metricsDashboard.skillsAndMcp.topCoreToolsTitle")}
                        subtitle={t("settings.metricsDashboard.skillsAndMcp.topCoreToolsSubtitle")}
                        emptyText={t("settings.metricsDashboard.skillsAndMcp.noCoreTools")}
                        data={topCoreToolData}
                        loading={isUsageLoading}
                        color="var(--lotus-chart-secondary)"
                      />
                    </div>
                  </Space>
                ),
              },
              {
                key: "forward",
                label: t("settings.metricsDashboard.tabs.forward"),
                children: (
                  <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                    <ForwardMetricsCards summary={forwardSummary} loading={isForwardLoading} />
                    <Card
                      size="small"
                      className="lotus-metric-card"
                      title={t("settings.metricsDashboard.forward.performanceTitle")}
                    >
                      <Row gutter={[token.marginSM, token.marginSM]}>
                        {forwardPerformanceStats.map((metric) => (
                          <Col key={metric.title} xs={24} sm={12} xl={6}>
                            <div
                              style={{
                                borderRadius: token.borderRadiusSM,
                                padding: token.paddingXS,
                                background: isDark
                                  ? "rgba(255, 255, 255, 0.05)"
                                  : "rgba(255, 255, 255, 0.82)",
                                border: isDark
                                  ? "1px solid rgba(255,255,255,0.08)"
                                  : "1px solid rgba(148,163,184,0.18)",
                              }}
                            >
                              <Statistic
                                title={metric.title}
                                value={metric.value}
                                suffix={metric.suffix}
                                valueStyle={{ fontSize: token.fontSizeHeading4 }}
                              />
                            </div>
                          </Col>
                        ))}
                      </Row>
                    </Card>
                    <ForwardEndpointDistribution
                      data={endpointMetrics}
                      loading={isForwardLoading}
                    />
                  </Space>
                ),
              },
              {
                key: "memory",
                label: t("settings.metricsDashboard.tabs.memory"),
                children: (
                  <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                    <MemoryMetricsCards summary={memorySummary} loading={isLoading} />
                    <MemoryTrendChart data={memoryTimeline} loading={isLoading} />
                    <Card
                      size="small"
                      className="lotus-metric-card"
                      title={t("settings.metricsDashboard.memory.breakdownTitle")}
                    >
                      <Descriptions size="small" bordered column={1}>
                        <Descriptions.Item label={t("settings.metricsDashboard.memory.byType")}>
                          {formatBreakdownText(memorySummary?.by_type)}
                        </Descriptions.Item>
                        <Descriptions.Item label={t("settings.metricsDashboard.memory.byStatus")}>
                          {formatBreakdownText(memorySummary?.by_status)}
                        </Descriptions.Item>
                        <Descriptions.Item label={t("settings.metricsDashboard.memory.byScope")}>
                          {formatBreakdownText(memorySummary?.by_scope)}
                        </Descriptions.Item>
                        <Descriptions.Item label={t("settings.metricsDashboard.memory.lastDream")}>
                          {formatTimestamp(memorySummary?.last_dream_at)}
                        </Descriptions.Item>
                        <Descriptions.Item
                          label={t("settings.metricsDashboard.memory.lastReindex")}
                        >
                          {formatTimestamp(memorySummary?.last_reindex_at)}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>
                  </Space>
                ),
              },
              {
                key: "records",
                label: t("settings.metricsDashboard.tabs.records"),
                children: (
                  <Tabs
                    size="small"
                    destroyInactiveTabPane
                    items={[
                      {
                        key: "sessions",
                        label: t("settings.metricsDashboard.sessionsTabLabel", {
                          count: sessions.length,
                        }),
                        children: (
                          <Card
                            size="small"
                            extra={
                              <Text type="secondary">
                                {t("settings.metricsDashboard.sessionsHint")}
                              </Text>
                            }
                          >
                            <SessionTable
                              sessions={sessions}
                              loading={isLoading}
                              onSelectSession={(sessionId) => {
                                void loadSessionDetail(sessionId);
                              }}
                            />
                          </Card>
                        ),
                      },
                      {
                        key: "forward-requests",
                        label: t("settings.metricsDashboard.forwardTabLabel", {
                          count: forwardRequests.length,
                        }),
                        children: (
                          <Card size="small">
                            <ForwardRequestTable
                              requests={forwardRequests}
                              loading={isForwardLoading}
                            />
                          </Card>
                        ),
                      },
                    ]}
                  />
                ),
              },
            ]}
          />
        </Card>

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
                  {renderMetricNumber(selectedSession.total_token_usage.total_tokens)}
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
    </div>
  );
};

export default SystemSettingsMetricsTab;
