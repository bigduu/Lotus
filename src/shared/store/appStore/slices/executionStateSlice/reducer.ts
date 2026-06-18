import { AgentEvent, SessionSummary } from "@services/chat/AgentService";
import {
  MAX_REASONS_KEPT,
  OPTIMISTIC_RACE_WINDOW_MS,
  TOOL_PREVIEW_MAX_CHARS,
  type ActiveToolCall,
  type ChildProgress,
  type ExecutionAction,
  type ExecutionMap,
  type ExecutionPhase,
  type ExecutionReason,
  type PendingChildApprovalPayload,
  type PendingQuestionPayload,
  type SessionExecutionState,
} from "./types";

const debugRespondState = (event: string, payload: Record<string, unknown>): void => {
  if (!import.meta.env.DEV) return;
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem("lotus_debug_respond") !== "1") return;
  console.warn(`[ExecutionState] ${event}`, payload);
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
    pendingChildApproval: null,
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

const pendingChildApprovalEquals = (
  current: (PendingChildApprovalPayload & { receivedAt: string }) | null,
  payload: PendingChildApprovalPayload,
): boolean => {
  if (!current) {
    return false;
  }
  return (
    current.childSessionId === payload.childSessionId &&
    current.requestId === payload.requestId &&
    current.toolName === payload.toolName &&
    current.permission === payload.permission &&
    current.resource === payload.resource
  );
};

/**
 * Surface a blocked child sub-agent's approval request. Unlike a pending
 * question, this does NOT change the parent session's execution phase — the
 * parent keeps running while the child waits; the prompt is purely an
 * out-of-band approve/deny affordance.
 */
const applyPendingChildApprovalSnapshot = (
  entry: SessionExecutionState,
  payload: PendingChildApprovalPayload,
  receivedAt: string,
): SessionExecutionState => {
  if (pendingChildApprovalEquals(entry.interaction.pendingChildApproval, payload)) {
    return entry;
  }
  return {
    ...entry,
    interaction: {
      ...entry.interaction,
      pendingChildApproval: { ...payload, receivedAt },
    },
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
      // Only an actively-observed run can transition to `settling` on `complete`.
      // A one-shot terminal `Complete` can be delivered to a subscription that
      // raced ahead of the real run (e.g. the optimistic subscription opened for a
      // `/goal` control command before any runner exists). Without this guard such
      // a stray `complete` would resurrect an already-settled session
      // (idle/completed/error/cancelled) back into `settling`, marking it busy and
      // triggering an endless resubscribe loop. `waiting_user_answer` is likewise
      // preserved — a clarification stream's close is not a true completion.
      if (ABSORBING_FOR_RECONCILE.has(entry.phase)) {
        return entry;
      }
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
    case "setPendingChildApproval": {
      const entry = ensureEntry(map, action.sessionId);
      const next = applyPendingChildApprovalSnapshot(entry, action.payload, now());
      if (next === entry) {
        return map;
      }
      return writeEntry(map, action.sessionId, next);
    }
    case "clearPendingChildApproval": {
      const entry = ensureEntry(map, action.sessionId);
      if (entry.interaction.pendingChildApproval === null) {
        return map;
      }
      const next: SessionExecutionState = {
        ...entry,
        interaction: {
          ...entry.interaction,
          pendingChildApproval: null,
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
