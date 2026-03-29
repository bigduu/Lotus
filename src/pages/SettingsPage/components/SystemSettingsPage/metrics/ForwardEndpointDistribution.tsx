import { Card, theme } from "antd";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTranslation } from "react-i18next";

import type { ForwardEndpointMetrics } from "../../../../../services/metrics";

interface ForwardEndpointDistributionProps {
  data: ForwardEndpointMetrics[];
  loading: boolean;
}

const { useToken } = theme;

const ForwardEndpointDistribution: React.FC<ForwardEndpointDistributionProps> = ({
  data,
  loading,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();

  if (loading) {
    return (
      <Card
        size="small"
        className="lotus-metric-card"
        title={t("settings.charts.endpointDistribution")}
      >
        <div style={{ width: "100%", height: 240 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
              color: token.colorTextSecondary,
            }}
          >
            {t("settings.common.loading")}
          </div>
        </div>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card
        size="small"
        className="lotus-metric-card"
        title={t("settings.charts.endpointDistribution")}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: 240,
            color: token.colorTextSecondary,
          }}
        >
          {t("settings.charts.noForwardMetrics")}
        </div>
      </Card>
    );
  }

  const chartData = data.map((item) => ({
    endpoint: item.endpoint.split(".").pop() || item.endpoint,
    requests: item.requests,
    successful: item.successful,
    failed: item.failed,
  }));

  return (
    <Card
      size="small"
      className="lotus-metric-card"
      title={t("settings.charts.endpointDistribution")}
    >
      <div style={{ width: "100%", height: 240 }}>
        <ResponsiveContainer>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="endpoint" />
            <YAxis />
            <Tooltip
              formatter={(value: number, name: string) => [
                `${value}`,
                name.charAt(0).toUpperCase() + name.slice(1),
              ]}
            />
            <Legend />
            <Bar
              dataKey="successful"
              fill="var(--lotus-chart-secondary)"
              name={t("settings.common.successful")}
              fillOpacity={0.9}
              radius={[4, 4, 0, 0]}
            />
            <Bar
              dataKey="failed"
              fill="var(--lotus-chart-danger)"
              name={t("settings.common.failed")}
              fillOpacity={0.9}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
};

export default ForwardEndpointDistribution;
