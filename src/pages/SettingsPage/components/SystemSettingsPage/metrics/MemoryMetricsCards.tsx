import { Col, Row, Skeleton, Statistic, theme } from "antd";
import { Card } from "@/components/ui/card";
import { useTranslation } from "react-i18next";

import type { MemoryMetricsSummary } from "@services/metrics";

const { useToken } = theme;

interface MemoryMetricsCardsProps {
  summary: MemoryMetricsSummary | null;
  loading: boolean;
}

const formatTimestamp = (value?: string | null): string => {
  if (!value) {
    return "-";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const MemoryMetricsCards: React.FC<MemoryMetricsCardsProps> = ({ summary, loading }) => {
  const { t } = useTranslation();
  const { token } = useToken();

  if (loading) {
    return <Skeleton active paragraph={{ rows: 1 }} />;
  }

  return (
    <Row gutter={[token.marginSM, token.marginSM]}>
      <Col xs={24} sm={12} lg={8} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.totalMemories")}
            value={summary?.total_memories ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-primary)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.staleCandidates")}
            value={summary?.stale_candidate_count ?? 0}
            precision={0}
            valueStyle={{
              color:
                (summary?.stale_candidate_count ?? 0) > 0
                  ? "var(--lotus-chart-accent)"
                  : "var(--lotus-chart-secondary)",
            }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.memoryProjects")}
            value={summary?.project_count ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-purple)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8} xl={6}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.unifiedMetricsCards.lastReindex")}
            value={formatTimestamp(summary?.last_reindex_at)}
            valueStyle={{ color: "var(--lotus-chart-cyan)" }}
          />
        </Card>
      </Col>
    </Row>
  );
};

export default MemoryMetricsCards;
