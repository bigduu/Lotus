import { StateCreator } from "zustand";
import { AgentEvent, SessionSummary } from "../../services/AgentService";
import type { AppState } from "../";
import { applyReplayableSessionEvent, isSessionMetadataEvent } from "./sessionMetadataSlice";

// =============================================================================
// Execution-state model — owned by createExecutionStateSlice.
// Replaces the legacy processingChats Set.
// =============================================================================

export const OPTIMISTIC_RACE_WINDOW_MS = 5_000;
export const STALE_OPTIMISTIC_TIMEOUT_MS = 30_000;
export const TOOL_PREVIEW_MAX_CHARS = 80;
export const MAX_REASONS_KEPT = 16;

const debugRespondState = (event: string, payload: Record<string, unknown>): void => {
  if (!import.meta.env.DEV) return;
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem("lotus_debug_respond") !== "1") return;
  console.warn(`[ExecutionState] ${event}`, payload);
};

export type ExecutionPhase =
  | "idle"
  | "starting"
  | "running"
  | "streaming"
  | "running_tools"
  | "waiting_user_answer"
  | "running_children"
  | "settling"
  | "completed"
  | "error"
  | "cancelled";

export type ExecutionReason =
  | "optimistic:send"
  | "optimistic:respond"
  | "optimistic:retry"
  | "optimistic:openSession.forceSubscribe"
  | "summary:is_running"
  | "summary:terminal"
  | "sse:token"
  | "sse:tool_start"
  | "sse:tool_complete"
  | "sse:need_clarification"
  | "sse:sub_agent_started"
  | "sse:sub_agent_completed"
  | "sse:complete"
  | "sse:error"
  | "sse:terminal_one_shot"
  | "sse:execution_started"
  | "user:cancel"
  | "settle:timeout";

export type Confidence = "optimistic" | "summary" | "live" | "terminal";

export interface ActiveToolCall {
  toolCallId: string;
  toolName: string;
  startedAt: string;
  /** Most recent tool_token chunk, bounded to TOOL_PREVIEW_MAX_CHARS. */
  preview?: string;
}

export interface SessionStreamSnapshot {
  hasTokens: boolean;
  tokenCount: number;
  activeToolCalls: ActiveToolCall[];
  lastStatusHint: string | null;
}

export interface SessionBackendSnapshot {
  isRunning: boolean;
  lastRunStatus: "completed" | "error" | "cancelled" | null;
  lastRunError: string | null;
  syncedAt: string | null;
  /** Populated from SessionSummary.has_pending_question (or SSE need_clarification). */
  hasPendingQuestion: boolean | null;
  /** Running child count from SessionSummary or sub_agent events. */
  runningChildCount: number | null;
}

export interface PendingQuestionPayload {
  question: string;
  options: string[];
  allowCustom: boolean;
  toolCallId: string | null;
}

export interface SessionInteractionSnapshot {
  pendingQuestion:
    | (PendingQuestionPayload & {
        receivedAt: string;
      })
    | null;
  /**
   * @deprecated Legacy compatibility slot. Runtime readers should derive respondMode
   * from pendingQuestion via selectors instead of treating this as independent truth.
   */
  respondMode:
    | (PendingQuestionPayload & {
        sessionId: string;
      })
    | null;
}

export interface ChildProgress {
  title?: string;
  status?: string;
  error?: string;
  lastHeartbeatAt?: string;
  lastEventAt?: string;
  outputPreview?: string;
  roundCount?: number;
}

export interface SessionChildrenSnapshot {
  byId: Record<string, ChildProgress>;
  runningCount: number;
}

export interface SessionExecutionTimestamps {
  optimisticAt: string | null;
  confirmedAt: string | null;
  firstTokenAt: string | null;
  terminalAt: string | null;
  settlingStartedAt: string | null;
  settledAt: string | null;
}

export interface SessionExecutionError {
  message: string;
  source: "sse" | "summary" | "transport" | "user_cancel";
  details?: unknown;
  occurredAt: string;
}

export interface SessionExecutionState {
  sessionId: string;
  phase: ExecutionPhase;
  confidence: Confidence;
  activeReasons: ExecutionReason[];
  /**
   * Client-local primary convergence key. Incremented on every new execution
   * attempt. All stale-event guards, subscription deduplication, and optimistic
   * race protection use this value. NOT derived from the backend.
   */
  generation: number;
  /**
   * Backend run_id from execution_started events. OBSERVATIONAL ONLY — useful
   * for diagnostics and log correlation, but NEVER used for frontend convergence
   * decisions because not every execution path exposes a reliable run identity.
   */
  backendRunId: string | null;
  stream: SessionStreamSnapshot;
  backend: SessionBackendSnapshot;
  interaction: SessionInteractionSnapshot;
  children: SessionChildrenSnapshot;
  timestamps: SessionExecutionTimestamps;
  error: SessionExecutionError | null;
}

export type ExecutionMap = Record<string, SessionExecutionState>;

// =============================================================================
// Action ADT — every mutation flows through these tagged actions so behavior
// can be unit-tested without a Zustand store.
// =============================================================================

export type OneShotTerminalPayload =
  | { status: "completed" }
  | { status: "cancelled"; message?: string }
  | { status: "error"; message?: string };

