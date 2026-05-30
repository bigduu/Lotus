import type { MutableRefObject } from "react";
import {
  AgentClient,
  TokenBudgetUsage,
  ContextSummaryInfo,
  TaskList,
  TaskListDelta,
  AgentEvent,
} from "../services/chat/AgentService";
import {
  useAppStore,
  selectShouldObserve,
  selectGeneration,
  selectChildren,
  type AppState,
} from "../pages/ChatPage/store";
import { applyReplayableSessionEvent } from "../pages/ChatPage/store/slices/sessionMetadataSlice";
import { streamingMessageBus } from "../pages/ChatPage/utils/streamingMessageBus";
import {
  appendAssistantReasoningChunk,
  appendAssistantStreamingChunk,
  clearAssistantStreamingState,
  getAssistantStreamingState,
  setAssistantStreamingState,
} from "../pages/ChatPage/streaming/assistantStreamingAtoms";
import {
  appendToolStreamingChunk,
  setToolStreamingStatus,
} from "../pages/ChatPage/streaming/toolStreamingAtoms";
import {
  clearChildPreviewState,
  getChildPreviewState,
  setChildPreviewState,
} from "../pages/ChatPage/streaming/childPreviewAtoms";
import type { Message } from "../pages/ChatPage/types/chatMessages";
import { mapTokenBudgetUsage } from "../pages/ChatPage/types/tokenBudget";
import type { MessageInstance } from "antd/es/message/interface";
import {
  formatCompletionPolicyViolationMessage,
  isCompletionPolicyViolationError,
} from "../shared/utils/completionPolicyViolation";
import { sendDesktopNotification } from "../services/notification/desktopNotification";
import i18n from "../shared/i18n";
import { debugLog } from "../shared/utils/debugFlags";
import {
  type SubscriptionEntry,
  debugSse,
  isAbortError,
  compactEvaluationReasoning,
  isTaskItemStatus,
  getChildStatus,
  isTerminalChildStatus,
  isMemoryStatusTool,
  planModeStateFromEvent,
  CHILD_HEARTBEAT_MIN_INTERVAL_MS,
  CHILD_PREVIEW_MAX_CHARS,
} from "./useAgentEventSubscription.helpers";

type TimerHandle = ReturnType<typeof setTimeout>;

