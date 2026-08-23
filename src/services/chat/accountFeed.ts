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
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { useSessionReadStateStore } from "@shared/store/sessionReadStateStore";
import { isApiV2WsEnabled } from "@shared/utils/debugFlags";
import { workflowCatalogQuery } from "../../features/workflows";
import {
  acceptChildApprovalVersion,
  childApprovalVersionKey,
  replaceChildApprovalVersions,
} from "./childApprovalVersions";

const CURSOR_STORAGE_KEY = "lotus_account_feed_cursor_v1";
const REFRESH_DEBOUNCE_MS = 400;
const CONFIG_RESYNC_RETRY_MS = 1_000;
const CONFIG_RESYNC_MAX_ATTEMPTS = 3;

// The feed transport is either a browser `EventSource` (legacy SSE, default) or
// the opt-in v2 WebSocket handle; both expose `close()`, so we only depend on
// the narrow `FeedSubscription` interface.
let eventSource: FeedSubscription | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let feedEpoch = 0;
let hydrationEpoch = 0;
let bufferingChanges = false;
let bufferedChanges: ChangeEvent[] = [];
let configResyncGeneration = 0;
let configResyncRetryTimer: ReturnType<typeof setTimeout> | null = null;

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

const advanceCursor = (seq: number): void => {
  if (seq > readCursor()) writeCursor(seq);
};

const requestConfigResync = (epoch: number, reason: "transport open" | "feed reset"): void => {
  const generation = ++configResyncGeneration;
  if (configResyncRetryTimer) {
    clearTimeout(configResyncRetryTimer);
    configResyncRetryTimer = null;
  }

  const attempt = (attemptNumber: number): void => {
    if (epoch !== feedEpoch || generation !== configResyncGeneration) return;
    void useConfigSectionStore
      .getState()
      .resyncLoadedSections()
      .catch(() => {
        if (epoch !== feedEpoch || generation !== configResyncGeneration) return;
        const willRetry = attemptNumber < CONFIG_RESYNC_MAX_ATTEMPTS;
        console.warn(
          willRetry
            ? `Configuration resync failed after ${reason}; retrying (${attemptNumber}/${CONFIG_RESYNC_MAX_ATTEMPTS}).`
            : `Configuration resync failed after ${reason}; retry limit reached.`,
        );
        if (!willRetry) return;
        configResyncRetryTimer = setTimeout(() => {
          configResyncRetryTimer = null;
          attempt(attemptNumber + 1);
        }, CONFIG_RESYNC_RETRY_MS);
      });
  };

  attempt(1);
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
  "session_cleared",
]);

// MessageAppended represents the persisted user turn. Terminal events keep the
// latch dirty through the assistant tail, while SessionCleared covers an ABA
// reset whose eventual list count can equal the previously-read count.
const UNREAD_CONTENT_CHANGE_TYPES = new Set<string>([
  "message_appended",
  "session_cleared",
  "complete",
  "cancelled",
  "error",
  "need_clarification",
]);

const isUnreadContentChange = (change: ChangeEvent): boolean => {
  const sessionId = change.session_id ?? change.event.session_id;
  return Boolean(sessionId && UNREAD_CONTENT_CHANGE_TYPES.has(change.event.type));
};

const latchUnreadChange = (change: ChangeEvent): boolean => {
  const sessionId = change.session_id ?? change.event.session_id;
  if (!sessionId || !isUnreadContentChange(change)) return true;
  return useSessionReadStateStore.getState().markUnreadFromFeed(sessionId, change.seq);
};

