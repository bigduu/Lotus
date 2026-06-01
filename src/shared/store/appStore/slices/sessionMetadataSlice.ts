/**
 * Unified entry point for replayable session-metadata events.
 *
 * Both the live SSE path (`useAgentEventSubscription`) and the boot/reconnect
 * replay path (`applyRunningSnapshot`) MUST route metadata events through
 * `applyReplayableSessionEvent` so that:
 *
 * 1. The same precedence rules apply in both paths (titleVersion-based for
 *    `session_title_updated`, updatedAt-based for `session_pinned_updated`).
 * 2. The reducer set stays narrow — `applyAgentEventInner` in
 *    `executionStateSlice` should never see a metadata event.
 *
 * State for these fields lives on `chatSessionSlice` (each `ChatItem` already
 * has `title`, `titleVersion`, `pinned`, `updatedAt`). This module is just the
 * dispatch surface; it does not own state.
 *
 * Implementation note: the dispatcher takes a `target` (the two `applyServer*`
 * actions) rather than reaching into `useAppStore` directly. That keeps this
 * module decoupled from the store singleton, which both prevents an import
 * cycle (this module is consumed by `chatSessionSlice`, which the singleton
 * also imports) and lets unit tests dispatch into an isolated `createStore`
 * without touching the global store.
 */

import type { AgentEvent } from "@services/chat/AgentService";
import type { ChatItem } from "@shared/types/chat";

/**
 * The subset of `AgentEvent` types that are persisted as session metadata and
 * replayed for late subscribers. Adding a new metadata field means: extend
 * this union, extend `isSessionMetadataEvent`, add a `case` below, and add an
 * `applyServer*` action on `chatSessionSlice`.
 */
export type ReplayableSessionMetadataEvent =
  | (AgentEvent & { type: "session_title_updated" })
  | (AgentEvent & { type: "session_pinned_updated" });

/**
 * Type guard separating metadata events from execution events. Used by the
 * snapshot partitioner so `applyAgentEventInner` only ever sees execution
 * events (running/tools/children/clarification).
 */
export function isSessionMetadataEvent(event: AgentEvent): event is ReplayableSessionMetadataEvent {
  return event.type === "session_title_updated" || event.type === "session_pinned_updated";
}

/**
 * Minimal target shape for the dispatcher — just the two store actions it
 * delegates to. Pass `useAppStore.getState()` from production code, or an
 * isolated test store's state from unit tests.
 */
export interface ReplayableSessionEventTarget {
  applyServerTitle: (sessionId: string, title: string, titleVersion: number) => void;
  applyServerPinned: (sessionId: string, pinned: boolean, updatedAt: string) => void;
}

/**
 * Dispatch a replayable metadata event into the chat session store. Idempotent
 * and version-aware — safe to call from both live SSE and replay paths.
 */
export function applyReplayableSessionEvent(
  event: ReplayableSessionMetadataEvent,
  target: ReplayableSessionEventTarget,
): void {
  switch (event.type) {
    case "session_title_updated": {
      if (
        typeof event.session_id === "string" &&
        typeof event.title === "string" &&
        typeof event.title_version === "number"
      ) {
        target.applyServerTitle(event.session_id, event.title, event.title_version);
      }
      break;
    }
    case "session_pinned_updated": {
      if (
        typeof event.session_id === "string" &&
        typeof event.pinned === "boolean" &&
        typeof event.updated_at === "string"
      ) {
        target.applyServerPinned(event.session_id, event.pinned, event.updated_at);
      }
      break;
    }
  }
}

/**
 * Pure variant of `applyReplayableSessionEvent` that mutates a caller-owned
 * `ChatItem[]` instead of the store. Used by `loadChats` to bake replay
 * events into the local baseline snapshot before the single trailing `set`.
 *
 * Precedence rules MUST stay in sync with `applyServerTitle` / `applyServerPinned`
 * in `chatSessionSlice.ts`.
 */
export function applyReplayableSessionEventToList(
  event: ReplayableSessionMetadataEvent,
  chats: ChatItem[],
): void {
  const idx = chats.findIndex((c) => c.id === event.session_id);
  if (idx < 0) return;
  switch (event.type) {
    case "session_title_updated": {
      if (typeof event.title !== "string" || typeof event.title_version !== "number") {
        return;
      }
      const incoming = event.title_version;
      const existing = chats[idx].titleVersion ?? 0;
      if (incoming <= existing) return;
      chats[idx] = { ...chats[idx], title: event.title, titleVersion: incoming };
      return;
    }
    case "session_pinned_updated": {
      if (typeof event.pinned !== "boolean" || typeof event.updated_at !== "string") {
        return;
      }
      const incomingTs = new Date(event.updated_at).getTime();
      const existingTs = new Date(chats[idx].updatedAt ?? 0).getTime();
      if (incomingTs < existingTs) return;
      if (chats[idx].pinned === event.pinned) return;
      chats[idx] = { ...chats[idx], pinned: event.pinned, updatedAt: event.updated_at };
      return;
    }
  }
}
