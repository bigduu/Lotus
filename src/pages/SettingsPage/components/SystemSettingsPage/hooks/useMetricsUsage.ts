import { useCallback, useEffect, useMemo, useState } from "react";

import { metricsService } from "../../../../../services/metrics";
import type { MetricsUsageBreakdownResponse } from "../../../../../services/metrics";
import { resolveMetricsRange } from "./resolveMetricsRange";

export interface MetricsUsageFilters {
  startDate?: string;
  endDate?: string;
  days?: number;
  model?: string;
}

interface UseMetricsUsageOptions {
  filters?: MetricsUsageFilters;
  autoRefreshMs?: number;
}

const DEFAULT_AUTO_REFRESH_MS = 15_000;

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export const useMetricsUsage = (options: UseMetricsUsageOptions = {}) => {
  const { filters, autoRefreshMs = DEFAULT_AUTO_REFRESH_MS } = options;

  const normalizedFilters = useMemo(
    () => ({
      startDate: filters?.startDate,
      endDate: filters?.endDate,
      days: filters?.days ?? 30,
      model: filters?.model,
    }),
    [filters?.days, filters?.endDate, filters?.model, filters?.startDate],
  );

  const resolvedRange = useMemo(
    () =>
      resolveMetricsRange({
        startDate: normalizedFilters.startDate,
        endDate: normalizedFilters.endDate,
        days: normalizedFilters.days,
      }),
    [normalizedFilters.days, normalizedFilters.endDate, normalizedFilters.startDate],
  );

  const [data, setData] = useState<MetricsUsageBreakdownResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsage = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const response = await metricsService.getUsageBreakdown({
          startDate: resolvedRange.startDate,
          endDate: resolvedRange.endDate,
          model: normalizedFilters.model,
        });
        setData(response);
        setError(null);
      } catch (loadError) {
        setError(toErrorMessage(loadError, "Failed to load usage breakdown"));
      } finally {
        if (showLoading) {
          setIsLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [normalizedFilters.model, resolvedRange.endDate, resolvedRange.startDate],
  );

  const refresh = useCallback(async () => {
    await loadUsage(false);
  }, [loadUsage]);

  useEffect(() => {
    void loadUsage(true);
  }, [loadUsage]);

  useEffect(() => {
    if (autoRefreshMs <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadUsage(false);
    }, autoRefreshMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefreshMs, loadUsage]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    refresh,
  };
};