export type ExecutionAction =
  | { type: "ensureSession"; sessionId: string }
  | { type: "markOptimisticStart"; sessionId: string }
  | { type: "markRespondStart"; sessionId: string; toolCallId?: string | null }
  | { type: "markRetryStart"; sessionId: string }
  | { type: "markForceSubscribe"; sessionId: string }
  | { type: "markCancel"; sessionId: string }
  | { type: "markSettleTimeout"; sessionId: string }
  | { type: "markStreamStarted"; sessionId: string; generation: number }
  | { type: "applyAgentEvent"; sessionId: string; event: AgentEvent; generation: number }
  | { type: "applyExecutionStarted"; sessionId: string; runId: string; generation: number }
  | { type: "applySessionSummary"; sessionId: string; summary: SessionSummary }
  | {
      type: "applyOneShotTerminal";
      sessionId: string;
      generation: number;
      payload: OneShotTerminalPayload;
    }
  | { type: "beginSettle"; sessionId: string; generation: number }
  | {
      type: "applyChildProgress";
      sessionId: string;
      childId: string;
      patch: Partial<ChildProgress>;
    }
  | { type: "clearChildProgress"; sessionId: string; childId: string }
  | { type: "setPendingQuestion"; sessionId: string; payload: PendingQuestionPayload }
  | { type: "clearPendingQuestion"; sessionId: string }
  | { type: "resetSession"; sessionId: string }
  | {
      type: "applyRunningSnapshot";
      sessions: Array<{
        sessionId: string;
        runId: string;
        criticalEvents: AgentEvent[];
      }>;
    };

// =============================================================================
// Helpers
// =============================================================================

export const isBusyPhase = (phase: ExecutionPhase | undefined): boolean =>
  phase !== undefined &&
  phase !== "idle" &&
  phase !== "completed" &&
  phase !== "error" &&
  phase !== "cancelled";

/** Phases where the message input should be locked (user cannot type/submit). */
export const isInputLockedPhase = (phase: ExecutionPhase | undefined): boolean =>
  phase === "starting" ||
  phase === "running" ||
  phase === "streaming" ||
  phase === "running_tools" ||
  phase === "running_children" ||
  phase === "settling";

/** Phases where a "Cancel" action makes sense. */
export const isCancellablePhase = (phase: ExecutionPhase | undefined): boolean =>
  phase === "starting" ||
  phase === "running" ||
  phase === "streaming" ||
  phase === "running_tools" ||
  phase === "running_children";

export const createInitialExecutionState = (sessionId: string): SessionExecutionState => ({
  sessionId,
  phase: "idle",
  confidence: "optimistic",
  activeReasons: [],
  generation: 0,
  backendRunId: null,
  stream: {
    hasTokens: false,
    tokenCount: 0,
    activeToolCalls: [],
    lastStatusHint: null,
  },
  backend: {
    isRunning: false,
    lastRunStatus: null,
    lastRunError: null,
    syncedAt: null,
    hasPendingQuestion: null,
    runningChildCount: null,
  },
  interaction: {
    pendingQuestion: null,
    respondMode: null,
  },
  children: {
    byId: {},
    runningCount: 0,
  },
  timestamps: {
    optimisticAt: null,
    confirmedAt: null,
    firstTokenAt: null,
    terminalAt: null,
    settlingStartedAt: null,
    settledAt: null,
  },
  error: null,
});

const ensureEntry = (map: ExecutionMap, sessionId: string): SessionExecutionState =>
  map[sessionId] ?? createInitialExecutionState(sessionId);

const appendReason = (reasons: ExecutionReason[], reason: ExecutionReason): ExecutionReason[] => {
  const next =
    reasons.length >= MAX_REASONS_KEPT ? reasons.slice(-(MAX_REASONS_KEPT - 1)) : reasons;
  return [...next, reason];
};

const truncatePreview = (text: string): string =>
  text.length <= TOOL_PREVIEW_MAX_CHARS ? text : text.slice(text.length - TOOL_PREVIEW_MAX_CHARS);

const areStringArraysEqual = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

const pendingQuestionPayloadEquals = (
  current:
    | PendingQuestionPayload
    | (PendingQuestionPayload & { receivedAt: string })
    | (PendingQuestionPayload & { sessionId: string })
    | null,
  payload: PendingQuestionPayload,
): boolean => {
  if (!current) {
    return false;
  }
  return (
    current.question === payload.question &&
    current.allowCustom === payload.allowCustom &&
    current.toolCallId === payload.toolCallId &&
    areStringArraysEqual(current.options, payload.options)
  );
};

const applyPendingQuestionSnapshot = (
  entry: SessionExecutionState,
  payload: PendingQuestionPayload,
  receivedAt: string,
): SessionExecutionState => {
  const pendingQuestion = pendingQuestionPayloadEquals(entry.interaction.pendingQuestion, payload)
    ? entry.interaction.pendingQuestion
    : { ...payload, receivedAt };

  if (
    entry.phase === "waiting_user_answer" &&
    entry.confidence === "live" &&
    pendingQuestion === entry.interaction.pendingQuestion
  ) {
    return entry;
  }

  return {
    ...entry,
    phase: "waiting_user_answer",
    confidence: "live",
    interaction: {
      ...entry.interaction,
      pendingQuestion,
      respondMode: null,
    },
    activeReasons: appendReason(entry.activeReasons, "sse:need_clarification"),
  };
};

/**
 * Side-state events (tokens, tool progress, child progress) do not override
 * these phases. The user must explicitly respond/approve, or a dedicated action
 * must clear the state, before execution can resume.
 */
const ABSORBING_FOR_RECONCILE: ReadonlySet<ExecutionPhase> = new Set([
  "idle",
  "completed",
  "error",
  "cancelled",
  "settling",
  "waiting_user_answer",
]);

/**
 * After a side-state mutation (token / tool start-complete / child progress),
 * derive the appropriate active phase. Promotes `starting` and `running` based
 * on observed live evidence; does not override terminal, settling, or blocked
 * phases — those have their own dedicated action handlers.
 */
const reconcileActivePhase = (entry: SessionExecutionState): SessionExecutionState => {
  if (ABSORBING_FOR_RECONCILE.has(entry.phase)) {
    return entry;
  }
  if (entry.children.runningCount > 0) {
    return entry.phase === "running_children" ? entry : { ...entry, phase: "running_children" };
  }
  if (entry.stream.activeToolCalls.length > 0) {
    return entry.phase === "running_tools" ? entry : { ...entry, phase: "running_tools" };
  }
  if (entry.stream.hasTokens) {
    return entry.phase === "streaming" ? entry : { ...entry, phase: "streaming" };
  }
  return entry.phase === "running" ? entry : { ...entry, phase: "running" };
};

