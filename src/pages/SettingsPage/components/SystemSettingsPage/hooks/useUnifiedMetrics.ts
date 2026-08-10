import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { metricsService } from "@services/metrics";
import type {
  CombinedSummary,
  ForwardEndpointMetrics,
  ForwardMetricsQuery,
  ForwardMetricsSummary,
  ForwardRequestMetrics,
  MemoryMetricsSummary,
  MetricsGranularity,
  MetricsSummary,
  ModelMetrics,
  SessionDetail,
  SessionMetrics,
  UnifiedTimelinePoint,
} from "@services/metrics";
import { resolveMetricsRange } from "./resolveMetricsRange";

export interface UnifiedMetricsFilters {
  startDate?: string;
  endDate?: string;
  model?: string;
  days?: number;
  granularity?: MetricsGranularity;
  sessionLimit?: number;
}

interface UseUnifiedMetricsOptions {
  filters?: UnifiedMetricsFilters;
  autoRefreshMs?: number;
}

const DEFAULT_AUTO_REFRESH_MS = 15_000;

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export const useUnifiedMetrics = (options: UseUnifiedMetricsOptions = {}) => {
  const { filters, autoRefreshMs = DEFAULT_AUTO_REFRESH_MS } = options;

  const normalizedFilters = useMemo(
    () => ({
      startDate: filters?.startDate,
      endDate: filters?.endDate,
      model: filters?.model?.trim() || undefined,
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

  // Chat metrics state
  const [chatSummary, setChatSummary] = useState<MetricsSummary | null>(null);
  const [modelMetrics, setModelMetrics] = useState<ModelMetrics[]>([]);
  const [modelCatalog, setModelCatalog] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionMetrics[]>([]);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [isSessionDetailLoading, setIsSessionDetailLoading] = useState(false);

  // Forward metrics state
  const [forwardSummary, setForwardSummary] = useState<ForwardMetricsSummary | null>(null);
  const [endpointMetrics, setEndpointMetrics] = useState<ForwardEndpointMetrics[]>([]);
  const [forwardRequests, setForwardRequests] = useState<ForwardRequestMetrics[]>([]);

  // Unified metrics state
  const [combinedSummary, setCombinedSummary] = useState<CombinedSummary | null>(null);
  const [memorySummary, setMemorySummary] = useState<MemoryMetricsSummary | null>(null);
  const [timeline, setTimeline] = useState<UnifiedTimelinePoint[]>([]);

  // Loading states
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestGenerationRef = useRef(0);
  const sessionDetailGenerationRef = useRef(0);

  const loadAllMetrics = useCallback(
    async (showLoading: boolean) => {
      const requestGeneration = ++requestGenerationRef.current;

      setIsLoading(showLoading);
      setIsRefreshing(!showLoading);
      setError(null);

      if (showLoading) {
        // Keep every visible dataset on the same filter generation. Rendering
        // old all-model values while the selected-model requests are pending
        // would recreate the mixed-scope dashboard this hook is meant to avoid.
        setChatSummary(null);
        setForwardSummary(null);
        setCombinedSummary(null);
        setMemorySummary(null);
        setTimeline([]);
        setModelMetrics([]);
        setSessions([]);
        setEndpointMetrics([]);
        setForwardRequests([]);
      }

      try {
        const modelFilter = normalizedFilters.model ? { model: normalizedFilters.model } : {};
        const forwardQuery: ForwardMetricsQuery = {
          startDate: resolvedRange.startDate,
          endDate: resolvedRange.endDate,
          ...modelFilter,
          limit: normalizedFilters.sessionLimit,
        };

        const [
          unifiedSummary,
          timelineResponse,
          modelResponse,
          sessionsResponse,
          endpointResponse,
          requestsResponse,
        ] = await Promise.all([
          metricsService.getUnifiedSummary({
            startDate: resolvedRange.startDate,
            endDate: resolvedRange.endDate,
            ...modelFilter,
          }),
          metricsService.getUnifiedTimeline({
            days: resolvedRange.days,
            endDate: resolvedRange.endDate,
            granularity: normalizedFilters.granularity,
            ...modelFilter,
          }),
          metricsService.getByModel({
            startDate: resolvedRange.startDate,
            endDate: resolvedRange.endDate,
            ...modelFilter,
          }),
          metricsService.getSessions({
            startDate: resolvedRange.startDate,
            endDate: resolvedRange.endDate,
            ...modelFilter,
            limit: normalizedFilters.sessionLimit,
          }),
          metricsService.getForwardByEndpoint(forwardQuery),
          metricsService.getForwardRequests(forwardQuery),
        ]);

        if (requestGeneration !== requestGenerationRef.current) {
          return;
        }

        setChatSummary(unifiedSummary.chat);
        setForwardSummary(unifiedSummary.forward);
        setCombinedSummary(unifiedSummary.combined);
        setMemorySummary(unifiedSummary.memory);
        setTimeline(timelineResponse);
        setModelMetrics(modelResponse);
        setModelCatalog((currentCatalog) => {
          const responseModels = modelResponse.map((item) => item.model);
          if (!normalizedFilters.model) {
            return Array.from(new Set(responseModels));
          }
          if (currentCatalog.length > 0) {
            return currentCatalog;
          }
          return Array.from(new Set([normalizedFilters.model, ...responseModels]));
        });
        setSessions(sessionsResponse);
        setEndpointMetrics(endpointResponse);
        setForwardRequests(requestsResponse);
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
    ],
  );

  const refresh = useCallback(async () => {
    await loadAllMetrics(false);
  }, [loadAllMetrics]);

  const loadSessionDetail = useCallback(async (sessionId: string) => {
    const detailGeneration = ++sessionDetailGenerationRef.current;
    setIsSessionDetailLoading(true);
    try {
      const detail = await metricsService.getSessionDetail(sessionId);
      if (detailGeneration !== sessionDetailGenerationRef.current) {
        return;
      }
      setSessionDetail(detail);
    } catch (detailError) {
      if (detailGeneration !== sessionDetailGenerationRef.current) {
        return;
      }
      setError(toErrorMessage(detailError, "Failed to load session detail"));
    } finally {
      if (detailGeneration === sessionDetailGenerationRef.current) {
        setIsSessionDetailLoading(false);
      }
    }
  }, []);

  const clearSessionDetail = useCallback(() => {
    sessionDetailGenerationRef.current += 1;
    setSessionDetail(null);
    setIsSessionDetailLoading(false);
  }, []);

  useEffect(() => {
    clearSessionDetail();
    void loadAllMetrics(true);

    return () => {
      requestGenerationRef.current += 1;
      sessionDetailGenerationRef.current += 1;
    };
  }, [clearSessionDetail, loadAllMetrics]);

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

  // Derived combined metrics for convenience
  const totalTokens = useMemo(() => {
    const chatTokens = chatSummary?.total_tokens.total_tokens ?? 0;
    const forwardTokens = forwardSummary?.total_tokens.total_tokens ?? 0;
    return chatTokens + forwardTokens;
  }, [chatSummary, forwardSummary]);

  const totalRequests = useMemo(() => {
    const chatSessions = chatSummary?.total_sessions ?? 0;
    const forwardRequests = forwardSummary?.total_requests ?? 0;
    return chatSessions + forwardRequests;
  }, [chatSummary, forwardSummary]);

  return {
    // Chat metrics
    chatSummary,
    modelMetrics,
    modelCatalog,
    sessions,
    sessionDetail,
    isSessionDetailLoading,
    loadSessionDetail,
    clearSessionDetail,

    // Forward metrics
    forwardSummary,
    endpointMetrics,
    forwardRequests,

    // Unified metrics
    combinedSummary,
    memorySummary,
    timeline,
    totalTokens,
    totalRequests,

    // Loading states
    isLoading,
    isRefreshing,
    error,
    refresh,
  };
};

export type UnifiedMetricsReturn = ReturnType<typeof useUnifiedMetrics>;
