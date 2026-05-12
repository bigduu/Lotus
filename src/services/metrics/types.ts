export type MetricsGranularity = "daily" | "weekly" | "monthly";

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface MetricsSummary {
  total_sessions: number;
  total_tokens: TokenUsage;
  total_tool_calls: number;
  active_sessions: number;
  prompt_cached_tool_outputs?: number;
  tool_context_tokens_saved?: number;
  total_compression_events?: number;
  total_tokens_saved?: number;
  non_tool_compression_tokens_saved?: number;
  completed_sessions?: number;
  awaiting_response_sessions?: number;
  error_sessions?: number;
  cancelled_sessions?: number;
  total_sync_mismatches?: number;
  sync_mismatch_breakdown?: Record<string, number>;
}

export interface ModelMetrics {
  model: string;
  sessions: number;
  rounds: number;
  tokens: TokenUsage;
  tool_calls: number;
  prompt_cached_tool_outputs?: number;
}

export type SessionStatus = "running" | "awaiting_response" | "completed" | "error" | "cancelled";

export interface SessionMetrics {
  session_id: string;
  model: string;
  started_at: string;
  completed_at?: string | null;
  total_rounds: number;
  total_token_usage: TokenUsage;
  tool_call_count: number;
  tool_breakdown: Record<string, number>;
  status: SessionStatus;
  message_count: number;
  duration_ms?: number | null;
  prompt_cached_tool_outputs?: number;
  prompt_cached_tool_tokens_saved?: number;
  total_compression_events?: number;
  total_tokens_saved?: number;
}

export interface ToolCallMetrics {
  tool_call_id: string;
  tool_name: string;
  started_at: string;
  completed_at?: string | null;
  success?: boolean | null;
  error?: string | null;
  duration_ms?: number | null;
}

export type RoundStatus = "running" | "success" | "error" | "cancelled";

export interface RoundMetrics {
  round_id: string;
  session_id: string;
  model: string;
  started_at: string;
  completed_at?: string | null;
  token_usage: TokenUsage;
  tool_calls: ToolCallMetrics[];
  status: RoundStatus;
  error?: string | null;
  duration_ms?: number | null;
  prompt_cached_tool_outputs?: number;
  prompt_cached_tool_tokens_saved?: number;
  compression_count?: number;
  tokens_saved?: number;
}

export interface SessionDetail {
  session: SessionMetrics;
  rounds: RoundMetrics[];
}

export interface DailyMetrics {
  date: string;
  total_sessions: number;
  total_rounds: number;
  total_token_usage: TokenUsage;
  total_tool_calls: number;
  model_breakdown: Record<string, TokenUsage>;
  tool_breakdown: Record<string, number>;
  prompt_cached_tool_outputs?: number;
}

export interface PeriodMetrics {
  label: string;
  period_start: string;
  period_end: string;
  total_sessions: number;
  total_rounds: number;
  total_token_usage: TokenUsage;
  total_tool_calls: number;
  model_breakdown: Record<string, TokenUsage>;
  tool_breakdown: Record<string, number>;
  prompt_cached_tool_outputs?: number;
}

export interface MetricsDateRange {
  startDate?: string;
  endDate?: string;
}

export interface MetricsSessionQuery extends MetricsDateRange {
  model?: string;
  limit?: number;
}

export interface MetricsUsageQuery extends MetricsDateRange {
  model?: string;
}

export interface UsageCountItem {
  name: string;
  count: number;
}

export interface SkillUsageItem {
  skill_id: string;
  count: number;
}

export interface McpServerUsageItem {
  server_id: string;
  count: number;
  unique_tools: number;
}

export interface McpToolUsageItem {
  alias: string;
  server_id: string;
  tool_name: string;
  count: number;
}

export interface MetricsUsageBreakdownResponse {
  total_sessions: number;
  total_tool_calls: number;
  core_tool_calls: number;
  skill_load_calls: number;
  mcp_calls: number;
  unique_skills: number;
  unique_mcp_servers: number;
  unique_mcp_tools: number;
  sessions_with_skill_loads: number;
  sessions_with_mcp_calls: number;
  top_core_tools: UsageCountItem[];
  top_skills: SkillUsageItem[];
  top_mcp_servers: McpServerUsageItem[];
  top_mcp_tools: McpToolUsageItem[];
}

export interface MetricsDailyQuery {
  days?: number;
  endDate?: string;
  granularity?: MetricsGranularity;
}

// Forward metrics types
export type ForwardStatus = "pending" | "success" | "error";

export interface ForwardMetricsSummary {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  total_tokens: TokenUsage;
  avg_duration_ms?: number | null;
}

export interface ForwardEndpointMetrics {
  endpoint: string;
  requests: number;
  successful: number;
  failed: number;
  tokens: TokenUsage;
  avg_duration_ms?: number | null;
}

export interface ForwardRequestMetrics {
  forward_id: string;
  endpoint: string;
  model: string;
  is_stream: boolean;
  started_at: string;
  completed_at?: string | null;
  status_code?: number | null;
  status?: ForwardStatus | null;
  token_usage?: TokenUsage | null;
  error?: string | null;
  duration_ms?: number | null;
}

export interface ForwardMetricsQuery {
  startDate?: string;
  endDate?: string;
  endpoint?: string;
  model?: string;
  limit?: number;
}

export interface MemoryMetricsQuery {
  scope?: "global" | "project" | "session";
  projectKey?: string;
  days?: number;
  endDate?: string;
  granularity?: MetricsGranularity;
}

export interface MemoryMetricsSummary {
  scope?: "global" | "project" | "session" | null;
  project_key?: string | null;
  total_memories: number;
  stale_candidate_count: number;
  project_count: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  by_scope: Record<string, number>;
  last_reindex_at?: string | null;
  last_dream_at?: string | null;
}

// Unified API types (v2)
export interface UnifiedSummary {
  chat: MetricsSummary;
  forward: ForwardMetricsSummary;
  combined: CombinedSummary;
  memory: MemoryMetricsSummary;
}

export interface CombinedSummary {
  total_requests: number;
  total_tokens: number;
  total_success: number;
  total_errors: number;
  success_rate: number;
  prompt_cached_tool_outputs?: number;
  total_compression_events?: number;
  total_tokens_saved?: number;
  total_sync_mismatches?: number;
}

export interface MemoryTimelinePoint {
  label: string;
  period_start: string;
  period_end: string;
  created_memories: number;
  updated_memories: number;
  total_memories: number;
}

export interface UnifiedTimelinePoint {
  date: string;
  chat_tokens: number;
  chat_sessions: number;
  forward_tokens: number;
  forward_requests: number;
  total_tokens: number;
  prompt_cached_tool_outputs?: number;
}
