import { Empty, Skeleton } from "antd";
import { Card } from "@/components/ui/card";
import { Typography } from "@/components/ui/typography";
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

import type { MemoryTimelinePoint } from "@services/metrics";

const { Text } = Typography;

interface MemoryTrendChartProps {
  data: MemoryTimelinePoint[];
  loading: boolean;
}

const MemoryTrendChart: React.FC<MemoryTrendChartProps> = ({ data, loading }) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Card
        size="small"
        className="lotus-metric-card"
        title={t("settings.charts.memoryTrendTitle")}
      >
        <Skeleton active paragraph={{ rows: 5 }} />
      </Card>
    );
  }

  return (
    <Card size="small" className="lotus-metric-card" title={t("settings.charts.memoryTrendTitle")}>
      {data.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("settings.charts.noMemoryTrend")}
        />
      ) : (
        <>
          <Text type="secondary">{t("settings.charts.memoryTrendDescription")}</Text>
          <div style={{ width: "100%", height: 280, marginTop: 12 }}>
            <ResponsiveContainer>
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" minTickGap={24} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="total_memories"
                  name={t("settings.charts.totalMemories")}
                  stroke="var(--lotus-chart-primary)"
                  strokeWidth={2.5}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="created_memories"
                  name={t("settings.charts.createdMemories")}
                  stroke="var(--lotus-chart-secondary)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="updated_memories"
                  name={t("settings.charts.updatedMemories")}
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

export default MemoryTrendChart;
