import { Tooltip } from "antd";
import type { ReactNode } from "react";

const trimTrailingZero = (value: string): string => value.replace(/\.0$/, "");

export const formatMetricExactNumber = (value: number): string => value.toLocaleString();

export const formatMetricDetailedNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  return value.toLocaleString(undefined, {
    maximumFractionDigits: 20,
  });
};

export const formatMetricCompactNumber = (value: number): string => {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const abs = Math.abs(value);

  if (abs >= 1_000_000_000) {
    const digits = abs >= 10_000_000_000 ? 0 : 1;
    return `${trimTrailingZero((value / 1_000_000_000).toFixed(digits))}B`;
  }

  if (abs >= 1_000_000) {
    const digits = abs >= 10_000_000 ? 0 : 1;
    return `${trimTrailingZero((value / 1_000_000).toFixed(digits))}M`;
  }

  if (abs >= 1_000) {
    const digits = abs >= 10_000 ? 0 : 1;
    return `${trimTrailingZero((value / 1_000).toFixed(digits))}K`;
  }

  return formatMetricExactNumber(value);
};

export const shouldCompactMetricNumber = (value: number): boolean =>
  Number.isFinite(value) && Math.abs(value) >= 1_000;

export const formatMetricTooltipValue = (value: number): string =>
  formatMetricDetailedNumber(value);

export const renderMetricNumber = (value: number): ReactNode => {
  if (!Number.isFinite(value)) {
    return String(value);
  }

  const display = formatMetricCompactNumber(value);
  if (!shouldCompactMetricNumber(value)) {
    return display;
  }

  return (
    <Tooltip title={<div>{formatMetricDetailedNumber(value)}</div>}>
      <span>{display}</span>
    </Tooltip>
  );
};

export const statisticNumberFormatter = (value: string | number | undefined): ReactNode => {
  const numericValue = Number(value ?? 0);
  if (!Number.isFinite(numericValue)) {
    return value == null ? "-" : String(value);
  }
  return renderMetricNumber(numericValue);
};
