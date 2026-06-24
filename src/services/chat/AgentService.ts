import { debugLog, isApiV2WsEnabled } from "@shared/utils/debugFlags";
/**
 * Agent Client Service
 *
 * HTTP client for communicating with local copilot-agent endpoints
 * Handles SSE streaming and AgentEvent processing
 */
import { agentApiClient } from "../api";
import { getBackendBaseUrlSync } from "../../shared/utils/backendBaseUrl";
import * as v2Stream from "./v2Stream";
import type { FeedSubscription } from "./v2Stream";

export type { FeedSubscription } from "./v2Stream";

// Agent Event Types (matching Rust backend)
export type AgentEventType =
  | "token"
  | "reasoning_token"
  | "tool_token"
  | "tool_start"
  | "tool_complete"
  | "tool_error"
  | "task_list_updated"
  | "task_list_item_progress"
  | "task_list_completed"
  | "task_evaluation_started"
  | "task_evaluation_completed"
  | "token_budget_updated"
  | "context_compression_status"
  | "context_summarized"
  | "context_pressure_notification"
  | "tool_lifecycle"
  | "sub_agent_started"
  | "sub_agent_event"
  | "sub_agent_heartbeat"
  | "sub_agent_completed"
  | "child_approval_requested"
  | "session_title_updated"
  | "session_pinned_updated"
  | "session_created"
  | "session_deleted"
  | "session_cleared"
  | "message_appended"
  | "plan_mode_entered"
  | "plan_mode_exited"
  | "plan_file_updated"
  | "need_clarification"
  | "notification"
  | "execution_started"
  | "runner_progress"
  | "goal_status_changed"
  | "complete"
  | "cancelled"
  | "error";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface GoldConfig {
  enabled: boolean;
  auto_answer_enabled?: boolean;
  auto_continue_enabled?: boolean;
  model_name?: string | null;
  /** The user's session goal, surfaced to the main agent and the evaluator. */
  goal?: string | null;
  /** Legacy field: tunes the evaluator only. Falls back to the goal when `goal` is unset. */
  evaluation_prompt?: string | null;
  max_output_tokens?: number;
  max_auto_continuations?: number;
  /** Minimum evaluator confidence required to auto-continue/auto-answer ("low" | "medium" | "high"). */
  min_auto_continue_confidence?: "low" | "medium" | "high";
}

/** One persisted side-channel double-check verdict in the goal's eval trail. */
export interface GoalEvalRecord {
  checkpoint: string;
  iteration: number;
  decision: "continue" | "achieved" | "blocked" | "need_input" | "exhausted" | string;
  confidence: "low" | "medium" | "high" | string;
  reasoning: string;
  missing_information?: string[];
  next_action?: string | null;
  recorded_at: string;
}

/**
 * Runtime goal state (Codex-style goal loop). Distinct from {@link GoldConfig}:
 * the config is what the user SET; this is where the goal actually IS — its
 * live status, how many autonomous continuations have fired, and the trail of
 * double-check verdicts.
 */
export interface GoalState {
  objective: string;
  status: "active" | "complete" | "blocked" | "need_input" | "budget_limited" | string;
  declared_status?: "complete" | "blocked" | null;
  declared_at_round?: number | null;
  continuation_count: number;
  eval_history: GoalEvalRecord[];
  created_at: string;
  updated_at: string;
}

export interface TokenBudgetUsage {
  system_tokens: number;
  summary_tokens: number;
  window_tokens: number;
  total_tokens: number;
  max_context_tokens?: number;
  budget_limit: number;
  truncation_occurred: boolean;
  segments_removed: number;
  prompt_cached_tool_outputs?: number;
  prompt_cached_tool_tokens_saved?: number;
  thinking_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface ContextSummaryInfo {
  summary: string;
  messages_summarized: number;
  tokens_saved: number;
}

// TaskList Types
export type TaskItemStatus = "pending" | "in_progress" | "completed" | "blocked";

export interface TaskItem {
  id: string;
  description: string;
  status: TaskItemStatus;
  depends_on: string[];
  notes: string;
}

export interface TaskList {
  session_id: string;
  title: string;
  items: TaskItem[];
  created_at: string;
  updated_at: string;
  version?: number;
}

interface TaskListSnapshotResponse {
  session_id: string;
  title: string | null;
  items: TaskItem[];
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
}

export interface TaskListDelta {
  session_id: string;
  item_id: string;
  status: TaskItemStatus;
  tool_calls_count: number;
  version: number;
}

export interface AgentEvent {
  type: AgentEventType;
  content?: string;
  tool_call_id?: string;
  tool_name?: string;
  arguments?: Record<string, unknown>;
  result?: {
    success: boolean;
    result: string;
    display_preference?: string;
    // Images returned by image-producing tools (e.g. an MCP `screenshot`),
    // raw base64 + mime — surfaced for inline preview in the tool detail view.
    images?: Array<{ mime_type: string; data: string }>;
  };
  error?: string;
  message?: string; // For Error events
  // Union type because 'usage' field has different shapes for different events
  usage?:
    | {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      }
    | TokenBudgetUsage;
  summary_info?: ContextSummaryInfo;
  // TaskList events
  task_list?: TaskList;
  // TaskList delta
  session_id?: string;
  // Goal status event: full runtime goal state (status, continuation count, eval trail).
  goal_state?: GoalState | null;
  item_id?: string;
  status?:
    | TaskItemStatus
    | "exploring"
    | "designing"
    | "reviewing"
    | "finalizing"
    | "awaiting_approval"
    | string;
  phase?: string;
  tool_calls_count?: number;
  version?: number;
  completed_at?: string;
  total_rounds?: number;
  total_tool_calls?: number;
  // TaskList evaluation
  items_count?: number;
  updates_count?: number;
  reasoning?: string;
  // Tool lifecycle events
  elapsed_ms?: number;
  is_mutating?: boolean;
  auto_approved?: boolean;
  summary?: string;
  // Sub-agent events
  parent_session_id?: string;
  child_session_id?: string;
  title?: string;
  event?: AgentEvent;
  timestamp?: string;
  // ChildApprovalRequested event: an out-of-process child sub-agent hit a gated
  // tool and is blocked awaiting a human approve/deny decision. `tool_name` is
  // reused from the tool-event fields above.
  request_id?: string;
  permission?: string;
  resource?: string;
  // ContextPressureNotification events
  percent?: number;
  level?: string;
  // NeedClarification events
  question?: string;
  options?: string[];
  allow_custom?: boolean;
  // ExecutionStarted event
  run_id?: string;
  started_at?: string;
  // PlanModeEntered event
  entered_at?: string;
  // RunnerProgress event
  round_count?: number;
  // SessionTitleUpdated event
  title_version?: number;
  source?: "auto" | "manual" | "fallback";
  updated_at?: string;
  // SessionPinnedUpdated event
  pinned?: boolean;
  // MessageAppended / SessionCreated events
  message_id?: string;
  role?: "user" | "assistant" | "tool" | "system";
  created_at?: string;
  kind?: SessionKind;
  // Plan mode events
  pre_permission_mode?: string;
  restored_mode?: string;
  plan?: string | null;
  plan_file_path?: string | null;
  // Notification event (backend-classified, preference-gated, deduped server-side)
  id?: string;
  category?: string;
  priority?: string;
  body?: string;
  dedup_key?: string;
}

/**
 * A sequenced change-feed event from `GET /api/v1/stream`: an {@link AgentEvent}
 * stamped with a global monotonic `seq` (the resume cursor) and a routing
 * `session_id`.
 */
export interface ChangeEvent {
  seq: number;
  ts: string;
  session_id?: string;
  event: AgentEvent;
}

/** Control frame telling the client to drop local state and full-resync. */
export interface FeedResetFrame {
  type: "feed_reset";
  from_seq: number;
}

/** Callbacks for {@link AgentClient.subscribeToAccountStream}. */
export interface AccountStreamHandlers {
  onChange: (change: ChangeEvent) => void;
  onReset?: () => void;
  onOpen?: () => void;
  onError?: () => void;
}

export interface ChatRequest {
  message: string;
  session_id?: string;
  system_prompt?: string;
  enhance_prompt?: string;
  copilot_conclusion_with_options_enhancement_enabled?: boolean;
  workspace_path?: string;
  selected_skill_ids?: string[];
  images?: Array<{
    base64: string;
    name?: string;
    size?: number;
    type?: string;
  }>;
  model: string; // Required for chat/create compatibility; backend persists to session
  model_ref?: { provider: string; model: string };
  provider?: string;
}

export interface GoalCommandResponse {
  action: string;
  should_execute: boolean;
  gold_config?: GoldConfig | null;
}

export interface ChatResponse {
  session_id: string;
  status: string;
  stream_url?: string;
  /** Present when the message was a /goal control command handled server-side. */
  goal_command?: GoalCommandResponse | null;
}

export type ExecuteSyncReason =
  | "message_count_mismatch"
  | "last_message_id_mismatch"
  | "pending_question_mismatch";

export interface ExecuteClientSync {
  client_message_count: number;
  client_last_message_id?: string | null;
  client_has_pending_question: boolean;
  client_pending_question_tool_call_id?: string | null;
}

export interface ExecuteSyncInfo {
  need_sync: boolean;
  reason?: ExecuteSyncReason;
  server_message_count: number;
  server_last_message_id?: string | null;
  has_pending_question: boolean;
  pending_question_tool_call_id?: string | null;
  has_pending_user_message: boolean;
}

export interface ExecuteResponse {
  session_id: string;
  status: "started" | "already_running" | "completed" | "error" | "cancelled";
  events_url: string;
  sync?: ExecuteSyncInfo;
  /** Unique run identifier for correlating SSE events across reconnects. */
  run_id?: string;
}

export interface ExecuteRequest {
  model?: string;
  model_ref?: { provider: string; model: string };
  provider?: string;
  reasoning_effort?: ReasoningEffort;
  client_sync?: ExecuteClientSync;
}

/** Response of `GET respond/{sessionId}/pending`: the session's current pending clarification. */
export type PendingQuestionResponse = {
  has_pending_question: boolean;
  question?: string;
  options?: string[];
  allow_custom?: boolean;
  tool_call_id?: string;
};

export interface HistoryResponse {
  session_id: string;
  compression_events?: Array<{
    id: string;
    created_at: string;
    messages_compressed: number;
    segments_removed: number;
  }>;
  /** Session-level gold config (from session metadata). */
  gold_config?: GoldConfig | null;
  /** Runtime goal state (status + continuation count + double-check eval history). */
  goal_state?: GoalState | null;
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "tool" | "system";
    content: string;
    compressed?: boolean;
    compressed_by_event_id?: string;
    content_parts?: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: string } }
    >;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: {
        name: string;
        arguments: string;
      };
    }>;
    tool_call_id?: string;
    tool_success?: boolean;
    reasoning?: string;
    created_at: string;
  }>;
}

