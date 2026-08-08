import { Card, Col, Row, Skeleton, Statistic, theme } from "antd";
import { useTranslation } from "react-i18next";

import type { MetricsUsageBreakdownResponse } from "@services/metrics";
import { statisticNumberFormatter } from "./metricNumberFormatting";

const { useToken } = theme;

interface UsageBreakdownCardsProps {
  summary: MetricsUsageBreakdownResponse | null;
  loading: boolean;
}

const UsageBreakdownCards: React.FC<UsageBreakdownCardsProps> = ({ summary, loading }) => {
  const { t } = useTranslation();
  const { token } = useToken();

  if (loading) {
    return <Skeleton active paragraph={{ rows: 1 }} />;
  }

  const items = [
    {
      key: "skill-load-calls",
      title: t("settings.metricsDashboard.skillsAndMcp.cards.skillLoadCalls"),
      value: summary?.skill_load_calls ?? 0,
      color: "var(--lotus-chart-primary)",
    },
    {
      key: "unique-skills",
      title: t("settings.metricsDashboard.skillsAndMcp.cards.uniqueSkills"),
      value: summary?.unique_skills ?? 0,
      color: "var(--lotus-chart-purple)",
    },
    {
      key: "mcp-calls",
      title: t("settings.metricsDashboard.skillsAndMcp.cards.mcpCalls"),
      value: summary?.mcp_calls ?? 0,
      color: "var(--lotus-chart-accent)",
    },
    {
      key: "unique-mcp-servers",
      title: t("settings.metricsDashboard.skillsAndMcp.cards.uniqueMcpServers"),
      value: summary?.unique_mcp_servers ?? 0,
      color: "var(--lotus-chart-cyan)",
    },
    {
      key: "unique-mcp-tools",
      title: t("settings.metricsDashboard.skillsAndMcp.cards.uniqueMcpTools"),
      value: summary?.unique_mcp_tools ?? 0,
      color: "var(--lotus-chart-secondary)",
    },
    {
      key: "core-tool-calls",
      title: t("settings.metricsDashboard.skillsAndMcp.cards.coreToolCalls"),
      value: summary?.core_tool_calls ?? 0,
      color: "var(--lotus-metric-text-strong)",
    },
  ].filter((item) => item.value > 0);

  if (items.length === 0) {
    return null;
  }

  return (
    <Row gutter={[token.marginSM, token.marginSM]}>
      {items.map((item) => (
        <Col key={item.key} xs={24} sm={12} lg={8} xl={4}>
          <Card size="small" className="lotus-metric-card">
            <Statistic
              title={item.title}
              value={item.value}
              precision={0}
              formatter={statisticNumberFormatter}
              valueStyle={{ color: item.color }}
            />
          </Card>
        </Col>
      ))}
    </Row>
  );
};

export default UsageBreakdownCards;
