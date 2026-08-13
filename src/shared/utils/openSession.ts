import { findLeafIdBySessionId, useUILayoutStore } from "@shared/store/uiLayoutStore";
import { uiLayoutDebug } from "@shared/utils/debugFlags";

import { useAppStore } from "@shared/store/appStore";
import { useSessionReadStateStore } from "@shared/store/sessionReadStateStore";

type OpenSessionOptions = {
  // For schedule-created sessions, the UI may not be subscribed to background events.
  // Let callers force a one-time index refresh before loading history.
  forceRefreshIndex?: boolean;
  // Load full history regardless of current messageCount (useful when session summary is stale).
  forceLoadHistory?: boolean;
  // If the backend says the session is currently running, enable SSE subscription.
  subscribeIfRunning?: boolean;
  // Force a (best-effort) SSE subscription even when `isRunning` is false.
  // This only works well if the backend emits an immediate terminal event for completed sessions.
  forceSubscribe?: boolean;
};

const ensureSessionVisibleAndLoaded = async (sessionId: string, options?: OpenSessionOptions) => {
  const store = useAppStore.getState();

  const wasMissing = !store.chats.some((c) => c.id === sessionId);

  // If the session isn't in the in-memory list (e.g. created by schedules in background),
  // refresh from backend so Sidebar can render it.
  if (options?.forceRefreshIndex || wasMissing) {
    try {
      await store.refreshChats();
    } catch (e) {
      console.warn("[openSession] refreshChats failed:", e);
    }
  }

  const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
  if (!chat) return false;
  const readState = useSessionReadStateStore.getState();
  const marker = readState.markers[sessionId];
  const readObservation = {
    content: marker?.dirtyContentThrough,
    reset: readState.feedResetThrough,
  };
  const unreadCoordinate =
    readState.pendingFeedReset ||
    (marker?.dirtyContentThrough ?? 0) > (marker?.readContentThrough ?? 0) ||
    readState.feedResetThrough > (marker?.readResetThrough ?? 0);

  // Lazy-load history:
  // - forced (schedule sessions; summary can be stale), or
  // - session just got pulled into memory (avoid requiring a full page reload), or
  // - when backend indicates there is content.
  if (
    options?.forceLoadHistory ||
    wasMissing ||
    unreadCoordinate ||
    ((chat.messages?.length || 0) === 0 && (chat.messageCount || 0) > 0)
  ) {
    try {
      if (!(await store.loadChatHistory(sessionId))) {
        return false;
      }
    } catch (e) {
      console.warn("[openSession] loadChatHistory failed:", e);
      return false;
    }
  }

  if (typeof document === "undefined" || document.visibilityState !== "hidden") {
    const rendered = useAppStore.getState().chats.find((candidate) => candidate.id === sessionId);
    const layout = useUILayoutStore.getState();
    const stillVisible =
      useAppStore.getState().currentSessionId === sessionId ||
      Object.values(layout.leafSessionIds).includes(sessionId);
    if (rendered && stillVisible) {
      // Always pass the pre-load observation, including for an already-loaded
      // clean session. A feed event racing this continuation then remains
      // dirty and is reconciled by the visible ConversationPane.
      useSessionReadStateStore.getState().markRead([rendered], { [sessionId]: readObservation });
    }
  }

  // Optionally enable SSE subscription when the backend runner is active.
  // This is best-effort and won't start execution.
  if (options?.forceSubscribe) {
    store.markForceSubscribe(sessionId);
    return true;
  }

  const shouldSubscribeIfRunning = options?.subscribeIfRunning ?? true;
  if (shouldSubscribeIfRunning && chat.isRunning) {
    store.markForceSubscribe(sessionId);
  }
  return true;
};

/**
 * Open a session in the pane workspace and set it as the global selection.
 * The workspace may currently be in a single-leaf or multi-leaf state.
 *
 * Important: some callers (e.g. buttons inside ChatView) run inside a pane whose
 * onMouseDownCapture may also set selection. We always assign the leaf mapping first,
 * then update the global selection to avoid "sidebar selected but view not switched".
 */
export const openSession = (sessionId: string, options?: OpenSessionOptions) => {
  const { activeLeafId, leafSessionIds, setLeafSessionId, setActiveLeafId } =
    useUILayoutStore.getState();

  const existingLeafId = findLeafIdBySessionId(leafSessionIds, sessionId);
  const activeLeafSessionId = leafSessionIds[activeLeafId] ?? null;

  uiLayoutDebug("openSession (input)", {
    activeLeafId,
    activeLeafSessionId,
    sessionId,
    existingLeafId,
  });

  if (existingLeafId) {
    if (existingLeafId === activeLeafId) {
      // Already visible in the focused leaf.
      uiLayoutDebug("openSession (decision)", {
        action: "noop_already_active",
        leafId: activeLeafId,
        sessionId,
      });
    } else {
      // Focus the leaf where the session already exists to preserve
      // one-session-per-leaf mapping.
      setActiveLeafId(existingLeafId);
      uiLayoutDebug("openSession (decision)", {
        action: "focus_existing_leaf",
        leafId: existingLeafId,
        sessionId,
      });
    }
  } else {
    setLeafSessionId(activeLeafId, sessionId);
    uiLayoutDebug("openSession (decision)", {
      action: "assign_to_active_leaf",
      leafId: activeLeafId,
      sessionId,
    });
  }

  const appState = useAppStore.getState();
  appState.selectSession(sessionId);

  // Best-effort background sync so Sidebar + view can render even for sessions
  // that were created while the UI wasn't watching.
  void ensureSessionVisibleAndLoaded(sessionId, options);
};
