import { StateCreator } from "zustand";
import { ChatItem, Message } from "@shared/types/chat";
import { AgentClient } from "@services/chat/AgentService";
import { ApiError } from "@services/api";
import type { AppState } from "../";
import { useProviderStore } from "./providerSlice";
import { applyExecutionEvent } from "./executionStateSlice";
import { applyReplayableSessionEventToList, isSessionMetadataEvent } from "./sessionMetadataSlice";
import i18n from "@shared/i18n";
import { debugLog } from "@shared/utils/debugFlags";
import { resolveProviderDefaultReasoningEffort } from "@shared/utils/reasoningEffort";
import {
  DEFAULT_BASE_SYSTEM_PROMPT,
  mapHistoryMessagesToUi,
  sessionSummaryToChatItem,
} from "./chatSessionSlice/messageMapping";
import {
  REFRESH_CHATS_THROTTLE_MS,
  clearRefreshChatsThrottleWindow,
  consumeTrailingRefreshCallbacks,
  executeForcedRefreshChats,
  executeRefreshChats,
  refreshChatsState,
  settleTrailingRefreshCallbacks,
} from "./chatSessionSlice/refreshChats";

// Re-export public types + the test-only history mapper so existing import
// paths (`@shared/store/appStore/slices/chatSessionSlice`) keep resolving.
export type {
  ChatSlice,
  DeleteMessageResult,
  DeleteMessageFailureReason,
} from "./chatSessionSlice/types";
export { mapHistoryMessagesToUi } from "./chatSessionSlice/messageMapping";

import type { ChatSlice } from "./chatSessionSlice/types";

const agentClient = AgentClient.getInstance();

// Multi-device reconcile debounce: coalesce a burst of account-feed events for
// the open session (e.g. a turn driven on another device emits several change
// events) into a single history+pending reload.
const reconcileTimers = new Map<string, ReturnType<typeof setTimeout>>();
const RECONCILE_DEBOUNCE_MS = 300;

