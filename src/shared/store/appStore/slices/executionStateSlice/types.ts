import { AgentEvent, SessionSummary } from "@services/chat/AgentService";

// =============================================================================
// Execution-state model — owned by createExecutionStateSlice.
// Replaces the legacy processingChats Set.
// =============================================================================

export const OPTIMISTIC_RACE_WINDOW_MS = 5_000;
export const STALE_OPTIMISTIC_TIMEOUT_MS = 30_000;
export const TOOL_PREVIEW_MAX_CHARS = 80;
export const MAX_REASONS_KEPT = 16;
/**
 * Bound on `resolvedChildApprovalRequestIds` (see below). The backend's
 * `runs/active` critical-events window is itself bounded, so we only need to
 * remember "recently resolved" requestIds long enough to outlast a replay of
 * that window — this cap just stops unbounded growth over a long session.
 */
export const MAX_RESOLVED_CHILD_APPROVALS_KEPT = 32;

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

/**
 * An out-of-process child sub-agent that hit a gated tool and is blocked
 * awaiting a human approve/deny decision (surfaced via the
 * `child_approval_requested` SSE event on the parent's stream).
 */
export interface PendingChildApprovalPayload {
  childSessionId: string;
  requestId: string;
  toolName: string | null;
  permission: string | null;
  resource: string | null;
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
  /**
   * FIFO queue of blocked child sub-agent approval requests for this parent
   * session, oldest (head) first. Concurrent sub-agent fan-out can produce
   * more than one outstanding gated action at once — each gets its own entry
   * here instead of overwriting a single slot (#25, was TODO #23).
   * `selectPendingChildApproval` surfaces only the head; answering/clearing
   * it pops that entry and the next (if any) surfaces automatically.
   */
  pendingChildApprovals: Array<
    PendingChildApprovalPayload & {
      receivedAt: string;
    }
  >;
  /**
   * Bounded FIFO of `requestId`s that have already been resolved — answered
   * by the user (`dequeuePendingChildApproval`) or lifecycle-cleared because
   * their child finished on its own (`clearPendingChildApprovalsForChild`).
   * The backend's `runs/active` snapshot can still include an already
   * resolved request in `last_critical_events` for a while; this tombstone
   * set stops a resync/reconcile replay (`applyRunningSnapshot`) from
   * resurrecting a dismissed prompt. Bounded via
   * `MAX_RESOLVED_CHILD_APPROVALS_KEPT`.
   */
  resolvedChildApprovalRequestIds: string[];
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
  | {
      type: "enqueuePendingChildApproval";
      sessionId: string;
      payload: PendingChildApprovalPayload;
    }
  | { type: "dequeuePendingChildApproval"; sessionId: string; requestId: string }
  | { type: "clearPendingChildApprovalsForChild"; sessionId: string; childSessionId: string }
  | { type: "reconcilePendingChildApprovals"; sessionId: string; events: AgentEvent[] }
  | { type: "resetSession"; sessionId: string }
  | {
      type: "applyRunningSnapshot";
      sessions: Array<{
        sessionId: string;
        runId: string;
        criticalEvents: AgentEvent[];
      }>;
    };

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
  enqueuePendingChildApproval: (sessionId: string, payload: PendingChildApprovalPayload) => void;
  dequeuePendingChildApproval: (sessionId: string, requestId: string) => void;
  clearPendingChildApprovalsForChild: (sessionId: string, childSessionId: string) => void;
  /**
   * Rebuild the pending-child-approval queue from an authoritative event log
   * (the backend's `last_critical_events`), WITHOUT touching phase/generation/
   * confidence/backendRunId. Unlike `applyRunningSnapshot`, this is safe to
   * call on an already-open, actively-streaming session (e.g. from the #91
   * gap-control reconcile) — it does not bump `generation`, so it can't
   * desync a live SSE subscription's stale-event guard.
   */
  reconcilePendingChildApprovals: (sessionId: string, events: AgentEvent[]) => void;
  resetSession: (sessionId: string) => void;
  applyRunningSnapshot: (
    sessions: Array<{
      sessionId: string;
      runId: string;
      criticalEvents: AgentEvent[];
    }>,
  ) => void;
}