const applyChange = (change: ChangeEvent): void => {
  const { event } = change;
  const store = useAppStore.getState();
  const sessionId = change.session_id ?? event.session_id;
  const parentForChild = (childSessionId: string): string | undefined =>
    store.chats.find((chat) => chat.id === childSessionId)?.parentSessionId ??
    Object.entries(store.executionBySession).find(([, entry]) =>
      Object.prototype.hasOwnProperty.call(entry.children.byId, childSessionId),
    )?.[0];

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
    case "child_approval_changed": {
      const parentSessionId = event.parent_session_id;
      const childSessionId = event.child_session_id;
      const requestId = event.request_id;
      if (
        parentSessionId &&
        childSessionId &&
        requestId &&
        acceptChildApprovalVersion(
          childApprovalVersionKey(parentSessionId, childSessionId, event.child_attempt, requestId),
          event.version,
        )
      ) {
        if (event.status === "pending") {
          store.enqueuePendingChildApproval(parentSessionId, {
            childSessionId,
            requestId,
            toolName: event.tool_name ?? null,
            permission: event.permission ?? null,
            resource: event.resource ?? null,
          });
        } else if (
          event.status === "decision_recorded" ||
          event.status === "approved" ||
          event.status === "denied" ||
          event.status === "expired" ||
          event.status === "delivery_failed"
        ) {
          store.dequeuePendingChildApproval(parentSessionId, requestId);
        }
      }
      break;
    }
    case "sub_agent_started": {
      const parentSessionId = event.parent_session_id;
      const childSessionId = event.child_session_id;
      if (
        parentSessionId &&
        childSessionId &&
        !Object.prototype.hasOwnProperty.call(
          store.executionBySession[parentSessionId]?.children.byId ?? {},
          childSessionId,
        )
      ) {
        // Only fill a missing edge. The replacement snapshot may already hold
        // a newer running/terminal state while this older queued delta was
        // waiting for an account-feed sequence.
        store.applyChildProgress(parentSessionId, childSessionId, {
          title: event.title,
          status: "pending",
          lastEventAt: change.ts,
        });
      }
      scheduleRefresh();
      break;
    }
    case "sub_agent_completed": {
      const parentSessionId = event.parent_session_id;
      const childSessionId = event.child_session_id;
      if (parentSessionId && childSessionId) {
        store.clearPendingChildApprovalsForChild(parentSessionId, childSessionId);
        store.applyChildProgress(parentSessionId, childSessionId, {
          status: typeof event.status === "string" ? event.status : "completed",
          error: event.error,
          lastEventAt: change.ts,
        });
      }
      scheduleRefresh();
      break;
    }
    case "execution_started":
      if (sessionId) {
        const parentSessionId = parentForChild(sessionId);
        if (parentSessionId) {
          // A child session can be retried. This later durable delta must
          // supersede an earlier terminal progress row replayed in the same
          // hydration barrier.
          store.applyChildProgress(parentSessionId, sessionId, {
            status: "running",
            error: undefined,
            lastEventAt: event.started_at ?? change.ts,
          });
        }
      }
      scheduleRefresh();
      break;
    case "session_deleted":
      if (sessionId) {
        const parentSessionId = parentForChild(sessionId);
        if (parentSessionId) {
          store.clearPendingChildApprovalsForChild(parentSessionId, sessionId);
          store.clearChildProgress(parentSessionId, sessionId);
        }
      }
      scheduleRefresh();
      break;
    case "session_title_updated":
      if (sessionId && typeof event.title === "string") {
        store.applyServerTitle(
          sessionId,
          event.title,
          event.title_version ?? 0,
          typeof event.title_generated === "boolean" ? event.title_generated : true,
        );
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
    case "config.changed":
    case "config.invalid":
    case "config.recovered":
      if (event.section && typeof event.revision === "number") {
        useConfigSectionStore
          .getState()
          .handleConfigEvent(event.section, event.revision, event.type);
      }
      break;
    case "workflow_changed":
    case "workflow_invalid":
    case "workflow_recovered":
      if (event.workflow_id && typeof event.revision === "number") {
        workflowCatalogQuery.invalidate({
          type: event.type,
          workflowId: event.workflow_id,
          revision: event.revision,
          scope: event.scope,
        });
      }
      break;
    case "project_created":
    case "project_updated":
    case "project_archived": {
      const projectId = event.project_id;
      const revision = event.revision;
      if (projectId && typeof revision === "number") {
        store.applyProjectEvent({ type: event.type, project_id: projectId, revision });
      }
      break;
    }
    case "session_project_updated": {
      // Project reassignment changes the sidebar group. Reconcile via the
      // existing session list path rather than duplicating merge logic here.
      if (sessionId) {
        scheduleRefresh();
      }
      break;
    }
    // Coarse list/state changes — reuse the existing reconciliation path.
    case "session_created":
    case "session_cleared":
    case "message_appended":
    case "task_list_updated":
    case "task_list_item_progress":
    case "task_list_completed":
    case "complete":
    case "cancelled":
    case "error":
    case "need_clarification":
    default:
      scheduleRefresh();
      break;
  }
};

