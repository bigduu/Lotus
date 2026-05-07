import { useEffect, useRef, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
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
} from "../pages/ChatPage/store";
import { applyReplayableSessionEvent } from "../pages/ChatPage/store/slices/sessionMetadataSlice";
import { streamingMessageBus } from "../pages/ChatPage/utils/streamingMessageBus";
import type { Message } from "../pages/ChatPage/types/chatMessages";
import { App as AntApp } from "antd";
import {
  formatCompletionPolicyViolationMessage,
  isCompletionPolicyViolationError,
} from "../shared/utils/completionPolicyViolation";
import { sendDesktopNotification } from "../services/notification/desktopNotification";

type SubscriptionEntry = {
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

function debugSse(...args: unknown[]): void {
  if (!import.meta.env.DEV) return;
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem("lotus_debug_sse") !== "1") return;
  console.warn("[SSE]", ...args);
}

const isAbortError = (err: unknown) => {
  const e = err as { name?: string; code?: number };
  return e?.name === "AbortError" || e?.code === 20;
};

const MAX_TASK_EVALUATION_REASONING_CHARS = 220;

const compactEvaluationReasoning = (reasoning: string): string => {
  const normalized = reasoning.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TASK_EVALUATION_REASONING_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TASK_EVALUATION_REASONING_CHARS)}...`;
};

const isTaskItemStatus = (status: AgentEvent["status"]): status is TaskListDelta["status"] =>
  status === "pending" ||
  status === "in_progress" ||
  status === "completed" ||
  status === "blocked";

const TERMINAL_CHILD_STATUS = new Set(["completed", "error", "cancelled", "failed"]);

const isMemoryStatusTool = (toolName: string): boolean => {
  const normalizedToolName = toolName.trim().toLowerCase();
  return normalizedToolName === "memory_note" || normalizedToolName === "session_note";
};

const getSharedAgentClient = (): AgentClient => {
  const maybeSingleton = AgentClient as typeof AgentClient & {
    getInstance?: () => AgentClient;
  };

  if (typeof maybeSingleton.getInstance === "function") {
    return maybeSingleton.getInstance();
  }

  return new AgentClient();
};

export function useAgentEventSubscription() {
  const { message } = AntApp.useApp();
  // Stable store actions
  const {
    addMessage,
    applyAgentEvent,
    updateTokenUsage,
    setTruncationInfo,
    updateSession,
    updateMessage,
    setTaskList,
    loadTaskList,
    updateTaskListDelta,
    setEvaluationState,
    applyChildProgress,
    persistSessionTitle,
    refreshChatsNow,
    setPendingQuestion,
    clearPendingQuestion,
  } = useAppStore(
    useShallow((state) => ({
      addMessage: state.addMessage,
      applyAgentEvent: state.applyAgentEvent,
      updateTokenUsage: state.updateTokenUsage,
      setTruncationInfo: state.setTruncationInfo,
      updateSession: state.updateSession,
      updateMessage: state.updateMessage,
      setTaskList: state.setTaskList,
      loadTaskList: state.loadTaskList,
      updateTaskListDelta: state.updateTaskListDelta,
      setEvaluationState: state.setEvaluationState,
      applyChildProgress: state.applyChildProgress,
      persistSessionTitle: state.persistSessionTitle,
      refreshChatsNow: state.refreshChatsNow,
      setPendingQuestion: state.setPendingQuestion,
      clearPendingQuestion: state.clearPendingQuestion,
    })),
  );

  const agentClientRef = useRef<AgentClient | null>(null);
  if (!agentClientRef.current) {
    agentClientRef.current = getSharedAgentClient();
  }
  const taskBaselineRecoveryRef = useRef<Set<string>>(new Set());
  const parentSettleTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // sessionId -> subscription
  const subscriptionsBySessionRef = useRef<Map<string, SubscriptionEntry>>(new Map());

  // sessionId -> streaming state
  const streamingStateBySessionRef = useRef<
    Map<
      string,
      {
        sessionId: string;
        messageId: string;
        content: string;
        reasoningMessageId: string;
        reasoningContent: string;
        statusMessageId: string;
        status: string;
      }
    >
  >(new Map());

  // parentSessionId -> { children, parentDone }
  const backgroundChildrenByParentRef = useRef<
    Map<string, { children: Set<string>; parentDone: boolean }>
  >(new Map());

  // toolCallId -> toolName mapping for tracking tool names across start/complete
  const toolNamesByCallIdRef = useRef<Map<string, string>>(new Map());
  // toolCallId -> messageId mapping so we can update the tool call card in-place
  const toolCallMessageIdByCallIdRef = useRef<Map<string, string>>(new Map());

  // Chats that are processing but we couldn't subscribe yet (missing sessionId)
  const pendingSessionIdsRef = useRef<Set<string>>(new Set());

  // Reconnect backoff state (sessionId -> state)
  const reconnectStateBySessionRef = useRef<
    Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> | null }>
  >(new Map());

  const clearReconnect = useCallback((sessionId: string) => {
    const existing = reconnectStateBySessionRef.current.get(sessionId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    reconnectStateBySessionRef.current.delete(sessionId);
  }, []);

  const clearParentSettleTimer = useCallback((sessionId: string) => {
    const timer = parentSettleTimersRef.current.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      parentSettleTimersRef.current.delete(sessionId);
    }
  }, []);

  const cleanupChat = useCallback(
    (sessionId: string, opts?: { clearDraft?: boolean }) => {
      debugSse("cleanupChat", sessionId, opts);
      clearReconnect(sessionId);
      clearParentSettleTimer(sessionId);
      pendingSessionIdsRef.current.delete(sessionId);

      const existing = subscriptionsBySessionRef.current.get(sessionId);
      if (!existing) return;

      subscriptionsBySessionRef.current.delete(sessionId);

      // Abort SSE
      existing.controller.abort();

      // Force flush any pending streaming updates before cleaning up
      streamingMessageBus.forceFlush();

      // Clear streaming placeholder only when we really want to discard the draft.
      // This lets us preserve in-memory draft content across view switches and
      // transient resubscribe cycles (e.g. network hiccups) without touching storage.
      const streaming = streamingStateBySessionRef.current.get(existing.sessionId);
      if (streaming) {
        if (opts?.clearDraft) {
          streamingMessageBus.clear(streaming.sessionId, streaming.messageId);
          streamingMessageBus.clear(streaming.sessionId, streaming.reasoningMessageId);
          streamingMessageBus.clear(streaming.sessionId, streaming.statusMessageId);
        }
        streamingStateBySessionRef.current.delete(existing.sessionId);
      } else if (opts?.clearDraft) {
        streamingMessageBus.clear(sessionId, `streaming-${sessionId}`);
        streamingMessageBus.clear(sessionId, `streaming-reasoning-${sessionId}`);
        streamingMessageBus.clear(sessionId, `streaming-status-${sessionId}`);
      }
    },
    [clearParentSettleTimer, clearReconnect],
  );

  const ensureTaskListBaseline = useCallback(
    async (sessionId: string) => {
      const normalizedSessionId = sessionId.trim();
      if (!normalizedSessionId) return;
      if (taskBaselineRecoveryRef.current.has(normalizedSessionId)) return;
      if (useAppStore.getState().taskLists[normalizedSessionId]) return;

      taskBaselineRecoveryRef.current.add(normalizedSessionId);
      try {
        await loadTaskList(normalizedSessionId);
      } catch (error) {
        console.warn(
          `[useAgentEventSubscription] Failed to recover task list baseline for ${normalizedSessionId}:`,
          error,
        );
      } finally {
        taskBaselineRecoveryRef.current.delete(normalizedSessionId);
      }
    },
    [loadTaskList],
  );

  const startSubscription = useCallback(
    (sessionId: string) => {
      const generation = selectGeneration(sessionId)(useAppStore.getState()) ?? 0;
      debugSse("startSubscription", sessionId, "generation:", generation);
      // If a reconnect was scheduled, starting a new subscription supersedes it.
      clearReconnect(sessionId);

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
      const existingDraft = streamingMessageBus.getLatest(messageId);
      const existingReasoningDraft = streamingMessageBus.getLatest(reasoningMessageId);
      const existingStatus = streamingMessageBus.getLatest(statusMessageId);
      streamingStateBySessionRef.current.set(sessionId, {
        sessionId,
        messageId,
        content: existingDraft ?? "",
        reasoningMessageId,
        reasoningContent: existingReasoningDraft ?? "",
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

      // Only publish an empty placeholder if we don't already have a draft.
      // If we do, keep it as-is so remounting the view doesn't "blink" to empty.
      if (existingDraft === null) {
        streamingMessageBus.publish({ sessionId, messageId, content: "" });
      }

      const scheduleReconnect = () => {
        const prev = reconnectStateBySessionRef.current.get(sessionId);
        const attempt = prev?.attempt ?? 0;
        const delayMs = Math.min(5000, 250 * Math.pow(2, attempt));
        debugSse("scheduleReconnect", sessionId, "delay:", delayMs, "attempt:", attempt);

        cleanupChat(sessionId, { clearDraft: false });
        const timer = setTimeout(() => {
          reconnectStateBySessionRef.current.delete(sessionId);
          // selectShouldObserve = any active execution; triggers reconnect while session is alive
          if (!selectShouldObserve(sessionId)(useAppStore.getState())) return;
          const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
          const sid = chat?.id?.trim();
          if (!sid) return;
          startSubscription(sid);
        }, delayMs);
        reconnectStateBySessionRef.current.set(sessionId, {
          attempt: attempt + 1,
          timer,
        });
      };

      let terminalEventSeen = false;
      const PARENT_SETTLE_DELAY_MS = 250;

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
          return;
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
              applyAgentEvent(
                sessionId,
                { type: "token", content: tokenContent } as AgentEvent,
                generation,
              );
              const state = streamingStateBySessionRef.current.get(sessionId);
              if (!state) return;
              setStreamingStatus(null);
              state.content += tokenContent;
              streamingMessageBus.publish({
                sessionId: state.sessionId,
                messageId: state.messageId,
                content: state.content,
              });
            },

            onReasoningToken: (tokenContent: string) => {
              applyAgentEvent(
                sessionId,
                { type: "reasoning_token", content: tokenContent } as AgentEvent,
                generation,
              );
              const state = streamingStateBySessionRef.current.get(sessionId);
              if (!state) return;
              state.reasoningContent += tokenContent;
              streamingMessageBus.publish({
                sessionId: state.sessionId,
                messageId: state.reasoningMessageId,
                content: state.reasoningContent,
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
                  if (streamingState.status) {
                    streamingState.status = "";
                    streamingMessageBus.clear(
                      streamingState.sessionId,
                      streamingState.statusMessageId,
                    );
                  }
                  streamingMessageBus.publish({
                    sessionId: streamingState.sessionId,
                    messageId: streamingState.messageId,
                    content: "",
                  });
                  streamingMessageBus.publish({
                    sessionId: streamingState.sessionId,
                    messageId: streamingState.reasoningMessageId,
                    content: "",
                  });
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
              const messageId = toolCallMessageIdByCallIdRef.current.get(toolCallId);

              const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
              if (!chat) return;

              // Fallback to checking the most recent message if messageId isn't found exactly
              // (e.g. if the tool call was started by another client and we just connected)
              const msg =
                (messageId ? chat?.messages.find((m) => m.id === messageId) : null) ||
                chat?.messages[chat.messages.length - 1];

              if (
                !msg ||
                !("type" in msg) ||
                msg.type !== "tool_call" ||
                !("toolCalls" in msg) ||
                !Array.isArray(msg.toolCalls)
              ) {
                return;
              }

              // If we didn't track the tool name yet (e.g. we just connected), infer it from the message
              const targetCall = msg.toolCalls.find((c) => c.toolCallId === toolCallId);
              if (targetCall && !toolNamesByCallIdRef.current.has(toolCallId)) {
                toolNamesByCallIdRef.current.set(toolCallId, targetCall.toolName);
                toolCallMessageIdByCallIdRef.current.set(toolCallId, msg.id);
              }

              const updatedToolCalls = msg.toolCalls.map(
                (call: {
                  toolCallId: string;
                  toolName: string;
                  parameters: Record<string, unknown>;
                  streamingOutput?: string;
                }) => {
                  if (call.toolCallId !== toolCallId) return call;
                  const next = (call.streamingOutput || "") + (tokenContent || "");
                  return { ...call, streamingOutput: next };
                },
              );

              updateMessage(sessionId, msg.id, {
                toolCalls: updatedToolCalls,
              });
            },

            onToolComplete: (toolCallId, result: AgentEvent["result"]) => {
              applyAgentEvent(
                sessionId,
                { type: "tool_complete", tool_call_id: toolCallId } as AgentEvent,
                generation,
              );
              // Retrieve tool name tracked in onToolStart
              const toolName = toolNamesByCallIdRef.current.get(toolCallId) || "unknown";
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
              toolNamesByCallIdRef.current.delete(toolCallId);
              toolCallMessageIdByCallIdRef.current.delete(toolCallId);
              setStreamingStatus(null);
              void addMessage(sessionId, {
                id: crypto.randomUUID(),
                role: "assistant",
                type: "tool_result",
                toolName: "unknown",
                toolCallId,
                result: {
                  tool_name: "unknown",
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
                    title: `需要审批: ${_toolName || "未知工具"}`,
                    body: `工具 ${_toolName || ""} 需要您的审批后才能执行`,
                    sessionId,
                    eventType: "tool_approval",
                    eventId: toolCallId,
                  });
                }
              }

              // When a tool finishes, update its message card with timing metadata
              if (phase === "finished" || phase === "error" || phase === "cancelled") {
                const messageId = toolCallMessageIdByCallIdRef.current.get(toolCallId);
                if (messageId) {
                  void updateMessage(sessionId, messageId, {
                    metadata: {
                      elapsed_ms: elapsedMs,
                      is_mutating: isMutating,
                    },
                  });
                }

                // Only clear the streaming status if it's currently showing THIS tool
                const normalizedToolName = (_toolName || "").trim().toLowerCase();
                const currentState = streamingStateBySessionRef.current.get(sessionId);
                const shouldClearStatus = isMemoryStatusTool(_toolName || "")
                  ? currentState?.status === "memory_updating"
                  : Boolean(
                      currentState?.status && currentState.status.includes(normalizedToolName),
                    );
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
              const maxContextTokens =
                typeof usage.max_context_tokens === "number" && usage.max_context_tokens > 0
                  ? usage.max_context_tokens
                  : undefined;
              const tokenUsage = {
                systemTokens: usage.system_tokens,
                summaryTokens: usage.summary_tokens,
                windowTokens: usage.window_tokens,
                totalTokens: usage.total_tokens,
                budgetLimit: usage.budget_limit,
                ...(maxContextTokens ? { maxContextTokens } : {}),
                ...(typeof usage.prompt_cached_tool_outputs === "number" &&
                usage.prompt_cached_tool_outputs > 0
                  ? { promptCachedToolOutputs: usage.prompt_cached_tool_outputs }
                  : {}),
              };

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
                `Conversation summarized: ${summaryInfo.messages_summarized} messages compressed, saved ${summaryInfo.tokens_saved.toLocaleString()} tokens`,
                5,
              );
            },

            onContextPressureNotification: (_percent, level, msg) => {
              if (level === "critical") {
                message.error(msg, 6);
                void sendDesktopNotification({
                  title: "上下文即将耗尽",
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

            onTaskListCompleted: (_sid, totalRounds, totalToolCalls) => {
              message.success(
                `All tasks completed! Total rounds: ${totalRounds}, Tool calls: ${totalToolCalls}`,
                3,
              );
            },

            onTaskEvaluationStarted: (sid, itemsCount) => {
              setEvaluationState(sid, {
                isEvaluating: true,
                reasoning: null,
                timestamp: Date.now(),
              });
              message.info(`Evaluating ${itemsCount} task(s)...`, 2);
            },

            onTaskEvaluationCompleted: (sid, updatesCount, reasoning) => {
              const compactReasoning = compactEvaluationReasoning(reasoning);
              setEvaluationState(sid, {
                isEvaluating: false,
                reasoning: updatesCount > 0 ? compactReasoning : null,
                timestamp: Date.now(),
              });

              if (updatesCount > 0) {
                message.success(`Evaluation complete: ${updatesCount} task(s) updated.`, 3);
              } else {
                message.info(`Evaluation complete: No updates needed`, 2);
              }
            },

            onComplete: () => {
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
                  cur != null &&
                  (cur.controller !== ownerController || cur.generation !== generation)
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
                const streamedRaw = state?.content || "";
                const streamedReasoningRaw = state?.reasoningContent || "";
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
                  const chatAfterSync = useAppStore
                    .getState()
                    .chats.find((c) => c.id === sessionId);
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
                  reasoning:
                    updatesCount > 0 ? compactEvaluationReasoning(evt.reasoning ?? "") : null,
                  timestamp: Date.now(),
                });
                return;
              }

              if (evt.type === "runner_progress") {
                const current = selectChildren(parentSessionId)(useAppStore.getState())?.[
                  childSessionId
                ];
                if (current?.status && TERMINAL_CHILD_STATUS.has(current.status)) {
                  return;
                }
                applyChildProgress(parentSessionId, childSessionId, {
                  status: "running",
                  roundCount:
                    typeof evt.round_count === "number" ? evt.round_count : current?.roundCount,
                  lastEventAt: new Date().toISOString(),
                });
                return;
              }

              // Maintain a small rolling preview for fast UI feedback.
              if (evt.type === "token" && typeof evt.content === "string") {
                const prev =
                  selectChildren(parentSessionId)(useAppStore.getState())?.[childSessionId]
                    ?.outputPreview || "";
                const next = (prev + evt.content).slice(-2000);
                applyChildProgress(parentSessionId, childSessionId, {
                  status: "running",
                  outputPreview: next,
                  lastEventAt: new Date().toISOString(),
                });
              } else {
                applyChildProgress(parentSessionId, childSessionId, {
                  status: "running",
                  lastEventAt: new Date().toISOString(),
                });
              }
            },

            onSubAgentHeartbeat: (parentSessionId, childSessionId, ts) => {
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

              applyChildProgress(parentSessionId, childSessionId, {
                status,
                error,
                lastEventAt: new Date().toISOString(),
              });

              // Notify when a background sub-agent completes successfully
              if (status === "completed") {
                const child = selectChildren(parentSessionId)(useAppStore.getState())?.[
                  childSessionId
                ];
                void sendDesktopNotification({
                  title: "后台任务完成",
                  body: child?.title ? `「${child.title}」已完成` : "一个后台任务已完成",
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
                title: "Bodhi AI 需要您的回复",
                body: truncatedQuestion || "Agent 需要您回答一个问题",
                sessionId: targetSessionId,
                eventType: "clarification",
                eventId: event.tool_call_id ?? undefined,
              });
            },

            onExecutionStarted: (runId, _startedAt) => {
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
          // If we explicitly aborted, do nothing (normal cleanup path).
          if (controller.signal.aborted) return;

          // Some runtimes surface network disconnects as AbortError even when we didn't abort.
          // In that case, attempt to resubscribe instead of tearing down processing state.
          if (isAbortError(err)) {
            if (shouldSkipReconnectAfterTerminal()) return;

            // selectShouldObserve = any active execution; attempt reconnect while session is alive
            const stillBusy = selectShouldObserve(sessionId)(useAppStore.getState());
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
    },
    [
      addMessage,
      cleanupChat,
      clearParentSettleTimer,
      clearPendingQuestion,
      clearReconnect,
      ensureTaskListBaseline,
      message,
      persistSessionTitle,
      refreshChatsNow,
      setEvaluationState,
      setPendingQuestion,
      applyAgentEvent,
      setTaskList,
      setTruncationInfo,
      updateMessage,
      updateSession,
      updateTaskListDelta,
      updateTokenUsage,
      applyChildProgress,
    ],
  );

  const ensureSubscription = useCallback(
    (sessionId: string) => {
      const normalizedSessionId = sessionId.trim();
      if (!normalizedSessionId) {
        return;
      }

      pendingSessionIdsRef.current.delete(normalizedSessionId);

      const existing = subscriptionsBySessionRef.current.get(normalizedSessionId);
      // Only skip if the existing subscription is truly live.
      // A controller can still be "not aborted" even after the SSE reader already ended,
      // while old onComplete/onError cleanup is still in flight. That stale entry must not
      // block the next execution generation for the same session.
      if (
        existing?.sessionId === normalizedSessionId &&
        !existing.controller.signal.aborted &&
        !existing.streamEnded
      ) {
        debugSse(
          "skipExistingSubscription",
          normalizedSessionId,
          "generation:",
          existing.generation,
          "streamEnded:",
          existing.streamEnded,
        );
        return;
      }

      // If we need to restart the SSE connection (e.g. sessionId changed or stale entry),
      // keep any existing draft in-memory so the UI doesn't lose what it already rendered.
      if (existing) {
        debugSse(
          "restartStaleSubscription",
          normalizedSessionId,
          "generation:",
          existing.generation,
          "aborted:",
          existing.controller.signal.aborted,
          "streamEnded:",
          existing.streamEnded,
        );
        cleanupChat(normalizedSessionId, { clearDraft: false });
      }
      startSubscription(normalizedSessionId);
    },
    [cleanupChat, startSubscription],
  );

  // Effect A: reconcile active subscriptions when busy sessions change (NO global cleanup return)
  const executionBySession = useAppStore((state) => state.executionBySession);
  useEffect(() => {
    const state = { executionBySession };
    const busySessionIds = new Set(
      Object.entries(executionBySession)
        .filter(([id]) => selectShouldObserve(id)(state))
        .map(([id]) => id),
    );

    // Start needed subscriptions
    busySessionIds.forEach((sessionId) => ensureSubscription(sessionId));

    // Stop subscriptions for chats no longer processing
    for (const sessionId of Array.from(subscriptionsBySessionRef.current.keys())) {
      if (!busySessionIds.has(sessionId)) {
        cleanupChat(sessionId, { clearDraft: true });
      }
    }

    // Drop pending chats that are no longer processing
    for (const sessionId of Array.from(pendingSessionIdsRef.current)) {
      if (!busySessionIds.has(sessionId)) {
        pendingSessionIdsRef.current.delete(sessionId);
      }
    }
  }, [executionBySession, ensureSubscription, cleanupChat]);

  // Retry pending processing chats when chats/config updates (e.g. sessionId arrives)
  useEffect(() => {
    return useAppStore.subscribe(
      (s) => s.chats,
      () => {
        if (pendingSessionIdsRef.current.size === 0) return;

        for (const sessionId of Array.from(pendingSessionIdsRef.current)) {
          if (!selectShouldObserve(sessionId)(useAppStore.getState())) {
            pendingSessionIdsRef.current.delete(sessionId);
            continue;
          }
          ensureSubscription(sessionId);
        }
      },
    );
  }, [ensureSubscription]);

  // Effect B: unmount cleanup only
  useEffect(() => {
    const subscriptionsBySession = subscriptionsBySessionRef.current;

    return () => {
      const activeSessionIds = Array.from(subscriptionsBySession.keys());
      for (const sessionId of activeSessionIds) {
        cleanupChat(sessionId, { clearDraft: true });
      }
    };
  }, [cleanupChat]);
}
