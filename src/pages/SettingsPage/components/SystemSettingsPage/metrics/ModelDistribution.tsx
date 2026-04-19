import { Card, Empty, Skeleton } from "antd";
import { Typography } from "@/components/ui/typography";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useTranslation } from "react-i18next";

import type { ModelMetrics } from "@services/metrics";

const { Text } = Typography;

interface ModelDistributionProps {
  data: ModelMetrics[];
  loading: boolean;
}

const PIE_COLORS = [
  "var(--lotus-chart-primary)",
  "var(--lotus-chart-secondary)",
  "var(--lotus-chart-accent)",
  "var(--lotus-chart-purple)",
  "var(--lotus-chart-cyan)",
];

const ModelDistribution: React.FC<ModelDistributionProps> = ({ data, loading }) => {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Card
        size="small"
        className="lotus-metric-card"
        title={t("settings.charts.modelDistribution")}
      >
        <Skeleton active paragraph={{ rows: 5 }} />
      </Card>
    );
  }

  const chartData = data.map((row) => ({
    name: row.model,
    value: row.tokens.total_tokens,
  }));

  return (
    <Card size="small" className="lotus-metric-card" title={t("settings.charts.modelDistribution")}>
      {chartData.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("settings.charts.noModelMetrics")}
        />
      ) : (
        <>
          <Text type="secondary">{t("settings.charts.modelDistributionDescription")}</Text>
          <div style={{ width: "100%", height: 280, marginTop: 12 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  fill="var(--lotus-chart-primary)"
                  dataKey="value"
                  nameKey="name"
                  label
                >
                  {chartData.map((entry, index) => (
                    <Cell
                      key={`${entry.name}-${index}`}
                      fill={PIE_COLORS[index % PIE_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
};

export default ModelDistribution;