const writeEntry = (
  map: ExecutionMap,
  sessionId: string,
  entry: SessionExecutionState,
): ExecutionMap => ({ ...map, [sessionId]: entry });

const removeEntry = (map: ExecutionMap, sessionId: string): ExecutionMap => {
  if (!(sessionId in map)) {
    return map;
  }
  const next = { ...map };
  delete next[sessionId];
  return next;
};

// =============================================================================
// Side-state helpers used by individual event branches
// =============================================================================

const applyTokenEvent = (
  entry: SessionExecutionState,
  reason: ExecutionReason,
  now: () => string,
): SessionExecutionState => {
  const firstTokenAt = entry.timestamps.firstTokenAt ?? now();
  const next: SessionExecutionState = {
    ...entry,
    confidence: "live",
    stream: {
      ...entry.stream,
      hasTokens: true,
      tokenCount: entry.stream.tokenCount + 1,
    },
    timestamps: { ...entry.timestamps, firstTokenAt },
    activeReasons: appendReason(entry.activeReasons, reason),
  };
  return reconcileActivePhase(next);
};

const applyStreamStarted = (
  entry: SessionExecutionState,
  now: () => string,
): SessionExecutionState => {
  if (entry.stream.hasTokens && entry.timestamps.firstTokenAt !== null) {
    return entry;
  }

  const firstTokenAt = entry.timestamps.firstTokenAt ?? now();
  const next: SessionExecutionState = {
    ...entry,
    confidence: "live",
    stream: {
      ...entry.stream,
      hasTokens: true,
      // Token text stays on the RAF-batched streaming bus; this is only the
      // coarse semantic marker used by phase selectors and completion logic.
      tokenCount: Math.max(1, entry.stream.tokenCount),
    },
    timestamps: { ...entry.timestamps, firstTokenAt },
    activeReasons: appendReason(entry.activeReasons, "sse:token"),
  };
  return reconcileActivePhase(next);
};

const applyToolStart = (
  entry: SessionExecutionState,
  toolCallId: string,
  toolName: string,
  startedAt: string,
): SessionExecutionState => {
  const existingIndex = entry.stream.activeToolCalls.findIndex(
    (call) => call.toolCallId === toolCallId,
  );
  // Idempotent: if same toolCallId already present, don't duplicate.
  const activeToolCalls =
    existingIndex >= 0
      ? entry.stream.activeToolCalls
      : [...entry.stream.activeToolCalls, { toolCallId, toolName, startedAt }];
  const next: SessionExecutionState = {
    ...entry,
    confidence: "live",
    stream: { ...entry.stream, activeToolCalls },
    activeReasons: appendReason(entry.activeReasons, "sse:tool_start"),
  };
  return reconcileActivePhase(next);
};

const applyToolToken = (
  entry: SessionExecutionState,
  toolCallId: string,
  content: string,
): SessionExecutionState => {
  const idx = entry.stream.activeToolCalls.findIndex((c) => c.toolCallId === toolCallId);
  if (idx < 0) {
    return entry;
  }
  const target = entry.stream.activeToolCalls[idx];
  const previousPreview = target.preview ?? "";
  const merged = truncatePreview(previousPreview + content);
  const updated: ActiveToolCall = { ...target, preview: merged };
  const activeToolCalls = [...entry.stream.activeToolCalls];
  activeToolCalls[idx] = updated;
  return { ...entry, stream: { ...entry.stream, activeToolCalls } };
};

const applyToolEnd = (
  entry: SessionExecutionState,
  toolCallId: string,
  reason: ExecutionReason,
): SessionExecutionState => {
  const activeToolCalls = entry.stream.activeToolCalls.filter((c) => c.toolCallId !== toolCallId);
  if (activeToolCalls.length === entry.stream.activeToolCalls.length) {
    return entry;
  }
  const intermediate: SessionExecutionState = {
    ...entry,
    stream: { ...entry.stream, activeToolCalls },
    activeReasons: appendReason(entry.activeReasons, reason),
  };
  // If parent terminal already arrived and nothing else active, settle now.
  if (
    intermediate.timestamps.terminalAt &&
    intermediate.children.runningCount === 0 &&
    intermediate.stream.activeToolCalls.length === 0 &&
    !ABSORBING_FOR_RECONCILE.has(intermediate.phase)
  ) {
    return {
      ...intermediate,
      phase: "settling",
      timestamps: {
        ...intermediate.timestamps,
        settlingStartedAt:
          intermediate.timestamps.settlingStartedAt ?? intermediate.timestamps.terminalAt,
      },
    };
  }
  return reconcileActivePhase(intermediate);
};

const applySubAgentStart = (
  entry: SessionExecutionState,
  childId: string,
  patch: Partial<ChildProgress>,
): SessionExecutionState => {
  const existing = entry.children.byId[childId];
  const wasRunning =
    existing !== undefined && (existing.status === undefined || existing.status === "running");
  const newProgress: ChildProgress = {
    ...existing,
    ...patch,
    status: patch.status ?? existing?.status ?? "running",
  };
  const isRunning = newProgress.status === undefined || newProgress.status === "running";
  const runningDelta = (isRunning ? 1 : 0) - (wasRunning ? 1 : 0);
  const intermediate: SessionExecutionState = {
    ...entry,
    confidence: "live",
    children: {
      byId: { ...entry.children.byId, [childId]: newProgress },
      runningCount: Math.max(0, entry.children.runningCount + runningDelta),
    },
    activeReasons: appendReason(entry.activeReasons, "sse:sub_agent_started"),
  };
  return reconcileActivePhase(intermediate);
};