const applyChangeAndAdvanceCursor = (change: ChangeEvent): void => {
  useAppStore.getState().setAgentAvailability(true);
  applyChange(change);
  advanceCursor(change.seq);
};

const closeFeedForReplay = (epoch: number): void => {
  if (epoch !== feedEpoch) return;
  // Invalidate every callback already queued by this transport before
  // closing it. A late metadata callback must not advance the cursor past the
  // unread event whose durable latch just failed.
  feedEpoch += 1;
  hydrationEpoch += 1;
  bufferingChanges = false;
  bufferedChanges = [];
  eventSource?.close();
  eventSource = null;
  useAppStore.getState().setAgentAvailability(false);
};

/**
 * Replacement hydration barrier.
 *
 * The feed is already subscribed and all arriving deltas are buffered while
 * the snapshot request is in flight. Once Bamboo returns the account-feed
 * watermark, local child/approval state is replaced and only buffered events
 * strictly newer than that watermark are reduced. This is the piece replay by
 * persisted cursor alone cannot provide after a full browser reload.
 */
const hydrateSubagentState = async (client: AgentClient, epoch: number): Promise<void> => {
  const currentHydration = ++hydrationEpoch;
  const resetTokens = useSessionReadStateStore.getState().pendingFeedResetTokens();
  bufferingChanges = true;
  bufferedChanges = [];
  try {
    const snapshot = await client.getSubagentSnapshot();
    if (epoch !== feedEpoch || currentHydration !== hydrationEpoch || eventSource === null) {
      return;
    }

    const buffered = bufferedChanges.sort((left, right) => left.seq - right.seq);
    const replay = buffered.filter((change) => change.seq > snapshot.snapshot_seq);
    bufferedChanges = [];
    bufferingChanges = false;

    replaceChildApprovalVersions(snapshot.approvals);
    useAppStore.getState().replaceSubagentSnapshot(snapshot);
    // The sub-agent snapshot does not contain message/unread state, so its
    // watermark must never advance the account-feed resume cursor. It can,
    // however, turn a previously persisted feed-reset token into a durable
    // global gap watermark: every session loaded now or later inherits it.
    useSessionReadStateStore.getState().resolveFeedResets(resetTokens, snapshot.snapshot_seq);
    // Content events at or below the sub-agent watermark were latched before
    // buffering, but still advance the resume cursor only after that latch is
    // durable. The snapshot itself must never skip an event that did not
    // actually arrive on this transport.
    for (const change of buffered) {
      if (change.seq > snapshot.snapshot_seq) break;
      if (!latchUnreadChange(change)) {
        // Stop at the first non-durable content coordinate. Advancing over a
        // later metadata event would make this unread event unreplayable after
        // reload even though its own latch failed.
        closeFeedForReplay(epoch);
        return;
      }
      advanceCursor(change.seq);
    }
    let lastReplayedSeq = snapshot.snapshot_seq;
    for (const change of replay) {
      if (change.seq <= lastReplayedSeq) continue;
      if (!latchUnreadChange(change)) {
        closeFeedForReplay(epoch);
        return;
      }
      applyChangeAndAdvanceCursor(change);
      lastReplayedSeq = Math.max(lastReplayedSeq, change.seq);
    }
    // The snapshot supplies progress-only children immediately; refresh the
    // normal session index as well so titles, placement and tree metadata use
    // their existing authoritative mapping path.
    void useAppStore.getState().refreshSessionsIndex();
  } catch (error) {
    if (epoch !== feedEpoch || currentHydration !== hydrationEpoch || eventSource === null) {
      return;
    }
    // Compatibility/failure path: never strand already-delivered feed events
    // behind the barrier. An older backend may not expose the snapshot route;
    // incremental sync still works, though reload recovery needs the new API.
    const replay = bufferedChanges.sort((left, right) => left.seq - right.seq);
    bufferedChanges = [];
    bufferingChanges = false;
    let lastReplayedSeq = readCursor();
    for (const change of replay) {
      if (change.seq <= lastReplayedSeq) continue;
      if (latchUnreadChange(change)) {
        applyChangeAndAdvanceCursor(change);
        lastReplayedSeq = change.seq;
      } else {
        closeFeedForReplay(epoch);
        return;
      }
    }
    console.warn("Failed to hydrate authoritative sub-agent snapshot", error);
    void useAppStore.getState().refreshSessionsIndex();
  }
};

