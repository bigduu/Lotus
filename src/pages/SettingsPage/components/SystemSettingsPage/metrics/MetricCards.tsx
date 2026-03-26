import { Card, Col, Row, Skeleton, Statistic, theme } from "antd";
import { useTranslation } from "react-i18next";

import type { MetricsSummary, SessionMetrics } from "@services/metrics";

const { useToken } = theme;

interface MetricCardsProps {
  summary: MetricsSummary | null;
  sessions: SessionMetrics[];
  loading: boolean;
}

const formatDuration = (durationMs: number): string => {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
};

const averageSessionDuration = (sessions: SessionMetrics[]): number => {
  const completed = sessions.filter(
    (session) =>
      typeof session.duration_ms === "number" && session.duration_ms > 0,
  );

  if (completed.length === 0) {
    return 0;
  }

  const total = completed.reduce(
    (sum, session) => sum + (session.duration_ms ?? 0),
    0,
  );

  return Math.floor(total / completed.length);
};

const MetricCards: React.FC<MetricCardsProps> = ({
  summary,
  sessions,
  loading,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();

  if (loading) {
    return <Skeleton active paragraph={{ rows: 1 }} />;
  }

  const averageDurationMs = averageSessionDuration(sessions);

  return (
    <Row gutter={[token.marginSM, token.marginSM]}>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.metricsCards.totalSessions")}
            value={summary?.total_sessions ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-primary)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.metricsCards.chatTokens")}
            value={summary?.total_tokens.total_tokens ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-metric-text-strong)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.metricsCards.totalToolCalls")}
            value={summary?.total_tool_calls ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-purple)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.metricsCards.avgSessionDuration")}
            value={
              averageDurationMs > 0 ? formatDuration(averageDurationMs) : "-"
            }
            valueStyle={{ color: "var(--lotus-chart-accent)" }}
          />
        </Card>
      </Col>
    </Row>
  );
};

export default MetricCards;
