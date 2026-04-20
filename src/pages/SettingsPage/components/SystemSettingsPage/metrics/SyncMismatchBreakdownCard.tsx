import { Card, Empty, Skeleton, Typography } from "antd";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";

const { Text } = Typography;

interface SyncMismatchBreakdownCardProps {
  breakdown?: Record<string, number> | null;
  loading: boolean;
}

const REASON_LABEL_FALLBACKS: Record<string, string> = {
  message_count: "Message Count",
  last_message_id: "Last Message",
  pending_question: "Pending Question",
};

const formatReasonLabel = (reason: string): string => {
  if (REASON_LABEL_FALLBACKS[reason]) {
    return REASON_LABEL_FALLBACKS[reason];
  }

  return reason
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const SyncMismatchBreakdownCard: React.FC<SyncMismatchBreakdownCardProps> = ({
  breakdown,
  loading,
}) => {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Card
        size="small"
        className="lotus-metric-card"
        title={t("settings.metricsDashboard.syncMismatchBreakdownTitle", {
          defaultValue: "Sync Mismatch Breakdown",
        })}
      >
        <Skeleton active paragraph={{ rows: 5 }} />
      </Card>
    );
  }

  const chartData = Object.entries(breakdown ?? {})
    .map(([reason, count]) => ({
      reason,
      label: t(`settings.syncMismatchReasons.${reason}`, {
        defaultValue: formatReasonLabel(reason),
      }),
      count,
    }))
    .sort((left, right) => right.count - left.count);

  return (
    <Card
      size="small"
      className="lotus-metric-card"
      title={t("settings.metricsDashboard.syncMismatchBreakdownTitle", {
        defaultValue: "Sync Mismatch Breakdown",
      })}
      extra={
        <Text type="secondary">
          {t("settings.metricsDashboard.syncMismatchBreakdownSubtitle", {
            defaultValue: "Grouped by execute sync mismatch reason",
          })}
        </Text>
      }
    >
      {chartData.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("settings.metricsDashboard.noSyncMismatchBreakdown", {
            defaultValue: "No sync mismatches recorded for the selected range",
          })}
        />
      ) : (
        <div style={{ width: "100%", minWidth: 0, height: 280, minHeight: 280 }}>
          <ResponsiveContainer>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 8, right: 12, left: 12, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis dataKey="label" type="category" width={110} />
              <Tooltip
                formatter={(value: number) => [
                  value.toLocaleString(),
                  t("settings.metricsDashboard.syncMismatchCountLabel", {
                    defaultValue: "Mismatches",
                  }),
                ]}
                labelFormatter={(label) =>
                  t("settings.metricsDashboard.syncMismatchReasonLabel", {
                    defaultValue: "Reason: {{label}}",
                    label,
                  })
                }
              />
              <Bar
                dataKey="count"
                fill="var(--lotus-chart-danger)"
                radius={[0, 6, 6, 0]}
                name={t("settings.metricsDashboard.syncMismatchCountLabel", {
                  defaultValue: "Mismatches",
                })}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
};

export default SyncMismatchBreakdownCard;
