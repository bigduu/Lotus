import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { metricsService } from "@services/metrics";
import type { MetricsUsageBreakdownResponse } from "@services/metrics";
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
  /** When false, no initial load and no polling. Defaults to true. */
  enabled?: boolean;
}

const DEFAULT_AUTO_REFRESH_MS = 30_000;

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export const useMetricsUsage = (options: UseMetricsUsageOptions = {}) => {
  const { filters, autoRefreshMs = DEFAULT_AUTO_REFRESH_MS, enabled = true } = options;

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
  const requestGenerationRef = useRef(0);

  const loadUsage = useCallback(
    async (showLoading: boolean) => {
      const requestGeneration = ++requestGenerationRef.current;

      setIsLoading(showLoading);
      setIsRefreshing(!showLoading);
      setError(null);

      if (showLoading) {
        setData(null);
      }

      try {
        const response = await metricsService.getUsageBreakdown({
          startDate: resolvedRange.startDate,
          endDate: resolvedRange.endDate,
          model: normalizedFilters.model,
        });

        if (requestGeneration !== requestGenerationRef.current) {
          return;
        }

        setData(response);
        setError(null);
      } catch (loadError) {
        if (requestGeneration !== requestGenerationRef.current) {
          return;
        }
        setError(toErrorMessage(loadError, "Failed to load usage breakdown"));
      } finally {
        if (requestGeneration === requestGenerationRef.current) {
          setIsLoading(false);
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
    if (!enabled) {
      requestGenerationRef.current += 1;
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }
    void loadUsage(true);

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [enabled, loadUsage]);

  useEffect(() => {
    if (!enabled || autoRefreshMs <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadUsage(false);
    }, autoRefreshMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [enabled, autoRefreshMs, loadUsage]);

  return {
    data,
    isLoading,
    isRefreshing,
    error,
    refresh,
  };
};
