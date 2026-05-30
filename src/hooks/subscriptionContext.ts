import type { MutableRefObject } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import type { AgentClient } from "../services/chat/AgentService";
import type { AppState } from "../pages/ChatPage/store";
import type { SubscriptionEntry } from "./useAgentEventSubscription.helpers";

type TimerHandle = ReturnType<typeof setTimeout>;

export interface StreamingDraftState {
  sessionId: string;
  messageId: string;
  content: string;
  reasoningMessageId: string;
  reasoningContent: string;
  statusMessageId: string;
  status: string;
}

/**
 * Everything a single SSE subscription run needs from the owning hook: stable
 * store actions, the hook's lifecycle callbacks, the per-hook ref registries,
 * the antd message API, and `restart` (the hook's own startSubscription, for
 * reconnect). Built once per call in useAgentEventSubscription.
 */
export interface SubscriptionContext
  extends Pick<
    AppState,
    | "addMessage"
    | "applyAgentEvent"
    | "updateTokenUsage"
    | "setTruncationInfo"
    | "updateSession"
    | "updateMessage"
    | "setTaskList"
    | "updateTaskListDelta"
    | "setEvaluationState"
    | "applyChildProgress"
    | "persistSessionTitle"
    | "refreshChatsNow"
    | "setPendingQuestion"
    | "clearPendingQuestion"
  > {
  message: MessageInstance;
  cleanupChat: (
    sessionId: string,
    opts?: { clearDraft?: boolean; clearTitleRetry?: boolean },
  ) => void;
  clearReconnect: (sessionId: string) => void;
  clearParentSettleTimer: (sessionId: string) => void;
  clearTitleRefreshRetry: (sessionId: string) => void;
  ensureTaskListBaseline: (sessionId: string) => Promise<void>;
  shouldShowTaskListCompletedNotice: (
    sessionId: string,
    totalRounds: number,
    totalToolCalls: number,
    completedAt?: string,
  ) => boolean;
  markStreamStartedOnce: (sessionId: string, generation: number) => void;
  flushChildPreview: (parentSessionId: string, childSessionId: string) => void;
  scheduleChildPreviewFlush: (
    parentSessionId: string,
    childSessionId: string,
    content: string,
    lastEventAt: string,
  ) => void;
  restart: (sessionId: string) => void;
  agentClientRef: MutableRefObject<AgentClient | null>;
  parentSettleTimersRef: MutableRefObject<Map<string, TimerHandle>>;
  titleRefreshRetryTimersRef: MutableRefObject<
    Map<string, { attempt: number; timer: TimerHandle | null }>
  >;
  subscriptionsBySessionRef: MutableRefObject<Map<string, SubscriptionEntry>>;
  streamingStateBySessionRef: MutableRefObject<Map<string, StreamingDraftState>>;
  backgroundChildrenByParentRef: MutableRefObject<
    Map<string, { children: Set<string>; parentDone: boolean }>
  >;
  lastChildHeartbeatAtRef: MutableRefObject<Map<string, number>>;
  lastChildRoundCountRef: MutableRefObject<Map<string, number>>;
  pendingChildPreviewRef: MutableRefObject<
    Map<string, { content: string; lastEventAt: string; timer: TimerHandle | null }>
  >;
  toolNamesByCallIdRef: MutableRefObject<Map<string, string>>;
  toolCallMessageIdByCallIdRef: MutableRefObject<Map<string, string>>;
  reconnectStateBySessionRef: MutableRefObject<
    Map<string, { attempt: number; timer: TimerHandle | null }>
  >;
}

/**
 * Per-subscription run state shared with the domain event-handler factories:
 * the hook context plus this run's identity/locals and the two closures the
 * domain handlers need (status publishing + parent-settle scheduling). The
 * flag-coupled engine handlers (terminal/clarification) stay in the runner.
 */
export interface RunContext {
  ctx: SubscriptionContext;
  sessionId: string;
  generation: number;
  controller: AbortController;
  messageId: string;
  reasoningMessageId: string;
  statusMessageId: string;
  setStreamingStatus: (nextStatus?: string | null) => void;
  scheduleParentSettleCheck: () => void;
}
