import { StateCreator } from "zustand";
import { AgentClient, SessionSummary } from "@services/chat/AgentService";
import {
  beginPermissionModeSummaryRequest,
  reconcilePermissionModeSummary,
} from "../../bypassPermissionMutations";
import { debugLog } from "@shared/utils/debugFlags";
import { ChatItem } from "@shared/types/chat";
import type { AppState } from "../../";
import { applyExecutionEvent } from "../executionStateSlice";
import { parseTimestampMs, canReuseSessionListChat } from "./equality";
import { sessionSummaryToChatItem } from "./messageMapping";
import type { ChatSlice } from "./types";

const agentClient = AgentClient.getInstance();

/**
 * Zustand `set` for the chat slice. Matches the type produced by the slice's
 * `StateCreator`, so the refresh helpers can mutate the store directly.
 */
export type ChatSliceSet = Parameters<StateCreator<AppState, [], [], ChatSlice>>[0];

type ActivityRevision = {
  milliseconds: number;
  submillisecond: string;
};

/**
 * Bamboo currently aliases `last_activity_at` to the metadata-tainted
 * `updated_at`, but it is still the only revision that orders two atomic
 * SessionSummary snapshots. Preserve the six fractional digits below
 * JavaScript's millisecond precision so a fast truncate/append pair remains
 * ordered.
 */
const parseActivityRevision = (value?: string | null): ActivityRevision | null => {
  if (!value?.trim()) return null;
  const normalized = value.trim();
  const milliseconds = Date.parse(normalized);
  if (!Number.isFinite(milliseconds)) return null;

  const fractionMatch = normalized.match(/\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i);
  const fraction = (fractionMatch?.[1] ?? "").padEnd(9, "0").slice(0, 9);
  return {
    milliseconds,
    submillisecond: fraction.slice(3),
  };
};

/** Compare two valid summary revisions, returning null when either is absent. */
const compareActivityRevisions = (left?: string | null, right?: string | null): number | null => {
  const leftRevision = parseActivityRevision(left);
  const rightRevision = parseActivityRevision(right);
  if (!leftRevision || !rightRevision) return null;
  if (leftRevision.milliseconds !== rightRevision.milliseconds) {
    return leftRevision.milliseconds > rightRevision.milliseconds ? 1 : -1;
  }
  if (leftRevision.submillisecond !== rightRevision.submillisecond) {
    return leftRevision.submillisecond > rightRevision.submillisecond ? 1 : -1;
  }
  return 0;
};

// === REFRESH CHATS DEDUPLICATION ===
const REFRESH_CHATS_THROTTLE_MS = 750;

interface RefreshChatsState {
  inFlight: Promise<void> | null;
  forcedPromise: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  trailingPromise: Promise<void> | null;
  trailingResolve: (() => void) | null;
  trailingReject: ((error: unknown) => void) | null;
}

export const refreshChatsState: RefreshChatsState = {
  inFlight: null,
  forcedPromise: null,
  timer: null,
  trailingPromise: null,
  trailingResolve: null,
  trailingReject: null,
};

// A committed create/copy can race an older full-list request whose snapshot
// predates that commit. Full-list reconciliation normally treats absence as
// deletion, so protect newly committed IDs until a forced trailing read has
// run after the stale request. Counts make nested callers safe.
const protectedSessionIds = new Map<string, number>();

