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

const { Text } = Typography;

export interface TokenChartPoint {
  label: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface TokenChartProps {
  data: TokenChartPoint[];
  loading: boolean;
}

const TokenChart: React.FC<TokenChartProps> = ({ data, loading }) => {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Card size="small" title={t("settings.charts.tokenUsageOverTime")}>
        <Skeleton active paragraph={{ rows: 5 }} />
      </Card>
    );
  }

  return (
    <Card size="small" title={t("settings.charts.tokenUsageOverTime")}>
      {data.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("settings.charts.noTokenUsage")}
        />
      ) : (
        <>
          <Text type="secondary">
            {t("settings.charts.tokenUsageDescription")}
          </Text>
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
                  dataKey="totalTokens"
                  name={t("settings.charts.total")}
                  stroke="#1677ff"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="promptTokens"
                  name={t("settings.charts.prompt")}
                  stroke="#52c41a"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="completionTokens"
                  name={t("settings.charts.completion")}
                  stroke="#fa8c16"
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

export default TokenChart;