export type SessionKind = "root" | "child";

export interface SessionPlanModeState {
  entered_at: string;
  pre_permission_mode: string;
  plan_file_path?: string | null;
  status: "exploring" | "designing" | "reviewing" | "finalizing" | "awaiting_approval";
}

export interface SessionSummary {
  id: string;
  kind: SessionKind;
  title: string;
  title_version: number;
  pinned: boolean;
  parent_session_id?: string | null;
  root_session_id: string;
  spawn_depth: number;
  model: string;
  model_ref?: { provider: string; model: string } | null;
  reasoning_effort?: ReasoningEffort | null;
  gold_config?: GoldConfig | null;
  created_by_schedule_id?: string | null;
  token_usage?: TokenBudgetUsage;
  created_at: string;
  updated_at: string;
  last_activity_at: string;
  message_count: number;
  has_attachments: boolean;
  is_running: boolean;
  last_run_status?: string;
  last_run_error?: string;
  /** Active plan mode runtime state mirrored from backend session summary. */
  plan_mode?: SessionPlanModeState | null;
  /**
   * SubAgent profile id for child sessions (e.g. "general-purpose", "plan").
   * Mirrored from the child session's metadata into the global SessionIndexEntry,
   * so this lightweight list endpoint can surface the role without loading
   * each session.json. Always undefined for root sessions and for legacy
   * children created before subagent profiles were introduced.
   */
  subagent_type?: string | null;
  /**
   * Child lifecycle mirrored from `session.metadata["lifecycle"]`: `"resident"`
   * for a reusable resident agent, else undefined (one-shot child).
   */
  lifecycle?: string | null;
  /** For a resident agent, its stable reuse key (e.g. "essayist"). */
  resident_name?: string | null;
  /** Whether the session currently has a pending question awaiting user response. */
  has_pending_question?: boolean;
  /** Number of child sessions currently running under this session. */
  running_child_count?: number;
  /**
   * Per-session "bypass permissions" toggle, read from the session's runtime
   * state. Only populated by the detail endpoint (`GET /v1/sessions/{id}`);
   * list endpoints leave it `false`.
   */
  bypass_permissions?: boolean;
}

export interface RunningSessionEntry {
  session_id: string;
  run_id: string;
  started_at: string;
  round_count: number;
  last_tool_name?: string | null;
  last_tool_phase?: string | null;
  last_event_at?: string | null;
  last_critical_events: AgentEvent[];
  running_child_session_ids: string[];
}

export interface RunningSessionsResponse {
  sessions: RunningSessionEntry[];
}

export interface ListSessionsResponse {
  sessions: SessionSummary[];
}

export interface CreateSessionRequest {
  title?: string;
  system_prompt?: string;
  model?: string;
  model_ref?: { provider: string; model: string };
  provider?: string;
  reasoning_effort?: ReasoningEffort;
  gold_config?: GoldConfig;
}

export interface CreateSessionResponse {
  session: SessionSummary;
}