const applySubAgentUpdate = (
  entry: SessionExecutionState,
  childId: string,
  patch: Partial<ChildProgress>,
): SessionExecutionState => {
  const existing = entry.children.byId[childId];
  const wasRunning =
    existing === undefined || existing.status === undefined || existing.status === "running";
  const merged: ChildProgress = { ...existing, ...patch };
  if (
    existing !== undefined &&
    existing.title === merged.title &&
    existing.status === merged.status &&
    existing.error === merged.error &&
    existing.lastHeartbeatAt === merged.lastHeartbeatAt &&
    existing.lastEventAt === merged.lastEventAt &&
    existing.outputPreview === merged.outputPreview &&
    existing.roundCount === merged.roundCount
  ) {
    return entry;
  }
  const isRunning = merged.status === undefined || merged.status === "running";
  let runningDelta = 0;
  if (existing !== undefined) {
    runningDelta = (isRunning ? 1 : 0) - (wasRunning ? 1 : 0);
  }
  const newRunningCount = Math.max(0, entry.children.runningCount + runningDelta);
  const intermediate: SessionExecutionState = {
    ...entry,
    children: {
      byId: { ...entry.children.byId, [childId]: merged },
      runningCount: newRunningCount,
    },
  };
  // If parent terminal already seen and nothing active, settle.
  if (
    intermediate.timestamps.terminalAt &&
    intermediate.children.runningCount === 0 &&
    intermediate.stream.activeToolCalls.length === 0 &&
    !ABSORBING_FOR_RECONCILE.has(intermediate.phase)
  ) {
    return {
      ...intermediate,
      phase: "settling",
      timestamps: {
        ...intermediate.timestamps,
        settlingStartedAt:
          intermediate.timestamps.settlingStartedAt ?? intermediate.timestamps.terminalAt,
      },
      activeReasons: appendReason(intermediate.activeReasons, "sse:sub_agent_completed"),
    };
  }
  return reconcileActivePhase(intermediate);
};

const applyClearChild = (entry: SessionExecutionState, childId: string): SessionExecutionState => {
  if (!(childId in entry.children.byId)) {
    return entry;
  }
  const existing = entry.children.byId[childId];
  const wasRunning = existing.status === undefined || existing.status === "running";
  const nextById = { ...entry.children.byId };
  delete nextById[childId];
  const intermediate: SessionExecutionState = {
    ...entry,
    children: {
      byId: nextById,
      runningCount: Math.max(0, entry.children.runningCount - (wasRunning ? 1 : 0)),
    },
  };
  if (
    intermediate.timestamps.terminalAt &&
    intermediate.children.runningCount === 0 &&
    intermediate.stream.activeToolCalls.length === 0 &&
    !ABSORBING_FOR_RECONCILE.has(intermediate.phase)
  ) {
    return {
      ...intermediate,
      phase: "settling",
      timestamps: {
        ...intermediate.timestamps,
        settlingStartedAt:
          intermediate.timestamps.settlingStartedAt ?? intermediate.timestamps.terminalAt,
      },
    };
  }
  return reconcileActivePhase(intermediate);
};

// =============================================================================
// applyAgentEvent — single SSE entry point. Drops on stale generation.
// =============================================================================

const applyAgentEventInner = (
  entry: SessionExecutionState,
  event: AgentEvent,
  now: () => string,
): SessionExecutionState => {
  switch (event.type) {
    case "token":
      return applyTokenEvent(entry, "sse:token", now);
    case "reasoning_token":
      return applyTokenEvent(entry, "sse:token", now);
    case "tool_start": {
      const toolCallId = event.tool_call_id ?? "";
      const toolName = event.tool_name ?? "";
      if (!toolCallId) {
        return entry;
      }
      return applyToolStart(entry, toolCallId, toolName, now());
    }
    case "tool_token": {
      const toolCallId = event.tool_call_id ?? "";
      if (!toolCallId) {
        return entry;
      }
      return applyToolToken(entry, toolCallId, event.content ?? "");
    }
    case "tool_complete":
    case "tool_error": {
      const toolCallId = event.tool_call_id ?? "";
      if (!toolCallId) {
        return entry;
      }
      return applyToolEnd(entry, toolCallId, "sse:tool_complete");
    }
    case "tool_lifecycle":
      return entry;
    case "sub_agent_started": {
      const childId = event.child_session_id ?? "";
      if (!childId) {
        return entry;
      }
      return applySubAgentStart(entry, childId, {
        title: event.title,
        status: "running",
      });
    }
    case "sub_agent_event":
    case "sub_agent_heartbeat": {
      const childId = event.child_session_id ?? "";
      if (!childId) {
        return entry;
      }
      const patch: Partial<ChildProgress> = {
        lastEventAt: event.timestamp ?? now(),
      };
      if (event.type === "sub_agent_heartbeat") {
        patch.lastHeartbeatAt = event.timestamp ?? now();
      }
      return applySubAgentUpdate(entry, childId, patch);
    }
    case "sub_agent_completed": {
      const childId = event.child_session_id ?? "";
      if (!childId) {
        return entry;
      }
      const status = typeof event.status === "string" ? event.status : "completed";
      return applySubAgentUpdate(entry, childId, {
        status,
        error: event.error,
      });
    }
    case "need_clarification": {
      const payload: PendingQuestionPayload = {
        question: event.question ?? "",
        options: event.options ?? [],
        allowCustom: event.allow_custom ?? false,
        toolCallId: event.tool_call_id ?? null,
      };
      return applyPendingQuestionSnapshot(entry, payload, now());
    }
    case "execution_started": {
      const runId = event.run_id;
      if (!runId) {
        return entry;
      }
      // A respond/resume race can deliver an early `complete` for the same client generation
      // before the backend acknowledges the resumed run. If execution_started arrives while the
      // entry is still in `starting` or has been prematurely pushed to `settling`, recover it
      // back to an active running phase for the current generation.
      if (entry.phase !== "starting" && entry.phase !== "settling") {
        return {
          ...entry,
          backendRunId: runId,
          confidence: "live",
          activeReasons: appendReason(entry.activeReasons, "sse:execution_started"),
        };
      }
      return {
        ...entry,
        phase: "running",
        confidence: "live",
        backendRunId: runId,
        timestamps: { ...entry.timestamps, confirmedAt: now() },
        activeReasons: appendReason(entry.activeReasons, "sse:execution_started"),
      };
    }
    case "complete": {
      const terminalAt = now();
      return {
        ...entry,
        phase: "settling",
        timestamps: {
          ...entry.timestamps,
          terminalAt,
          settlingStartedAt: entry.timestamps.settlingStartedAt ?? terminalAt,
        },
        activeReasons: appendReason(entry.activeReasons, "sse:complete"),
      };
    }
    case "cancelled": {
      const terminalAt = now();
      return {
        ...entry,
        phase: "cancelled",
        confidence: "terminal",
        timestamps: { ...entry.timestamps, terminalAt, settledAt: terminalAt },
        error: event.message
          ? {
              message: event.message,
              source: "user_cancel",
              occurredAt: terminalAt,
            }
          : null,
        activeReasons: appendReason(entry.activeReasons, "sse:error"),
      };
    }
    case "error": {
      const terminalAt = now();
      return {
        ...entry,
        phase: "error",
        confidence: "terminal",
        timestamps: { ...entry.timestamps, terminalAt },
        error: {
          message: event.message ?? event.error ?? "Unknown error",
          source: "sse",
          occurredAt: terminalAt,
        },
        activeReasons: appendReason(entry.activeReasons, "sse:error"),
      };
    }
    case "task_list_updated":
    case "task_list_item_progress":
    case "task_list_completed":
    case "task_evaluation_started":
    case "task_evaluation_completed":
    case "token_budget_updated":
    case "context_compression_status":
    case "context_summarized":
    case "context_pressure_notification":
      return entry;
    default:
      return entry;
  }
};

