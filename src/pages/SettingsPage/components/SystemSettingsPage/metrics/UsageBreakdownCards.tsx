import { Col, Row, Skeleton, Statistic, theme } from "antd";
import { Card } from "@/components/ui/card";
import { useTranslation } from "react-i18next";

import type { MetricsUsageBreakdownResponse } from "@services/metrics";

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

  return (
    <Row gutter={[token.marginSM, token.marginSM]}>
      <Col xs={24} sm={12} lg={8} xl={4}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.metricsDashboard.skillsAndMcp.cards.skillLoadCalls", {
              defaultValue: "Skill Loads",
            })}
            value={summary?.skill_load_calls ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-primary)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8} xl={4}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.metricsDashboard.skillsAndMcp.cards.uniqueSkills", {
              defaultValue: "Unique Skills",
            })}
            value={summary?.unique_skills ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-purple)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8} xl={4}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.metricsDashboard.skillsAndMcp.cards.mcpCalls", {
              defaultValue: "MCP Calls",
            })}
            value={summary?.mcp_calls ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-accent)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8} xl={4}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.metricsDashboard.skillsAndMcp.cards.uniqueMcpServers", {
              defaultValue: "MCP Servers",
            })}
            value={summary?.unique_mcp_servers ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-cyan)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8} xl={4}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.metricsDashboard.skillsAndMcp.cards.uniqueMcpTools", {
              defaultValue: "MCP Tools",
            })}
            value={summary?.unique_mcp_tools ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-chart-secondary)" }}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8} xl={4}>
        <Card size="small" className="lotus-metric-card">
          <Statistic
            title={t("settings.metricsDashboard.skillsAndMcp.cards.coreToolCalls", {
              defaultValue: "Core Tool Calls",
            })}
            value={summary?.core_tool_calls ?? 0}
            precision={0}
            valueStyle={{ color: "var(--lotus-metric-text-strong)" }}
          />
        </Card>
      </Col>
    </Row>
  );
};

export default UsageBreakdownCards;
