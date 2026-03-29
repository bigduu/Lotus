import { Card, Col, Row, Skeleton, Statistic, theme } from "antd";
import { useTranslation } from "react-i18next";

import type { ForwardMetricsSummary } from "../../../../../services/metrics";

const { useToken } = theme;

interface ForwardMetricsCardsProps {
  summary: ForwardMetricsSummary | null;
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

const ForwardMetricsCards: React.FC<ForwardMetricsCardsProps> = ({ summary, loading }) => {
  const { t } = useTranslation();
  const { token } = useToken();

  if (loading) {
    return <Skeleton active paragraph={{ rows: 1 }} />;
  }

  const successRate =
    summary && summary.total_requests > 0
      ? ((summary.successful_requests / summary.total_requests) * 100).toFixed(1)
      : "0.0";

  return (
    <Row gutter={[token.marginSM, token.marginSM]}>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.forwardMetricsCards.totalForwardRequests")}
            value={summary?.total_requests ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-primary)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.forwardMetricsCards.successRate")}
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
            title={t("settings.forwardMetricsCards.forwardTokens")}
            value={summary?.total_tokens.total_tokens ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-metric-text-strong)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.forwardMetricsCards.avgResponseTime")}
            value={formatDuration(summary?.avg_duration_ms)}
            valueStyle={{ color: "var(--lotus-chart-cyan)" }}
          />
        </Card>
      </Col>
    </Row>
  );
};

export default ForwardMetricsCards;