export interface SessionSystemPromptResponse {
  session_id: string;
  base_system_prompt: string;
  enhancement_prompt?: string;
  workspace_context?: string;
  instruction_context?: string;
  env_context?: string;
  skill_context?: string;
  tool_guide_context?: string;
  dream_notebook?: string;
  session_memory_note?: string;
  project_memory_index?: string;
  relevant_durable_memories?: string;
  project_dream?: string;
  global_dream_fallback?: string;
  prompt_memory_observability?: {
    project_prompt_injection_enabled: boolean;
    relevant_recall_enabled: boolean;
    relevant_recall_rerank_enabled?: boolean;
    project_first_dream_enabled: boolean;
    latest_user_query_present: boolean;
    resolved_project_key?: string;
    session_notes_status: string;
    project_memory_index_status: string;
    relevant_memory_status: string;
    project_dream_status: string;
    global_dream_fallback_status: string;
    dream_source: string;
    session_topic_count?: number;
    truncated_session_topic_count?: number;
    relevant_memory_count?: number;
    session_note_section_chars?: number;
    project_memory_index_section_chars?: number;
    relevant_memory_section_chars?: number;
    project_dream_section_chars?: number;
    global_dream_fallback_section_chars?: number;
    context_pressure_warning_chars?: number;
    external_memory_section_chars?: number;
  };
  external_memory?: string;
  task_list?: string;
  effective_system_prompt: string;
}

export interface PatchSessionRequest {
  title?: string;
  pinned?: boolean;
  model?: string;
  provider?: string;
  model_ref?: { provider: string; model: string } | null;
  reasoning_effort?: ReasoningEffort;
  clear_reasoning_effort?: boolean;
  gold_config?: GoldConfig;
  /** Per-session "bypass permissions" toggle: when true, tool permission
   * checks are skipped for this session only. */
  bypass_permissions?: boolean;
}

export interface RunProjectDreamResponse {
  success: boolean;
  session_id: string;
  project_key: string;
  dream_generated: boolean;
  used_model?: string;
  session_count?: number;
  note_path?: string;
  notebook_chars?: number;
  message?: string;
}

/** Response from POST /api/v1/child-approval/{child_session_id}. */
export interface ChildApprovalResponse {
  delivered: boolean;
}

export type TruncateSessionMessagesRequest = {
  mode: "after_last_user" | "error_retry";
};

export interface TruncateSessionMessagesResponse {
  success: boolean;
  session_id: string;
  messages_removed: number;
  message_count: number;
}

export interface RestoreSessionStateRequest {
  target_message_id: string;
  restore_files: boolean;
}

export interface RestoreSessionStateResponse {
  success: boolean;
  session_id: string;
  target_message_id: string;
  restore_files: boolean;
  messages_removed: number;
  message_count: number;
  restored_files?: number;
  deleted_files?: number;
  file_errors?: Array<{
    file_path: string;
    checkpoint_path?: string | null;
    error: string;
  }>;
}

export interface PatchSessionMessageRequest {
  content: string;
}

export interface ScheduleRunConfig {
  system_prompt?: string;
  task_message?: string;
  model?: string;
  reasoning_effort?: ReasoningEffort;
  workspace_path?: string;
  enhance_prompt?: string;
  auto_execute?: boolean;
}

export type ScheduleTrigger =
  | {
      type: "interval";
      every_seconds: number;
      anchor_at?: string | null;
    }
  | {
      type: "daily";
      hour: number;
      minute: number;
      second?: number;
    }
  | {
      type: "weekly";
      weekdays: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
      hour: number;
      minute: number;
      second?: number;
    }
  | {
      type: "monthly";
      days: number[];
      hour: number;
      minute: number;
      second?: number;
    }
  | {
      type: "cron";
      expr: string;
    };

export type MisfirePolicy =
  | { type: "run_once" }
  | { type: "skip" }
  | { type: "catch_up_all" }
  | {
      type: "catch_up_window";
      max_catch_up_runs: number;
      max_lateness_seconds: number;
    };

export type OverlapPolicy = "allow" | "skip" | "queue_one";

export interface ScheduleState {
  next_fire_at?: string | null;
  last_scheduled_at?: string | null;
  last_started_at?: string | null;
  last_finished_at?: string | null;
  last_success_at?: string | null;
  last_failure_at?: string | null;
  queued_run_count: number;
  running_run_count: number;
  consecutive_failures: number;
  total_run_count: number;
  total_success_count: number;
  total_failure_count: number;
  total_missed_count: number;
}

export interface ScheduleEntry {
  id: string;
  name: string;
  enabled: boolean;
  trigger: ScheduleTrigger;
  timezone?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  misfire_policy: MisfirePolicy;
  overlap_policy: OverlapPolicy;
  created_at: string;
  updated_at: string;
  state: ScheduleState;
  run_config: ScheduleRunConfig;
}

export interface ListSchedulesResponse {
  schedules: ScheduleEntry[];
}

export interface CreateScheduleRequest {
  name: string;
  trigger: ScheduleTrigger;
  timezone?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  misfire_policy?: MisfirePolicy;
  overlap_policy?: OverlapPolicy;
  enabled?: boolean;
  run_config?: ScheduleRunConfig;
}

export interface PatchScheduleRequest {
  name?: string;
  enabled?: boolean;
  trigger?: ScheduleTrigger;
  timezone?: string | null;
  start_at?: string | null;
  end_at?: string | null;
  misfire_policy?: MisfirePolicy;
  overlap_policy?: OverlapPolicy;
  run_config?: ScheduleRunConfig;
}

export interface ScheduleRunRecord {
  run_id: string;
  schedule_id: string;
  scheduled_for: string;
  claimed_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  status: "queued" | "running" | "success" | "failed" | "skipped" | "missed" | "cancelled";
  outcome_reason?: string | null;
  session_id?: string | null;
  dispatch_lag_ms?: number | null;
  execution_duration_ms?: number | null;
  was_catch_up: boolean;
}

export interface ListScheduleSessionsResponse {
  schedule_id: string;
  sessions: SessionSummary[];
}

export interface ListScheduleRunsResponse {
  schedule_id: string;
  runs: ScheduleRunRecord[];
}

// Event handlers type
export interface SessionTitleUpdatedEvent {
  type: "session_title_updated";
  session_id: string;
  title: string;
  title_version: number;
  source: "auto" | "manual" | "fallback";
  updated_at: string;
}

export interface SessionPinnedUpdatedEvent {
  type: "session_pinned_updated";
  session_id: string;
  pinned: boolean;
  updated_at: string;
}

