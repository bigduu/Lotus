import { Card, Empty, Skeleton, Typography } from "antd";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";

const { Text } = Typography;

export interface TopUsageBarDatum {
  label: string;
  count: number;
  meta?: string;
}

interface TopUsageBarCardProps {
  title: string;
  subtitle?: string;
  emptyText: string;
  color?: string;
  data: TopUsageBarDatum[];
  loading: boolean;
  countLabel?: string;
}

const TopUsageBarCard: React.FC<TopUsageBarCardProps> = ({
  title,
  subtitle,
  emptyText,
  color = "var(--lotus-chart-primary)",
  data,
  loading,
  countLabel,
}) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Card size="small" className="lotus-metric-card" title={title}>
        <Skeleton active paragraph={{ rows: 5 }} />
      </Card>
    );
  }

  return (
    <Card size="small" className="lotus-metric-card" title={title}>
      {data.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      ) : (
        <>
          {subtitle ? <Text type="secondary">{subtitle}</Text> : null}
          <div style={{ width: "100%", minWidth: 0, height: 280, marginTop: subtitle ? 12 : 0 }}>
            <ResponsiveContainer>
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 8, right: 12, left: 12, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} />
                <YAxis dataKey="label" type="category" width={110} />
                <Tooltip
                  formatter={(value: number) => [
                    value.toLocaleString(),
                    countLabel ?? t("settings.metricsDashboard.calls"),
                  ]}
                  labelFormatter={(label, payload) => {
                    const meta = payload?.[0]?.payload?.meta as string | undefined;
                    return meta ? `${label} · ${meta}` : String(label);
                  }}
                />
                <Bar
                  dataKey="count"
                  fill={color}
                  radius={[0, 6, 6, 0]}
                  name={countLabel ?? t("settings.metricsDashboard.calls")}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Card>
  );
};

export default TopUsageBarCard;