// =============================================================================
// applySessionSummary — reconciliation rules from the plan §B.4
// =============================================================================

const isBackendStatus = (s: string | undefined): s is "completed" | "error" | "cancelled" =>
  s === "completed" || s === "error" || s === "cancelled";

const applySummaryInner = (
  entry: SessionExecutionState,
  summary: SessionSummary,
  now: () => string,
): SessionExecutionState => {
  const lastRunStatusRaw = summary.last_run_status;
  const lastRunStatus = isBackendStatus(lastRunStatusRaw) ? lastRunStatusRaw : null;
  const syncedAt = now();
  const hasPendingQuestion =
    summary.has_pending_question === undefined ? null : summary.has_pending_question;
  const runningChildCount =
    summary.running_child_count === undefined ? null : summary.running_child_count;
  const merged: SessionExecutionState = {
    ...entry,
    backend: {
      ...entry.backend,
      isRunning: summary.is_running,
      lastRunStatus,
      lastRunError: summary.last_run_error ?? null,
      syncedAt,
      hasPendingQuestion,
      runningChildCount,
    },
    backendRunId: entry.backendRunId,
  };

  if (summary.is_running) {
    if (
      entry.phase === "idle" ||
      entry.phase === "completed" ||
      entry.phase === "error" ||
      entry.phase === "cancelled"
    ) {
      return {
        ...merged,
        phase: "running",
        confidence: "summary",
        activeReasons: appendReason(merged.activeReasons, "summary:is_running"),
      };
    }
    if (entry.phase === "starting") {
      return {
        ...merged,
        phase: "running",
        confidence: "summary",
        timestamps: { ...merged.timestamps, confirmedAt: syncedAt },
        activeReasons: appendReason(merged.activeReasons, "summary:is_running"),
      };
    }
    return merged;
  }

  debugRespondState("summary.notRunning.evaluate", {
    sessionId: summary.id,
    phase: entry.phase,
    generation: entry.generation,
    backendRunId: entry.backendRunId,
    summaryIsRunning: summary.is_running,
    lastRunStatus,
    optimisticAt: entry.timestamps.optimisticAt,
    syncedAt,
  });

  // is_running === false
  const inProgress: ReadonlySet<ExecutionPhase> = new Set([
    "starting",
    "running",
    "streaming",
    "running_tools",
    "running_children",
    "settling",
  ]);
  if (inProgress.has(entry.phase)) {
    if (lastRunStatus === "completed") {
      debugRespondState("summary.notRunning.transition", {
        sessionId: summary.id,
        fromPhase: entry.phase,
        toPhase: "completed",
        generation: entry.generation,
        backendRunId: entry.backendRunId,
        lastRunStatus,
      });
      return {
        ...merged,
        phase: "completed",
        confidence: "terminal",
        timestamps: { ...merged.timestamps, settledAt: syncedAt },
        activeReasons: appendReason(merged.activeReasons, "summary:terminal"),
      };
    }
    if (lastRunStatus === "error") {
      debugRespondState("summary.notRunning.transition", {
        sessionId: summary.id,
        fromPhase: entry.phase,
        toPhase: "error",
        generation: entry.generation,
        backendRunId: entry.backendRunId,
        lastRunStatus,
      });
      return {
        ...merged,
        phase: "error",
        confidence: "terminal",
        timestamps: { ...merged.timestamps, settledAt: syncedAt },
        error: {
          message: summary.last_run_error ?? "Backend reported error",
          source: "summary",
          occurredAt: syncedAt,
        },
        activeReasons: appendReason(merged.activeReasons, "summary:terminal"),
      };
    }
    if (lastRunStatus === "cancelled") {
      debugRespondState("summary.notRunning.transition", {
        sessionId: summary.id,
        fromPhase: entry.phase,
        toPhase: "cancelled",
        generation: entry.generation,
        backendRunId: entry.backendRunId,
        lastRunStatus,
      });
      return {
        ...merged,
        phase: "cancelled",
        confidence: "terminal",
        timestamps: { ...merged.timestamps, settledAt: syncedAt },
        activeReasons: appendReason(merged.activeReasons, "summary:terminal"),
      };
    }
    // last_run_status === null and is_running false. Apply optimistic race window.
    if (entry.timestamps.optimisticAt) {
      const ageMs = Date.parse(syncedAt) - Date.parse(entry.timestamps.optimisticAt);
      if (Number.isFinite(ageMs) && ageMs < OPTIMISTIC_RACE_WINDOW_MS) {
        debugRespondState("summary.notRunning.keepOptimistic", {
          sessionId: summary.id,
          phase: entry.phase,
          generation: entry.generation,
          backendRunId: entry.backendRunId,
          ageMs,
          windowMs: OPTIMISTIC_RACE_WINDOW_MS,
        });
        return merged;
      }
    }
    debugRespondState("summary.notRunning.transition", {
      sessionId: summary.id,
      fromPhase: entry.phase,
      toPhase: "idle",
      generation: entry.generation,
      backendRunId: entry.backendRunId,
      lastRunStatus,
    });
    return {
      ...merged,
      phase: "idle",
      confidence: "summary",
      activeReasons: appendReason(merged.activeReasons, "summary:terminal"),
    };
  }

  // waiting_user_answer / idle / completed / error / cancelled — leave phase alone.
  return merged;
};