interface StreamingDraftState {
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
 * Open (or reconnect) the SSE subscription for one session. Extracted verbatim
 * from useAgentEventSubscription.startSubscription; all hook-scoped dependencies
 * arrive via `ctx`, destructured below so the body reads identically.
 */
export function startAgentSubscription(sessionId: string, ctx: SubscriptionContext): void {
  const {
    addMessage,
    applyAgentEvent,
    updateTokenUsage,
    setTruncationInfo,
    updateSession,
    updateMessage,
    setTaskList,
    updateTaskListDelta,
    setEvaluationState,
    applyChildProgress,
    persistSessionTitle,
    refreshChatsNow,
    setPendingQuestion,
    clearPendingQuestion,
    message,
    cleanupChat,
    clearReconnect,
    clearParentSettleTimer,
    clearTitleRefreshRetry,
    ensureTaskListBaseline,
    shouldShowTaskListCompletedNotice,
    markStreamStartedOnce,
    flushChildPreview,
    scheduleChildPreviewFlush,
    restart,
    agentClientRef,
    parentSettleTimersRef,
    titleRefreshRetryTimersRef,
    subscriptionsBySessionRef,
    streamingStateBySessionRef,
    backgroundChildrenByParentRef,
    lastChildHeartbeatAtRef,
    lastChildRoundCountRef,
    pendingChildPreviewRef,
    toolNamesByCallIdRef,
    toolCallMessageIdByCallIdRef,
    reconnectStateBySessionRef,
  } = ctx;
  const state = useAppStore.getState();
  const generation = selectGeneration(sessionId)(state) ?? 0;
  const executionEntry = state.executionBySession?.[sessionId];
  debugSse("startSubscription", sessionId, "generation:", generation);
  debugLog("[SSE]", "startSubscription", {
    sessionId,
    generation,
    phase: executionEntry?.phase ?? null,
    backendRunId: executionEntry?.backendRunId ?? null,
    shouldObserve: selectShouldObserve(sessionId)(state),
  });
  // If a reconnect was scheduled, starting a new subscription supersedes it.
  clearReconnect(sessionId);
  clearTitleRefreshRetry(sessionId);

  const controller = new AbortController();
  subscriptionsBySessionRef.current.set(sessionId, {
    sessionId,
    controller,
    generation,
    streamEnded: false,
  });

  const messageId = `streaming-${sessionId}`;
  const reasoningMessageId = `streaming-reasoning-${sessionId}`;
  const statusMessageId = `streaming-status-${sessionId}`;
  const existingAssistantDraft = getAssistantStreamingState(sessionId);
  const existingStatus = streamingMessageBus.getLatest(statusMessageId);
  streamingStateBySessionRef.current.set(sessionId, {
    sessionId,
    messageId,
    content: existingAssistantDraft.content,
    reasoningMessageId,
    reasoningContent: existingAssistantDraft.reasoningContent,
    statusMessageId,
    status: existingStatus ?? "",
  });

  const setStreamingStatus = (nextStatus?: string | null) => {
    const state = streamingStateBySessionRef.current.get(sessionId);
    if (!state) return;

    const normalized = (nextStatus ?? "").trim();
    if (!normalized) {
      if (!state.status) return;
      state.status = "";
      streamingMessageBus.clear(state.sessionId, state.statusMessageId);
      return;
    }

    if (state.status === normalized) return;
    state.status = normalized;
    streamingMessageBus.publish({
      sessionId: state.sessionId,
      messageId: state.statusMessageId,
      content: state.status,
    });
  };

  // Assistant text/reasoning drafts live in Jotai now. Keep status on the bus,
  // and let content updates emit transient bus notifications only for scroll behavior.

  const scheduleReconnect = () => {
    const prev = reconnectStateBySessionRef.current.get(sessionId);
    const attempt = prev?.attempt ?? 0;
    const delayMs = Math.min(5000, 250 * Math.pow(2, attempt));
    const reconnectState = useAppStore.getState();
    const reconnectEntry = reconnectState.executionBySession?.[sessionId];
    debugSse("scheduleReconnect", sessionId, "delay:", delayMs, "attempt:", attempt);
    debugLog("[SSE]", "scheduleReconnect", {
      sessionId,
      generation,
      attempt,
      delayMs,
      phase: reconnectEntry?.phase ?? null,
      backendRunId: reconnectEntry?.backendRunId ?? null,
      shouldObserve: selectShouldObserve(sessionId)(reconnectState),
      terminalEventSeen,
    });

    cleanupChat(sessionId, { clearDraft: false });
    const timer = setTimeout(() => {
      reconnectStateBySessionRef.current.delete(sessionId);
      // selectShouldObserve = any active execution; triggers reconnect while session is alive
      const latestState = useAppStore.getState();
      const shouldObserve = selectShouldObserve(sessionId)(latestState);
      if (!shouldObserve) {
        debugLog("[SSE]", "scheduleReconnect.skipNotBusy", {
          sessionId,
          generation,
          phase: latestState.executionBySession?.[sessionId]?.phase ?? null,
          backendRunId: latestState.executionBySession?.[sessionId]?.backendRunId ?? null,
        });
        return;
      }
      const chat = latestState.chats.find((c) => c.id === sessionId);
      const sid = chat?.id?.trim();
      if (!sid) {
        debugLog("[SSE]", "scheduleReconnect.skipMissingSession", { sessionId, generation });
        return;
      }
      debugLog("[SSE]", "scheduleReconnect.restart", { sessionId: sid, generation });
      restart(sid);
    }, delayMs);
    reconnectStateBySessionRef.current.set(sessionId, {
      attempt: attempt + 1,
      timer,
    });
  };

  let terminalEventSeen = false;
  // `need_clarification` can be followed by a terminal stream close (and even a backend
  // `complete` event) for the CURRENT SSE stream. That is not a true run completion: the
  // session should remain in `waiting_user_answer` with its pending question intact until
  // the user responds.
  let rootClarificationSeen = false;
  const PARENT_SETTLE_DELAY_MS = 250;
  const TITLE_REFRESH_RETRY_DELAYS_MS = [1200, 3000] as const;
  const DEFAULT_SESSION_TITLES = new Set([
    "New Session",
    "新建会话",
    "新建會話",
    "Nouvelle session",
    "新しいセッション",
    "नया सत्र",
  ]);

  const isUntitledChatTitle = (title: string | undefined | null): boolean => {
    const normalized = (title || "").trim();
    if (!normalized) return true;
    if (DEFAULT_SESSION_TITLES.has(normalized)) return true;
    const prefixed =
      normalized.startsWith("New Session - ") ||
      normalized.startsWith("New Session with ") ||
      normalized.startsWith("New session - ") ||
      normalized.startsWith("New session with ");
    if (!prefixed) return false;
    const suffix = normalized
      .replace(/^New Session - /, "")
      .replace(/^New Session with /, "")
      .replace(/^New session - /, "")
      .replace(/^New session with /, "")
      .trim();
    return suffix.length > 0;
  };

  const shouldRetryTitleRefresh = (): boolean => {
    const state = useAppStore.getState();
    const currentGeneration = selectGeneration(sessionId)(state) ?? 0;
    if (currentGeneration !== generation) {
      return false;
    }
    if (selectShouldObserve(sessionId)(state)) {
      return false;
    }
    const chat = state.chats.find((c) => c.id === sessionId);
    if (!chat || chat.isRunning) {
      return false;
    }
    return isUntitledChatTitle(chat.title) && (chat.titleVersion ?? 0) === 0;
  };

  const scheduleTitleRefreshRetry = () => {
    if (!shouldRetryTitleRefresh()) {
      clearTitleRefreshRetry(sessionId);
      return;
    }

    const existing = titleRefreshRetryTimersRef.current.get(sessionId);
    const attempt = existing?.attempt ?? 0;
    if (attempt >= TITLE_REFRESH_RETRY_DELAYS_MS.length) {
      clearTitleRefreshRetry(sessionId);
      return;
    }

    clearTitleRefreshRetry(sessionId);
    const delayMs = TITLE_REFRESH_RETRY_DELAYS_MS[attempt];
    const timer = setTimeout(() => {
      titleRefreshRetryTimersRef.current.delete(sessionId);
      void (async () => {
        if (!shouldRetryTitleRefresh()) {
          clearTitleRefreshRetry(sessionId);
          return;
        }
        try {
          await refreshChatsNow();
        } catch (error) {
          console.warn(
            `[useAgentEventSubscription] Title refresh retry failed for session ${sessionId}:`,
            error,
          );
        } finally {
          if (shouldRetryTitleRefresh()) {
            scheduleTitleRefreshRetry();
          } else {
            clearTitleRefreshRetry(sessionId);
          }
        }
      })();
    }, delayMs);

    titleRefreshRetryTimersRef.current.set(sessionId, {
      attempt: attempt + 1,
      timer,
    });
  };

  const markStreamEnded = () => {
    const current = subscriptionsBySessionRef.current.get(sessionId);
    if (!current || current.controller !== controller || current.streamEnded) {
      return;
    }
    current.streamEnded = true;
    debugSse(
      "markStreamEnded",
      sessionId,
      "generation:",
      current.generation,
      "terminal:",
      terminalEventSeen,
    );
  };

  const hasBackgroundChildren = () => {
    const bg = backgroundChildrenByParentRef.current.get(sessionId);
    return (bg?.children.size ?? 0) > 0;
  };

  const shouldSkipReconnectAfterTerminal = () => terminalEventSeen && !hasBackgroundChildren();

  const clearParentDraft = () => {
    const entry = subscriptionsBySessionRef.current.get(sessionId);
    if (entry) {
      streamingMessageBus.clear(sessionId, `streaming-${sessionId}`);
      streamingMessageBus.clear(sessionId, `streaming-reasoning-${sessionId}`);
      streamingMessageBus.clear(sessionId, `streaming-status-${sessionId}`);
      clearAssistantStreamingState(sessionId);
      streamingStateBySessionRef.current.delete(entry.sessionId);
    }
  };

  const settleParentCompletion = async () => {
    clearParentSettleTimer(sessionId);

    try {
      await refreshChatsNow();
    } catch (error) {
      console.warn(
        `[useAgentEventSubscription] High-priority refresh failed while settling parent ${sessionId}:`,
        error,
      );
    }

    const currentBg =
      backgroundChildrenByParentRef.current.get(sessionId) ??
      ({ children: new Set<string>(), parentDone: false } as const);
    if (!currentBg.parentDone || currentBg.children.size > 0) {
      return;
    }

    const currentSub = subscriptionsBySessionRef.current.get(sessionId);
    if (
      currentSub &&
      (currentSub.controller !== controller || currentSub.generation !== generation)
    ) {
      return;
    }

    const state = useAppStore.getState();
    const chat = state.chats.find((c) => c.id === sessionId);
    // IMPORTANT: do not treat selectShouldObserve(sessionId) as evidence that the
    // backend is still running here. This settle path exists specifically to clear
    // stale local processing bits after a terminal event.
    const stillRunning = Boolean(chat?.isRunning);
    if (stillRunning) {
      // Execution state already reflects running via applySessionSummary from
      // refreshChatsNow; no explicit action needed.
      clearTitleRefreshRetry(sessionId);
      return;
    }

    if (shouldRetryTitleRefresh()) {
      scheduleTitleRefreshRetry();
    } else {
      clearTitleRefreshRetry(sessionId);
    }

    cleanupChat(sessionId, { clearDraft: true });
    // Execution state already settled via onComplete/onError applyAgentEvent;
    // no explicit action needed here.
  };

  const scheduleParentSettleCheck = () => {
    clearParentSettleTimer(sessionId);
    const timer = setTimeout(() => {
      parentSettleTimersRef.current.delete(sessionId);
      void settleParentCompletion();
    }, PARENT_SETTLE_DELAY_MS);
    parentSettleTimersRef.current.set(sessionId, timer);
  };

  const finalizeParentCompletion = () => {
    const bg =
      backgroundChildrenByParentRef.current.get(sessionId) ??
      ({ children: new Set<string>(), parentDone: false } as const);
    const children = new Set(bg.children);
    backgroundChildrenByParentRef.current.set(sessionId, {
      children,
      parentDone: true,
    });

    if (children.size === 0) {
      scheduleParentSettleCheck();
      return;
    }

    // Parent is done, but child sessions may still forward progress into this stream.
    // Clear the parent draft while keeping the SSE subscription alive for child events.
    clearParentDraft();
  };

  const client = agentClientRef.current;
  if (!client) return;

  client
    .subscribeToEvents(
      sessionId,
      {
        onToken: (tokenContent: string) => {
          markStreamStartedOnce(sessionId, generation);
          const state = streamingStateBySessionRef.current.get(sessionId);
          if (!state) return;
          setStreamingStatus(null);
          state.content += tokenContent;
          appendAssistantStreamingChunk(state.sessionId, tokenContent);
          streamingMessageBus.publish({
            sessionId: state.sessionId,
            messageId: state.messageId,
            content: tokenContent,
            transient: true,
          });
        },

        onReasoningToken: (tokenContent: string) => {
          markStreamStartedOnce(sessionId, generation);
          const state = streamingStateBySessionRef.current.get(sessionId);
          if (!state) return;
          state.reasoningContent += tokenContent;
          appendAssistantReasoningChunk(state.sessionId, tokenContent);
          streamingMessageBus.publish({
            sessionId: state.sessionId,
            messageId: state.reasoningMessageId,
            content: tokenContent,
            transient: true,
          });
        },

        onToolStart: (toolCallId, toolName, args) => {
          applyAgentEvent(
            sessionId,
            { type: "tool_start", tool_call_id: toolCallId, tool_name: toolName } as AgentEvent,
            generation,
          );
          // Flush any buffered assistant draft before tool execution starts
          // so streaming view keeps a natural "assistant text -> tool call" order.
          const streamingState = streamingStateBySessionRef.current.get(sessionId);
          const bufferedRaw = streamingState?.content || "";
          const bufferedReasoningRaw = streamingState?.reasoningContent || "";
          const hasBufferedContent = bufferedRaw.trim().length > 0;
          const hasBufferedReasoning = bufferedReasoningRaw.trim().length > 0;
          if (hasBufferedContent || hasBufferedReasoning) {
            const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
            const last = chat?.messages?.[chat.messages.length - 1] as
              | (Message & { metadata?: { reasoning?: string } })
              | undefined;
            const lastReasoning =
              typeof last?.metadata?.reasoning === "string" ? last.metadata.reasoning : "";
            const lastIsSame =
              last?.role === "assistant" &&
              last?.type === "text" &&
              typeof last?.content === "string" &&
              last.content === bufferedRaw &&
              lastReasoning === bufferedReasoningRaw;

            if (!lastIsSame) {
              void addMessage(sessionId, {
                id: `assistant-${Date.now()}`,
                role: "assistant",
                type: "text",
                content: bufferedRaw,
                createdAt: new Date().toISOString(),
                metadata: {
                  sessionId,
                  model: "agent",
                  ...(hasBufferedReasoning ? { reasoning: bufferedReasoningRaw } : {}),
                },
              });
            }

            if (streamingState) {
              streamingState.content = "";
              streamingState.reasoningContent = "";
              setAssistantStreamingState(streamingState.sessionId, {
                content: "",
                reasoningContent: "",
              });
              if (streamingState.status) {
                streamingState.status = "";
                streamingMessageBus.clear(streamingState.sessionId, streamingState.statusMessageId);
              }
            }
          }

          // Track tool name for later use in onToolComplete
          toolNamesByCallIdRef.current.set(toolCallId, toolName);
          const normalizedToolName = toolName.trim().toLowerCase();
          if (isMemoryStatusTool(toolName)) {
            setStreamingStatus("memory_updating");
          } else {
            setStreamingStatus(`tool_running:${normalizedToolName || "tool"}`);
          }

          const messageId = crypto.randomUUID();
          toolCallMessageIdByCallIdRef.current.set(toolCallId, messageId);

          void addMessage(sessionId, {
            id: messageId,
            role: "assistant",
            type: "tool_call",
            toolCalls: [
              {
                toolCallId,
                toolName,
                parameters: args || {},
                streamingOutput: "",
              },
            ],
            metadata: {},
            createdAt: new Date().toISOString(),
          });
        },

        onToolToken: (toolCallId: string, tokenContent: string) => {
          applyAgentEvent(
            sessionId,
            {
              type: "tool_token",
              tool_call_id: toolCallId,
              content: tokenContent,
            } as AgentEvent,
            generation,
          );

          if (!toolNamesByCallIdRef.current.has(toolCallId)) {
            const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
            const matchingMessage =
              chat?.messages
                ?.slice()
                .reverse()
                .find(
                  (message) =>
                    "type" in message &&
                    message.type === "tool_call" &&
                    Array.isArray(message.toolCalls) &&
                    message.toolCalls.some((call) => call.toolCallId === toolCallId),
                ) ?? null;

            if (
              matchingMessage &&
              "toolCalls" in matchingMessage &&
              Array.isArray(matchingMessage.toolCalls)
            ) {
              const targetCall = matchingMessage.toolCalls.find(
                (call) => call.toolCallId === toolCallId,
              );
              if (targetCall) {
                toolNamesByCallIdRef.current.set(toolCallId, targetCall.toolName);
                toolCallMessageIdByCallIdRef.current.set(toolCallId, matchingMessage.id);
              }
            }
          }

          appendToolStreamingChunk(sessionId, toolCallId, tokenContent);
        },

        onToolComplete: (toolCallId, result: AgentEvent["result"]) => {
          applyAgentEvent(
            sessionId,
            { type: "tool_complete", tool_call_id: toolCallId } as AgentEvent,
            generation,
          );
          // Retrieve tool name tracked in onToolStart
          const toolName = toolNamesByCallIdRef.current.get(toolCallId) || "unknown";
          setToolStreamingStatus(sessionId, toolCallId, "completed");
          toolNamesByCallIdRef.current.delete(toolCallId);
          toolCallMessageIdByCallIdRef.current.delete(toolCallId);

          const normalizedToolName = toolName.trim().toLowerCase();
          const currentState = streamingStateBySessionRef.current.get(sessionId);
          const shouldClearStatus = isMemoryStatusTool(toolName)
            ? currentState?.status === "memory_updating"
            : Boolean(currentState?.status && currentState.status.includes(normalizedToolName));
          if (shouldClearStatus) {
            setStreamingStatus(null);
          }

          const displayPreference =
            (result?.display_preference as "Default" | "Collapsible" | "Hidden") || "Default";

          void addMessage(sessionId, {
            id: crypto.randomUUID(),
            role: "assistant",
            type: "tool_result",
            toolName,
            toolCallId,
            result: {
              tool_name: toolName,
              result: result?.result ?? "",
              display_preference: displayPreference,
            },
            isError: !result?.success,
            createdAt: new Date().toISOString(),
          });
        },

        onToolError: (toolCallId, error: string) => {
          applyAgentEvent(
            sessionId,
            { type: "tool_error", tool_call_id: toolCallId } as AgentEvent,
            generation,
          );
          const toolName = toolNamesByCallIdRef.current.get(toolCallId) || "unknown";
          setToolStreamingStatus(sessionId, toolCallId, "error");
          toolNamesByCallIdRef.current.delete(toolCallId);
          toolCallMessageIdByCallIdRef.current.delete(toolCallId);
          setStreamingStatus(null);
          void addMessage(sessionId, {
            id: crypto.randomUUID(),
            role: "assistant",
            type: "tool_result",
            toolName,
            toolCallId,
            result: {
              tool_name: toolName,
              result: error,
              display_preference: "Default",
            },
            isError: true,
            createdAt: new Date().toISOString(),
          });
        },

        onToolLifecycle: (
          toolCallId,
          _toolName,
          phase,
          elapsedMs,
          isMutating,
          autoApproved,
          summary,
        ) => {
          if (phase === "begin") {
            const normalizedToolName = (_toolName || "").trim().toLowerCase();
            if (isMemoryStatusTool(_toolName || "")) {
              setStreamingStatus("memory_updating");
            } else {
              setStreamingStatus(`tool_running:${normalizedToolName || "tool"}`);
            }

            // Notify when a mutating tool needs user approval
            if (autoApproved === false) {
              void sendDesktopNotification({
                title: i18n.t("app.notifications.toolApproval.title", {
                  tool: _toolName || i18n.t("app.notifications.toolApproval.unknownTool"),
                }),
                body: i18n.t("app.notifications.toolApproval.body", { tool: _toolName || "" }),
                sessionId,
                eventType: "tool_approval",
                eventId: toolCallId,
              });
            }
          }

          // When a tool finishes, update its message card with timing metadata
          if (phase === "finished" || phase === "error" || phase === "cancelled") {
            setToolStreamingStatus(
              sessionId,
              toolCallId,
              phase === "finished" ? "completed" : "error",
            );
            const messageId = toolCallMessageIdByCallIdRef.current.get(toolCallId);
            if (messageId) {
              const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
              const existingMessage = chat?.messages.find((m) => m.id === messageId);
              const existingMetadata =
                existingMessage && "metadata" in existingMessage
                  ? ((existingMessage as { metadata?: Record<string, unknown> }).metadata ?? {})
                  : {};

              void updateMessage(sessionId, messageId, {
                metadata: {
                  ...existingMetadata,
                  elapsed_ms: elapsedMs,
                  is_mutating: isMutating,
                  ...(summary ? { summary } : {}),
                },
              });
            }

            // Only clear the streaming status if it's currently showing THIS tool
            const normalizedToolName = (_toolName || "").trim().toLowerCase();
            const currentState = streamingStateBySessionRef.current.get(sessionId);
            const shouldClearStatus = isMemoryStatusTool(_toolName || "")
              ? currentState?.status === "memory_updating"
              : Boolean(currentState?.status && currentState.status.includes(normalizedToolName));
            if (shouldClearStatus) {
              setStreamingStatus(null);
            }
          }
        },

        onContextCompressionStatus: (_phase, status) => {
          if (status === "started") {
            setStreamingStatus("context_compacting");
            return;
          }
          if (status === "degraded_sections") {
            setStreamingStatus("context_compaction_degraded");
            return;
          }
          if (status === "failed") {
            setStreamingStatus("context_compaction_failed");
            return;
          }
          setStreamingStatus(null);
        },

        onTokenBudgetUpdated: (usage: TokenBudgetUsage) => {
          const tokenUsage = mapTokenBudgetUsage(usage);
          if (!tokenUsage) {
            return;
          }

          updateTokenUsage(sessionId, tokenUsage);
          setTruncationInfo(sessionId, usage.truncation_occurred, usage.segments_removed);

          // Persist in chat config without causing resubscribe:
          const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);

          if (chat) {
            updateSession(sessionId, {
              config: {
                ...chat.config,
                tokenUsage,
                truncationOccurred: usage.truncation_occurred,
                segmentsRemoved: usage.segments_removed,
              },
            });
          }
        },

        onContextSummarized: (summaryInfo: ContextSummaryInfo) => {
          setStreamingStatus(null);
          message.info(
            i18n.t("app.notifications.conversationSummarized", {
              messages: summaryInfo.messages_summarized,
              tokens: summaryInfo.tokens_saved.toLocaleString(),
            }),
            5,
          );
        },

        onContextPressureNotification: (_percent, level, msg) => {
          if (level === "critical") {
            message.error(msg, 6);
            void sendDesktopNotification({
              title: i18n.t("app.notifications.contextPressure.title"),
              body: msg,
              sessionId,
              eventType: "context_pressure",
            });
          } else {
            message.warning(msg, 5);
          }
        },

        onTaskListUpdated: (taskList: TaskList) => {
          if (taskList.session_id) {
            setTaskList(taskList.session_id, taskList);
          }
        },

        onTaskListItemProgress: (delta: TaskListDelta) => {
          if (delta.session_id) {
            if (!useAppStore.getState().taskLists[delta.session_id]) {
              void ensureTaskListBaseline(delta.session_id);
              return;
            }
            updateTaskListDelta(delta.session_id, delta);
          }
        },

        onTaskListCompleted: (completedSessionId, totalRounds, totalToolCalls, completedAt) => {
          if (
            !shouldShowTaskListCompletedNotice(
              completedSessionId,
              totalRounds,
              totalToolCalls,
              completedAt,
            )
          ) {
            return;
          }

          message.success(
            i18n.t("app.notifications.allTasksCompleted", {
              rounds: totalRounds,
              toolCalls: totalToolCalls,
            }),
            3,
          );
        },

        onTaskEvaluationStarted: (sid, itemsCount) => {
          setEvaluationState(sid, {
            isEvaluating: true,
            reasoning: null,
            timestamp: Date.now(),
          });
          message.info(
            i18n.t("app.notifications.evaluatingTasks", {
              count: itemsCount,
            }),
            2,
          );
        },

        onTaskEvaluationCompleted: (sid, updatesCount, reasoning) => {
          const compactReasoning = compactEvaluationReasoning(reasoning);
          setEvaluationState(sid, {
            isEvaluating: false,
            reasoning: updatesCount > 0 ? compactReasoning : null,
            timestamp: Date.now(),
          });

          if (updatesCount > 0) {
            message.success(
              i18n.t("app.notifications.evaluationCompleteUpdated", {
                count: updatesCount,
              }),
              3,
            );
          } else {
            message.info(i18n.t("app.notifications.evaluationCompleteNoUpdates"), 2);
          }
        },

        onComplete: () => {
          // A clarification stream may end with a backend `complete` event even though the
          // root session is merely waiting for user input. Treat that as a terminal close for
          // THIS SSE subscription only; do not run normal completion side effects.
          if (rootClarificationSeen) {
            terminalEventSeen = true;
            setStreamingStatus(null);
            streamingMessageBus.forceFlush();
            return;
          }

          terminalEventSeen = true;
          applyAgentEvent(sessionId, { type: "complete" } as AgentEvent, generation);

          // Capture the controller that owns THIS execution run.  The async
          // body below may outlive this subscription (e.g. loadChatHistory
          // retries take ~2s).  If the user responds to conclusion_with_options and a *new*
          // subscription starts for the same sessionId in the meantime, we
          // must NOT clean up the new one.
          const ownerController = controller;

          // Detect if a *different* subscription took over for the same
          // sessionId while we were waiting (e.g. loadChatHistory retries).
          // When that happens the current ref entry will point to a
          // different controller, meaning our cleanup would kill the live
          // successor.
          const isSuperseded = () => {
            const cur = subscriptionsBySessionRef.current.get(sessionId);
            return (
              cur != null && (cur.controller !== ownerController || cur.generation !== generation)
            );
          };

          void (async () => {
            // Clear any lingering status so the UI doesn't stay in "thinking" state
            // while we finalize the response.
            setStreamingStatus(null);
            streamingMessageBus.forceFlush();

            // Clear any pending question state for this session
            clearPendingQuestion(sessionId);

            // If a newer run already owns this session, skip all completion
            // side effects to avoid overwriting in-flight UI state.
            if (isSuperseded()) return;

            const state = streamingStateBySessionRef.current.get(sessionId);
            const liveAssistantDraft = getAssistantStreamingState(sessionId);
            const streamedRaw = liveAssistantDraft.content || state?.content || "";
            const streamedReasoningRaw =
              liveAssistantDraft.reasoningContent || state?.reasoningContent || "";
            const hasStreamedContent = streamedRaw.trim().length > 0;
            const hasStreamedReasoning = streamedReasoningRaw.trim().length > 0;

            // Convert the streaming draft into a normal assistant message immediately so it
            // doesn't "disappear" when we turn off processing UI.
            if (hasStreamedContent || hasStreamedReasoning) {
              const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
              const last = chat?.messages?.[chat.messages.length - 1] as
                | (Message & { metadata?: { reasoning?: string } })
                | undefined;
              const lastReasoning =
                typeof last?.metadata?.reasoning === "string" ? last.metadata.reasoning : "";
              const lastIsSame =
                last?.role === "assistant" &&
                last?.type === "text" &&
                typeof last?.content === "string" &&
                last.content === streamedRaw &&
                lastReasoning === streamedReasoningRaw;

              if (!lastIsSame) {
                await addMessage(sessionId, {
                  id: `assistant-${Date.now()}`,
                  role: "assistant",
                  type: "text",
                  content: streamedRaw,
                  createdAt: new Date().toISOString(),
                  metadata: {
                    sessionId,
                    model: "agent",
                    ...(hasStreamedReasoning ? { reasoning: streamedReasoningRaw } : {}),
                  },
                });
              }
            }

            if (isSuperseded()) return;

            // Sync with persisted history. Use retries because the backend can emit "complete"
            // before it finishes persisting the final assistant message.
            await useAppStore.getState().loadChatHistory(sessionId, {
              mode: "monotonic",
              retries: 4,
              retryDelayMs: 200,
              waitForAssistant: true,
            });

            if (isSuperseded()) return;

            // Fallback for older backends/races: if persisted history still has no
            // reasoning, re-attach the streamed reasoning locally.
            if (hasStreamedReasoning) {
              const chatAfterSync = useAppStore.getState().chats.find((c) => c.id === sessionId);
              const lastAssistantText = [...(chatAfterSync?.messages || [])]
                .reverse()
                .find((msg) => msg?.role === "assistant" && msg?.type === "text") as
                | (Message & { metadata?: Record<string, unknown> })
                | undefined;

              const hasPersistedReasoning =
                typeof lastAssistantText?.metadata?.reasoning === "string" &&
                (lastAssistantText.metadata.reasoning as string).trim().length > 0;

              if (lastAssistantText?.id && !hasPersistedReasoning) {
                updateMessage(sessionId, lastAssistantText.id, {
                  metadata: {
                    ...(lastAssistantText.metadata || {}),
                    reasoning: streamedReasoningRaw,
                  },
                } as Partial<Message>);
              }
            }

            // If another subscription already took over (user responded quickly),
            // do NOT tear down the active subscription or mark processing as false.
            if (isSuperseded()) return;

            // Mark parent completed. If there are background children, keep the SSE
            // subscription alive to forward sub-agent progress.
            finalizeParentCompletion();
          })().catch((error) => {
            // Completion cleanup must be best-effort but never leave the UI stuck in
            // processing/thinking if a follow-up sync request fails (for example due to CORS
            // or a transient network error after the backend already emitted `complete`).
            console.warn(
              `[useAgentEventSubscription] Completion finalization failed for session ${sessionId}:`,
              error,
            );
            if (!isSuperseded()) {
              finalizeParentCompletion();
            }
          });
        },

        onCancelled: async (cancelMessage?: string) => {
          terminalEventSeen = true;
          applyAgentEvent(
            sessionId,
            { type: "cancelled", message: cancelMessage } as AgentEvent,
            generation,
          );
          setStreamingStatus(null);
          clearPendingQuestion(sessionId);
          finalizeParentCompletion();
        },

        onError: async (errorMessage: string) => {
          terminalEventSeen = true;
          applyAgentEvent(
            sessionId,
            { type: "error", message: errorMessage } as AgentEvent,
            generation,
          );
          setStreamingStatus(null);

          try {
            const friendlyErrorMessage = isCompletionPolicyViolationError(errorMessage)
              ? formatCompletionPolicyViolationMessage(errorMessage)
              : errorMessage;

            await addMessage(sessionId, {
              id: `error-${Date.now()}`,
              role: "assistant",
              type: "text",
              content: `❌ **Error**: ${friendlyErrorMessage}`,
              createdAt: new Date().toISOString(),
              finishReason: "error",
            });
          } catch (error) {
            console.warn(
              `[useAgentEventSubscription] Failed to append error message for session ${sessionId}:`,
              error,
            );
          } finally {
            finalizeParentCompletion();
          }
        },

        onSessionTitleUpdated: (event) => {
          applyReplayableSessionEvent(event, useAppStore.getState());
        },

        onSessionPinnedUpdated: (event) => {
          applyReplayableSessionEvent(event, useAppStore.getState());
        },

        onPlanModeEntered: (event) => {
          const targetSessionId = event.session_id || sessionId;
          const planMode = planModeStateFromEvent(event);
          if (!planMode) {
            void refreshChatsNow();
            return;
          }
          updateSession(targetSessionId, {
            planMode,
          });
        },

        onPlanModeExited: (event) => {
          const targetSessionId = event.session_id || sessionId;
          updateSession(targetSessionId, {
            planMode: null,
          });
          void refreshChatsNow();
        },

        onPlanFileUpdated: (event) => {
          const targetSessionId = event.session_id || sessionId;
          const currentSession = useAppStore
            .getState()
            .chats.find((chat) => chat.id === targetSessionId);
          const currentPlanMode = currentSession?.planMode;
          if (currentPlanMode) {
            updateSession(targetSessionId, {
              planMode: {
                ...currentPlanMode,
                plan_file_path: event.plan_file_path ?? currentPlanMode.plan_file_path ?? null,
                status:
                  event.status === "exploring" ||
                  event.status === "designing" ||
                  event.status === "reviewing" ||
                  event.status === "finalizing" ||
                  event.status === "awaiting_approval"
                    ? event.status
                    : currentPlanMode.status,
              },
            });
          } else {
            void refreshChatsNow();
          }
        },

        onSubAgentStarted: (parentSessionId, childSessionId, title) => {
          const bg =
            backgroundChildrenByParentRef.current.get(parentSessionId) ??
            ({ children: new Set<string>(), parentDone: false } as const);
          const children = new Set(bg.children);
          children.add(childSessionId);
          backgroundChildrenByParentRef.current.set(parentSessionId, {
            children,
            parentDone: bg.parentDone,
          });

          // Parent phase is already driven by applyAgentEvent(sub_agent_started)
          // via applyChildProgress → applyChildProgress.

          applyChildProgress(parentSessionId, childSessionId, {
            title,
            // "started" now means "created + queued". Mark as pending until
            // we observe child events/heartbeat/completion.
            status: "pending",
            lastEventAt: new Date().toISOString(),
          });

          // Persist child session title to backend so it survives refresh.
          // Fire-and-forget to avoid blocking the SSE event loop.
          if (title && title.trim()) {
            persistSessionTitle(childSessionId, title).catch((e) => {
              console.warn(
                `[useAgentEventSubscription] Failed to persist sub-agent title for ${childSessionId}:`,
                e,
              );
            });
          }

          // Ensure the child session appears in the session list immediately.
          void refreshChatsNow();
        },

        onSubAgentEvent: (parentSessionId, childSessionId, evt: AgentEvent) => {
          if (evt.type === "task_list_updated" && evt.task_list) {
            const sharedSessionId = evt.task_list.session_id || parentSessionId;
            setTaskList(sharedSessionId, evt.task_list);
            return;
          }
          if (evt.type === "task_list_item_progress") {
            const sharedSessionId = evt.session_id || parentSessionId;
            if (
              typeof evt.item_id === "string" &&
              isTaskItemStatus(evt.status) &&
              typeof evt.tool_calls_count === "number" &&
              typeof evt.version === "number"
            ) {
              if (!useAppStore.getState().taskLists[sharedSessionId]) {
                void ensureTaskListBaseline(sharedSessionId);
                return;
              }
              updateTaskListDelta(sharedSessionId, {
                session_id: sharedSessionId,
                item_id: evt.item_id,
                status: evt.status,
                tool_calls_count: evt.tool_calls_count,
                version: evt.version,
              });
            }
            return;
          }
          if (evt.type === "task_evaluation_started") {
            const sharedSessionId = evt.session_id || parentSessionId;
            setEvaluationState(sharedSessionId, {
              isEvaluating: true,
              reasoning: null,
              timestamp: Date.now(),
            });
            return;
          }
          if (evt.type === "task_evaluation_completed") {
            const sharedSessionId = evt.session_id || parentSessionId;
            const updatesCount = evt.updates_count ?? 0;
            setEvaluationState(sharedSessionId, {
              isEvaluating: false,
              reasoning: updatesCount > 0 ? compactEvaluationReasoning(evt.reasoning ?? "") : null,
              timestamp: Date.now(),
            });
            return;
          }

          const current = selectChildren(parentSessionId)(useAppStore.getState())?.[childSessionId];
          if (isTerminalChildStatus(current?.status)) {
            return;
          }

          if (evt.type === "runner_progress") {
            const nextRoundCount =
              typeof evt.round_count === "number" ? evt.round_count : current?.roundCount;
            const roundKey = `${parentSessionId}:${childSessionId}`;
            if (
              typeof nextRoundCount === "number" &&
              lastChildRoundCountRef.current.get(roundKey) === nextRoundCount
            ) {
              return;
            }
            if (typeof nextRoundCount === "number") {
              lastChildRoundCountRef.current.set(roundKey, nextRoundCount);
            }
            applyChildProgress(parentSessionId, childSessionId, {
              status: "running",
              roundCount: nextRoundCount,
              lastEventAt: new Date().toISOString(),
            });
            return;
          }

          // Maintain a small rolling preview for fast UI feedback, but flush it in a
          // throttled way so we don't write global execution state on every child token.
          if (evt.type === "token" && typeof evt.content === "string") {
            const previewKey = `${parentSessionId}:${childSessionId}`;
            const pendingPreview = pendingChildPreviewRef.current.get(previewKey);
            const livePreview = getChildPreviewState(parentSessionId, childSessionId);
            const prev =
              pendingPreview?.content ?? livePreview.outputPreview ?? current?.outputPreview ?? "";
            const next = (prev + evt.content).slice(-CHILD_PREVIEW_MAX_CHARS);
            setChildPreviewState(parentSessionId, childSessionId, next);
            scheduleChildPreviewFlush(
              parentSessionId,
              childSessionId,
              next,
              new Date().toISOString(),
            );
          } else {
            applyChildProgress(parentSessionId, childSessionId, {
              status: "running",
              lastEventAt: new Date().toISOString(),
            });
          }
        },

        onSubAgentHeartbeat: (parentSessionId, childSessionId, ts) => {
          if (isTerminalChildStatus(getChildStatus(parentSessionId, childSessionId))) {
            return;
          }
          const heartbeatKey = `${parentSessionId}:${childSessionId}`;
          const lastHeartbeatAt = lastChildHeartbeatAtRef.current.get(heartbeatKey) ?? 0;
          const nextHeartbeatAt = Date.parse(ts || "") || Date.now();
          if (nextHeartbeatAt - lastHeartbeatAt < CHILD_HEARTBEAT_MIN_INTERVAL_MS) {
            return;
          }
          lastChildHeartbeatAtRef.current.set(heartbeatKey, nextHeartbeatAt);
          applyChildProgress(parentSessionId, childSessionId, {
            status: "running",
            lastHeartbeatAt: ts,
          });
        },

        onSubAgentCompleted: (parentSessionId, childSessionId, status, error) => {
          const bg =
            backgroundChildrenByParentRef.current.get(parentSessionId) ??
            ({ children: new Set<string>(), parentDone: false } as const);
          const children = new Set(bg.children);
          children.delete(childSessionId);
          backgroundChildrenByParentRef.current.set(parentSessionId, {
            children,
            parentDone: bg.parentDone,
          });

          flushChildPreview(parentSessionId, childSessionId);
          clearChildPreviewState(parentSessionId, childSessionId);
          const childStateKey = `${parentSessionId}:${childSessionId}`;
          lastChildHeartbeatAtRef.current.delete(childStateKey);
          lastChildRoundCountRef.current.delete(childStateKey);
          applyChildProgress(parentSessionId, childSessionId, {
            status,
            error,
            lastEventAt: new Date().toISOString(),
          });

          // Notify when a background sub-agent completes successfully
          if (status === "completed") {
            const child = selectChildren(parentSessionId)(useAppStore.getState())?.[childSessionId];
            void sendDesktopNotification({
              title: i18n.t("app.notifications.backgroundTask.completedTitle"),
              body: child?.title
                ? i18n.t("app.notifications.backgroundTask.completedBody", {
                    title: child.title,
                  })
                : i18n.t("app.notifications.backgroundTask.completedFallback"),
              sessionId: parentSessionId,
              eventType: "subagent_completed",
              eventId: childSessionId,
            });
          }

          // If parent already completed and no more background children, wait briefly
          // for any backend auto-resume/root-resume handoff before tearing down the stream.
          if (bg.parentDone && children.size === 0) {
            scheduleParentSettleCheck();
          }

          void refreshChatsNow();
        },

        onNeedClarification: (event) => {
          const targetSessionId = event.session_id || sessionId;
          // Only suppress subsequent root-session completion finalization when the
          // clarification belongs to this subscription's own parent session.
          if (targetSessionId === sessionId) {
            rootClarificationSeen = true;
          }
          debugSse("event.needClarification", {
            sessionId,
            targetSessionId,
            subscriptionGeneration: generation,
            currentStoreGeneration: selectGeneration(targetSessionId)(useAppStore.getState()),
            toolCallId: event.tool_call_id ?? null,
            questionPreview: (event.question || "").slice(0, 120),
          });
          setPendingQuestion(targetSessionId, {
            question: event.question || "",
            options: event.options || [],
            allowCustom: event.allow_custom ?? true,
            toolCallId: event.tool_call_id ?? null,
          });

          // Notify user when a clarification is needed while app is in background
          const questionText = event.question || "";
          const truncatedQuestion =
            questionText.length > 80 ? `${questionText.slice(0, 80)}...` : questionText;
          void sendDesktopNotification({
            title: i18n.t("app.notifications.clarification.title"),
            body: truncatedQuestion || i18n.t("app.notifications.clarification.fallbackBody"),
            sessionId: targetSessionId,
            eventType: "clarification",
            eventId: event.tool_call_id ?? undefined,
          });
        },

        onExecutionStarted: (runId, _startedAt) => {
          debugLog("[SSE]", "event.executionStarted", {
            sessionId,
            generation,
            runId,
          });
          debugSse("event.executionStarted.compareGeneration", {
            sessionId,
            subscriptionGeneration: generation,
            currentStoreGeneration: selectGeneration(sessionId)(useAppStore.getState()),
            runId,
          });
          applyAgentEvent(
            sessionId,
            { type: "execution_started", run_id: runId } as AgentEvent,
            generation,
          );
        },
        onRunnerProgress: () => {
          // Root-session progress is parsed but unused in this scope; nested child
          // progress is handled inside onSubAgentEvent.
        },
      },
      controller,
    )
    .then(() => {
      markStreamEnded();
      debugSse(
        "streamEnded",
        sessionId,
        "generation:",
        generation,
        "aborted:",
        controller.signal.aborted,
        "terminal:",
        terminalEventSeen,
      );
      debugLog("[SSE]", "streamEnded", {
        sessionId,
        generation,
        aborted: controller.signal.aborted,
        terminalEventSeen,
        shouldSkipReconnectAfterTerminal: shouldSkipReconnectAfterTerminal(),
        phase: useAppStore.getState().executionBySession?.[sessionId]?.phase ?? null,
        backendRunId: useAppStore.getState().executionBySession?.[sessionId]?.backendRunId ?? null,
      });
      // Stream ended without throwing. Backend live SSE should be long-lived, but
      // one-shot terminal streams intentionally close after emitting complete/error.
      if (controller.signal.aborted || shouldSkipReconnectAfterTerminal()) return;

      // If a newer subscription already replaced this one (e.g. user
      // responded to conclusion_with_options quickly), don't interfere with it.
      const currentSub = subscriptionsBySessionRef.current.get(sessionId);
      if (
        currentSub &&
        (currentSub.controller !== controller || currentSub.generation !== generation)
      )
        return;

      // selectShouldObserve = any active execution; keep processing state while session is alive
      const stillBusy = selectShouldObserve(sessionId)(useAppStore.getState());
      debugLog("[SSE]", "streamEnded.busyCheck", {
        sessionId,
        generation,
        stillBusy,
        phase: useAppStore.getState().executionBySession?.[sessionId]?.phase ?? null,
        backendRunId: useAppStore.getState().executionBySession?.[sessionId]?.backendRunId ?? null,
      });
      if (!stillBusy) {
        cleanupChat(sessionId, { clearDraft: true });
        return;
      }

      // Restart subscription with backoff.
      scheduleReconnect();
    })
    .catch((err) => {
      markStreamEnded();
      debugSse("streamError", sessionId, "generation:", generation, err);
      debugLog("[SSE]", "streamError", {
        sessionId,
        generation,
        aborted: controller.signal.aborted,
        terminalEventSeen,
        error: err,
        phase: useAppStore.getState().executionBySession?.[sessionId]?.phase ?? null,
        backendRunId: useAppStore.getState().executionBySession?.[sessionId]?.backendRunId ?? null,
      });
      // If we explicitly aborted, do nothing (normal cleanup path).
      if (controller.signal.aborted) return;

      // Some runtimes surface network disconnects as AbortError even when we didn't abort.
      // In that case, attempt to resubscribe instead of tearing down processing state.
      if (isAbortError(err)) {
        if (shouldSkipReconnectAfterTerminal()) return;

        // selectShouldObserve = any active execution; attempt reconnect while session is alive
        const stillBusy = selectShouldObserve(sessionId)(useAppStore.getState());
        debugLog("[SSE]", "streamError.abortError.busyCheck", {
          sessionId,
          generation,
          stillBusy,
          phase: useAppStore.getState().executionBySession?.[sessionId]?.phase ?? null,
          backendRunId:
            useAppStore.getState().executionBySession?.[sessionId]?.backendRunId ?? null,
        });
        if (!stillBusy) {
          cleanupChat(sessionId, { clearDraft: true });
          return;
        }

        scheduleReconnect();
        return;
      }

      if (shouldSkipReconnectAfterTerminal()) return;

      console.error("[useAgentEventSubscription] Subscription error:", err);
      cleanupChat(sessionId, { clearDraft: true });
      const currentGen = selectGeneration(sessionId)(useAppStore.getState());
      // selectShouldObserve = any active execution; only emit error if session is still alive
      const currentBusy = selectShouldObserve(sessionId)(useAppStore.getState());
      if (currentGen === generation && currentBusy) {
        applyAgentEvent(
          sessionId,
          { type: "error", message: String(err) } as AgentEvent,
          generation,
        );
      }
    });
}
