/**
 * Account change-feed runner.
 *
 * Owns a single long-lived SSE connection to `GET /api/v1/stream` and applies
 * durable change events to the Zustand store. This replaces the former
 * timer-based polling (10s agent-health + 15s session-index): the feed connects
 * once, the browser `EventSource` auto-reconnects with `Last-Event-ID`, and the
 * backend replays only what was missed. Availability is derived from the feed
 * connection state rather than a health poll.
 *
 * Most change events trigger a debounced `refreshChats()` so all existing,
 * tested session-list reconciliation logic is reused. Title/pinned events also
 * apply directly for snappier UX. Live token streaming of the *currently open*
 * session still flows through the per-session `/events/{id}` SSE
 * (`agentSubscriptionRunner`); this feed is the cross-session sync channel.
 */
import { AgentClient, type ChangeEvent, type FeedSubscription } from "./AgentService";
import { useAppStore, selectShouldObserve } from "@shared/store/appStore";
import { isApiV2WsEnabled } from "@shared/utils/debugFlags";

const CURSOR_STORAGE_KEY = "lotus_account_feed_cursor_v1";
const REFRESH_DEBOUNCE_MS = 400;

// The feed transport is either a browser `EventSource` (legacy SSE, default) or
// the opt-in v2 WebSocket handle; both expose `close()`, so we only depend on
// the narrow `FeedSubscription` interface.
let eventSource: FeedSubscription | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

const readCursor = (): number => {
  try {
    const raw = localStorage.getItem(CURSOR_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
};

const writeCursor = (seq: number): void => {
  try {
    localStorage.setItem(CURSOR_STORAGE_KEY, String(seq));
  } catch {
    // Best-effort: a private-mode storage failure must not break the feed.
  }
};

const clearCursor = (): void => {
  try {
    localStorage.removeItem(CURSOR_STORAGE_KEY);
  } catch {
    /* ignore */
  }
};

const scheduleRefresh = (): void => {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void useAppStore.getState().refreshSessionsIndex();
  }, REFRESH_DEBOUNCE_MS);
};

// Change types that alter a session's CONTENT or interaction state — when one
// arrives for the currently-open session (driven on ANOTHER device), reconcile
// that session's messages + pending question so a passive viewer stays in sync,
// not just the session list. (Driven locally, the reconcile is a monotonic
// no-op — see `reconcileOpenSession`.)
const OPEN_SESSION_RECONCILE_TYPES = new Set<string>([
  "message_appended",
  "task_list_updated",
  "task_list_item_progress",
  "task_list_completed",
  "complete",
  "cancelled",
  "error",
  "execution_started",
  "need_clarification",
]);

const applyChange = (change: ChangeEvent): void => {
  const { event } = change;
  const store = useAppStore.getState();
  const sessionId = change.session_id ?? event.session_id;

  // Multi-device: keep the OPEN conversation live (not just the list) when it
  // changes elsewhere.
  if (
    sessionId &&
    sessionId === store.currentSessionId &&
    OPEN_SESSION_RECONCILE_TYPES.has(event.type)
  ) {
    store.reconcileOpenSession(sessionId, event.type);
  }

  // Passive per-token streaming: when a run STARTS on the OPEN session on another
  // device and this device is not already observing it, refresh now (un-debounced)
  // so the session's `is_running` summary flips its execution phase to `running`
  // -> `selectShouldObserve` becomes true -> the agent-event subscription engages
  // and live tokens stream in. (`execution_started` itself can't promote an `idle`
  // entry to `running`; the summary path can — hence a refresh, not a synthetic
  // event.) On the device DRIVING the run, `selectShouldObserve` is already true,
  // so this is skipped.
  if (
    sessionId &&
    sessionId === store.currentSessionId &&
    event.type === "execution_started" &&
    !selectShouldObserve(sessionId)(store)
  ) {
    void store.refreshChatsNow();
  }

  switch (event.type) {
    case "session_title_updated":
      if (sessionId && typeof event.title === "string") {
        store.applyServerTitle(sessionId, event.title, event.title_version ?? 0);
      }
      // Title also affects the list ordering/labels of non-open sessions.
      scheduleRefresh();
      break;
    case "session_pinned_updated":
      if (sessionId && typeof event.pinned === "boolean") {
        store.applyServerPinned(sessionId, event.pinned, event.updated_at ?? change.ts);
      }
      scheduleRefresh();
      break;
    // Coarse list/state changes — reuse the existing reconciliation path.
    case "session_created":
    case "session_deleted":
    case "session_cleared":
    case "message_appended":
    case "task_list_updated":
    case "task_list_item_progress":
    case "task_list_completed":
    case "complete":
    case "cancelled":
    case "error":
    case "execution_started":
    case "need_clarification":
    default:
      scheduleRefresh();
      break;
  }
};

/**
 * Start the account feed. Idempotent — a second call is a no-op while a
 * connection is live.
 */
export const startAccountFeed = (): void => {
  if (eventSource) return;
  // The feed requires a browser/webview transport: an EventSource for the
  // legacy SSE path, or a WebSocket for the opt-in v2 path. In SSR/node/test
  // environments both may be absent — skip rather than throw.
  const wsEnabled = isApiV2WsEnabled();
  if (wsEnabled) {
    if (typeof WebSocket === "undefined") return;
  } else if (typeof EventSource === "undefined") {
    return;
  }
  const client = AgentClient.getInstance();

  eventSource = client.subscribeToAccountStream(
    {
      onOpen: () => {
        useAppStore.getState().setAgentAvailability(true);
      },
      onError: () => {
        // Transient: the browser will auto-reconnect (resending Last-Event-ID).
        useAppStore.getState().setAgentAvailability(false);
      },
      onReset: () => {
        // Cursor predated the retained window — drop it and full-resync.
        clearCursor();
        void useAppStore.getState().refreshSessionsIndex();
      },
      onChange: (change) => {
        useAppStore.getState().setAgentAvailability(true);
        writeCursor(change.seq);
        applyChange(change);
      },
    },
    { since: readCursor() },
  );
};

/** Stop the account feed and tear down the connection. */
export const stopAccountFeed = (): void => {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
};