// =============================================================================
// Pure reducer
// =============================================================================

const defaultNow = (): string => new Date().toISOString();

export const applyExecutionEvent = (
  map: ExecutionMap,
  action: ExecutionAction,
  now: () => string = defaultNow,
): ExecutionMap => {
  switch (action.type) {
    case "ensureSession": {
      if (action.sessionId in map) {
        return map;
      }
      return writeEntry(map, action.sessionId, createInitialExecutionState(action.sessionId));
    }
    case "markOptimisticStart": {
      const entry = ensureEntry(map, action.sessionId);
      const optimisticAt = now();
      const next: SessionExecutionState = {
        ...entry,
        phase: "starting",
        confidence: "optimistic",
        generation: entry.generation + 1,
        stream: {
          hasTokens: false,
          tokenCount: 0,
          activeToolCalls: [],
          lastStatusHint: null,
        },
        interaction: {
          ...entry.interaction,
          respondMode: null,
        },
        error: null,
        timestamps: {
          optimisticAt,
          confirmedAt: null,
          firstTokenAt: null,
          terminalAt: null,
          settlingStartedAt: null,
          settledAt: null,
        },
        activeReasons: appendReason(entry.activeReasons, "optimistic:send"),
      };
      return writeEntry(map, action.sessionId, next);
    }
    case "markRespondStart": {
      const entry = ensureEntry(map, action.sessionId);
      const optimisticAt = now();
      const next: SessionExecutionState = {
        ...entry,
        phase: "starting",
        confidence: "optimistic",
        generation: entry.generation + 1,
        stream: {
          hasTokens: false,
          tokenCount: 0,
          activeToolCalls: [],
          lastStatusHint: null,
        },
        interaction: {
          ...entry.interaction,
          pendingQuestion: null,
          respondMode: null,
        },
        error: null,
        timestamps: {
          ...entry.timestamps,
          optimisticAt,
          confirmedAt: null,
          firstTokenAt: null,
          terminalAt: null,
          settlingStartedAt: null,
          settledAt: null,
        },
        activeReasons: appendReason(entry.activeReasons, "optimistic:respond"),
      };
      return writeEntry(map, action.sessionId, next);
    }
    case "markRetryStart": {
      const entry = ensureEntry(map, action.sessionId);
      const optimisticAt = now();
      const next: SessionExecutionState = {
        ...entry,
        phase: "starting",
        confidence: "optimistic",
        generation: entry.generation + 1,
        stream: {
          hasTokens: false,
          tokenCount: 0,
          activeToolCalls: [],
          lastStatusHint: null,
        },
        error: null,
        timestamps: {
          ...entry.timestamps,
          optimisticAt,
          confirmedAt: null,
          firstTokenAt: null,
          terminalAt: null,
          settlingStartedAt: null,
          settledAt: null,
        },
        activeReasons: appendReason(entry.activeReasons, "optimistic:retry"),
      };
      return writeEntry(map, action.sessionId, next);
    }
    case "markForceSubscribe": {
      const entry = ensureEntry(map, action.sessionId);
      // Only force into running if not already busy.
      if (isBusyPhase(entry.phase)) {
        return map;
      }
      const next: SessionExecutionState = {
        ...entry,
        phase: "running",
        confidence: "optimistic",
        generation: entry.generation + 1,
        error: null,
        activeReasons: appendReason(entry.activeReasons, "optimistic:openSession.forceSubscribe"),
      };
      return writeEntry(map, action.sessionId, next);
    }
    case "markCancel": {
      const entry = ensureEntry(map, action.sessionId);
      const settledAt = now();
      const next: SessionExecutionState = {
        ...entry,
        phase: "cancelled",
        confidence: "terminal",
        timestamps: { ...entry.timestamps, settledAt },
        activeReasons: appendReason(entry.activeReasons, "user:cancel"),
      };
      return writeEntry(map, action.sessionId, next);
    }
    case "markSettleTimeout": {
      const entry = ensureEntry(map, action.sessionId);
      if (entry.phase !== "starting" && entry.phase !== "settling") {
        return map;
      }
      const next: SessionExecutionState = {
        ...entry,
        phase: "idle",
        confidence: "optimistic",
        timestamps: { ...entry.timestamps, settledAt: now() },
        activeReasons: appendReason(entry.activeReasons, "settle:timeout"),
      };
      return writeEntry(map, action.sessionId, next);
    }
    case "markStreamStarted": {
      const entry = ensureEntry(map, action.sessionId);
      if (action.generation !== entry.generation) {
        return map;
      }
      const next = applyStreamStarted(entry, now);
      if (next === entry) {
        return map;
      }
      return writeEntry(map, action.sessionId, next);
    }
    case "applyAgentEvent": {
      const entry = ensureEntry(map, action.sessionId);
      if (action.generation !== entry.generation) {
        debugRespondState("drop.applyAgentEvent.generationMismatch", {
          sessionId: action.sessionId,
          actionGeneration: action.generation,
          entryGeneration: entry.generation,
          eventType: action.event.type,
          phase: entry.phase,
          backendRunId: entry.backendRunId ?? null,
        });
        return map;
      }
      const next = applyAgentEventInner(entry, action.event, now);
      if (next === entry) {
        return map;
      }
      return writeEntry(map, action.sessionId, next);
    }
    case "applyExecutionStarted": {
      const entry = ensureEntry(map, action.sessionId);
      if (action.generation !== entry.generation) {
        debugRespondState("drop.applyExecutionStarted.generationMismatch", {
          sessionId: action.sessionId,
          actionGeneration: action.generation,
          entryGeneration: entry.generation,
          runId: action.runId,
          phase: entry.phase,
          backendRunId: entry.backendRunId ?? null,
        });
        return map;
      }
      if (entry.phase !== "starting" && entry.phase !== "settling") {
        return writeEntry(map, action.sessionId, {
          ...entry,
          backendRunId: action.runId,
          confidence: "live",
          activeReasons: appendReason(entry.activeReasons, "sse:execution_started"),
        });
      }
      const next: SessionExecutionState = {
        ...entry,
        phase: "running",
        confidence: "live",
        backendRunId: action.runId,
        timestamps: { ...entry.timestamps, confirmedAt: now() },
        activeReasons: appendReason(entry.activeReasons, "sse:execution_started"),
      };
      return writeEntry(map, action.sessionId, next);
    }
    case "applySessionSummary": {
      const entry = ensureEntry(map, action.sessionId);
      const next = applySummaryInner(entry, action.summary, now);
      if (next === entry) {
        return map;
      }
      return writeEntry(map, action.sessionId, next);
    }
    case "applyOneShotTerminal": {
      const entry = ensureEntry(map, action.sessionId);
      if (action.generation !== entry.generation) {
        return map;
      }
      if (entry.phase !== "idle" && entry.phase !== "starting") {
        return map;
      }
      const terminalAt = now();
      if (action.payload.status === "completed") {
        return writeEntry(map, action.sessionId, {
          ...entry,
          phase: "completed",
          confidence: "terminal",
          timestamps: { ...entry.timestamps, terminalAt, settledAt: terminalAt },
          activeReasons: appendReason(entry.activeReasons, "sse:terminal_one_shot"),
        });
      }
      if (action.payload.status === "cancelled") {
        return writeEntry(map, action.sessionId, {
          ...entry,
          phase: "cancelled",
          confidence: "terminal",
          timestamps: { ...entry.timestamps, terminalAt, settledAt: terminalAt },
          error: action.payload.message
            ? {
                message: action.payload.message,
                source: "user_cancel",
                occurredAt: terminalAt,
              }
            : null,
          activeReasons: appendReason(entry.activeReasons, "sse:terminal_one_shot"),
        });
      }
      return writeEntry(map, action.sessionId, {
        ...entry,
        phase: "error",
        confidence: "terminal",
        timestamps: { ...entry.timestamps, terminalAt, settledAt: terminalAt },
        error: {
          message: action.payload.message ?? "Unknown error",
          source: "sse",
          occurredAt: terminalAt,
        },
        activeReasons: appendReason(entry.activeReasons, "sse:terminal_one_shot"),
      });
    }
    case "beginSettle": {
      const entry = ensureEntry(map, action.sessionId);
      if (action.generation !== entry.generation) {
        return map;
      }
      if (
        entry.phase !== "running" &&
        entry.phase !== "streaming" &&
        entry.phase !== "running_tools" &&
        entry.phase !== "running_children"
      ) {
        return map;
      }
      const settlingStartedAt = now();
      return writeEntry(map, action.sessionId, {
        ...entry,
        phase: "settling",
        timestamps: {
          ...entry.timestamps,
          settlingStartedAt,
          terminalAt: entry.timestamps.terminalAt ?? settlingStartedAt,
        },
      });
    }
    case "applyChildProgress": {
      const entry = ensureEntry(map, action.sessionId);
      const isFirstSeen = !(action.childId in entry.children.byId);
      const next = isFirstSeen
        ? applySubAgentStart(entry, action.childId, action.patch)
        : applySubAgentUpdate(entry, action.childId, action.patch);
      if (next === entry) {
        return map;
      }
      return writeEntry(map, action.sessionId, next);
    }
    case "clearChildProgress": {
      const entry = ensureEntry(map, action.sessionId);
      const next = applyClearChild(entry, action.childId);
      if (next === entry) {
        return map;
      }
      return writeEntry(map, action.sessionId, next);
    }
    case "setPendingQuestion": {
      const entry = ensureEntry(map, action.sessionId);
      const next = applyPendingQuestionSnapshot(entry, action.payload, now());
      if (next === entry) {
        return map;
      }
      return writeEntry(map, action.sessionId, next);
    }
    case "clearPendingQuestion": {
      const entry = ensureEntry(map, action.sessionId);
      if (entry.interaction.pendingQuestion === null && entry.interaction.respondMode === null) {
        return map;
      }
      const next: SessionExecutionState = {
        ...entry,
        interaction: {
          ...entry.interaction,
          pendingQuestion: null,
          respondMode: null,
        },
      };
      return writeEntry(map, action.sessionId, next);
    }
    case "resetSession": {
      return removeEntry(map, action.sessionId);
    }
    case "applyRunningSnapshot": {
      let nextMap = map;
      for (const snap of action.sessions) {
        const entry = ensureEntry(nextMap, snap.sessionId);
        // Bump generation so replayed events match.
        const newGeneration = entry.generation + 1;
        let updated: SessionExecutionState = {
          ...entry,
          generation: newGeneration,
          backendRunId: snap.runId,
          phase: "running",
          confidence: "live",
          timestamps: {
            ...entry.timestamps,
            confirmedAt: now(),
          },
          activeReasons: appendReason(entry.activeReasons, "sse:execution_started"),
        };

        // Replay critical events (skip ExecutionStarted to avoid double-processing).
        for (const event of snap.criticalEvents) {
          if (event.type === "execution_started") continue;
          updated = applyAgentEventInner(updated, event, now);
        }

        nextMap = writeEntry(nextMap, snap.sessionId, updated);
      }
      return nextMap;
    }
    default: {
      return map;
    }
  }
};

