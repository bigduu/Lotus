import { debugLog } from "@shared/utils/debugFlags";
/**
 * Agent Client Service
 *
 * HTTP client for communicating with local copilot-agent endpoints
 * Handles SSE streaming and AgentEvent processing
 */
import { agentApiClient } from "../api";

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
  | "sub_session_started"
  | "sub_session_event"
  | "sub_session_heartbeat"
  | "sub_session_completed"
  | "need_clarification"
  | "complete"
  | "error";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

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
  item_id?: string;
  status?: TaskItemStatus | string;
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
  // Sub-session events
  parent_session_id?: string;
  child_session_id?: string;
  title?: string;
  event?: AgentEvent;
  timestamp?: string;
  // ContextPressureNotification events
  percent?: number;
  level?: string;
  // NeedClarification events
  question?: string;
  options?: string[];
  allow_custom?: boolean;
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

export interface ChatResponse {
  session_id: string;
  status: string;
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
}

export interface ExecuteRequest {
  model?: string;
  model_ref?: { provider: string; model: string };
  provider?: string;
  reasoning_effort?: ReasoningEffort;
  client_sync?: ExecuteClientSync;
}

export interface HistoryResponse {
  session_id: string;
  compression_events?: Array<{
    id: string;
    created_at: string;
    messages_compressed: number;
    segments_removed: number;
  }>;
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

export interface SessionSummary {
  id: string;
  kind: SessionKind;
  title: string;
  pinned: boolean;
  parent_session_id?: string | null;
  root_session_id: string;
  spawn_depth: number;
  model: string;
  model_ref?: { provider: string; model: string } | null;
  reasoning_effort?: ReasoningEffort | null;
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
  /**
   * SubAgent profile id for child sessions (e.g. "general-purpose", "plan").
   * Mirrored from the child session's metadata into the global SessionIndexEntry,
   * so this lightweight list endpoint can surface the role without loading
   * each session.json. Always undefined for root sessions and for legacy
   * children created before subagent profiles were introduced.
   */
  subagent_type?: string | null;
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
export interface AgentEventHandlers {
  onToken?: (content: string) => void;
  onReasoningToken?: (content: string) => void;
  onToolToken?: (toolCallId: string, content: string) => void;
  onToolStart?: (toolCallId: string, toolName: string, args: Record<string, unknown>) => void;
  onToolComplete?: (toolCallId: string, result: AgentEvent["result"]) => void;
  onToolError?: (toolCallId: string, error: string) => void;
  onTaskListUpdated?: (taskList: TaskList) => void;
  onTaskListItemProgress?: (delta: TaskListDelta) => void;
  onTaskListCompleted?: (sessionId: string, totalRounds: number, totalToolCalls: number) => void;
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
  onError?: (message: string) => void;
  onSubSessionStarted?: (parentSessionId: string, childSessionId: string, title?: string) => void;
  onSubSessionEvent?: (parentSessionId: string, childSessionId: string, event: AgentEvent) => void;
  onSubSessionHeartbeat?: (
    parentSessionId: string,
    childSessionId: string,
    timestamp: string,
  ) => void;
  onSubSessionCompleted?: (
    parentSessionId: string,
    childSessionId: string,
    status: string,
    error?: string,
  ) => void;
  onNeedClarification?: (event: AgentEvent) => void;
}

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
    return agentApiClient.post<ChatResponse>("chat", request);
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
    return agentApiClient.post<ExecuteResponse>(`execute/${sessionId}`, payload);
  }

  /**
   * List backend sessions (V2 index-backed).
   */
  async listSessions(): Promise<ListSessionsResponse> {
    return agentApiClient.get<ListSessionsResponse>("sessions");
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
   * Development-only: reset V2 session storage (deletes sessions/ and resets sessions.json index).
   */
  async devResetSessions(): Promise<void> {
    await agentApiClient.post("dev/reset");
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
    debugLog("[AgentClient]", "[AgentClient] Subscribing to events for session:", sessionId);

    try {
      const response = await agentApiClient.fetchRaw(`events/${sessionId}`, {
        signal,
      });

      debugLog(
        "[AgentClient]",
        "[AgentClient] Events subscription response:",
        response.status,
        response.statusText,
        "Content-Type:",
        response.headers.get("content-type"),
      );

      if (!response.ok) {
        // Try to parse error details from response
        let errorMessage = `Failed to subscribe to events: ${response.statusText}`;
        try {
          const body = await response.text();
          if (body) {
            try {
              const errorData = JSON.parse(body);
              errorMessage =
                errorData.error || errorData.message || errorData.detail || errorMessage;
            } catch {
              errorMessage = body || errorMessage;
            }
          }
        } catch (e) {
          console.error("Failed to parse error response:", e);
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          if (signal?.aborted) {
            break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process SSE lines
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);

              // Check for [DONE] marker
              if (data === "[DONE]") {
                return;
              }

              try {
                const event: AgentEvent = JSON.parse(data);
                this.handleEvent(event, handlers);
              } catch (e) {
                console.warn("Failed to parse event:", data, e);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (signal?.aborted) {
        // Normal lifecycle (caller aborted due to navigation, completion, etc.)
        debugLog("[AgentClient]", "Events subscription aborted for session:", sessionId);
        return;
      }
      console.error("[AgentClient] Events subscription error:", error);
      throw error;
    }
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
      case "sub_session_started":
        if (event.parent_session_id && event.child_session_id) {
          handlers.onSubSessionStarted?.(
            event.parent_session_id,
            event.child_session_id,
            event.title,
          );
        }
        break;
      case "sub_session_event":
        if (event.parent_session_id && event.child_session_id && event.event) {
          handlers.onSubSessionEvent?.(
            event.parent_session_id,
            event.child_session_id,
            event.event,
          );
        }
        break;
      case "sub_session_heartbeat":
        if (event.parent_session_id && event.child_session_id && event.timestamp) {
          handlers.onSubSessionHeartbeat?.(
            event.parent_session_id,
            event.child_session_id,
            event.timestamp,
          );
        }
        break;
      case "sub_session_completed":
        if (event.parent_session_id && event.child_session_id) {
          handlers.onSubSessionCompleted?.(
            event.parent_session_id,
            event.child_session_id,
            typeof event.status === "string" ? event.status : "completed",
            event.error,
          );
        }
        break;
      case "need_clarification":
        handlers.onNeedClarification?.(event);
        break;
      case "complete":
        handlers.onComplete?.(event.usage);
        break;
      case "error":
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
  async getHistory(sessionId: string): Promise<HistoryResponse> {
    return agentApiClient.get<HistoryResponse>(`history/${sessionId}`);
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