/**
 * Start the account feed. Idempotent — a second call is a no-op while a
 * connection is live.
 */
export const startAccountFeed = (): boolean => {
  if (eventSource) return true;
  // The feed requires a browser/webview transport: an EventSource for the
  // legacy SSE path, or a WebSocket for the opt-in v2 path. In SSR/node/test
  // environments both may be absent — skip rather than throw.
  const wsEnabled = isApiV2WsEnabled();
  if (wsEnabled) {
    if (typeof WebSocket === "undefined") return false;
  } else if (typeof EventSource === "undefined") {
    return false;
  }
  const client = AgentClient.getInstance();
  const epoch = ++feedEpoch;
  let openedOnce = false;
  bufferingChanges = true;
  bufferedChanges = [];
  // Start the REST request before opening the transport so even a transport
  // implementation that can synchronously enqueue replay frames is behind the
  // barrier. Promise continuation still runs after `eventSource` is assigned.
  const initialHydration = hydrateSubagentState(client, epoch);

  eventSource = client.subscribeToAccountStream(
    {
      onOpen: () => {
        if (epoch !== feedEpoch) return;
        useAppStore.getState().setAgentAvailability(true);
        requestConfigResync(epoch, "transport open");
        if (openedOnce) {
          void hydrateSubagentState(client, epoch);
        }
        openedOnce = true;
      },
      onError: () => {
        if (epoch !== feedEpoch) return;
        // Transient: the browser will auto-reconnect (resending Last-Event-ID).
        useAppStore.getState().setAgentAvailability(false);
      },
      onReset: () => {
        if (epoch !== feedEpoch) return;
        // Cursor predated the retained window. The stream fast-forwards to its
        // current head; replace state at a fresh snapshot watermark before
        // accepting the new live tail.
        // The retained journal no longer contains every missed content event,
        // and the sub-agent snapshot has no message state. Persist an
        // account-wide pending gap; a fresh snapshot converts it to a bounded
        // watermark inherited by sessions loaded now or later.
        useSessionReadStateStore.getState().beginFeedReset();
        clearCursor();
        requestConfigResync(epoch, "feed reset");
        void hydrateSubagentState(client, epoch);
      },
      onChange: (change) => {
        if (epoch !== feedEpoch) return;
        // Observe content before the hydration barrier: its snapshot watermark
        // covers sub-agent state only, so a <= watermark content event may be
        // filtered from replay without being represented by the snapshot.
        const durable = latchUnreadChange(change);
        if (bufferingChanges) {
          bufferedChanges.push(change);
          return;
        }
        if (durable) {
          applyChangeAndAdvanceCursor(change);
        } else {
          // A content latch that could not be persisted must be replayed on a
          // fresh connection; applying later events would let their cursor
          // skip over it permanently.
          closeFeedForReplay(epoch);
        }
      },
    },
    { since: readCursor() },
  );
  void initialHydration;
  return true;
};

/** Stop the account feed and tear down the connection. */
export const stopAccountFeed = (): void => {
  feedEpoch += 1;
  hydrationEpoch += 1;
  configResyncGeneration += 1;
  bufferingChanges = false;
  bufferedChanges = [];
  if (configResyncRetryTimer) {
    clearTimeout(configResyncRetryTimer);
    configResyncRetryTimer = null;
  }
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
};
