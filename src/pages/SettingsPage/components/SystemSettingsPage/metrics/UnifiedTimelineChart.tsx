import { Card, Empty, Skeleton, Typography } from "antd";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { UnifiedTimelinePoint } from "../../../../../services/metrics";
import { formatMetricCompactNumber, formatMetricTooltipValue } from "./metricNumberFormatting";

const { Text } = Typography;

interface UnifiedTimelineChartProps {
  data: UnifiedTimelinePoint[];
  loading: boolean;
}

const UnifiedTimelineChart: React.FC<UnifiedTimelineChartProps> = ({ data, loading }) => {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Card
        size="small"
        className="lotus-metric-card"
        title={t("settings.charts.unifiedTokenUsageOverTime")}
      >
        <Skeleton active paragraph={{ rows: 5 }} />
      </Card>
    );
  }

  return (
    <Card
      size="small"
      className="lotus-metric-card"
      title={t("settings.charts.unifiedTokenUsageOverTime")}
    >
      {data.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("settings.charts.noTokenUsage")}
        />
      ) : (
        <>
          <Text type="secondary">{t("settings.charts.unifiedTokenUsageDescription")}</Text>
          <div style={{ width: "100%", height: 280, marginTop: 12 }}>
            <ResponsiveContainer>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" minTickGap={24} />
                <YAxis allowDecimals={false} tickFormatter={formatMetricCompactNumber} />
                <Tooltip formatter={(value: number) => formatMetricTooltipValue(value)} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="total_tokens"
                  name={t("settings.charts.total")}
                  stroke="var(--lotus-chart-primary)"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="chat_tokens"
                  name={t("settings.charts.chat")}
                  stroke="var(--lotus-chart-secondary)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="forward_tokens"
                  name={t("settings.charts.forward")}
                  stroke="var(--lotus-chart-accent)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
};

export default UnifiedTimelineChart;