export function protectSessionFromStaleLists(sessionId: string): () => void {
  protectedSessionIds.set(sessionId, (protectedSessionIds.get(sessionId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = protectedSessionIds.get(sessionId) ?? 0;
    if (count <= 1) protectedSessionIds.delete(sessionId);
    else protectedSessionIds.set(sessionId, count - 1);
  };
}

export function consumeTrailingRefreshCallbacks(): {
  resolve: (() => void) | null;
  reject: ((error: unknown) => void) | null;
} {
  const callbacks = {
    resolve: refreshChatsState.trailingResolve,
    reject: refreshChatsState.trailingReject,
  };
  refreshChatsState.trailingPromise = null;
  refreshChatsState.trailingResolve = null;
  refreshChatsState.trailingReject = null;
  return callbacks;
}

export function settleTrailingRefreshCallbacks(
  promise: Promise<void>,
  callbacks: { resolve: (() => void) | null; reject: ((error: unknown) => void) | null },
): void {
  if (!callbacks.resolve && !callbacks.reject) {
    return;
  }
  void promise.then(
    () => callbacks.resolve?.(),
    (error) => callbacks.reject?.(error),
  );
}

export function clearRefreshChatsThrottleWindow(): {
  resolve: (() => void) | null;
  reject: ((error: unknown) => void) | null;
} {
  if (refreshChatsState.timer) {
    clearTimeout(refreshChatsState.timer);
    refreshChatsState.timer = null;
  }
  return consumeTrailingRefreshCallbacks();
}

/**
 * Apply a fetched session list to the store.
 * Preserves in-memory messages and merges local state.
 */
export function applySessionsList(
  sessions: SessionSummary[],
  set: ChatSliceSet,
  summaryRequestRevision?: number,
): void {
  const next = sessions.map(sessionSummaryToChatItem);

  set((state) => {
    // Reconcile executionBySession against every summary.
    let executionBySession = state.executionBySession;
    for (const summary of sessions) {
      executionBySession = applyExecutionEvent(executionBySession, {
        type: "applySessionSummary",
        sessionId: summary.id,
        summary,
      });
    }

    // Preserve in-memory messages when possible.
    const prevById = new Map(state.chats.map((c) => [c.id, c]));
    let chatsChanged = state.chats.length !== next.length;

    const merged = next.map((c, index) => {
      const prev = prevById.get(c.id);
      if (!prev) {
        chatsChanged = true;
        return c;
      }

      const prevUpdatedAtMs = parseTimestampMs(prev.updatedAt);
      const remoteUpdatedAtMs = parseTimestampMs(c.updatedAt);
      const preferLocalSessionFields =
        prevUpdatedAtMs !== null &&
        remoteUpdatedAtMs !== null &&
        prevUpdatedAtMs > remoteUpdatedAtMs;

      const prevConfig = prev.config || {};
      const nextConfig = c.config || {};
      const hasLocalModel = Object.prototype.hasOwnProperty.call(prevConfig, "model");
      const hasLocalModelRef = Object.prototype.hasOwnProperty.call(prevConfig, "model_ref");
      const hasLocalReasoning = Object.prototype.hasOwnProperty.call(prevConfig, "reasoningEffort");
      const hasLocalGoldConfig = Object.prototype.hasOwnProperty.call(prevConfig, "goldConfig");

      // A count alone is not monotonic: clear/truncate/restore legitimately
      // lower it. Order the atomic summary pair by Bamboo's revision first so
      // an older high-count list cannot undo a newer reset, while a newer
      // reset lets the next 0 -> 1 append become observable. At an equal or
      // unavailable revision retain the old max-count lag protection.
      const activityRevisionOrder = compareActivityRevisions(c.lastActivityAt, prev.lastActivityAt);
      const previousMessageCount = prev.messageCount ?? 0;
      const remoteMessageCount = c.messageCount ?? 0;
      const remoteSummaryWins = activityRevisionOrder !== null && activityRevisionOrder > 0;
      const localSummaryWins = activityRevisionOrder !== null && activityRevisionOrder < 0;
      const effectiveMessageCount = remoteSummaryWins
        ? remoteMessageCount
        : localSummaryWins
          ? previousMessageCount
          : Math.max(previousMessageCount, remoteMessageCount);
      const effectiveLastActivityAt = remoteSummaryWins
        ? c.lastActivityAt
        : localSummaryWins
          ? prev.lastActivityAt
          : (c.lastActivityAt ?? prev.lastActivityAt);

      // Title precedence is governed by `title_version`, NOT `updatedAt`.
      // The backend bumps `title_version` on every authoritative title change
      // (manual PATCH or auto-title generation), so the highest version always wins.
      const remoteTitleVersion = c.titleVersion ?? 0;
      const localTitleVersion = prev.titleVersion ?? 0;
      const titleGenerated =
        prev.titleGenerated === true || c.titleGenerated === true
          ? true
          : remoteTitleVersion > localTitleVersion
            ? (c.titleGenerated ?? prev.titleGenerated)
            : (prev.titleGenerated ?? c.titleGenerated);
      const titleFields = {
        ...(remoteTitleVersion > localTitleVersion
          ? { title: c.title, titleVersion: remoteTitleVersion }
          : { title: prev.title, titleVersion: localTitleVersion }),
        // Lifecycle is monotonic: a pending summary may finalize, while a
        // lagging summary must never reopen title generation after manual or
        // generated finalization.
        titleGenerated,
      };

      const mergedConfig = {
        ...prevConfig,
        ...nextConfig,
        model: preferLocalSessionFields
          ? hasLocalModel
            ? prevConfig.model
            : nextConfig.model
          : nextConfig.model,
        model_ref: preferLocalSessionFields
          ? hasLocalModelRef
            ? prevConfig.model_ref
            : nextConfig.model_ref
          : nextConfig.model_ref,
        reasoningEffort: preferLocalSessionFields
          ? hasLocalReasoning
            ? prevConfig.reasoningEffort
            : nextConfig.reasoningEffort
          : nextConfig.reasoningEffort,
        goldConfig: preferLocalSessionFields
          ? hasLocalGoldConfig
            ? prevConfig.goldConfig
            : nextConfig.goldConfig
          : nextConfig.goldConfig,
        // Bamboo's summary is authoritative. The sole exception is the exact
        // window in which this session has an optimistic PATCH in flight.
        ...(() => {
          const permissionMode = reconcilePermissionModeSummary(
            c.id,
            nextConfig.permissionMode ?? "default",
            summaryRequestRevision,
          );
          return {
            permissionMode,
            permissionModeSupported: nextConfig.permissionModeSupported ?? false,
            bypassPermissions: permissionMode !== "default",
          };
        })(),
        compressionEvents: prev.config?.compressionEvents ?? c.config?.compressionEvents,
        syncCursor: prev.config?.syncCursor ?? c.config?.syncCursor,
      };

      const mergedChat: ChatItem = {
        ...c,
        // `title`, `titleVersion`, and `titleGenerated` are deliberately
        // omitted here —
        // version-based precedence below (`...titleFields`) is the source of truth
        // for those fields, overriding the `updatedAt`-based logic.
        pinned: preferLocalSessionFields ? prev.pinned : c.pinned,
        updatedAt: preferLocalSessionFields ? prev.updatedAt : c.updatedAt,
        messages: prev.messages,
        lastActivityAt: effectiveLastActivityAt,
        messageCount: effectiveMessageCount,
        planMode: c.planMode,
        config: mergedConfig,
        // Override title metadata with version/lifecycle precedence,
        // overriding the `updatedAt`-based decision for these fields specifically.
        ...titleFields,
      };

      if (canReuseSessionListChat(prev, mergedChat)) {
        if (state.chats[index] !== prev) {
          chatsChanged = true;
        }
        return prev;
      }

      chatsChanged = true;
      return mergedChat;
    });

    for (const localChat of state.chats) {
      if (protectedSessionIds.has(localChat.id) && !sessions.some((s) => s.id === localChat.id)) {
        merged.push(localChat);
        chatsChanged = true;
      }
    }

    if (!chatsChanged && executionBySession === state.executionBySession) {
      return state;
    }

    return {
      ...state,
      chats: chatsChanged ? merged : state.chats,
      executionBySession,
    };
  });
}

export async function executeRefreshChats(set: ChatSliceSet): Promise<void> {
  if (refreshChatsState.inFlight) {
    debugLog("[ChatSlice]", "refreshChats.inFlight.reuse", {});
    return refreshChatsState.inFlight;
  }

  debugLog("[ChatSlice]", "refreshChats.start", {});
  refreshChatsState.inFlight = (async () => {
    try {
      const summaryRequestRevision = beginPermissionModeSummaryRequest();
      const list = await agentClient.listSessions();
      debugLog("[ChatSlice]", "refreshChats.response", {
        count: list.sessions.length,
        runningCount: list.sessions.filter((session) => session.is_running).length,
      });
      applySessionsList(list.sessions, set, summaryRequestRevision);
    } catch (error) {
      console.error("[ChatSlice] Failed to refresh sessions:", error);
      debugLog("[ChatSlice]", "refreshChats.error", { error });
      throw error;
    }
  })().finally(() => {
    debugLog("[ChatSlice]", "refreshChats.finally", {});
    refreshChatsState.inFlight = null;
  });

  return refreshChatsState.inFlight;
}

export function executeForcedRefreshChats(set: ChatSliceSet): Promise<void> {
  if (refreshChatsState.forcedPromise) {
    debugLog("[ChatSlice]", "refreshChatsNow.forced.reuse", {});
    return refreshChatsState.forcedPromise;
  }

  debugLog("[ChatSlice]", "refreshChatsNow.forced.start", {
    hasInflight: Boolean(refreshChatsState.inFlight),
  });
  refreshChatsState.forcedPromise = (async () => {
    if (refreshChatsState.inFlight) {
      await refreshChatsState.inFlight;
    }
    await executeRefreshChats(set);
  })().finally(() => {
    debugLog("[ChatSlice]", "refreshChatsNow.forced.finally", {});
    refreshChatsState.forcedPromise = null;
  });

  return refreshChatsState.forcedPromise;
}

export { REFRESH_CHATS_THROTTLE_MS };
