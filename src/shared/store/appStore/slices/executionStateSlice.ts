import { StateCreator } from "zustand";
import type { AppState } from "../";
import { applyReplayableSessionEvent, isSessionMetadataEvent } from "./sessionMetadataSlice";
import { AgentEvent } from "@services/chat/AgentService";
import { applyExecutionEvent } from "./executionStateSlice/reducer";
import type { ExecutionAction, ExecutionStateSlice } from "./executionStateSlice/types";

// Re-export the execution-state model + pure reducer so existing import paths
// (`@shared/store/appStore/slices/executionStateSlice`) continue to resolve.
export {
  OPTIMISTIC_RACE_WINDOW_MS,
  STALE_OPTIMISTIC_TIMEOUT_MS,
  TOOL_PREVIEW_MAX_CHARS,
  MAX_REASONS_KEPT,
} from "./executionStateSlice/types";
export type {
  ExecutionPhase,
  ExecutionReason,
  Confidence,
  ActiveToolCall,
  SessionStreamSnapshot,
  SessionBackendSnapshot,
  PendingQuestionPayload,
  PendingChildApprovalPayload,
  SessionInteractionSnapshot,
  ChildProgress,
  SessionChildrenSnapshot,
  SessionExecutionTimestamps,
  SessionExecutionError,
  SessionExecutionState,
  ExecutionMap,
  OneShotTerminalPayload,
  ExecutionAction,
  ExecutionStateSlice,
} from "./executionStateSlice/types";
export {
  isBusyPhase,
  isInputLockedPhase,
  isCancellablePhase,
  createInitialExecutionState,
  applyExecutionEvent,
} from "./executionStateSlice/reducer";

// =============================================================================
// Zustand slice creator + projection helpers
// =============================================================================

const sliceNow = (): string => new Date().toISOString();

type ExecutionSet = Parameters<StateCreator<AppState, [], [], ExecutionStateSlice>>[0];

/**
 * Run one ExecutionAction through the pure reducer and commit the result,
 * skipping the state update when the reducer returns the same map (no-op).
 */
const runExecutionAction = (set: ExecutionSet, action: ExecutionAction): void => {
  set((state) => {
    const next = applyExecutionEvent(state.executionBySession, action, sliceNow);
    if (next === state.executionBySession) return state;
    return { executionBySession: next };
  });
};

export const createExecutionStateSlice: StateCreator<AppState, [], [], ExecutionStateSlice> = (
  set,
  get,
) => ({
  executionBySession: {},

  ensureSession: (sessionId) => runExecutionAction(set, { type: "ensureSession", sessionId }),

  markOptimisticStart: (sessionId) => {
    const entry = get().executionBySession[sessionId];
    const newGeneration = entry ? entry.generation + 1 : 1;
    runExecutionAction(set, { type: "markOptimisticStart", sessionId });
    return newGeneration;
  },

  markRespondStart: (sessionId, toolCallId) => {
    const entry = get().executionBySession[sessionId];
    const newGeneration = entry ? entry.generation + 1 : 1;
    runExecutionAction(set, { type: "markRespondStart", sessionId, toolCallId });
    return newGeneration;
  },

  markRetryStart: (sessionId) => {
    const entry = get().executionBySession[sessionId];
    const newGeneration = entry ? entry.generation + 1 : 1;
    runExecutionAction(set, { type: "markRetryStart", sessionId });
    return newGeneration;
  },

  markForceSubscribe: (sessionId) =>
    runExecutionAction(set, { type: "markForceSubscribe", sessionId }),

  markCancel: (sessionId) => runExecutionAction(set, { type: "markCancel", sessionId }),

  markSettleTimeout: (sessionId) =>
    runExecutionAction(set, { type: "markSettleTimeout", sessionId }),

  markStreamStarted: (sessionId, generation) =>
    runExecutionAction(set, { type: "markStreamStarted", sessionId, generation }),

  applyAgentEvent: (sessionId, event, generation) =>
    runExecutionAction(set, { type: "applyAgentEvent", sessionId, event, generation }),

  applyExecutionStarted: (sessionId, runId, generation) =>
    runExecutionAction(set, { type: "applyExecutionStarted", sessionId, runId, generation }),

  applySessionSummary: (sessionId, summary) =>
    runExecutionAction(set, { type: "applySessionSummary", sessionId, summary }),

  applyOneShotTerminal: (sessionId, generation, payload) =>
    runExecutionAction(set, { type: "applyOneShotTerminal", sessionId, generation, payload }),

  beginSettle: (sessionId, generation) =>
    runExecutionAction(set, { type: "beginSettle", sessionId, generation }),

  applyChildProgress: (sessionId, childId, patch) =>
    runExecutionAction(set, { type: "applyChildProgress", sessionId, childId, patch }),

  clearChildProgress: (sessionId, childId) =>
    runExecutionAction(set, { type: "clearChildProgress", sessionId, childId }),

  setPendingQuestion: (sessionId, payload) =>
    runExecutionAction(set, { type: "setPendingQuestion", sessionId, payload }),

  clearPendingQuestion: (sessionId) =>
    runExecutionAction(set, { type: "clearPendingQuestion", sessionId }),

  setPendingChildApproval: (sessionId, payload) =>
    runExecutionAction(set, { type: "setPendingChildApproval", sessionId, payload }),

  clearPendingChildApproval: (sessionId) =>
    runExecutionAction(set, { type: "clearPendingChildApproval", sessionId }),

  resetSession: (sessionId) => runExecutionAction(set, { type: "resetSession", sessionId }),

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

    runExecutionAction(set, { type: "applyRunningSnapshot", sessions: partitioned });
  },
});