export interface AgentEventHandlers {
  onToken?: (content: string) => void;
  onReasoningToken?: (content: string) => void;
  onToolToken?: (toolCallId: string, content: string) => void;
  onToolStart?: (toolCallId: string, toolName: string, args: Record<string, unknown>) => void;
  onToolComplete?: (toolCallId: string, result: AgentEvent["result"]) => void;
  onToolError?: (toolCallId: string, error: string) => void;
  onTaskListUpdated?: (taskList: TaskList) => void;
  onTaskListItemProgress?: (delta: TaskListDelta) => void;
  onTaskListCompleted?: (
    sessionId: string,
    totalRounds: number,
    totalToolCalls: number,
    completedAt?: string,
  ) => void;
  onTaskEvaluationStarted?: (sessionId: string, itemsCount: number) => void;
  onTaskEvaluationCompleted?: (sessionId: string, updatesCount: number, reasoning: string) => void;
  onTokenBudgetUpdated?: (usage: TokenBudgetUsage) => void;
  onContextCompressionStatus?: (phase: string, status: string) => void;
  onContextSummarized?: (summaryInfo: ContextSummaryInfo) => void;
  onContextPressureNotification?: (percent: number, level: string, message: string) => void;
  onToolLifecycle?: (
    toolCallId: string,
    toolName: string,
    phase: string,
    elapsedMs?: number,
    isMutating?: boolean,
    autoApproved?: boolean,
    summary?: string,
    error?: string,
  ) => void;
  onComplete?: (usage: AgentEvent["usage"]) => void;
  onCancelled?: (message?: string) => void;
  onError?: (message: string) => void;
  onSubAgentStarted?: (parentSessionId: string, childSessionId: string, title?: string) => void;
  onSubAgentEvent?: (parentSessionId: string, childSessionId: string, event: AgentEvent) => void;
  onSubAgentHeartbeat?: (
    parentSessionId: string,
    childSessionId: string,
    timestamp: string,
  ) => void;
  onSubAgentCompleted?: (
    parentSessionId: string,
    childSessionId: string,
    status: string,
    error?: string,
  ) => void;
  onChildApprovalRequested?: (
    childSessionId: string,
    requestId: string,
    request: {
      toolName?: string;
      permission?: string;
      resource?: string;
    },
  ) => void;
  onNeedClarification?: (event: AgentEvent) => void;
  onNotification?: (event: AgentEvent) => void;
  onSessionTitleUpdated?: (event: SessionTitleUpdatedEvent) => void;
  onSessionPinnedUpdated?: (event: SessionPinnedUpdatedEvent) => void;
  onPlanModeEntered?: (event: AgentEvent) => void;
  onPlanModeExited?: (event: AgentEvent) => void;
  onPlanFileUpdated?: (event: AgentEvent) => void;
  onExecutionStarted?: (runId: string, startedAt?: string) => void;
  onRunnerProgress?: (sessionId: string, roundCount: number) => void;
  onGoalStatusChanged?: (event: AgentEvent) => void;
}

const summarizeClientSync = (clientSync?: ExecuteClientSync): Record<string, unknown> | null => {
  if (!clientSync) return null;
  return {
    client_message_count: clientSync.client_message_count,
    client_last_message_id: clientSync.client_last_message_id ?? null,
    client_has_pending_question: clientSync.client_has_pending_question,
    client_pending_question_tool_call_id: clientSync.client_pending_question_tool_call_id ?? null,
  };
};

const summarizeExecuteSync = (sync?: ExecuteSyncInfo): Record<string, unknown> | null => {
  if (!sync) return null;
  return {
    need_sync: sync.need_sync,
    reason: sync.reason ?? null,
    server_message_count: sync.server_message_count,
    server_last_message_id: sync.server_last_message_id ?? null,
    has_pending_question: sync.has_pending_question,
    pending_question_tool_call_id: sync.pending_question_tool_call_id ?? null,
    has_pending_user_message: sync.has_pending_user_message,
  };
};

const summarizeHistoryResponse = (history: HistoryResponse): Record<string, unknown> => {
  const last = history.messages[history.messages.length - 1];
  return {
    session_id: history.session_id,
    messageCount: history.messages.length,
    lastMessageId: last?.id ?? null,
    lastRole: last?.role ?? null,
    compressionEvents: history.compression_events?.length ?? 0,
  };
};

const summarizeSessionList = (sessions: SessionSummary[]): Record<string, unknown> => ({
  count: sessions.length,
  runningCount: sessions.filter((session) => session.is_running).length,
  sessions: sessions.slice(0, 10).map((session) => ({
    id: session.id,
    is_running: session.is_running,
    last_run_status: session.last_run_status ?? null,
    message_count: session.message_count,
    has_pending_question: session.has_pending_question ?? false,
    running_child_count: session.running_child_count ?? 0,
    updated_at: session.updated_at,
  })),
});

const summarizeRunningSessions = (response: RunningSessionsResponse): Record<string, unknown> => ({
  count: response.sessions.length,
  sessions: response.sessions.map((session) => ({
    session_id: session.session_id,
    run_id: session.run_id,
    round_count: session.round_count,
    last_event_at: session.last_event_at ?? null,
    last_tool_name: session.last_tool_name ?? null,
    last_tool_phase: session.last_tool_phase ?? null,
    criticalEventCount: session.last_critical_events.length,
    runningChildCount: session.running_child_session_ids.length,
  })),
});

const summarizeStreamControlEvent = (event: AgentEvent): Record<string, unknown> => ({
  type: event.type,
  session_id: event.session_id ?? null,
  run_id: event.run_id ?? null,
  round_count: event.round_count ?? null,
  message: event.message ?? null,
  error: event.error ?? null,
  tool_call_id: event.tool_call_id ?? null,
});

/**
 * Agent Client - HTTP client for copilot-agent-server
 */
export class AgentClient {
  private static instance: AgentClient;

  static getInstance(): AgentClient {
    if (!AgentClient.instance) {
      AgentClient.instance = new AgentClient();
    }
    return AgentClient.instance;
  }

  /**
   * Send a chat message and get session ID
   */
  async sendMessage(request: ChatRequest): Promise<ChatResponse> {
    debugLog("[AgentClient]", "chat.request", {
      sessionId: request.session_id ?? null,
      model: request.model,
      modelRef: request.model_ref ?? null,
      provider: request.provider ?? null,
      messageLength: request.message.length,
      hasImages: (request.images?.length ?? 0) > 0,
      imageCount: request.images?.length ?? 0,
      selectedSkillCount: request.selected_skill_ids?.length ?? 0,
      workspacePath: request.workspace_path ?? null,
    });
    const response = await agentApiClient.post<ChatResponse>("chat", request);
    debugLog("[AgentClient]", "chat.response", {
      requestedSessionId: request.session_id ?? null,
      sessionId: response.session_id,
      status: response.status,
    });
    return response;
  }

  /**
   * Execute agent for a session (idempotent)
   * Returns status: started | already_running | completed | error | cancelled
   */
  async execute(
    sessionId: string,
    model?: string,
    reasoningEffort?: ReasoningEffort,
    clientSync?: ExecuteClientSync,
    modelRef?: { provider: string; model: string },
  ): Promise<ExecuteResponse> {
    const payload: ExecuteRequest = {};
    if (model) {
      payload.model = model;
    }
    if (reasoningEffort) {
      payload.reasoning_effort = reasoningEffort;
    }
    if (clientSync) {
      payload.client_sync = clientSync;
    }
    if (modelRef) {
      payload.model_ref = modelRef;
      payload.provider = modelRef.provider;
    }
    debugLog("[AgentClient]", "execute.request", {
      sessionId,
      model: payload.model ?? null,
      reasoningEffort: payload.reasoning_effort ?? null,
      modelRef: payload.model_ref ?? null,
      provider: payload.provider ?? null,
      clientSync: summarizeClientSync(payload.client_sync),
    });
    const response = await agentApiClient.post<ExecuteResponse>(`execute/${sessionId}`, payload);
    debugLog("[AgentClient]", "execute.response", {
      sessionId,
      status: response.status,
      runId: response.run_id ?? null,
      eventsUrl: response.events_url,
      sync: summarizeExecuteSync(response.sync),
    });
    return response;
  }

