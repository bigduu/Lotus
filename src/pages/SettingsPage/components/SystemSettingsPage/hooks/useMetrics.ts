import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  metricsService,
  type DailyMetrics,
  type MemoryMetricsSummary,
  type MemoryTimelinePoint,
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
  getSummary: (query?: { startDate?: string; endDate?: string }) => Promise<MetricsSummary>;
  getByModel: (query?: { startDate?: string; endDate?: string }) => Promise<ModelMetrics[]>;
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
  getMemorySummary?: (query?: { days?: number; endDate?: string }) => Promise<MemoryMetricsSummary>;
  getMemoryTimeline?: (query?: {
    days?: number;
    endDate?: string;
    granularity?: MetricsGranularity;
  }) => Promise<MemoryTimelinePoint[]>;
}

export interface UseMetricsOptions {
  filters?: MetricsFilters;
  autoRefreshMs?: number;
  service?: MetricsHookService;
  /**
   * When false, the hook performs no network work (no initial load, no
   * polling). Used to keep the dashboard idle while the Metrics tab is not
   * visible. Defaults to true.
   */
  enabled?: boolean;
}

const DEFAULT_AUTO_REFRESH_MS = 30_000;

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
    enabled = true,
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
  const [timeline, setTimeline] = useState<Array<DailyMetrics | PeriodMetrics>>([]);
  const [memorySummary, setMemorySummary] = useState<MemoryMetricsSummary | null>(null);
  const [memoryTimeline, setMemoryTimeline] = useState<MemoryTimelinePoint[]>([]);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [isSessionDetailLoading, setIsSessionDetailLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);

  const loadAllMetrics = useCallback(
    async (showLoading: boolean) => {
      const requestGeneration = ++requestGenerationRef.current;

      // The newest request owns both flags. Resetting both prevents a refresh
      // from inheriting `isLoading` from an older initial/filter request (and
      // vice versa) when requests overlap.
      setIsLoading(showLoading);
      setIsRefreshing(!showLoading);
      setError(null);

      if (showLoading) {
        // A filter transition must not keep rendering data for the previous
        // range while its replacement request is in flight or after it fails.
        setSummary(null);
        setModelMetrics([]);
        setSessions([]);
        setTimeline([]);
        setMemorySummary(null);
        setMemoryTimeline([]);
      }

      try {
        const memorySummaryPromise = service.getMemorySummary
          ? service
              .getMemorySummary({
                days: resolvedRange.days,
                endDate: resolvedRange.endDate,
              })
              .catch(() => null)
          : Promise.resolve(null);
        const memoryTimelinePromise = service.getMemoryTimeline
          ? service
              .getMemoryTimeline({
                days: resolvedRange.days,
                endDate: resolvedRange.endDate,
                granularity: normalizedFilters.granularity,
              })
              .catch(() => [])
          : Promise.resolve([]);

        const [
          summaryResponse,
          modelResponse,
          sessionsResponse,
          dailyResponse,
          memoryResponse,
          memoryTimelineResponse,
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
          memorySummaryPromise,
          memoryTimelinePromise,
        ]);

        if (requestGeneration !== requestGenerationRef.current) {
          return;
        }

        setSummary(summaryResponse);
        setModelMetrics(modelResponse);
        setSessions(sessionsResponse);
        setTimeline(dailyResponse);
        setMemorySummary(memoryResponse);
        setMemoryTimeline(memoryTimelineResponse);
        setError(null);
      } catch (loadError) {
        if (requestGeneration !== requestGenerationRef.current) {
          return;
        }
        setError(toErrorMessage(loadError, "Failed to load metrics"));
      } finally {
        if (requestGeneration === requestGenerationRef.current) {
          setIsLoading(false);
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
    if (!enabled) {
      requestGenerationRef.current += 1;
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }
    void loadAllMetrics(true);

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [enabled, loadAllMetrics]);

  useEffect(() => {
    if (!enabled || autoRefreshMs <= 0) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadAllMetrics(false);
    }, autoRefreshMs);

    return () => {
      window.clearInterval(timer);
    };
  }, [enabled, autoRefreshMs, loadAllMetrics]);

  return {
    summary,
    modelMetrics,
    sessions,
    timeline,
    memorySummary,
    memoryTimeline,
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
