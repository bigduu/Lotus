import {
  ActiveToolCall,
  ChildProgress,
  ExecutionMap,
  ExecutionPhase,
  PendingQuestionPayload,
  SessionChildrenSnapshot,
  SessionExecutionState,
  isBusyPhase,
  isInputLockedPhase,
  isCancellablePhase,
} from "../slices/executionStateSlice";

// =============================================================================
// Selectors operating on the executionBySession map.
// All selectors are wired into production UI.
// =============================================================================

/**
 * Minimal structural shape of `state` — selectors only need
 * `executionBySession`.
 */
export interface ExecutionStateView {
  executionBySession: ExecutionMap;
  chats?: ReadonlyArray<{ id: string; isRunning?: boolean }>;
}

const NO_CHILDREN: SessionChildrenSnapshot = { byId: {}, runningCount: 0 };
const NO_TOOL_CALLS: ReadonlyArray<ActiveToolCall> = [];

const getEntry = (
  state: ExecutionStateView,
  sessionId: string | null,
): SessionExecutionState | null => {
  if (!sessionId) {
    return null;
  }
  return state.executionBySession[sessionId] ?? null;
};

export const selectExecutionState =
  (sessionId: string | null) =>
  (state: ExecutionStateView): SessionExecutionState | null =>
    getEntry(state, sessionId);

export const selectExecutionPhase =
  (sessionId: string | null) =>
  (state: ExecutionStateView): ExecutionPhase => {
    const entry = getEntry(state, sessionId);
    return entry?.phase ?? "idle";
  };

export const selectIsBusy =
  (sessionId: string | null) =>
  (state: ExecutionStateView): boolean => {
    const entry = getEntry(state, sessionId);
    return isBusyPhase(entry?.phase);
  };

export const selectIsStreaming =
  (sessionId: string | null) =>
  (state: ExecutionStateView): boolean => {
    const entry = getEntry(state, sessionId);
    if (!entry) {
      return false;
    }
    if (entry.phase === "streaming") {
      return true;
    }
    return entry.phase === "running_tools" && entry.stream.hasTokens;
  };

export const selectIsAwaitingUser =
  (sessionId: string | null) =>
  (state: ExecutionStateView): boolean => {
    const entry = getEntry(state, sessionId);
    if (!entry) {
      return false;
    }
    if (entry.phase === "waiting_user_answer") {
      return true;
    }
    if (entry.interaction.pendingQuestion !== null) {
      return true;
    }
    // Also consider the backend summary flag (used when SSE has not yet delivered
    // the pending question but the summary already knows about it).
    if (entry.backend.hasPendingQuestion === true) {
      return true;
    }
    return false;
  };

export const selectIsInputLocked =
  (sessionId: string | null) =>
  (state: ExecutionStateView): boolean => {
    const entry = getEntry(state, sessionId);
    return isInputLockedPhase(entry?.phase);
  };

export const selectCanCancel =
  (sessionId: string | null) =>
  (state: ExecutionStateView): boolean => {
    const entry = getEntry(state, sessionId);
    return isCancellablePhase(entry?.phase);
  };

/**
 * True when the session still needs a live SSE subscription.
 *
 * This is intentionally narrower than `selectIsBusy()`: `waiting_user_answer`
 * is a blocked/awaiting-input phase, not an actively executing phase, so we
 * should preserve the busy rail semantics without continuously reconnecting SSE.
 */
export const selectShouldObserve =
  (sessionId: string | null) =>
  (state: ExecutionStateView): boolean => {
    const entry = getEntry(state, sessionId);
    if (!isBusyPhase(entry?.phase)) {
      return false;
    }
    return entry?.phase !== "waiting_user_answer";
  };

export const selectActiveToolCalls =
  (sessionId: string | null) =>
  (state: ExecutionStateView): ReadonlyArray<ActiveToolCall> => {
    const entry = getEntry(state, sessionId);
    return entry?.stream.activeToolCalls ?? NO_TOOL_CALLS;
  };

export const selectPendingQuestion =
  (sessionId: string | null) =>
  (state: ExecutionStateView): SessionExecutionState["interaction"]["pendingQuestion"] => {
    const entry = getEntry(state, sessionId);
    return entry?.interaction.pendingQuestion ?? null;
  };

export const selectPendingChildApproval =
  (sessionId: string | null) =>
  (state: ExecutionStateView): SessionExecutionState["interaction"]["pendingChildApproval"] => {
    const entry = getEntry(state, sessionId);
    return entry?.interaction.pendingChildApproval ?? null;
  };

export const selectRespondMode =
  (sessionId: string | null) =>
  (state: ExecutionStateView): (PendingQuestionPayload & { sessionId: string }) | null => {
    if (!sessionId) {
      return null;
    }
    const pendingQuestion = selectPendingQuestion(sessionId)(state);
    if (!pendingQuestion) {
      return null;
    }
    return {
      sessionId,
      question: pendingQuestion.question,
      options: pendingQuestion.options,
      allowCustom: pendingQuestion.allowCustom,
      toolCallId: pendingQuestion.toolCallId,
    };
  };

export const selectChildren =
  (sessionId: string | null) =>
  (state: ExecutionStateView): Record<string, ChildProgress> => {
    const entry = getEntry(state, sessionId);
    return entry?.children.byId ?? NO_CHILDREN.byId;
  };

export const selectChildrenSnapshot =
  (sessionId: string | null) =>
  (state: ExecutionStateView): SessionChildrenSnapshot => {
    const entry = getEntry(state, sessionId);
    return entry?.children ?? NO_CHILDREN;
  };

export const selectGeneration =
  (sessionId: string | null) =>
  (state: ExecutionStateView): number => {
    const entry = getEntry(state, sessionId);
    return entry?.generation ?? 0;
  };

// =============================================================================
// Aggregated rail model — replaces ExecutionStatusRail's `deriveExecutionState`
// =============================================================================

export type RailLabelKey =
  | "idle"
  | "starting"
  | "running"
  | "streaming"
  | "running_tools"
  | "running_children"
  | "waiting_user_answer"
  | "settling"
  | "completed"
  | "error"
  | "cancelled";

export interface RailModel {
  state: RailLabelKey;
  activeToolCalls: ReadonlyArray<ActiveToolCall>;
  runningChildCount: number;
  hasQuestion: boolean;
  hasError: boolean;
  errorMessage: string | null;
  generation: number;
}

const IDLE_RAIL: RailModel = Object.freeze({
  state: "idle",
  activeToolCalls: [],
  runningChildCount: 0,
  hasQuestion: false,
  hasError: false,
  errorMessage: null,
  generation: 0,
});

export const selectRailModel =
  (sessionId: string | null) =>
  (state: ExecutionStateView): RailModel => {
    const entry = getEntry(state, sessionId);
    if (!entry) {
      return IDLE_RAIL;
    }
    return {
      state: entry.phase,
      activeToolCalls: entry.stream.activeToolCalls,
      runningChildCount: entry.children.runningCount,
      hasQuestion: entry.interaction.pendingQuestion !== null,
      hasError: entry.error !== null,
      errorMessage: entry.error?.message ?? null,
      generation: entry.generation,
    };
  };

// =============================================================================
// Pane-workspace convenience
// =============================================================================

export interface PaneExecutionView {
  sessionId: string;
  entry: SessionExecutionState | null;
}

export const selectExecutionByPane =
  (paneSessionIds: ReadonlyArray<string | null>) =>
  (state: ExecutionStateView): PaneExecutionView[] =>
    paneSessionIds.map((sessionId) => ({
      sessionId: sessionId ?? "",
      entry: getEntry(state, sessionId),
    }));
