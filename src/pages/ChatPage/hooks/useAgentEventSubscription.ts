import { useEffect, useRef, useCallback } from "react";
import { useShallow } from "zustand/react/shallow";
import { AgentClient } from "@services/chat/AgentService";
import { useAppStore, selectShouldObserve, selectGeneration } from "../store";
import { streamingMessageBus } from "../utils/streamingMessageBus";
import { clearAssistantStreamingState } from "../streaming/assistantStreamingAtoms";
import { clearToolStreamingStatesForSession } from "../streaming/toolStreamingAtoms";
import {
  clearChildPreviewStatesForParent,
  setChildPreviewState,
} from "../streaming/childPreviewAtoms";
import { App as AntApp } from "antd";
import { debugLog } from "@shared/utils/debugFlags";
import {
  type SubscriptionEntry,
  debugSse,
  buildTaskListCompletionNoticeKey,
  getSharedAgentClient,
  CHILD_PREVIEW_FLUSH_INTERVAL_MS,
} from "./useAgentEventSubscription.helpers";
import { startAgentSubscription } from "./agentSubscriptionRunner";

export function useAgentEventSubscription() {
  const { message } = AntApp.useApp();
  // Stable store actions
  const {
    addMessage,
    applyAgentEvent,
    markStreamStarted,
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
      markStreamStarted: state.markStreamStarted,
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
  const titleRefreshRetryTimersRef = useRef<
    Map<string, { attempt: number; timer: ReturnType<typeof setTimeout> | null }>
  >(new Map());
  const taskCompletionNoticeKeyBySessionRef = useRef<Map<string, string>>(new Map());
  const streamStartedGenerationBySessionRef = useRef<Map<string, number>>(new Map());

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
  const lastChildHeartbeatAtRef = useRef<Map<string, number>>(new Map());
  const lastChildRoundCountRef = useRef<Map<string, number>>(new Map());
  const pendingChildPreviewRef = useRef<
    Map<
      string,
      {
        content: string;
        lastEventAt: string;
        timer: ReturnType<typeof setTimeout> | null;
      }
    >
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

  const clearTitleRefreshRetry = useCallback((sessionId: string) => {
    const existing = titleRefreshRetryTimersRef.current.get(sessionId);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }
    titleRefreshRetryTimersRef.current.delete(sessionId);
  }, []);

  const cleanupChat = useCallback(
    (sessionId: string, opts?: { clearDraft?: boolean; clearTitleRetry?: boolean }) => {
      debugSse("cleanupChat", sessionId, opts);
      const state = useAppStore.getState();
      const executionEntry = state.executionBySession?.[sessionId];
      debugLog("[SSE]", "cleanupChat", {
        sessionId,
        opts: opts ?? null,
        generation: executionEntry?.generation ?? null,
        phase: executionEntry?.phase ?? null,
        backendRunId: executionEntry?.backendRunId ?? null,
        shouldObserve: selectShouldObserve(sessionId)(state),
      });
      clearReconnect(sessionId);
      clearParentSettleTimer(sessionId);
      if (opts?.clearTitleRetry) {
        clearTitleRefreshRetry(sessionId);
      }
      pendingSessionIdsRef.current.delete(sessionId);
      streamStartedGenerationBySessionRef.current.delete(sessionId);
      for (const [key, pending] of pendingChildPreviewRef.current.entries()) {
        if (!key.startsWith(`${sessionId}:`)) continue;
        if (pending.timer) {
          clearTimeout(pending.timer);
        }
        pendingChildPreviewRef.current.delete(key);
      }

      const existing = subscriptionsBySessionRef.current.get(sessionId);
      if (!existing) {
        if (opts?.clearDraft) {
          streamingMessageBus.clear(sessionId, `streaming-${sessionId}`);
          streamingMessageBus.clear(sessionId, `streaming-reasoning-${sessionId}`);
          streamingMessageBus.clear(sessionId, `streaming-status-${sessionId}`);
          clearAssistantStreamingState(sessionId);
          clearToolStreamingStatesForSession(sessionId);
          clearChildPreviewStatesForParent(sessionId);
        }
        return;
      }

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

      if (opts?.clearDraft) {
        clearAssistantStreamingState(sessionId);
        clearToolStreamingStatesForSession(sessionId);
        clearChildPreviewStatesForParent(sessionId);
      }
    },
    [clearParentSettleTimer, clearReconnect, clearTitleRefreshRetry],
  );

  const flushChildPreview = useCallback(
    (parentSessionId: string, childSessionId: string) => {
      const key = `${parentSessionId}:${childSessionId}`;
      const pending = pendingChildPreviewRef.current.get(key);
      if (!pending) return;
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pendingChildPreviewRef.current.delete(key);
      setChildPreviewState(parentSessionId, childSessionId, pending.content);
      applyChildProgress(parentSessionId, childSessionId, {
        status: "running",
        outputPreview: pending.content,
        lastEventAt: pending.lastEventAt,
      });
    },
    [applyChildProgress],
  );

  const scheduleChildPreviewFlush = useCallback(
    (parentSessionId: string, childSessionId: string, content: string, lastEventAt: string) => {
      const key = `${parentSessionId}:${childSessionId}`;
      const existing = pendingChildPreviewRef.current.get(key);
      if (existing?.timer) {
        clearTimeout(existing.timer);
      }
      const timer = setTimeout(() => {
        flushChildPreview(parentSessionId, childSessionId);
      }, CHILD_PREVIEW_FLUSH_INTERVAL_MS);
      pendingChildPreviewRef.current.set(key, {
        content,
        lastEventAt,
        timer,
      });
    },
    [flushChildPreview],
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

  const shouldShowTaskListCompletedNotice = useCallback(
    (sessionId: string, totalRounds: number, totalToolCalls: number, completedAt?: string) => {
      const noticeKey = buildTaskListCompletionNoticeKey(
        sessionId,
        totalRounds,
        totalToolCalls,
        completedAt,
      );
      const lastNoticeKey = taskCompletionNoticeKeyBySessionRef.current.get(sessionId);
      if (lastNoticeKey === noticeKey) {
        return false;
      }

      const executionEntry = useAppStore.getState().executionBySession?.[sessionId];
      const hasActiveQuestion =
        executionEntry?.phase === "waiting_user_answer" ||
        executionEntry?.interaction?.pendingQuestion != null;

      taskCompletionNoticeKeyBySessionRef.current.set(sessionId, noticeKey);
      return !hasActiveQuestion;
    },
    [],
  );

  const markStreamStartedOnce = useCallback(
    (sessionId: string, generation: number) => {
      if (streamStartedGenerationBySessionRef.current.get(sessionId) === generation) {
        return;
      }
      streamStartedGenerationBySessionRef.current.set(sessionId, generation);
      markStreamStarted(sessionId, generation);
    },
    [markStreamStarted],
  );

  const startSubscription = useCallback(
    (sessionId: string) => {
      startAgentSubscription(sessionId, {
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
        restart: startSubscription,
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
      });
    },
    [
      addMessage,
      cleanupChat,
      clearParentSettleTimer,
      clearPendingQuestion,
      clearReconnect,
      clearTitleRefreshRetry,
      ensureTaskListBaseline,
      message,
      shouldShowTaskListCompletedNotice,
      persistSessionTitle,
      refreshChatsNow,
      setEvaluationState,
      setPendingQuestion,
      applyAgentEvent,
      markStreamStartedOnce,
      setTaskList,
      setTruncationInfo,
      updateMessage,
      updateSession,
      updateTaskListDelta,
      updateTokenUsage,
      applyChildProgress,
      flushChildPreview,
      scheduleChildPreviewFlush,
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

      // Check current generation from store
      const currentGeneration = selectGeneration(normalizedSessionId)(useAppStore.getState());
      const generationMismatch = existing && existing.generation !== currentGeneration;
      debugSse("ensureSubscription.check", {
        sessionId: normalizedSessionId,
        existingGeneration: existing?.generation ?? null,
        currentGeneration,
        hasExisting: Boolean(existing),
        aborted: existing?.controller.signal.aborted ?? null,
        streamEnded: existing?.streamEnded ?? null,
        generationMismatch,
      });

      // Only skip if the existing subscription is truly live AND generation matches.
      // A controller can still be "not aborted" even after the SSE reader already ended,
      // while old onComplete/onError cleanup is still in flight. That stale entry must not
      // block the next execution generation for the same session.
      // Also re-subscribe if generation changed (e.g., after markRespondStart -> applyExecutionStarted).
      if (
        existing?.sessionId === normalizedSessionId &&
        !existing.controller.signal.aborted &&
        !existing.streamEnded &&
        !generationMismatch
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

      // If we need to restart the SSE connection (e.g. sessionId changed, stale entry, or generation mismatch),
      // keep any existing draft in-memory so the UI doesn't lose what it already rendered.
      if (existing) {
        debugSse(
          "restartStaleSubscription",
          normalizedSessionId,
          "generation:",
          existing.generation,
          "currentGeneration:",
          currentGeneration,
          "aborted:",
          existing.controller.signal.aborted,
          "streamEnded:",
          existing.streamEnded,
          "generationMismatch:",
          generationMismatch,
        );
        cleanupChat(normalizedSessionId, { clearDraft: false });
      }
      startSubscription(normalizedSessionId);
    },
    [cleanupChat, startSubscription],
  );

  // Effect A: reconcile active subscriptions when busy session IDs change (NO global cleanup return).
  // Do not subscribe to the full executionBySession map here: token/metadata updates must not rerun
  // subscription coordination unless the observable session set actually changes.
  //
  // CRITICAL: the derived key includes generation so the effect re-runs when a busy session's
  // generation changes (e.g. after markRespondStart bumps generation on respond/resume). Without
  // this, the effect would not re-trigger because the session ID set stays the same, leaving
  // ensureSubscription's generation-mismatch logic unreachable.
  //
  // Also include a coarse phase bucket so the effect re-runs for the same generation when a
  // respond/resume flow crosses important recovery boundaries:
  // - `starting` -> active running after applyExecutionStarted
  // - premature `settling` -> recovered running after applyExecutionStarted
  // This closes races where an early subscription ends before the backend resume actually starts.
  const busySessionKeys = useAppStore(
    useShallow((state) =>
      Object.entries(state.executionBySession)
        .filter(([sessionId]) => selectShouldObserve(sessionId)(state))
        .map(([sessionId, entry]) => {
          const phaseBucket =
            entry.phase === "starting"
              ? "starting"
              : entry.phase === "settling"
                ? "settling"
                : "live";
          return `${sessionId}\0${entry.generation}\0${phaseBucket}`;
        })
        .sort(),
    ),
  );

  useEffect(() => {
    // Extract session IDs from composite keys (format: "sessionId\0generation\0phaseBucket")
    const busySessionIds = busySessionKeys.map((key) => {
      const idx = key.indexOf("\0");
      return idx >= 0 ? key.slice(0, idx) : key;
    });
    const busySessionIdSet = new Set(busySessionIds);

    debugLog("[SSE]", "effect.busySessions", {
      busySessionIds,
    });
    debugSse("effect.busySessionKeys", {
      busySessionKeys,
      busySessionIds,
    });

    // Start needed subscriptions
    busySessionIds.forEach((sessionId) => ensureSubscription(sessionId));

    // Stop subscriptions for chats no longer processing
    for (const sessionId of Array.from(subscriptionsBySessionRef.current.keys())) {
      if (!busySessionIdSet.has(sessionId)) {
        cleanupChat(sessionId, { clearDraft: true });
      }
    }

    // Drop pending chats that are no longer processing
    for (const sessionId of Array.from(pendingSessionIdsRef.current)) {
      if (!busySessionIdSet.has(sessionId)) {
        pendingSessionIdsRef.current.delete(sessionId);
      }
    }
  }, [busySessionKeys, ensureSubscription, cleanupChat]);

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
        cleanupChat(sessionId, { clearDraft: true, clearTitleRetry: true });
      }
    };
  }, [cleanupChat]);
}