  /**
   * List backend sessions (V2 index-backed).
   */
  async listSessions(): Promise<ListSessionsResponse> {
    debugLog("[AgentClient]", "sessions.list.request", {});
    const response = await agentApiClient.get<ListSessionsResponse>("sessions");
    debugLog("[AgentClient]", "sessions.list.response", summarizeSessionList(response.sessions));
    return response;
  }

  /**
   * Get the current shared task list snapshot for a session.
   *
   * Child sessions resolve to the root/shared task list server-side.
   * Returns null when no task list currently exists.
   */
  async getTaskList(sessionId: string): Promise<TaskList | null> {
    const encodedSessionId = encodeURIComponent(sessionId);
    const snapshot = await agentApiClient.get<TaskListSnapshotResponse>(`task/${encodedSessionId}`);

    const hasTaskList = typeof snapshot.title === "string" || snapshot.items.length > 0;
    if (!hasTaskList) {
      return null;
    }

    const now = new Date().toISOString();
    return {
      session_id: snapshot.session_id,
      title: snapshot.title ?? "Task List",
      items: snapshot.items,
      created_at: now,
      updated_at: now,
    };
  }

  /**
   * Fetch the session's current pending question (clarification awaiting a user
   * answer), if any. Used by multi-device reconcile so a clarification answered
   * on another device clears here (and a newly-raised one appears).
   */
  async getPendingQuestion(sessionId: string): Promise<PendingQuestionResponse> {
    const encoded = encodeURIComponent(sessionId);
    try {
      return await agentApiClient.get<PendingQuestionResponse>(`respond/${encoded}/pending`);
    } catch (error) {
      console.warn(`[AgentClient] getPendingQuestion failed for ${sessionId}:`, error);
      return { has_pending_question: false };
    }
  }

  /**
   * Create a new backend session (root).
   */
  async createSession(req: CreateSessionRequest): Promise<CreateSessionResponse> {
    return agentApiClient.post<CreateSessionResponse>("sessions", req);
  }

  /**
   * Patch a session (title/pinned).
   */
  async patchSession(sessionId: string, req: PatchSessionRequest): Promise<void> {
    const encodedSessionId = encodeURIComponent(sessionId);
    await agentApiClient.patch(`sessions/${encodedSessionId}`, req);
  }

  /**
   * Manually regenerate a session's auto-title.
   */
  async regenerateSessionTitle(sessionId: string): Promise<void> {
    const encodedSessionId = encodeURIComponent(sessionId);
    await agentApiClient.post(`sessions/${encodedSessionId}/regenerate-title`);
  }

  /**
   * Get a session prompt snapshot (effective system prompt + extracted sections).
   */
  async getSessionSystemPrompt(sessionId: string): Promise<SessionSystemPromptResponse> {
    const encodedSessionId = encodeURIComponent(sessionId);
    return agentApiClient.get<SessionSystemPromptResponse>(
      `sessions/${encodedSessionId}/system-prompt`,
    );
  }

  /**
   * Clear a session's messages/events (keeps the session).
   */
  async clearSession(sessionId: string): Promise<void> {
    const encodedSessionId = encodeURIComponent(sessionId);
    await agentApiClient.post(`sessions/${encodedSessionId}/clear`);
  }

  /**
   * Manually trigger project-scoped Dream generation for a session.
   */
  async runProjectDream(sessionId: string): Promise<RunProjectDreamResponse> {
    const encodedSessionId = encodeURIComponent(sessionId);
    return agentApiClient.post<RunProjectDreamResponse>(
      `sessions/${encodedSessionId}/project-dream/run`,
    );
  }

  /**
   * Truncate session message history (server-side).
   *
   * - `after_last_user`: keep the last user message, drop assistant/tool tail.
   * - `error_retry`: preserve history and mark session for retry execution.
   */
  async truncateSessionMessages(
    sessionId: string,
    req: TruncateSessionMessagesRequest,
  ): Promise<TruncateSessionMessagesResponse> {
    const encodedSessionId = encodeURIComponent(sessionId);
    return agentApiClient.post<TruncateSessionMessagesResponse>(
      `sessions/${encodedSessionId}/messages/truncate`,
      req,
    );
  }

  /**
   * Restore session state to a specific message.
   * Optionally reverts file changes using checkpoints from tool results.
   */
  async restoreSessionState(
    sessionId: string,
    req: RestoreSessionStateRequest,
  ): Promise<RestoreSessionStateResponse> {
    const encodedSessionId = encodeURIComponent(sessionId);
    return agentApiClient.post<RestoreSessionStateResponse>(
      `sessions/${encodedSessionId}/restore`,
      req,
    );
  }

  /**
   * Update a single persisted message content in a session.
   */
  async patchSessionMessage(
    sessionId: string,
    messageId: string,
    req: PatchSessionMessageRequest,
  ): Promise<void> {
    const encodedSessionId = encodeURIComponent(sessionId);
    const encodedMessageId = encodeURIComponent(messageId);
    await agentApiClient.patch(`sessions/${encodedSessionId}/messages/${encodedMessageId}`, req);
  }

  /**
   * Delete a single persisted message from a session.
   *
   * Note: Some UI messages are local-only placeholders and may not exist on the backend.
   */
  async deleteSessionMessage(sessionId: string, messageId: string): Promise<void> {
    const encodedSessionId = encodeURIComponent(sessionId);
    const encodedMessageId = encodeURIComponent(messageId);
    await agentApiClient.delete(`sessions/${encodedSessionId}/messages/${encodedMessageId}`);
  }

  /**
   * Cleanup sessions by mode.
   */
  async cleanupSessions(mode: "all" | "empty" | "children", keepPinned: boolean): Promise<void> {
    await agentApiClient.post("sessions/cleanup", {
      mode,
      keep_pinned: keepPinned,
    });
  }

  /**
   * Deliver a human approve/deny decision for a blocked out-of-process child
   * sub-agent (surfaced via the `child_approval_requested` SSE event).
   *
   * Returns `{ delivered: true }` on success, or `{ delivered: false }` (HTTP
   * 404) if the child is no longer live.
   */
  async respondToChildApproval(
    childSessionId: string,
    requestId: string,
    approved: boolean,
  ): Promise<ChildApprovalResponse> {
    return agentApiClient.post<ChildApprovalResponse>(
      `child-approval/${encodeURIComponent(childSessionId)}`,
      { request_id: requestId, approved },
    );
  }

  /**
   * Development-only: reset V2 session storage (deletes sessions/ and resets sessions.json index).
   */
  async devResetSessions(): Promise<void> {
    await agentApiClient.post("dev/reset");
  }

  /**
   * Get a snapshot of all currently-running sessions.
   * Used by the frontend on boot/reconnect to replay active run state.
   */
  async getRunningSessions(): Promise<RunningSessionsResponse> {
    debugLog("[AgentClient]", "runs.active.request", {});
    const response = await agentApiClient.get<RunningSessionsResponse>("runs/active");
    debugLog("[AgentClient]", "runs.active.response", summarizeRunningSessions(response));
    return response;
  }

  async listSchedules(): Promise<ListSchedulesResponse> {
    return agentApiClient.get<ListSchedulesResponse>("schedules");
  }