// =============================================================================
// Zustand slice creator + projection helpers
// =============================================================================

export interface ExecutionStateSlice {
  executionBySession: ExecutionMap;
  ensureSession: (sessionId: string) => void;
  markOptimisticStart: (sessionId: string) => number; // Returns new generation
  markRespondStart: (sessionId: string, toolCallId?: string | null) => number; // Returns new generation
  markRetryStart: (sessionId: string) => number; // Returns new generation
  markForceSubscribe: (sessionId: string) => void;
  markCancel: (sessionId: string) => void;
  markSettleTimeout: (sessionId: string) => void;
  markStreamStarted: (sessionId: string, generation: number) => void;
  applyAgentEvent: (sessionId: string, event: AgentEvent, generation: number) => void;
  applyExecutionStarted: (sessionId: string, runId: string, generation: number) => void;
  applySessionSummary: (sessionId: string, summary: SessionSummary) => void;
  applyOneShotTerminal: (
    sessionId: string,
    generation: number,
    payload: OneShotTerminalPayload,
  ) => void;
  beginSettle: (sessionId: string, generation: number) => void;
  applyChildProgress: (sessionId: string, childId: string, patch: Partial<ChildProgress>) => void;
  clearChildProgress: (sessionId: string, childId: string) => void;
  setPendingQuestion: (sessionId: string, payload: PendingQuestionPayload) => void;
  clearPendingQuestion: (sessionId: string) => void;
  resetSession: (sessionId: string) => void;
  applyRunningSnapshot: (
    sessions: Array<{
      sessionId: string;
      runId: string;
      criticalEvents: AgentEvent[];
    }>,
  ) => void;
}