export const createChatSlice: StateCreator<AppState, [], [], ChatSlice> = (set, get) => ({
  chats: [],
  currentSessionId: null,
  latestActiveSessionId: null,

  addChat: async (chatData) => {
    const title = (chatData.title || i18n.t("chat.sidebar.newSession")).trim();
    const basePrompt = chatData.config?.baseSystemPrompt?.trim() || "";
    const activeModel = useProviderStore.getState().getActiveModel()?.trim();
    const model = chatData.config?.model?.trim() || activeModel || undefined;

    // Resolve model_ref when feature flag is ON
    // Always use provider defaults for new sessions, not the global selectedModelRef.
    // selectedModelRef is session-scoped user selection and should not leak into new sessions.
    let modelRef: { provider: string; model: string } | undefined;
    let providerValue: string | undefined;
    if (useProviderStore.getState().isProviderModelRefEnabled()) {
      // Prefer caller-provided model_ref (e.g. from EmptyTaskLauncher with explicit config)
      const callerModelRef = chatData.config?.model_ref;
      if (callerModelRef?.provider?.trim() && callerModelRef?.model?.trim()) {
        modelRef = callerModelRef;
        providerValue = callerModelRef.provider;
      } else {
        // Fall back to provider defaults (settings default model)
        const defaultChat = useProviderStore.getState().providerConfig.defaults?.chat;
        if (defaultChat?.provider?.trim() && defaultChat?.model?.trim()) {
          modelRef = defaultChat;
          providerValue = defaultChat.provider;
        } else {
          const m = useProviderStore.getState().getActiveModel();
          if (m) {
            modelRef = { provider: useProviderStore.getState().currentProvider, model: m };
            providerValue = useProviderStore.getState().currentProvider;
          }
        }
      }
    }

    // Resolve the reasoning effort for the new session. An explicit value from
    // the caller wins; otherwise inherit the provider's configured default
    // (e.g. "Max") so a new session matches what the input box shows, instead
    // of letting the backend silently fall back to its own default ("medium").
    const reasoningEffort =
      chatData.config?.reasoningEffort ??
      resolveProviderDefaultReasoningEffort(
        useProviderStore.getState().providerConfig,
        modelRef ?? null,
        providerValue ?? null,
        useProviderStore.getState().providerInstances,
      );

    const created = await agentClient.createSession({
      title,
      system_prompt: basePrompt || undefined,
      model,
      model_ref: modelRef,
      provider: providerValue,
      reasoning_effort: reasoningEffort || undefined,
      gold_config: chatData.config?.goldConfig ?? undefined,
    });

    const newChat: ChatItem = {
      ...sessionSummaryToChatItem(created.session),
      title,
      config: {
        ...chatData.config,
        model: created.session.model,
        model_ref: created.session.model_ref ?? null,
        reasoningEffort: created.session.reasoning_effort ?? null,
        goldConfig: created.session.gold_config ?? chatData.config?.goldConfig ?? null,
        // If the caller provided a base prompt, keep it; otherwise fall back.
        baseSystemPrompt: basePrompt || DEFAULT_BASE_SYSTEM_PROMPT,
      },
      messages: [],
    };

    set((state) => {
      const chats = [newChat, ...state.chats.filter((c) => c.id !== newChat.id)];
      return {
        ...state,
        chats,
        currentSessionId: newChat.id,
        latestActiveSessionId: newChat.id,
      };
    });

    return newChat.id;
  },

  selectSession: (sessionId) => {
    const prev = get();
    if (prev.currentSessionId === sessionId && prev.latestActiveSessionId === sessionId) {
      return;
    }
    set({ currentSessionId: sessionId, latestActiveSessionId: sessionId });
  },

  deleteSession: async (sessionId) => {
    try {
      await agentClient.deleteSession(sessionId);
    } catch (error) {
      console.error(`[ChatSlice] Failed to delete backend session ${sessionId}:`, error);
    }

    set((state) => {
      const toDelete = new Set<string>();
      for (const chat of state.chats) {
        if (chat.id === sessionId) toDelete.add(chat.id);
        if (chat.rootSessionId === sessionId) toDelete.add(chat.id);
      }

      const newChats = state.chats.filter((c) => !toDelete.has(c.id));
      const nextCurrent =
        state.currentSessionId && toDelete.has(state.currentSessionId)
          ? null
          : state.currentSessionId;
      const nextLatest =
        state.latestActiveSessionId && toDelete.has(state.latestActiveSessionId)
          ? (newChats[0]?.id ?? null)
          : state.latestActiveSessionId;

      return {
        ...state,
        chats: newChats,
        currentSessionId: nextCurrent,
        latestActiveSessionId: nextLatest,
      };
    });
  },

  deleteSessions: async (sessionIds) => {
    for (const id of sessionIds) {
      await get().deleteSession(id);
    }
  },

  updateSession: (sessionId, updates, options) => {
    const hasSessionLevelConfigUpdate =
      !!updates.config &&
      (Object.prototype.hasOwnProperty.call(updates.config, "model") ||
        Object.prototype.hasOwnProperty.call(updates.config, "reasoningEffort") ||
        Object.prototype.hasOwnProperty.call(updates.config, "goldConfig"));
    const hasSessionLevelTopLevelUpdate =
      typeof updates.title === "string" || typeof updates.pinned === "boolean";
    const shouldBumpUpdatedAt = hasSessionLevelConfigUpdate || hasSessionLevelTopLevelUpdate;
    const localUpdatedAt = shouldBumpUpdatedAt ? new Date().toISOString() : undefined;

    set((state) => {
      const chats = state.chats.map((chat) =>
        chat.id === sessionId
          ? {
              ...chat,
              ...updates,
              ...(localUpdatedAt ? { updatedAt: localUpdatedAt } : {}),
            }
          : chat,
      );
      return { ...state, chats };
    });

    // Best-effort backend patch for session-level metadata updates.
    const patch: Record<string, unknown> = {};
    if (typeof updates.title === "string") {
      patch.title = updates.title;
    }
    if (typeof updates.pinned === "boolean") {
      patch.pinned = updates.pinned;
    }
    if (updates.config && Object.prototype.hasOwnProperty.call(updates.config, "model")) {
      patch.model = updates.config.model ?? null;
    }
    if (updates.config && Object.prototype.hasOwnProperty.call(updates.config, "model_ref")) {
      if (useProviderStore.getState().isProviderModelRefEnabled()) {
        patch.model_ref = updates.config.model_ref ?? null;
        if (updates.config.model_ref) {
          patch.provider = updates.config.model_ref.provider;
        }
      }
    }
    if (updates.config && Object.prototype.hasOwnProperty.call(updates.config, "reasoningEffort")) {
      const reasoningEffort = updates.config.reasoningEffort;
      if (reasoningEffort) {
        patch.reasoning_effort = reasoningEffort;
      } else {
        patch.clear_reasoning_effort = true;
      }
    }
    if (updates.config && Object.prototype.hasOwnProperty.call(updates.config, "goldConfig")) {
      patch.gold_config = updates.config.goldConfig ?? {
        enabled: false,
        auto_answer_enabled: false,
        auto_continue_enabled: false,
      };
    }
    // Callers that already persisted these fields via an awaited direct
    // `patchSession` (e.g. the model / reasoning-effort handlers) pass
    // `skipBackendPatch` so we update local state only — otherwise this would
    // fire a redundant second PATCH for the same change.
    if (!options?.skipBackendPatch && Object.keys(patch).length > 0) {
      // NOTE: `patchSession` returns void, so the backend's bumped
      // `title_version` (and any other authoritative server fields) is not
      // available here. The backend emits SSE events (e.g. `session_title_updated`)
      // that `applyServerTitle` reconciles into local state.
      agentClient.patchSession(sessionId, patch).catch((e) => {
        console.warn(`[ChatSlice] Failed to patch session ${sessionId}:`, e);
      });
    }
  },

  persistSessionTitle: async (sessionId, title) => {
    // Capture previous title for rollback.
    const previousTitle = get().chats.find((c) => c.id === sessionId)?.title;

    // Optimistic local update.
    set((state) => ({
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === sessionId ? { ...chat, title, updatedAt: new Date().toISOString() } : chat,
      ),
    }));

    try {
      await agentClient.patchSession(sessionId, { title });
      // NOTE: `patchSession` returns void, so we cannot read the new
      // `title_version` from the PATCH response. The backend emits a
      // `session_title_updated` SSE event after the PATCH bumps the version,
      // and `applyServerTitle` will reconcile `titleVersion` locally there.
    } catch (e) {
      // Roll back to previous title on failure.
      if (typeof previousTitle === "string") {
        set((state) => ({
          ...state,
          chats: state.chats.map((chat) =>
            chat.id === sessionId ? { ...chat, title: previousTitle } : chat,
          ),
        }));
      }
      console.warn(`[ChatSlice] persistSessionTitle failed for ${sessionId}:`, e);
      throw e;
    }
  },

  applyServerTitle: (sessionId, title, titleVersion) =>
    set((state) => {
      const existing = state.chats.find((c) => c.id === sessionId);
      if (!existing) return state;
      if (titleVersion <= (existing.titleVersion ?? 0)) return state;
      return {
        ...state,
        chats: state.chats.map((chat) =>
          chat.id === sessionId
            ? { ...chat, title, titleVersion, updatedAt: new Date().toISOString() }
            : chat,
        ),
      };
    }),

  applyServerPinned: (sessionId, pinned, updatedAt) =>
    set((state) => {
      const existing = state.chats.find((c) => c.id === sessionId);
      if (!existing) return state;
      // Suppress stale replays: if the local copy is newer than the incoming
      // event, ignore. (`pinned` has no version field; we use `updatedAt`.)
      const incoming = Date.parse(updatedAt);
      const local = existing.updatedAt ? Date.parse(existing.updatedAt) : NaN;
      if (Number.isFinite(incoming) && Number.isFinite(local) && incoming < local) {
        return state;
      }
      // Idempotent — skip the re-render if nothing actually changed.
      if (existing.pinned === pinned) return state;
      return {
        ...state,
        chats: state.chats.map((chat) =>
          chat.id === sessionId ? { ...chat, pinned, updatedAt } : chat,
        ),
      };
    }),

  pinSession: (sessionId) => {
    get().updateSession(sessionId, { pinned: true });
  },

  unpinSession: (sessionId) => {
    get().updateSession(sessionId, { pinned: false });
  },

  setMessages: (sessionId, messages) => {
    const chat = get().chats.find((c) => c.id === sessionId);
    if (chat) {
      get().updateSession(sessionId, { messages });
    }
  },

  addMessage: async (sessionId, message) => {
    const chat = get().chats.find((c) => c.id === sessionId);
    if (!chat) return;
    const updatedMessages = [...chat.messages, message];
    get().updateSession(sessionId, { messages: updatedMessages });
  },

  updateMessage: (sessionId, messageId, updates) => {
    const chat = get().chats.find((c) => c.id === sessionId);
    if (!chat) return;

    const updatedMessages = chat.messages.map((msg) => {
      if (msg.id !== messageId) return msg;
      const updatedMsg = { ...msg } as Record<string, unknown>;
      Object.keys(updates).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(updatedMsg, key)) {
          updatedMsg[key] = (updates as Record<string, unknown>)[key];
        }
      });
      return updatedMsg as unknown as Message;
    });

    get().updateSession(sessionId, { messages: updatedMessages });
  },

  deleteMessage: async (sessionId, messageId) => {
    const chat = get().chats.find((c) => c.id === sessionId);
    if (!chat) {
      return {
        success: false,
        sessionId,
        messageId,
        reason: "session_not_found",
      };
    }
    if (!chat.messages.some((msg) => msg.id === messageId)) {
      return {
        success: false,
        sessionId,
        messageId,
        reason: "message_not_found",
      };
    }

    try {
      await agentClient.deleteSessionMessage(sessionId, messageId);
    } catch (e) {
      console.warn(
        `[ChatSlice] Failed to delete message ${messageId} from session ${sessionId}:`,
        e,
      );

      if (e instanceof ApiError) {
        if (e.status === 404) {
          return {
            success: false,
            sessionId,
            messageId,
            reason: "backend_not_found",
            statusCode: e.status,
            errorMessage: e.message,
          };
        }
        if (e.status === 409) {
          return {
            success: false,
            sessionId,
            messageId,
            reason: "session_running",
            statusCode: e.status,
            errorMessage: e.message,
          };
        }
        return {
          success: false,
          sessionId,
          messageId,
          reason: "backend_error",
          statusCode: e.status,
          errorMessage: e.message,
        };
      }

      return {
        success: false,
        sessionId,
        messageId,
        reason: "backend_error",
        errorMessage: e instanceof Error ? e.message : undefined,
      };
    }

    set((state) => ({
      ...state,
      chats: state.chats.map((existingChat) =>
        existingChat.id === sessionId
          ? {
              ...existingChat,
              messages: existingChat.messages.filter((msg) => msg.id !== messageId),
            }
          : existingChat,
      ),
    }));

    return {
      success: true,
      sessionId,
      messageId,
    };
  },

  refreshChats: async () => {
    // If a request is already in flight, wait for it
    if (refreshChatsState.inFlight) {
      return refreshChatsState.inFlight;
    }

    // If we're within the throttle window, queue a trailing call
    if (refreshChatsState.timer) {
      if (!refreshChatsState.trailingPromise) {
        refreshChatsState.trailingPromise = new Promise<void>((resolve, reject) => {
          refreshChatsState.trailingResolve = resolve;
          refreshChatsState.trailingReject = reject;
        });
      }
      return refreshChatsState.trailingPromise;
    }

    // Start throttle window. The timer callback is responsible for flushing
    // any trailing call that arrives while this window is active.
    refreshChatsState.timer = setTimeout(() => {
      refreshChatsState.timer = null;

      if (refreshChatsState.trailingPromise) {
        const callbacks = consumeTrailingRefreshCallbacks();
        settleTrailingRefreshCallbacks(executeRefreshChats(set), callbacks);
      }
    }, REFRESH_CHATS_THROTTLE_MS);

    // Execute immediately
    return executeRefreshChats(set);
  },

  refreshChatsNow: async () => {
    const trailingCallbacks = clearRefreshChatsThrottleWindow();
    debugLog("[ChatSlice]", "refreshChatsNow.start", {
      hadTrailingCallbacks: Boolean(trailingCallbacks),
      hasInflight: Boolean(refreshChatsState.inFlight),
    });
    const refreshPromise = refreshChatsState.inFlight
      ? executeForcedRefreshChats(set)
      : executeRefreshChats(set);
    settleTrailingRefreshCallbacks(refreshPromise, trailingCallbacks);
    return refreshPromise;
  },

  loadChats: async () => {
    debugLog("[ChatSlice]", "loadChats.start", {});
    let list = await agentClient.listSessions();
    if (!list.sessions || list.sessions.length === 0) {
      // Use provider defaults when creating the initial session on startup
      const defaultModel = useProviderStore.getState().getActiveModel()?.trim();
      const defaultModelRef = useProviderStore.getState().providerConfig.defaults?.chat;
      debugLog("[ChatSlice]", "loadChats.createInitialSession", {
        defaultModel: defaultModel ?? null,
        defaultModelRef: defaultModelRef ?? null,
      });
      const created = await agentClient.createSession({
        title: i18n.t("chat.sidebar.newSession"),
        model: defaultModel,
        model_ref: defaultModelRef,
        provider: defaultModelRef?.provider,
      });
      list = { sessions: [created.session] };
    }

    const chats = list.sessions.map(sessionSummaryToChatItem);
    const currentSessionId = chats[0]?.id ?? null;
    debugLog("[ChatSlice]", "loadChats.listResolved", {
      count: list.sessions.length,
      currentSessionId,
    });

    // Reconcile executionBySession against every summary.
    let executionBySession = get().executionBySession;
    for (const summary of list.sessions) {
      executionBySession = applyExecutionEvent(executionBySession, {
        type: "applySessionSummary",
        sessionId: summary.id,
        summary,
      });
    }

    // Replay active running sessions so the UI reflects live state immediately
    // after boot (removes the need for OPTIMISTIC_RACE_WINDOW_MS).
    try {
      const running = await agentClient.getRunningSessions();
      debugLog("[ChatSlice]", "loadChats.runningSnapshot", {
        count: running.sessions.length,
      });
      if (running.sessions.length > 0) {
        // Partition criticalEvents into metadata vs execution before replay.
        // Metadata events (title/pinned) flow through `applyReplayableSessionEvent`
        // so live SSE and boot replay share the same precedence rules; the
        // execution reducer never sees them.
        const partitioned = running.sessions.map((s) => {
          const executionOnly = [];
          for (const event of s.last_critical_events) {
            if (isSessionMetadataEvent(event)) {
              // Bake replay metadata into the local `chats` snapshot before
              // the single trailing `set`. Applying against the store here
              // would be overwritten by that `set` because `chats` was built
              // from the baseline before replay events arrived.
              applyReplayableSessionEventToList(event, chats);
              continue;
            }
            executionOnly.push(event);
          }
          return {
            sessionId: s.session_id,
            runId: s.run_id,
            criticalEvents: executionOnly,
          };
        });

        executionBySession = applyExecutionEvent(
          executionBySession,
          {
            type: "applyRunningSnapshot",
            sessions: partitioned,
          },
          () => new Date().toISOString(),
        );
      }
    } catch (error) {
      debugLog("[ChatSlice]", "loadChats.runningSnapshot.error", { error });
      // Non-fatal: if the backend doesn't support /runs/active yet,
      // fall back to the summary-based reconciliation above.
    }

    set({
      chats,
      latestActiveSessionId: currentSessionId,
      currentSessionId,
      executionBySession,
    });

    debugLog("[ChatSlice]", "loadChats.applied", {
      currentSessionId,
      chatCount: chats.length,
      executionSessionCount: Object.keys(executionBySession || {}).length,
    });

    if (currentSessionId) {
      // Lazy load history for the initial session.
      debugLog("[ChatSlice]", "loadChats.loadInitialHistory", { currentSessionId });
      await get().loadChatHistory(currentSessionId);
    }
  },

  loadChatHistory: async (sessionId, options) => {
    const mode = options?.mode ?? "replace";
    const retries = Math.max(0, options?.retries ?? 0);
    const retryDelayMs = Math.max(0, options?.retryDelayMs ?? 0);

    debugLog("[ChatSlice]", "loadChatHistory.start", {
      sessionId,
      mode,
      retries,
      retryDelayMs,
      waitForAssistant: options?.waitForAssistant ?? false,
    });

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        // Avoid spurious backend calls when the UI layout references a stale session id.
        // (e.g. after backend reset or manual data cleanup)
        const chat = get().chats.find((c) => c.id === sessionId);
        if (!chat) {
          debugLog("[ChatSlice]", "loadChatHistory.skipMissingChat", { sessionId, attempt });
          return;
        }

        const history = await agentClient.getHistory(sessionId);
        debugLog("[ChatSlice]", "loadChatHistory.response", {
          sessionId,
          attempt,
          historyMessageCount: history.messages.length,
          localMessageCount: chat.messages.length,
          localStoredMessageCount: chat.messageCount ?? null,
          lastMessageId: history.messages[history.messages.length - 1]?.id ?? null,
          lastRole: history.messages[history.messages.length - 1]?.role ?? null,
        });

        const lastRole = history.messages[history.messages.length - 1]?.role;
        if (options?.waitForAssistant && lastRole === "user" && attempt < retries) {
          // Backoff to give the backend time to persist the assistant reply.
          const delay = retryDelayMs > 0 ? retryDelayMs * (attempt + 1) : 200 * (attempt + 1);
          debugLog("[ChatSlice]", "loadChatHistory.waitForAssistant.retry", {
            sessionId,
            attempt,
            delay,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        const nextMessages = mapHistoryMessagesToUi(sessionId, history.messages);

        if (mode === "monotonic") {
          const prevMessages = chat.messages || [];
          const prevLen = prevMessages.length;
          const nextLen = nextMessages.length;
          const nextLastRole = nextMessages[nextMessages.length - 1]?.role;
          const prevLastRole = prevMessages[prevMessages.length - 1]?.role;
          const prevLastMessage = prevMessages[prevMessages.length - 1] as Message | undefined;
          const nextLastMessage = nextMessages[nextMessages.length - 1] as Message | undefined;
          const prevLastId = prevLastMessage?.id;
          const nextLastId = nextLastMessage?.id;

          // Avoid wiping newer in-memory UI state with shorter backend snapshots.
          // Only replace when backend is strictly longer, or when lengths are equal
          // but backend clearly progressed from a user tail / changed terminal item.
          let shouldReplace = false;
          if (nextLen > prevLen) {
            shouldReplace = true;
          } else if (nextLen === prevLen) {
            const resolvedUserTail = prevLastRole === "user" && nextLastRole !== "user";
            const terminalChanged =
              typeof prevLastId === "string" &&
              typeof nextLastId === "string" &&
              prevLastId !== nextLastId;
            shouldReplace = resolvedUserTail || terminalChanged;
          }

          debugLog("[ChatSlice]", "loadChatHistory.monotonicDecision", {
            sessionId,
            attempt,
            prevLen,
            nextLen,
            prevLastRole: prevLastRole ?? null,
            nextLastRole: nextLastRole ?? null,
            prevLastId: prevLastId ?? null,
            nextLastId: nextLastId ?? null,
            shouldReplace,
          });

          if (!shouldReplace) {
            get().updateSession(sessionId, {
              messageCount: Math.max(chat.messageCount ?? 0, history.messages.length),
            });
            debugLog("[ChatSlice]", "loadChatHistory.monotonicSkip", {
              sessionId,
              attempt,
              localMessageCount: chat.messages.length,
              serverMessageCount: history.messages.length,
            });
            return;
          }
        }

        get().updateSession(sessionId, {
          messages: nextMessages,
          messageCount: history.messages.length,
          config: {
            ...(chat.config || {}),
            ...(history.gold_config != null ? { goldConfig: history.gold_config } : {}),
            ...(history.goal_state != null ? { goalState: history.goal_state } : {}),
            compressionEvents: (history.compression_events || []).map((event) => ({
              id: event.id,
              createdAt: event.created_at,
              messagesCompressed: event.messages_compressed,
              segmentsRemoved: event.segments_removed,
            })),
            syncCursor: {
              messageCount: history.messages.length,
              lastMessageId: history.messages[history.messages.length - 1]?.id ?? null,
              hasPendingQuestion: Boolean(
                get().executionBySession?.[sessionId]?.interaction.pendingQuestion,
              ),
              pendingQuestionToolCallId:
                get().executionBySession?.[sessionId]?.interaction.pendingQuestion?.toolCallId ??
                null,
            },
          },
        });
        debugLog("[ChatSlice]", "loadChatHistory.applied", {
          sessionId,
          attempt,
          mode,
          messageCount: history.messages.length,
          lastMessageId: history.messages[history.messages.length - 1]?.id ?? null,
        });
        return;
      } catch (error) {
        if (attempt >= retries) {
          console.warn(`[ChatSlice] Failed to load history for ${sessionId}:`, error);
          debugLog("[ChatSlice]", "loadChatHistory.error.final", {
            sessionId,
            attempt,
            retries,
            error,
          });
          return;
        }
        const delay = retryDelayMs > 0 ? retryDelayMs * (attempt + 1) : 200 * (attempt + 1);
        debugLog("[ChatSlice]", "loadChatHistory.error.retry", {
          sessionId,
          attempt,
          delay,
          error,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  },

  reconcileOpenSession: (sessionId, reason) => {
    // Only the open session is reconciled from the feed — other sessions are
    // handled by the (debounced) list-level refresh.
    if (!sessionId || get().currentSessionId !== sessionId) {
      return;
    }
    const existing = reconcileTimers.get(sessionId);
    if (existing) {
      clearTimeout(existing);
    }
    reconcileTimers.set(
      sessionId,
      setTimeout(() => {
        reconcileTimers.delete(sessionId);
        // Bail if the user switched away while the timer was pending.
        if (get().currentSessionId !== sessionId) {
          return;
        }
        void (async () => {
          debugLog("[ChatSlice]", "reconcileOpenSession.start", {
            sessionId,
            reason: reason ?? null,
          });
          // monotonic: catches a behind (passive-viewer) device up; a no-op on
          // the device driving the run (its local state is ahead). waitForAssistant
          // so a freshly-completed turn picks up the assistant reply.
          await get().loadChatHistory(sessionId, {
            mode: "monotonic",
            waitForAssistant: true,
            retries: 3,
            retryDelayMs: 250,
          });
          // Reconcile the pending clarification so one answered/raised on another
          // device clears/appears here too.
          try {
            const pending = await agentClient.getPendingQuestion(sessionId);
            if (get().currentSessionId !== sessionId) {
              return;
            }
            if (pending.has_pending_question) {
              get().setPendingQuestion(sessionId, {
                question: pending.question ?? "",
                options: pending.options ?? [],
                allowCustom: pending.allow_custom ?? true,
                toolCallId: pending.tool_call_id ?? null,
              });
            } else {
              get().clearPendingQuestion(sessionId);
            }
          } catch (e) {
            debugLog("[ChatSlice]", "reconcileOpenSession.pendingError", { sessionId, error: e });
          }
        })();
      }, RECONCILE_DEBOUNCE_MS),
    );
  },
});