  async createSchedule(req: CreateScheduleRequest): Promise<ScheduleEntry> {
    return agentApiClient.post<ScheduleEntry>("schedules", req);
  }

  async patchSchedule(scheduleId: string, req: PatchScheduleRequest): Promise<ScheduleEntry> {
    const encoded = encodeURIComponent(scheduleId);
    return agentApiClient.patch<ScheduleEntry>(`schedules/${encoded}`, req);
  }

  async deleteSchedule(scheduleId: string): Promise<void> {
    const encoded = encodeURIComponent(scheduleId);
    await agentApiClient.delete(`schedules/${encoded}`);
  }

  async runScheduleNow(scheduleId: string): Promise<void> {
    const encoded = encodeURIComponent(scheduleId);
    await agentApiClient.post(`schedules/${encoded}/run`);
  }

  async listScheduleSessions(scheduleId: string): Promise<ListScheduleSessionsResponse> {
    const encoded = encodeURIComponent(scheduleId);
    return agentApiClient.get<ListScheduleSessionsResponse>(`schedules/${encoded}/sessions`);
  }

  async listScheduleRuns(scheduleId: string): Promise<ListScheduleRunsResponse> {
    const encoded = encodeURIComponent(scheduleId);
    return agentApiClient.get<ListScheduleRunsResponse>(`schedules/${encoded}/runs`);
  }

  /**
   * Subscribe to events only (no execution trigger)
   * Use this for passive observation like TaskList updates
   */
  async subscribeToEvents(
    sessionId: string,
    handlers: AgentEventHandlers,
    abortController?: AbortController,
  ): Promise<void> {
    const signal = abortController?.signal;
    debugLog("[AgentClient]", "events.subscribe.request", { sessionId });

    // v2 WebSocket transport (default ON; force OFF with bodhi_api_v2_ws="0").
    // Route this per-session agent stream over the shared `/v2/stream` socket.
    // The handle's Promise resolves on the agent `terminal` control or when the
    // abort signal fires; a transient WS disconnect does not reject (the WS
    // client reconnects and re-subscribes internally), so
    // `agentSubscriptionRunner` needs no change.
    //
    // If the WS's very FIRST connection never opens (old backend without
    // `/v2/stream`, or unreachable host), `onConnectFailed` fires once and we
    // transparently fall back to the legacy SSE agent path below — the caller
    // sees identical Promise/abort semantics regardless of which transport won.
    if (isApiV2WsEnabled()) {
      if (signal?.aborted) {
        debugLog("[AgentClient]", "events.subscribe.ws.aborted_before_connect", { sessionId });
        return;
      }

      let fellBack = false;
      const fallbackPromise = new Promise<void>((resolve, reject) => {
        // Declare `close` ABOVE the subscribeAgent call: `onConnectFailed` can
        // fire SYNCHRONOUSLY when the WS is already in a known-failed state (a
        // second subscribe after a prior WS failure), and the callback references
        // `close` — using it before initialization would throw a temporal-dead-
        // zone ReferenceError. (v2Stream also defers that synchronous fire to a
        // microtask for belt-and-braces.)
        let close: () => void = () => {};
        const subscription = v2Stream.subscribeAgent(
          sessionId,
          handlers,
          (event, h) => this.handleEvent(event, h),
          () => {
            // Initial WS connect failed: tear down the WS subscription (already
            // torn down internally by the client) and fall back to SSE. Mark so
            // the WS promise's resolution below is ignored.
            fellBack = true;
            debugLog("[AgentClient]", "events.subscribe.ws.connect_failed_fallback", { sessionId });
            close();
            this.subscribeToEventsSse(sessionId, handlers, signal).then(resolve, reject);
          },
        );
        const { promise } = subscription;
        close = subscription.close;
        const abortListener = () => {
          debugLog("[AgentClient]", "events.subscribe.ws.abort", { sessionId });
          close();
        };
        signal?.addEventListener("abort", abortListener, { once: true });
        promise
          .then(() => {
            signal?.removeEventListener("abort", abortListener);
            // Resolve the WS leg only if we did NOT fall back; otherwise the SSE
            // leg owns resolution.
            if (!fellBack) resolve();
          })
          .catch((error) => {
            signal?.removeEventListener("abort", abortListener);
            if (!fellBack) reject(error);
          });
      });
      await fallbackPromise;
      return;
    }

    return this.subscribeToEventsSse(sessionId, handlers, signal);
  }

  /**
   * Legacy SSE per-session agent subscription (`GET /api/v1/events/{id}`).
   *
   * This is the original `subscribeToEvents` body, factored out so it can be
   * invoked from BOTH the flag-off path AND the v2 WS connect-failure fallback,
   * with byte-for-byte identical behavior in the force-OFF case.
   */
  private subscribeToEventsSse(
    sessionId: string,
    handlers: AgentEventHandlers,
    signal?: AbortSignal,
  ): Promise<void> {
    const base = getBackendBaseUrlSync().trim().replace(/\/+$/, "");
    const origin = base.endsWith("/v1") ? base.slice(0, -3) : base;
    const eventsUrl = `${origin}/api/v1/events/${encodeURIComponent(sessionId)}`;
    debugLog("[AgentClient]", "events.subscribe.url", { sessionId, eventsUrl });

    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        debugLog("[AgentClient]", "events.subscribe.aborted_before_connect", { sessionId });
        resolve();
        return;
      }

      let settled = false;
      let terminalSeen = false;
      let eventSource: EventSource | null = null;

      const abortListener = () => {
        debugLog("[AgentClient]", "events.subscribe.abort", { sessionId, terminalSeen });
        settleResolve();
      };

      const cleanup = () => {
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        signal?.removeEventListener("abort", abortListener);
      };

      const settleResolve = () => {
        if (settled) return;
        settled = true;
        debugLog("[AgentClient]", "events.subscribe.resolve", {
          sessionId,
          terminalSeen,
          aborted: signal?.aborted ?? false,
        });
        cleanup();
        resolve();
      };

      const settleReject = (error: unknown) => {
        if (settled) return;
        settled = true;
        debugLog("[AgentClient]", "events.subscribe.reject", {
          sessionId,
          terminalSeen,
          aborted: signal?.aborted ?? false,
          error,
        });
        cleanup();
        reject(error);
      };

      signal?.addEventListener("abort", abortListener, { once: true });

      try {
        eventSource = new EventSource(eventsUrl, { withCredentials: true });
      } catch (error) {
        settleReject(error);
        return;
      }

      eventSource.onopen = () => {
        debugLog("[AgentClient]", "events.subscribe.open", { sessionId });
      };

      eventSource.onmessage = (messageEvent) => {
        const data = messageEvent.data;

        if (data === "[DONE]") {
          terminalSeen = true;
          debugLog("[AgentClient]", "events.subscribe.done", { sessionId });
          settleResolve();
          return;
        }

        if (data === "[KEEPALIVE]") {
          return;
        }

        try {
          const event: AgentEvent = JSON.parse(data);
          if (
            event.type === "execution_started" ||
            event.type === "complete" ||
            event.type === "cancelled" ||
            event.type === "error" ||
            event.type === "runner_progress" ||
            event.type === "need_clarification"
          ) {
            debugLog("[AgentClient]", "events.subscribe.event", {
              sessionId,
              ...summarizeStreamControlEvent(event),
            });
          }
          this.handleEvent(event, handlers);
          if (event.type === "complete" || event.type === "cancelled" || event.type === "error") {
            terminalSeen = true;
          }
        } catch (error) {
          console.warn("Failed to parse event:", data, error);
        }
      };