const sliceNow = (): string => new Date().toISOString();

export const createExecutionStateSlice: StateCreator<AppState, [], [], ExecutionStateSlice> = (
  set,
  get,
) => ({
  executionBySession: {},

  ensureSession: (sessionId) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "ensureSession", sessionId },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  markOptimisticStart: (sessionId) => {
    let newGeneration = 0;
    set((state) => {
      const entry = state.executionBySession[sessionId];
      const nextGeneration = entry ? entry.generation + 1 : 1;
      newGeneration = nextGeneration;
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "markOptimisticStart", sessionId },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
    return newGeneration;
  },

  markRespondStart: (sessionId, toolCallId) => {
    let newGeneration = 0;
    set((state) => {
      const entry = state.executionBySession[sessionId];
      const nextGeneration = entry ? entry.generation + 1 : 1;
      newGeneration = nextGeneration;
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "markRespondStart", sessionId, toolCallId },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
    return newGeneration;
  },

  markRetryStart: (sessionId) => {
    let newGeneration = 0;
    set((state) => {
      const entry = state.executionBySession[sessionId];
      const nextGeneration = entry ? entry.generation + 1 : 1;
      newGeneration = nextGeneration;
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "markRetryStart", sessionId },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
    return newGeneration;
  },

  markForceSubscribe: (sessionId) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "markForceSubscribe", sessionId },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  markCancel: (sessionId) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "markCancel", sessionId },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  markSettleTimeout: (sessionId) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "markSettleTimeout", sessionId },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  markStreamStarted: (sessionId, generation) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "markStreamStarted", sessionId, generation },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  applyAgentEvent: (sessionId, event, generation) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "applyAgentEvent", sessionId, event, generation },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  applyExecutionStarted: (sessionId, runId, generation) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "applyExecutionStarted", sessionId, runId, generation },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  applySessionSummary: (sessionId, summary) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "applySessionSummary", sessionId, summary },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  applyOneShotTerminal: (sessionId, generation, payload) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "applyOneShotTerminal", sessionId, generation, payload },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  beginSettle: (sessionId, generation) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "beginSettle", sessionId, generation },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  applyChildProgress: (sessionId, childId, patch) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "applyChildProgress", sessionId, childId, patch },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  clearChildProgress: (sessionId, childId) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "clearChildProgress", sessionId, childId },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  setPendingQuestion: (sessionId, payload) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "setPendingQuestion", sessionId, payload },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  clearPendingQuestion: (sessionId) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "clearPendingQuestion", sessionId },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  resetSession: (sessionId) => {
    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "resetSession", sessionId },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },

  applyRunningSnapshot: (sessions) => {
    // Partition replayable metadata events from execution events before
    // reducing. Metadata events (title/pinned) flow through the unified
    // `applyReplayableSessionEvent` entry so live SSE and snapshot replay
    // share the same precedence rules — `applyAgentEventInner` only ever
    // sees execution-domain events.
    const target = get();
    const partitioned = sessions.map((session) => {
      const executionOnly: AgentEvent[] = [];
      for (const event of session.criticalEvents) {
        if (isSessionMetadataEvent(event)) {
          applyReplayableSessionEvent(event, target);
          continue;
        }
        executionOnly.push(event);
      }
      return { ...session, criticalEvents: executionOnly };
    });

    set((state) => {
      const next = applyExecutionEvent(
        state.executionBySession,
        { type: "applyRunningSnapshot", sessions: partitioned },
        sliceNow,
      );
      if (next === state.executionBySession) return state;
      return { executionBySession: next };
    });
  },
});
