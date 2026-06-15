import { AgentEvent } from "@services/chat/AgentService";
import { useAppStore, selectShouldObserve, selectGeneration } from "@shared/store/appStore";
import { streamingMessageBus } from "../utils/streamingMessageBus";
import {
  clearAssistantStreamingState,
  getAssistantStreamingState,
} from "../streaming/assistantStreamingAtoms";
import type { Message } from "@shared/types/chatMessages";
import {
  formatCompletionPolicyViolationMessage,
  isCompletionPolicyViolationError,
} from "@shared/utils/completionPolicyViolation";
import { fireDesktopNotification } from "@services/notification/desktopNotification";
import { notificationTitleForCategory } from "./subscriptionHandlers/notificationCopy";
import { debugLog } from "@shared/utils/debugFlags";
import { debugSse, isAbortError } from "./useAgentEventSubscription.helpers";
import {
  PARENT_SETTLE_DELAY_MS,
  TITLE_REFRESH_RETRY_DELAYS_MS,
  isUntitledChatTitle,
} from "./agentSubscriptionRunner.helpers";
import type { SubscriptionContext, RunContext } from "./subscriptionContext";
import { createStreamingHandlers } from "./subscriptionHandlers/streamingHandlers";
import { createToolHandlers } from "./subscriptionHandlers/toolHandlers";
import { createContextHandlers } from "./subscriptionHandlers/contextHandlers";
import { createTaskListHandlers } from "./subscriptionHandlers/taskListHandlers";
import { createSessionMetaHandlers } from "./subscriptionHandlers/sessionMetaHandlers";
import { createChildHandlers } from "./subscriptionHandlers/childHandlers";

/**
 * Open (or reconnect) the SSE subscription for one session. The per-event-domain
 * handlers live in ./subscriptionHandlers/*; this orchestrator owns the
 * per-subscription engine (status/reconnect/settle closures + terminal &
 * clarification handlers that drive the two terminal flags) and wires a
 * RunContext through to the domain factories.
 */
export function startAgentSubscription(sessionId: string, ctx: SubscriptionContext): void {
  const {
    addMessage,
    applyAgentEvent,
    updateMessage,
    refreshChatsNow,
    setPendingQuestion,
    clearPendingQuestion,
    cleanupChat,
    clearReconnect,
    clearParentSettleTimer,
    clearTitleRefreshRetry,
    restart,
    agentClientRef,
    parentSettleTimersRef,
    titleRefreshRetryTimersRef,
    subscriptionsBySessionRef,
    streamingStateBySessionRef,
    backgroundChildrenByParentRef,
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

  // Shared per-run context handed to the per-event-domain handler factories.
  const run: RunContext = {
    ctx,
    sessionId,
    generation,
    controller,
    messageId,
    reasoningMessageId,
    statusMessageId,
    setStreamingStatus,
    scheduleParentSettleCheck,
  };

  const client = agentClientRef.current;
  if (!client) return;

  client
    .subscribeToEvents(
      sessionId,
      {
        ...createStreamingHandlers(run),
        ...createToolHandlers(run),
        ...createContextHandlers(run),
        ...createTaskListHandlers(run),
        ...createSessionMetaHandlers(run),
        ...createChildHandlers(run),
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
          // Desktop notification (if any) is delivered by the backend via the
          // `notification` event handled in onNotification below.
        },

        onNotification: (event) => {
          // The backend already classified this event, applied user preferences,
          // and deduplicated it; we only apply the local window-focus check.
          const title = notificationTitleForCategory(event.category) || event.title || "";
          void fireDesktopNotification({
            title,
            body: event.body || "",
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
