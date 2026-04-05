import { agentApiClient } from "../api";
import type {
  DailyMetrics,
  ForwardEndpointMetrics,
  ForwardMetricsQuery,
  ForwardMetricsSummary,
  ForwardRequestMetrics,
  MemoryMetricsQuery,
  MemoryMetricsSummary,
  MemoryTimelinePoint,
  MetricsDailyQuery,
  MetricsDateRange,
  MetricsSummary,
  MetricsUsageBreakdownResponse,
  MetricsUsageQuery,
  ModelMetrics,
  PeriodMetrics,
  SessionDetail,
  SessionMetrics,
  MetricsSessionQuery,
  UnifiedSummary,
  UnifiedTimelinePoint,
} from "./types";

type DailyOrPeriodMetrics = DailyMetrics[] | PeriodMetrics[];

const buildQueryString = (query: Record<string, string | number | undefined>): string => {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === "") {
      return;
    }
    params.set(key, String(value));
  });

  const output = params.toString();
  return output ? `?${output}` : "";
};

export class MetricsService {
  async getSummary(range: MetricsDateRange = {}): Promise<MetricsSummary> {
    const query = buildQueryString({
      start_date: range.startDate,
      end_date: range.endDate,
    });
    return agentApiClient.get<MetricsSummary>(`metrics/summary${query}`);
  }

  async getByModel(range: MetricsDateRange = {}): Promise<ModelMetrics[]> {
    const query = buildQueryString({
      start_date: range.startDate,
      end_date: range.endDate,
    });
    return agentApiClient.get<ModelMetrics[]>(`metrics/by-model${query}`);
  }

  async getSessions(query: MetricsSessionQuery = {}): Promise<SessionMetrics[]> {
    const queryString = buildQueryString({
      start_date: query.startDate,
      end_date: query.endDate,
      model: query.model,
      limit: query.limit,
    });
    return agentApiClient.get<SessionMetrics[]>(`metrics/sessions${queryString}`);
  }

  async getSessionDetail(sessionId: string): Promise<SessionDetail | null> {
    try {
      return await agentApiClient.get<SessionDetail>(
        `metrics/sessions/${encodeURIComponent(sessionId)}`,
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        return null;
      }
      throw error;
    }
  }

  async getUsageBreakdown(query: MetricsUsageQuery = {}): Promise<MetricsUsageBreakdownResponse> {
    const queryString = buildQueryString({
      start_date: query.startDate,
      end_date: query.endDate,
      model: query.model,
    });
    return agentApiClient.get<MetricsUsageBreakdownResponse>(
      `metrics/usage-breakdown${queryString}`,
    );
  }

  async getDaily(query: MetricsDailyQuery = {}): Promise<DailyOrPeriodMetrics> {
    const queryString = buildQueryString({
      days: query.days,
      end_date: query.endDate,
      granularity: query.granularity,
    });
    return agentApiClient.get<DailyOrPeriodMetrics>(`metrics/daily${queryString}`);
  }

  // Forward metrics methods
  async getForwardSummary(query: ForwardMetricsQuery = {}): Promise<ForwardMetricsSummary> {
    const queryString = buildQueryString({
      start_date: query.startDate,
      end_date: query.endDate,
      endpoint: query.endpoint,
      model: query.model,
      limit: query.limit,
    });
    return agentApiClient.get<ForwardMetricsSummary>(`metrics/forward/summary${queryString}`);
  }

  async getForwardByEndpoint(query: ForwardMetricsQuery = {}): Promise<ForwardEndpointMetrics[]> {
    const queryString = buildQueryString({
      start_date: query.startDate,
      end_date: query.endDate,
      endpoint: query.endpoint,
      model: query.model,
      limit: query.limit,
    });
    return agentApiClient.get<ForwardEndpointMetrics[]>(
      `metrics/forward/by-endpoint${queryString}`,
    );
  }

  async getForwardRequests(query: ForwardMetricsQuery = {}): Promise<ForwardRequestMetrics[]> {
    const queryString = buildQueryString({
      start_date: query.startDate,
      end_date: query.endDate,
      endpoint: query.endpoint,
      model: query.model,
      limit: query.limit,
    });
    return agentApiClient.get<ForwardRequestMetrics[]>(`metrics/forward/requests${queryString}`);
  }

  async getMemorySummary(query: MemoryMetricsQuery = {}): Promise<MemoryMetricsSummary> {
    const queryString = buildQueryString({
      scope: query.scope,
      project_key: query.projectKey,
    });
    return agentApiClient.get<MemoryMetricsSummary>(`metrics/memory/summary${queryString}`);
  }

  async getMemoryTimeline(query: MemoryMetricsQuery = {}): Promise<MemoryTimelinePoint[]> {
    const queryString = buildQueryString({
      scope: query.scope,
      project_key: query.projectKey,
      days: query.days,
      end_date: query.endDate,
      granularity: query.granularity,
    });
    return agentApiClient.get<MemoryTimelinePoint[]>(`metrics/memory/timeline${queryString}`);
  }

  // Unified API methods (v2)
  async getUnifiedSummary(range: MetricsDateRange = {}): Promise<UnifiedSummary> {
    const query = buildQueryString({
      start_date: range.startDate,
      end_date: range.endDate,
    });
    return agentApiClient.get<UnifiedSummary>(`metrics/v2/summary${query}`);
  }

  async getUnifiedTimeline(query: MetricsDailyQuery = {}): Promise<UnifiedTimelinePoint[]> {
    const queryString = buildQueryString({
      days: query.days,
      end_date: query.endDate,
      granularity: query.granularity,
    });
    return agentApiClient.get<UnifiedTimelinePoint[]>(`metrics/v2/timeline${queryString}`);
  }
}

export const metricsService = new MetricsService();
