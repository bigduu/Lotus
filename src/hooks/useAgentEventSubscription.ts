import { useEffect, useRef, useCallback } from "react";
import {
  AgentClient,
  TokenBudgetUsage,
  ContextSummaryInfo,
  TaskList,
  TaskListDelta,
  AgentEvent,
} from "../services/chat/AgentService";
import { useAppStore } from "../pages/ChatPage/store";
import { streamingMessageBus } from "../pages/ChatPage/utils/streamingMessageBus";
import type { Message } from "../pages/ChatPage/types/chatMessages";
import { message } from "antd";
import {
  formatCompletionPolicyViolationMessage,
  isCompletionPolicyViolationError,
} from "../shared/utils/completionPolicyViolation";

type SubscriptionEntry = {
  sessionId: string;
  controller: AbortController;
};

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

const isMemoryStatusTool = (toolName: string): boolean => {
  const normalizedToolName = toolName.trim().toLowerCase();
  return normalizedToolName === "memory_note" || normalizedToolName === "session_note";
};

export function useAgentEventSubscription() {
  const processingChats = useAppStore((state) => state.processingChats);

  // Stable store actions
  const addMessage = useAppStore((state) => state.addMessage);
  const setSessionProcessing = useAppStore((state) => state.setSessionProcessing);
  const updateTokenUsage = useAppStore((state) => state.updateTokenUsage);
  const setTruncationInfo = useAppStore((state) => state.setTruncationInfo);
  const updateSession = useAppStore((state) => state.updateSession);
  const updateMessage = useAppStore((state) => state.updateMessage);
  const setTaskList = useAppStore((state) => state.setTaskList);
  const updateTaskListDelta = useAppStore((state) => state.updateTaskListDelta);
  const setEvaluationState = useAppStore((state) => state.setEvaluationState);
  const upsertSubSessionProgress = useAppStore((state) => state.upsertSubSessionProgress);
  const refreshChats = useAppStore((state) => state.refreshChats);

  const agentClientRef = useRef(new AgentClient());

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

  const cleanupChat = useCallback(
    (sessionId: string, opts?: { clearDraft?: boolean }) => {
      clearReconnect(sessionId);
      pendingSessionIdsRef.current.delete(sessionId);

      const existing = subscriptionsBySessionRef.current.get(sessionId);
      if (!existing) return;

      subscriptionsBySessionRef.current.delete(sessionId);

      // Abort SSE
      existing.controller.abort();

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
    [clearReconnect],
  );

  const startSubscription = useCallback(
    (sessionId: string) => {
      // If a reconnect was scheduled, starting a new subscription supersedes it.
      clearReconnect(sessionId);

      const controller = new AbortController();
      subscriptionsBySessionRef.current.set(sessionId, {
        sessionId,
        controller,
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

        cleanupChat(sessionId, { clearDraft: false });
        const timer = setTimeout(() => {
          reconnectStateBySessionRef.current.delete(sessionId);
          if (!useAppStore.getState().processingChats.has(sessionId)) return;
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

      agentClientRef.current
        .subscribeToEvents(
          sessionId,
          {
            onToken: (tokenContent: string) => {
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
              const messageId = toolCallMessageIdByCallIdRef.current.get(toolCallId);
              if (!messageId) return;

              const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
              if (!chat) return;
              const msg = chat?.messages.find((m) => m.id === messageId);
              if (
                !msg ||
                !("type" in msg) ||
                msg.type !== "tool_call" ||
                !("toolCalls" in msg) ||
                !Array.isArray(msg.toolCalls)
              ) {
                return;
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

              updateMessage(sessionId, messageId, {
                toolCalls: updatedToolCalls,
              });
            },

            onToolComplete: (toolCallId, result: AgentEvent["result"]) => {
              // Retrieve tool name tracked in onToolStart
              const toolName = toolNamesByCallIdRef.current.get(toolCallId) || "unknown";
              toolNamesByCallIdRef.current.delete(toolCallId);
              toolCallMessageIdByCallIdRef.current.delete(toolCallId);
              setStreamingStatus(null);

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

            onToolLifecycle: (toolCallId, _toolName, phase, elapsedMs, isMutating) => {
              if (phase === "begin") {
                const normalizedToolName = (_toolName || "").trim().toLowerCase();
                if (isMemoryStatusTool(_toolName || "")) {
                  setStreamingStatus("memory_updating");
                } else {
                  setStreamingStatus(`tool_running:${normalizedToolName || "tool"}`);
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
                setStreamingStatus(null);
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

            onTaskListUpdated: (taskList: TaskList) => {
              if (taskList.session_id) {
                setTaskList(taskList.session_id, taskList);
              }
            },

            onTaskListItemProgress: (delta: TaskListDelta) => {
              if (delta.session_id) {
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
              // Capture the controller that owns THIS execution run.  The async
              // body below may outlive this subscription (e.g. loadChatHistory
              // retries take ~2s).  If the user responds to conclusion_with_options and a *new*
              // subscription starts for the same sessionId in the meantime, we
              // must NOT clean up the new one.
              const ownerController = controller;

              void (async () => {
                // Detect if a *different* subscription took over for the same
                // sessionId while we were waiting (e.g. loadChatHistory retries).
                // When that happens the current ref entry will point to a
                // different controller, meaning our cleanup would kill the live
                // successor.
                const isSuperseded = () => {
                  const cur = subscriptionsBySessionRef.current.get(sessionId);
                  return cur != null && cur.controller !== ownerController;
                };

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
                // subscription alive to forward sub-session progress.
                const bg =
                  backgroundChildrenByParentRef.current.get(sessionId) ??
                  ({ children: new Set<string>(), parentDone: false } as const);
                backgroundChildrenByParentRef.current.set(sessionId, {
                  children: new Set(bg.children),
                  parentDone: true,
                });

                if (bg.children.size === 0) {
                  cleanupChat(sessionId, { clearDraft: true });
                  setSessionProcessing(sessionId, false);
                } else {
                  // Clear the draft but keep subscription.
                  const entry = subscriptionsBySessionRef.current.get(sessionId);
                  if (entry) {
                    streamingMessageBus.clear(sessionId, `streaming-${sessionId}`);
                    streamingMessageBus.clear(sessionId, `streaming-reasoning-${sessionId}`);
                    streamingMessageBus.clear(sessionId, `streaming-status-${sessionId}`);
                    streamingStateBySessionRef.current.delete(entry.sessionId);
                  }
                }
              })();
            },

            onError: async (errorMessage: string) => {
              setStreamingStatus(null);

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

              const bg =
                backgroundChildrenByParentRef.current.get(sessionId) ??
                ({ children: new Set<string>(), parentDone: false } as const);
              backgroundChildrenByParentRef.current.set(sessionId, {
                children: new Set(bg.children),
                parentDone: true,
              });

              if (bg.children.size === 0) {
                cleanupChat(sessionId, { clearDraft: true });
                setSessionProcessing(sessionId, false);
              }
            },

            onSubSessionStarted: (parentSessionId, childSessionId, title) => {
              const bg =
                backgroundChildrenByParentRef.current.get(parentSessionId) ??
                ({ children: new Set<string>(), parentDone: false } as const);
              const children = new Set(bg.children);
              children.add(childSessionId);
              backgroundChildrenByParentRef.current.set(parentSessionId, {
                children,
                parentDone: bg.parentDone,
              });

              // Keep the parent subscribed while children are running.
              setSessionProcessing(sessionId, true);

              upsertSubSessionProgress(parentSessionId, childSessionId, {
                title,
                // "started" now means "created + queued". Mark as pending until
                // we observe child events/heartbeat/completion.
                status: "pending",
                lastEventAt: new Date().toISOString(),
              });

              // Ensure the child session appears in the session list.
              void refreshChats();
            },

            onSubSessionEvent: (parentSessionId, childSessionId, evt: AgentEvent) => {
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

              // Maintain a small rolling preview for fast UI feedback.
              if (evt.type === "token" && typeof evt.content === "string") {
                const prev =
                  useAppStore.getState().subSessionsByParent?.[parentSessionId]?.[childSessionId]
                    ?.outputPreview || "";
                const next = (prev + evt.content).slice(-2000);
                upsertSubSessionProgress(parentSessionId, childSessionId, {
                  status: "running",
                  outputPreview: next,
                  lastEventAt: new Date().toISOString(),
                });
              } else {
                upsertSubSessionProgress(parentSessionId, childSessionId, {
                  status: "running",
                  lastEventAt: new Date().toISOString(),
                });
              }
            },

            onSubSessionHeartbeat: (parentSessionId, childSessionId, ts) => {
              upsertSubSessionProgress(parentSessionId, childSessionId, {
                status: "running",
                lastHeartbeatAt: ts,
              });
            },

            onSubSessionCompleted: (parentSessionId, childSessionId, status, error) => {
              const bg =
                backgroundChildrenByParentRef.current.get(parentSessionId) ??
                ({ children: new Set<string>(), parentDone: false } as const);
              const children = new Set(bg.children);
              children.delete(childSessionId);
              backgroundChildrenByParentRef.current.set(parentSessionId, {
                children,
                parentDone: bg.parentDone,
              });

              upsertSubSessionProgress(parentSessionId, childSessionId, {
                status,
                error,
                lastEventAt: new Date().toISOString(),
              });

              // If parent already completed and no more background children, stop subscription.
              if (bg.parentDone && children.size === 0) {
                cleanupChat(sessionId, { clearDraft: true });
                setSessionProcessing(sessionId, false);
              }

              void refreshChats();
            },
          },
          controller,
        )
        .then(() => {
          // Stream ended without throwing. Backend SSE should be long-lived; treat this as a
          // disconnect and attempt to resubscribe (unless we were explicitly aborted).
          if (controller.signal.aborted) return;

          // If a newer subscription already replaced this one (e.g. user
          // responded to conclusion_with_options quickly), don't interfere with it.
          const currentSub = subscriptionsBySessionRef.current.get(sessionId);
          if (currentSub && currentSub.controller !== controller) return;

          const stillProcessing = useAppStore.getState().processingChats.has(sessionId);
          if (!stillProcessing) {
            cleanupChat(sessionId, { clearDraft: true });
            return;
          }

          // Restart subscription with backoff.
          scheduleReconnect();
        })
        .catch((err) => {
          // If we explicitly aborted, do nothing (normal cleanup path).
          if (controller.signal.aborted) return;

          // Some runtimes surface network disconnects as AbortError even when we didn't abort.
          // In that case, attempt to resubscribe instead of tearing down processing state.
          if (isAbortError(err)) {
            const stillProcessing = useAppStore.getState().processingChats.has(sessionId);
            if (!stillProcessing) {
              cleanupChat(sessionId, { clearDraft: true });
              return;
            }

            scheduleReconnect();
            return;
          }

          console.error("[useAgentEventSubscription] Subscription error:", err);
          cleanupChat(sessionId, { clearDraft: true });
          setSessionProcessing(sessionId, false);
        });
    },
    [
      addMessage,
      cleanupChat,
      clearReconnect,
      refreshChats,
      setEvaluationState,
      setSessionProcessing,
      setTaskList,
      setTruncationInfo,
      updateMessage,
      updateSession,
      updateTaskListDelta,
      updateTokenUsage,
      upsertSubSessionProgress,
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
      // Only skip if the existing subscription is still alive (controller not aborted).
      // When onComplete is still running its async cleanup (loadChatHistory with retries),
      // the subscription entry lingers but the SSE reader has already finished.
      // In that case we must restart so events from the next execution run are captured.
      if (existing?.sessionId === normalizedSessionId && !existing.controller.signal.aborted) {
        return;
      }

      // If we need to restart the SSE connection (e.g. sessionId changed or stale entry),
      // keep any existing draft in-memory so the UI doesn't lose what it already rendered.
      if (existing) cleanupChat(normalizedSessionId, { clearDraft: false });
      startSubscription(normalizedSessionId);
    },
    [cleanupChat, startSubscription],
  );

  // Effect A: reconcile active subscriptions when processingChats changes (NO global cleanup return)
  useEffect(() => {
    // Start needed subscriptions
    processingChats.forEach((sessionId) => ensureSubscription(sessionId));

    // Stop subscriptions for chats no longer processing
    for (const sessionId of Array.from(subscriptionsBySessionRef.current.keys())) {
      if (!processingChats.has(sessionId)) {
        cleanupChat(sessionId, { clearDraft: true });
      }
    }

    // Drop pending chats that are no longer processing
    for (const sessionId of Array.from(pendingSessionIdsRef.current)) {
      if (!processingChats.has(sessionId)) {
        pendingSessionIdsRef.current.delete(sessionId);
      }
    }
  }, [processingChats, ensureSubscription, cleanupChat]);

  // Retry pending processing chats when chats/config updates (e.g. sessionId arrives)
  useEffect(() => {
    return useAppStore.subscribe(
      (s) => s.chats,
      () => {
        if (pendingSessionIdsRef.current.size === 0) return;

        for (const sessionId of Array.from(pendingSessionIdsRef.current)) {
          if (!useAppStore.getState().processingChats.has(sessionId)) {
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
