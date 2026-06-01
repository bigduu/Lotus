import React from "react";
import { Progress, Tooltip, Space } from "antd";
import { useTranslation } from "react-i18next";
import {
  TokenUsage,
  formatCompactTokenCount,
  formatTokenCount,
  getUsageColor,
  getUsageDenominator,
  getUsagePercentage,
} from "@shared/types/tokenBudget";

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

type MetricBadgeTone = "green" | "blue" | "purple";

// Tones map onto the《千里江山》palette via theme vars (no stock antd colors):
// green → 石绿, blue → 石青 azure, purple → 泥金 gold (the warm accent).
const METRIC_BADGE_STYLES: Record<
  MetricBadgeTone,
  { backgroundColor: string; borderColor: string; color: string }
> = {
  green: {
    backgroundColor: "color-mix(in srgb, var(--lotus-success) 14%, transparent)",
    borderColor: "color-mix(in srgb, var(--lotus-success) 30%, transparent)",
    color: "var(--lotus-success)",
  },
  blue: {
    backgroundColor: "color-mix(in srgb, var(--lotus-accent-secondary) 14%, transparent)",
    borderColor: "color-mix(in srgb, var(--lotus-accent-secondary) 30%, transparent)",
    color: "var(--lotus-accent-secondary)",
  },
  purple: {
    backgroundColor: "color-mix(in srgb, var(--lotus-gold) 16%, transparent)",
    borderColor: "color-mix(in srgb, var(--lotus-gold) 32%, transparent)",
    color: "var(--lotus-gold)",
  },
};

const MetricBadge: React.FC<{ label: string; tone: MetricBadgeTone }> = ({ label, tone }) => {
  const style = METRIC_BADGE_STYLES[tone];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        borderRadius: 999,
        fontSize: 10,
        lineHeight: 1.4,
        fontWeight: 600,
        whiteSpace: "nowrap",
        backgroundColor: style.backgroundColor,
        border: `1px solid ${style.borderColor}`,
        color: style.color,
      }}
    >
      {label}
    </span>
  );
};

/**
 * Display token usage with a compact line progress bar.
 *
 * Shows:
 * - Line progress bar with color coding (green/yellow/red)
 * - Percentage text
 * - Compact optimization badges
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
  const color = getUsageColor(usage);
  const promptCachedToolOutputs = usage.promptCachedToolOutputs ?? 0;
  const promptCachedToolTokensSaved = usage.promptCachedToolTokensSaved ?? 0;
  const thinkingTokens = usage.thinkingTokens ?? 0;
  const cacheReadInputTokens = usage.cacheReadInputTokens ?? 0;
  const hasPromptCacheDetails = promptCachedToolOutputs > 0 || promptCachedToolTokensSaved > 0;
  const hasProviderResultDetails = thinkingTokens > 0 || cacheReadInputTokens > 0;

  const formatPercentageLabel = (value: number): string => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  };

  const getProgressStrokeColor = () => {
    if (percentage >= 90) return "var(--lotus-chart-danger)";
    if (percentage >= 70) return "var(--lotus-chart-accent)";
    return "var(--lotus-chart-secondary)";
  };

  const inlineBadges: Array<{ key: string; label: string; tone: MetricBadgeTone }> = [];

  if (promptCachedToolTokensSaved > 0) {
    inlineBadges.push({
      key: "prompt-saved",
      label: t("components.tokenUsage.promptSavedBadge", {
        value: formatCompactTokenCount(promptCachedToolTokensSaved),
      }),
      tone: "green",
    });
  }

  if (cacheReadInputTokens > 0) {
    inlineBadges.push({
      key: "cache-read",
      label: t("components.tokenUsage.cacheReadBadge", {
        value: formatCompactTokenCount(cacheReadInputTokens),
      }),
      tone: "blue",
    });
  }

  if (thinkingTokens > 0) {
    inlineBadges.push({
      key: "thinking",
      label: t("components.tokenUsage.thinkingBadge", {
        value: formatCompactTokenCount(thinkingTokens),
      }),
      tone: "purple",
    });
  }

  const sectionTitleStyle = {
    marginTop: 8,
    marginBottom: 4,
    fontSize: 11,
    fontWeight: 700,
    color: "var(--lotus-metric-text-muted)",
  } as const;

  const tooltipContent = (
    <div style={{ minWidth: 220, color: "var(--lotus-metric-text-strong)" }}>
      <div style={{ marginBottom: 4, fontWeight: "bold" }}>{t("components.tokenUsage.title")}</div>
      <div style={{ fontSize: 12 }}>
        {t("components.tokenUsage.contextWindow")}: {formatTokenCount(usage.totalTokens)} /{" "}
        {formatTokenCount(denominator)} {t("components.tokenUsage.tokens")}
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
          <div style={sectionTitleStyle}>{t("components.tokenUsage.contextPrepared")}</div>
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

          {hasPromptCacheDetails ? (
            <>
              <div style={sectionTitleStyle}>{t("components.tokenUsage.promptCacheTitle")}</div>
              {promptCachedToolOutputs > 0 && (
                <div style={{ color: "var(--lotus-metric-text-muted)" }}>
                  {t("components.tokenUsage.cachedToolOutputs", {
                    count: promptCachedToolOutputs,
                  })}
                </div>
              )}
              {promptCachedToolTokensSaved > 0 && (
                <div style={{ color: "var(--lotus-metric-text-muted)" }}>
                  {t("components.tokenUsage.promptSaved")}:{" "}
                  {formatTokenCount(promptCachedToolTokensSaved)}
                </div>
              )}
            </>
          ) : null}

          {hasProviderResultDetails ? (
            <>
              <div style={sectionTitleStyle}>{t("components.tokenUsage.providerResult")}</div>
              {cacheReadInputTokens > 0 && (
                <div>
                  {t("components.tokenUsage.cacheRead")}: {formatTokenCount(cacheReadInputTokens)}
                </div>
              )}
              {thinkingTokens > 0 && (
                <div>
                  {t("components.tokenUsage.thinking")}: {formatTokenCount(thinkingTokens)}
                </div>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <Tooltip
      title={tooltipContent}
      placement="top"
      arrow
      // Background must follow the theme to match the themed text colors inside
      // (dark text in light mode would otherwise sit on antd's default dark tooltip).
      color="var(--lotus-metric-tooltip-bg)"
    >
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
        {inlineBadges.map((badge) => (
          <MetricBadge key={badge.key} label={badge.label} tone={badge.tone} />
        ))}
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
  const color = getUsageColor(usage);

  const formatPercentageLabel = (value: number): string => {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  };

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
