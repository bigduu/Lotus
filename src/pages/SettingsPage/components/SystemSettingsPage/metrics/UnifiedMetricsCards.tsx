import { Card, Col, Row, Skeleton, Statistic, theme } from "antd";
import { useTranslation } from "react-i18next";

import type {
  CombinedSummary,
  MetricsSummary,
  SessionMetrics,
  ForwardMetricsSummary,
} from "../../../../../services/metrics";

const { useToken } = theme;

interface UnifiedMetricsCardsProps {
  chatSummary: MetricsSummary | null;
  forwardSummary: ForwardMetricsSummary | null;
  combinedSummary: CombinedSummary | null;
  sessions: SessionMetrics[];
  loading: boolean;
}

const formatDuration = (durationMs: number | null | undefined): string => {
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

const averageSessionDuration = (sessions: SessionMetrics[]): number => {
  const completed = sessions.filter(
    (session) => typeof session.duration_ms === "number" && session.duration_ms > 0,
  );

  if (completed.length === 0) {
    return 0;
  }

  const total = completed.reduce((sum, session) => sum + (session.duration_ms ?? 0), 0);

  return Math.floor(total / completed.length);
};

const UnifiedMetricsCards: React.FC<UnifiedMetricsCardsProps> = ({
  chatSummary,
  forwardSummary,
  combinedSummary,
  sessions,
  loading,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();

  if (loading) {
    return <Skeleton active paragraph={{ rows: 2 }} />;
  }

  const averageDurationMs = averageSessionDuration(sessions);
  const successRate = combinedSummary?.success_rate.toFixed(1) ?? "0.0";
  const avgForwardDuration = forwardSummary?.avg_duration_ms;

  return (
    <Row gutter={[token.marginSM, token.marginSM]}>
      {/* Combined Overview */}
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.totalRequests")}
            value={combinedSummary?.total_requests ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-primary)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.totalTokens")}
            value={combinedSummary?.total_tokens ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-metric-text-strong)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.successRate")}
            value={successRate}
            suffix="%"
            valueStyle={{
              color:
                Number(successRate) >= 95
                  ? "var(--lotus-chart-secondary)"
                  : Number(successRate) >= 80
                    ? "var(--lotus-chart-accent)"
                    : "var(--lotus-chart-danger)",
            }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.avgResponseTime")}
            value={formatDuration(avgForwardDuration)}
            valueStyle={{ color: "var(--lotus-chart-cyan)" }}
          />
        </Card>
      </Col>

      {/* Chat Metrics */}
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.chatSessions")}
            value={chatSummary?.total_sessions ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-primary)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.chatTokens")}
            value={chatSummary?.total_tokens.total_tokens ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-metric-text-strong)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.toolCalls")}
            value={chatSummary?.total_tool_calls ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-purple)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.avgSessionDuration")}
            value={averageDurationMs > 0 ? formatDuration(averageDurationMs) : "-"}
            valueStyle={{ color: "var(--lotus-chart-accent)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.promptCacheCompactions", {
              defaultValue: "Prompt Cache Compactions",
            })}
            value={
              chatSummary?.prompt_cached_tool_outputs ??
              combinedSummary?.prompt_cached_tool_outputs ??
              0
            }
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-cyan)" }}
          />
        </Card>
      </Col>

      {/* Forward Metrics */}
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.forwardRequests")}
            value={forwardSummary?.total_requests ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-primary)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.forwardTokens")}
            value={forwardSummary?.total_tokens.total_tokens ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-metric-text-strong)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.successful")}
            value={forwardSummary?.successful_requests ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-secondary)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.failed")}
            value={forwardSummary?.failed_requests ?? 0}
            precision={0}
            valueStyle={{
              color: forwardSummary?.failed_requests ? "var(--lotus-chart-danger)" : undefined,
            }}
          />
        </Card>
      </Col>
    </Row>
  );
};

export default UnifiedMetricsCards;