      eventSource.onerror = () => {
        debugLog("[AgentClient]", "events.subscribe.error", {
          sessionId,
          terminalSeen,
          aborted: signal?.aborted ?? false,
        });
        if (signal?.aborted || terminalSeen) {
          settleResolve();
          return;
        }
        settleReject(new Error(`EventSource connection failed for session ${sessionId}`));
      };
    });
  }

  /**
   * Subscribe to the account-wide change feed (`GET /api/v1/stream`).
   *
   * A single long-lived SSE connection multiplexing durable change events
   * across all sessions (session created/deleted/cleared, title/pinned, message
   * appended, task updates, terminal status). Replaces the old session-index
   * and health polling: the browser `EventSource` auto-reconnects and resends
   * `Last-Event-ID`, so the backend replays only what was missed.
   *
   * Returns a small `{ close() }` handle so the caller can tear it down. With
   * the legacy SSE transport this is the live `EventSource` (which structurally
   * satisfies the handle) and reconnection is handled natively by the browser;
   * with the v2 WebSocket transport it is the v2 feed subscription.
   *
   * v2 WebSocket transport is default ON (force OFF with bodhi_api_v2_ws="0").
   * If the WS's very FIRST connection never opens (old backend without
   * `/v2/stream`, or unreachable host), we transparently fall back to the legacy
   * SSE feed below. The returned handle closes whichever transport ended up
   * active; `accountFeed.ts` needs no change.
   */
  subscribeToAccountStream(
    handlers: AccountStreamHandlers,
    opts?: { since?: number },
  ): FeedSubscription {
    if (isApiV2WsEnabled()) {
      // The handle must close whichever transport is active. It starts holding
      // the WS feed subscription and swaps to the SSE handle if the initial WS
      // connect fails. If the caller closes BEFORE any fallback, the `closed`
      // guard prevents a late fallback from opening a leaked EventSource.
      //
      // IMPORTANT: declare `closed`/`active`/`wsHandle` ABOVE the subscribeFeed
      // call. `onConnectFailed` can fire SYNCHRONOUSLY inside subscribeFeed when
      // the WS is already in a known-failed state (a second subscribe after a
      // prior WS failure); referencing these from the callback before they were
      // initialized would throw a temporal-dead-zone ReferenceError. (v2Stream
      // also defers that synchronous fire to a microtask for belt-and-braces.)
      let closed = false;
      let active: FeedSubscription | null = null;
      // `wsClose` is a hoisted no-op so the callback NEVER references the
      // not-yet-assigned `wsHandle` const (temporal-dead-zone safety, symmetric
      // with the agent path). v2Stream also defers any synchronous connect-failed
      // fire to a microtask, so in practice the callback runs after `wsClose` is
      // pointed at the real handle below — but the no-op makes a sync fire safe too.
      let wsClose: () => void = () => {};
      const wsHandle: FeedSubscription = v2Stream.subscribeFeed(handlers, opts?.since ?? 0, () => {
        if (closed) return;
        debugLog("[AgentClient]", "stream.subscribe.ws.connect_failed_fallback", {});
        // Close the WS feed handle so v2Stream nulls its feedChannel and
        // closeIfIdle resets connectivity state (everOpened/connectFailed) —
        // symmetric with the agent path. Without this the feed channel stays
        // registered: hasSubscriptions() stays true, the WS never resets, and
        // every later subscribe keeps hitting the already-failed path (and the
        // WS is never retried even if the backend is later upgraded).
        wsClose();
        // Swap to the legacy SSE feed with the same handlers + since.
        active = this.subscribeAccountStreamSse(handlers, opts);
      });
      wsClose = () => wsHandle.close();
      if (active === null) active = wsHandle;
      return {
        close() {
          if (closed) return;
          closed = true;
          active?.close();
        },
      };
    }

    return this.subscribeAccountStreamSse(handlers, opts);
  }

  /**
   * Legacy SSE account change-feed (`GET /api/v1/stream`).
   *
   * This is the original `subscribeToAccountStream` body, factored out so it can
   * be invoked from BOTH the flag-off path AND the v2 WS connect-failure
   * fallback, with byte-for-byte identical behavior in the force-OFF case.
   */
  private subscribeAccountStreamSse(
    handlers: AccountStreamHandlers,
    opts?: { since?: number },
  ): FeedSubscription {
    const base = getBackendBaseUrlSync().trim().replace(/\/+$/, "");
    const origin = base.endsWith("/v1") ? base.slice(0, -3) : base;
    const since = opts?.since && opts.since > 0 ? `?since=${opts.since}` : "";
    const url = `${origin}/api/v1/stream${since}`;
    debugLog("[AgentClient]", "stream.subscribe.url", { url });

    const eventSource = new EventSource(url, { withCredentials: true });

    eventSource.onopen = () => {
      debugLog("[AgentClient]", "stream.subscribe.open", {});
      handlers.onOpen?.();
    };

    eventSource.onmessage = (messageEvent) => {
      const data = messageEvent.data;
      if (data === "[KEEPALIVE]") {
        return;
      }
      try {
        const parsed = JSON.parse(data) as ChangeEvent | FeedResetFrame;
        if ((parsed as FeedResetFrame).type === "feed_reset") {
          debugLog("[AgentClient]", "stream.subscribe.feed_reset", parsed);
          handlers.onReset?.();
          return;
        }
        handlers.onChange(parsed as ChangeEvent);
      } catch (error) {
        console.warn("Failed to parse change-feed event:", data, error);
      }
    };

    eventSource.onerror = () => {
      // The browser will auto-reconnect (resending Last-Event-ID). Surface the
      // transient disconnect so the UI can reflect availability.
      debugLog("[AgentClient]", "stream.subscribe.error", {});
      handlers.onError?.();
    };

    return eventSource;
  }

  /**
   * Handle a single agent event
   */
  private handleEvent(event: AgentEvent, handlers: AgentEventHandlers): void {
    switch (event.type) {
      case "token":
        handlers.onToken?.(event.content || "");
        break;
      case "reasoning_token":
        handlers.onReasoningToken?.(event.content || "");
        break;
      case "tool_token":
        handlers.onToolToken?.(event.tool_call_id || "", event.content || "");
        break;
      case "tool_start":
        handlers.onToolStart?.(
          event.tool_call_id || "",
          event.tool_name || "",
          event.arguments || {},
        );
        break;
      case "tool_complete":
        if (event.result) {
          handlers.onToolComplete?.(event.tool_call_id || "", event.result);
        }
        break;
      case "tool_error":
        handlers.onToolError?.(event.tool_call_id || "", event.error || "");
        break;
      case "task_list_updated":
        if (event.task_list) {
          handlers.onTaskListUpdated?.(event.task_list);
        }
        break;
      case "task_list_item_progress":
        if (
          event.session_id &&
          event.item_id &&
          event.status &&
          event.tool_calls_count !== undefined &&
          event.version !== undefined
        ) {
          const status = event.status;
          const isTaskStatus =
            status === "pending" ||
            status === "in_progress" ||
            status === "completed" ||
            status === "blocked";
          if (!isTaskStatus) {
            break;
          }
          handlers.onTaskListItemProgress?.({
            session_id: event.session_id,
            item_id: event.item_id,
            status,
            tool_calls_count: event.tool_calls_count,
            version: event.version,
          });
        }
        break;
      case "task_list_completed":
        if (
          event.session_id &&
          event.total_rounds !== undefined &&
          event.total_tool_calls !== undefined
        ) {
          handlers.onTaskListCompleted?.(
            event.session_id,
            event.total_rounds,
            event.total_tool_calls,
            event.completed_at,
          );
        }
        break;
      case "task_evaluation_started":
        if (event.session_id && event.items_count !== undefined) {
          handlers.onTaskEvaluationStarted?.(event.session_id, event.items_count);
        }
        break;
      case "task_evaluation_completed":
        if (event.session_id && event.updates_count !== undefined && event.reasoning) {
          handlers.onTaskEvaluationCompleted?.(
            event.session_id,
            event.updates_count,
            event.reasoning,
          );
        }
        break;
      case "token_budget_updated":
        if (event.usage && "system_tokens" in event.usage) {
          handlers.onTokenBudgetUpdated?.(event.usage);
        }
        break;
      case "context_compression_status":
        if (typeof event.phase === "string" && typeof event.status === "string") {
          handlers.onContextCompressionStatus?.(event.phase, event.status);
        }
        break;
      case "tool_lifecycle":
        handlers.onToolLifecycle?.(
          event.tool_call_id || "",
          event.tool_name || "",
          event.phase || "",
          event.elapsed_ms,
          event.is_mutating,
          event.auto_approved,
          event.summary,
          event.error,
        );
        break;
      case "context_summarized":
        if (event.summary_info) {
          handlers.onContextSummarized?.(event.summary_info);
        }
        break;
      case "context_pressure_notification":
        if (typeof event.percent === "number" && typeof event.level === "string") {
          handlers.onContextPressureNotification?.(event.percent, event.level, event.message || "");
        }
        break;
      case "sub_agent_started":
        if (event.parent_session_id && event.child_session_id) {
          handlers.onSubAgentStarted?.(
            event.parent_session_id,
            event.child_session_id,
            event.title,
          );
        }
        break;
      case "sub_agent_event":
        if (event.parent_session_id && event.child_session_id && event.event) {
          handlers.onSubAgentEvent?.(event.parent_session_id, event.child_session_id, event.event);
        }
        break;
      case "sub_agent_heartbeat":
        if (event.parent_session_id && event.child_session_id && event.timestamp) {
          handlers.onSubAgentHeartbeat?.(
            event.parent_session_id,
            event.child_session_id,
            event.timestamp,
          );
        }
        break;
      case "sub_agent_completed":
        if (event.parent_session_id && event.child_session_id) {
          handlers.onSubAgentCompleted?.(
            event.parent_session_id,
            event.child_session_id,
            typeof event.status === "string" ? event.status : "completed",
            event.error,
          );
        }
        break;
      case "child_approval_requested":
        if (event.child_session_id && event.request_id) {
          handlers.onChildApprovalRequested?.(event.child_session_id, event.request_id, {
            toolName: event.tool_name,
            permission: event.permission,
            resource: event.resource,
          });
        }
        break;
      case "execution_started":
        handlers.onExecutionStarted?.(event.run_id || "", event.started_at);
        break;
      case "runner_progress":
        if (event.session_id && typeof event.round_count === "number") {
          handlers.onRunnerProgress?.(event.session_id, event.round_count);
        }
        break;
      case "need_clarification":
        handlers.onNeedClarification?.(event);
        break;
      case "notification":
        handlers.onNotification?.(event);
        break;
      case "session_title_updated":
        if (
          event.session_id &&
          typeof event.title === "string" &&
          typeof event.title_version === "number" &&
          (event.source === "auto" || event.source === "manual" || event.source === "fallback") &&
          typeof event.updated_at === "string"
        ) {
          handlers.onSessionTitleUpdated?.({
            type: "session_title_updated",
            session_id: event.session_id,
            title: event.title,
            title_version: event.title_version,
            source: event.source,
            updated_at: event.updated_at,
          });
        }
        break;
      case "session_pinned_updated":
        if (
          event.session_id &&
          typeof event.pinned === "boolean" &&
          typeof event.updated_at === "string"
        ) {
          handlers.onSessionPinnedUpdated?.({
            type: "session_pinned_updated",
            session_id: event.session_id,
            pinned: event.pinned,
            updated_at: event.updated_at,
          });
        }
        break;
      case "plan_mode_entered":
        handlers.onPlanModeEntered?.(event);
        break;
      case "plan_mode_exited":
        handlers.onPlanModeExited?.(event);
        break;
      case "plan_file_updated":
        handlers.onPlanFileUpdated?.(event);
        break;
      case "goal_status_changed":
        handlers.onGoalStatusChanged?.(event);
        break;
      case "complete":
        debugLog("[AgentClient]", "events.dispatch.complete", summarizeStreamControlEvent(event));
        handlers.onComplete?.(event.usage);
        break;
      case "cancelled":
        debugLog("[AgentClient]", "events.dispatch.cancelled", summarizeStreamControlEvent(event));
        handlers.onCancelled?.(event.message);
        break;
      case "error":
        debugLog("[AgentClient]", "events.dispatch.error", summarizeStreamControlEvent(event));
        // Error event uses 'message' field, not 'error' field
        handlers.onError?.(event.message || event.error || "Unknown error");
        break;
      default:
        console.warn("Unknown event type:", event);
    }
  }

  /**
   * Stop generation for a session
   */
  async stopGeneration(sessionId: string): Promise<void> {
    await agentApiClient.post(`stop/${sessionId}`);
  }

  /**
   * Delete a persisted backend session
   */
  async deleteSession(sessionId: string): Promise<void> {
    const encodedSessionId = encodeURIComponent(sessionId);
    await agentApiClient.delete(`sessions/${encodedSessionId}`);
  }

  /**
   * Get chat history
   */
  async getHistory(sessionId: string, sinceMessageId?: string): Promise<HistoryResponse> {
    debugLog("[AgentClient]", "history.request", { sessionId, sinceMessageId });
    // Delta mode: when a cursor is supplied, the backend returns only messages
    // appended after it (`is_delta: true`), so a client that already has most
    // of the history only transfers the tail.
    const path = sinceMessageId
      ? `history/${sessionId}?since_message_id=${encodeURIComponent(sinceMessageId)}`
      : `history/${sessionId}`;
    const response = await agentApiClient.get<HistoryResponse>(path);
    debugLog("[AgentClient]", "history.response", summarizeHistoryResponse(response));
    return response;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<boolean> {
    try {
      await agentApiClient.get("health");
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const agentClient = AgentClient.getInstance();
