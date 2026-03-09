import { useCallback, useEffect, useMemo, useState } from "react";

import {
  metricsService,
  type DailyMetrics,
  type MetricsGranularity,
  type MetricsSummary,
  type ModelMetrics,
  type PeriodMetrics,
  type SessionDetail,
  type SessionMetrics,
} from "@services/metrics";
import { resolveMetricsRange } from "./resolveMetricsRange";

export interface MetricsFilters {
  startDate?: string;
  endDate?: string;
  model?: string;
  days?: number;
  granularity?: MetricsGranularity;
  sessionLimit?: number;
}

interface MetricsHookService {
  getSummary: (query?: {
    startDate?: string;
    endDate?: string;
  }) => Promise<MetricsSummary>;
  getByModel: (query?: {
    startDate?: string;
    endDate?: string;
  }) => Promise<ModelMetrics[]>;
  getSessions: (query?: {
    startDate?: string;
    endDate?: string;
    model?: string;
    limit?: number;
  }) => Promise<SessionMetrics[]>;
  getDaily: (query?: {
    days?: number;
    endDate?: string;
    granularity?: MetricsGranularity;
  }) => Promise<DailyMetrics[] | PeriodMetrics[]>;
  getSessionDetail: (sessionId: string) => Promise<SessionDetail | null>;
}

export interface UseMetricsOptions {
  filters?: MetricsFilters;
  autoRefreshMs?: number;
  service?: MetricsHookService;
}

const DEFAULT_AUTO_REFRESH_MS = 15_000;

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export const useMetrics = (options: UseMetricsOptions = {}) => {
  const {
    filters,
    autoRefreshMs = DEFAULT_AUTO_REFRESH_MS,
    service = metricsService,
  } = options;

  const normalizedFilters = useMemo(
    () => ({
      startDate: filters?.startDate,
      endDate: filters?.endDate,
      model: filters?.model,
      days: filters?.days ?? 30,
      granularity: filters?.granularity ?? "daily",
      sessionLimit: filters?.sessionLimit ?? 200,
    }),
    [
      filters?.startDate,
      filters?.endDate,
      filters?.model,
      filters?.days,
      filters?.granularity,
      filters?.sessionLimit,
    ],
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

  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [modelMetrics, setModelMetrics] = useState<ModelMetrics[]>([]);
  const [sessions, setSessions] = useState<SessionMetrics[]>([]);
  const [timeline, setTimeline] = useState<Array<DailyMetrics | PeriodMetrics>>(
    [],
  );
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(
    null,
  );
  const [isSessionDetailLoading, setIsSessionDetailLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAllMetrics = useCallback(
    async (showLoading: boolean) => {
      if (showLoading) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const [
          summaryResponse,
          modelResponse,
          sessionsResponse,
          dailyResponse,
        ] = await Promise.all([
          service.getSummary({
            startDate: resolvedRange.startDate,
            endDate: resolvedRange.endDate,
          }),
          service.getByModel({
            startDate: resolvedRange.startDate,
            endDate: resolvedRange.endDate,
          }),
          service.getSessions({
            startDate: resolvedRange.startDate,
            endDate: resolvedRange.endDate,
            model: normalizedFilters.model,
            limit: normalizedFilters.sessionLimit,
          }),
          service.getDaily({
            days: resolvedRange.days,
            endDate: resolvedRange.endDate,
            granularity: normalizedFilters.granularity,
          }),
        ]);

        setSummary(summaryResponse);
        setModelMetrics(modelResponse);
        setSessions(sessionsResponse);
        setTimeline(dailyResponse);
        setError(null);
      } catch (loadError) {
        setError(toErrorMessage(loadError, "Failed to load metrics"));
      } finally {
        if (showLoading) {
          setIsLoading(false);
        } else {
          setIsRefreshing(false);
        }
      }
    },
    [
      normalizedFilters.granularity,
      normalizedFilters.model,
      normalizedFilters.sessionLimit,
      resolvedRange.days,
      resolvedRange.endDate,
      resolvedRange.startDate,
      service,
    ],
  );

  const refresh = useCallback(async () => {
    await loadAllMetrics(false);
  }, [loadAllMetrics]);

  const loadSessionDetail = useCallback(
    async (sessionId: string) => {
      setIsSessionDetailLoading(true);
      try {
        const detail = await service.getSessionDetail(sessionId);
        setSessionDetail(detail);
      } catch (detailError) {
        setError(toErrorMessage(detailError, "Failed to load session detail"));
      } finally {
        setIsSessionDetailLoading(false);
      }
    },
    [service],
  );

  const clearSessionDetail = useCallback(() => {
    setSessionDetail(null);
  }, []);

  useEffect(() => {
    void loadAllMetrics(true);
  }, [loadAllMetrics]);

  useEffect(() => {
    if (autoRefreshMs <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadAllMetrics(false);
    }, autoRefreshMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefreshMs, loadAllMetrics]);

  return {
    summary,
    modelMetrics,
    sessions,
    timeline,
    sessionDetail,
    isLoading,
    isRefreshing,
    isSessionDetailLoading,
    error,
    refresh,
    loadSessionDetail,
    clearSessionDetail,
  };
};
