import { StateCreator } from "zustand";
import { AgentClient, SessionSummary } from "@services/chat/AgentService";
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
export function applySessionsList(sessions: SessionSummary[], set: ChatSliceSet): void {
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

      // Ensure messageCount stays monotonic, as listSessions summary might briefly lag
      const effectiveMessageCount = Math.max(prev.messageCount ?? 0, c.messageCount ?? 0);

      // Title precedence is governed by `title_version`, NOT `updatedAt`.
      // The backend bumps `title_version` on every authoritative title change
      // (manual PATCH or auto-title generation), so the highest version always wins.
      const remoteTitleVersion = c.titleVersion ?? 0;
      const localTitleVersion = prev.titleVersion ?? 0;
      const titleFields =
        remoteTitleVersion > localTitleVersion
          ? { title: c.title, titleVersion: remoteTitleVersion }
          : { title: prev.title, titleVersion: localTitleVersion };

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
        // `bypass_permissions` is only carried by the detail endpoint, never the
        // lightweight list. Keep the locally-known value (set via the toggle or a
        // prior detail load) so a list refresh can't reset it to `false`.
        bypassPermissions: Object.prototype.hasOwnProperty.call(prevConfig, "bypassPermissions")
          ? prevConfig.bypassPermissions
          : nextConfig.bypassPermissions,
        compressionEvents: prev.config?.compressionEvents ?? c.config?.compressionEvents,
        syncCursor: prev.config?.syncCursor ?? c.config?.syncCursor,
      };

      const mergedChat: ChatItem = {
        ...c,
        // `title` and `titleVersion` are deliberately omitted here —
        // version-based precedence below (`...titleFields`) is the source of truth
        // for those two fields, overriding the `updatedAt`-based logic.
        pinned: preferLocalSessionFields ? prev.pinned : c.pinned,
        updatedAt: preferLocalSessionFields ? prev.updatedAt : c.updatedAt,
        messages: prev.messages,
        messageCount: effectiveMessageCount,
        planMode: c.planMode,
        config: mergedConfig,
        // Override title/titleVersion with version-based precedence,
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
      const list = await agentClient.listSessions();
      debugLog("[ChatSlice]", "refreshChats.response", {
        count: list.sessions.length,
        runningCount: list.sessions.filter((session) => session.is_running).length,
      });
      applySessionsList(list.sessions, set);
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
