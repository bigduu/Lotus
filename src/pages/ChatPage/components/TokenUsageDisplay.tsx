import React from "react";
import { Progress, Tooltip, Space } from "antd";
import { useTranslation } from "react-i18next";
import {
  TokenUsage,
  getUsageDenominator,
  getUsagePercentage,
  getUsageColor,
  formatTokenCount,
} from "../types/tokenBudget";

interface TokenUsageDisplayProps {
  /** Token usage information */
  usage: TokenUsage;
  /** Whether to show the detailed breakdown */
  showDetails?: boolean;
  /** Size of the progress bar */
  size?: "small" | "default";
  /** Additional CSS class */
  className?: string;
}

/**
 * Display token usage with a compact line progress bar.
 *
 * Shows:
 * - Line progress bar with color coding (green/yellow/red)
 * - Percentage text
 * - Tooltip with detailed breakdown on hover
 */
export const TokenUsageDisplay: React.FC<TokenUsageDisplayProps> = ({
  usage,
  showDetails = true,
  size = "small",
  className = "",
}) => {
  const { t } = useTranslation();
  const denominator = getUsageDenominator(usage);
  const percentage = getUsagePercentage(usage);
  const formatPercentageLabel = (value: number): string => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  };
  const color = getUsageColor(usage);

  const getProgressStrokeColor = () => {
    if (percentage >= 90) return "var(--lotus-chart-danger)";
    if (percentage >= 70) return "var(--lotus-chart-accent)";
    return "var(--lotus-chart-secondary)";
  };

  const tooltipContent = (
    <div style={{ minWidth: 180, color: "var(--lotus-metric-text-strong)" }}>
      <div style={{ marginBottom: 4, fontWeight: "bold" }}>{t("components.tokenUsage.title")}</div>
      <div style={{ fontSize: 12 }}>
        {t("components.tokenUsage.contextWindow")}:{" "}
        {formatTokenCount(usage.totalTokens)} / {formatTokenCount(denominator)}{" "}
        {t("components.tokenUsage.tokens")}
      </div>
      <div style={{ fontSize: 12, color: "var(--lotus-metric-text-muted)" }}>
        {t("components.tokenUsage.usedPercent", { value: percentage.toFixed(1) })}
      </div>
      {showDetails && (
        <div
          style={{
            marginTop: 6,
            borderTop: "1px solid var(--lotus-metric-tooltip-border)",
            paddingTop: 6,
            fontSize: 11,
          }}
        >
          <div>
            {t("components.tokenUsage.system")}: {formatTokenCount(usage.systemTokens)}
          </div>
          {usage.summaryTokens > 0 && (
            <div>
              {t("components.tokenUsage.summary")}: {formatTokenCount(usage.summaryTokens)}
            </div>
          )}
          <div>
            {t("components.tokenUsage.messages")}: {formatTokenCount(usage.windowTokens)}
          </div>
          {typeof usage.promptCachedToolOutputs === "number" &&
            usage.promptCachedToolOutputs > 0 && (
              <div style={{ color: "var(--lotus-metric-text-muted)" }}>
                {t("components.tokenUsage.cachedToolOutputs", {
                  count: usage.promptCachedToolOutputs,
                  defaultValue: "Prompt cache: {{count}} tool outputs summarized",
                })}
              </div>
            )}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip title={tooltipContent} placement="top" arrow>
      <Space
        className={`token-usage-display ${className}`}
        size={4}
        align="center"
        style={{ lineHeight: 1 }}
      >
        <Progress
          type="line"
          percent={Math.min(percentage, 100)}
          size={{ height: size === "small" ? 6 : 8, width: 80 }}
          strokeColor={getProgressStrokeColor()}
          showInfo={false}
          style={{ margin: 0, lineHeight: 1 }}
        />
        <span
          style={{
            fontSize: size === "small" ? 11 : 12,
            color:
              color === "error"
                ? "var(--lotus-chart-danger)"
                : color === "warning"
                  ? "var(--lotus-chart-accent)"
                  : "var(--lotus-chart-secondary)",
            whiteSpace: "nowrap",
            fontWeight: 600,
          }}
        >
          {formatPercentageLabel(percentage)}%
        </span>
      </Space>
    </Tooltip>
  );
};

/**
 * Ultra-compact token usage badge showing just the percentage.
 */
export const TokenUsageBadge: React.FC<{
  usage: TokenUsage;
  className?: string;
}> = ({ usage, className = "" }) => {
  const { t } = useTranslation();
  const denominator = getUsageDenominator(usage);
  const percentage = getUsagePercentage(usage);
  const formatPercentageLabel = (value: number): string => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  };
  const color = getUsageColor(usage);
  const badgeTitle = `${formatTokenCount(usage.totalTokens)} / ${formatTokenCount(
    denominator,
  )} ${t("components.tokenUsage.tokens")} (${percentage.toFixed(1)}%)`;

  const getBadgeColor = () => {
    switch (color) {
      case "error":
        return "var(--lotus-chart-danger)";
      case "warning":
        return "var(--lotus-chart-accent)";
      case "success":
        return "var(--lotus-chart-secondary)";
      default:
        return "var(--lotus-metric-text-muted)";
    }
  };

  return (
    <Tooltip title={badgeTitle}>
      <span
        className={`token-usage-badge ${className}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "1px 6px",
          borderRadius: 10,
          fontSize: 11,
          fontWeight: 500,
          backgroundColor: getBadgeColor() + "20",
          color: getBadgeColor(),
          border: `1px solid ${getBadgeColor()}40`,
          lineHeight: 1,
        }}
      >
        {formatPercentageLabel(percentage)}%
      </span>
    </Tooltip>
  );
};

export default TokenUsageDisplay;
