import { AgentClient, AgentEvent, TaskListDelta } from "@services/chat/AgentService";
import { useAppStore, selectChildren } from "@shared/store/appStore";

export type SubscriptionEntry = {
  sessionId: string;
  controller: AbortController;
  /**
   * Client-local generation — the PRIMARY convergence key for this session's
   * SSE stream.  All stale-event drops, subscription deduplication, and
   * generation-gated state transitions use this value.
   *
   * backendRunId (from execution_started) is purely OBSERVATIONAL — useful for
   * diagnostics and cross-referencing backend logs, but NEVER used for frontend
   * convergence decisions because not every root/resume path exposes a reliable
   * run identity from the backend.
   */
  generation: number;
  /**
   * True once the underlying SSE reader has ended/resolved, even if async
   * completion cleanup is still in-flight. This lets a newer execution for the
   * same session replace the stale entry immediately instead of waiting for the
   * old cleanup path to finish.
   */
  streamEnded: boolean;
};

// === DEV-ONLY SSE DIAGNOSTICS ===
// Enable with: localStorage.setItem('lotus_debug_sse', '1')

export function debugSse(...args: unknown[]): void {
  if (!import.meta.env.DEV) return;
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem("lotus_debug_sse") !== "1") return;
  console.warn("[SSE]", ...args);
}

export const isAbortError = (err: unknown) => {
  const e = err as { name?: string; code?: number };
  return e?.name === "AbortError" || e?.code === 20;
};

const MAX_TASK_EVALUATION_REASONING_CHARS = 220;

export const compactEvaluationReasoning = (reasoning: string): string => {
  const normalized = reasoning.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TASK_EVALUATION_REASONING_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TASK_EVALUATION_REASONING_CHARS)}...`;
};

export const isTaskItemStatus = (status: AgentEvent["status"]): status is TaskListDelta["status"] =>
  status === "pending" ||
  status === "in_progress" ||
  status === "completed" ||
  status === "blocked";

const TERMINAL_CHILD_STATUS = new Set(["completed", "error", "cancelled", "failed"]);
export const CHILD_HEARTBEAT_MIN_INTERVAL_MS = 1_500;
export const CHILD_PREVIEW_FLUSH_INTERVAL_MS = 120;
export const CHILD_PREVIEW_MAX_CHARS = 8_000;

export const getChildStatus = (
  parentSessionId: string,
  childSessionId: string,
): string | undefined => {
  return selectChildren(parentSessionId)(useAppStore.getState())?.[childSessionId]?.status;
};

export const isTerminalChildStatus = (status?: string): boolean => {
  if (!status) return false;
  return TERMINAL_CHILD_STATUS.has(status);
};

export const buildTaskListCompletionNoticeKey = (
  sessionId: string,
  totalRounds: number,
  totalToolCalls: number,
  completedAt?: string,
): string => {
  const normalizedCompletedAt = completedAt?.trim();
  if (normalizedCompletedAt) {
    return `${sessionId}:${normalizedCompletedAt}`;
  }
  return `${sessionId}:stats:${totalRounds}:${totalToolCalls}`;
};

export const isMemoryStatusTool = (toolName: string): boolean => {
  const normalizedToolName = toolName.trim().toLowerCase();
  return normalizedToolName === "memory_note" || normalizedToolName === "session_note";
};

export const getSharedAgentClient = (): AgentClient => {
  const maybeSingleton = AgentClient as typeof AgentClient & {
    getInstance?: () => AgentClient;
  };

  if (typeof maybeSingleton.getInstance === "function") {
    return maybeSingleton.getInstance();
  }

  return new AgentClient();
};

export const planModeStateFromEvent = (event: AgentEvent) => {
  if (typeof event.pre_permission_mode !== "string" || typeof event.entered_at !== "string") {
    return null;
  }
  const status = event.status;
  if (
    status !== "exploring" &&
    status !== "designing" &&
    status !== "reviewing" &&
    status !== "finalizing" &&
    status !== "awaiting_approval"
  ) {
    return null;
  }
  return {
    entered_at: event.entered_at,
    pre_permission_mode: event.pre_permission_mode,
    plan_file_path: event.plan_file_path ?? null,
    status,
  } as const;
};
