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
import { AgentClient, type ChangeEvent } from "./AgentService";
import { useAppStore } from "@shared/store/appStore";

const CURSOR_STORAGE_KEY = "lotus_account_feed_cursor_v1";
const REFRESH_DEBOUNCE_MS = 400;

let eventSource: EventSource | null = null;
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

const applyChange = (change: ChangeEvent): void => {
  const { event } = change;
  const store = useAppStore.getState();
  const sessionId = change.session_id ?? event.session_id;

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
  // The feed requires a browser/webview EventSource. In SSR/node/test
  // environments it is absent — skip rather than throw.
  if (typeof EventSource === "undefined") return;
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
