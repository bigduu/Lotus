import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { ChatItem } from "@shared/types/chat";
import { createChatSlice, type ChatSlice } from "../slices/chatSessionSlice";
import {
  applyReplayableSessionEvent,
  type ReplayableSessionMetadataEvent,
} from "../slices/sessionMetadataSlice";

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      deleteSession: vi.fn(),
      listSessions: vi.fn(async () => ({ sessions: [] })),
      createSession: vi.fn(),
      patchSession: vi.fn(async () => undefined),
      getHistory: vi.fn(async () => ({
        session_id: "s",
        compression_events: [],
        messages: [],
      })),
      deleteSessionMessage: vi.fn(),
    })),
  },
}));

const createChat = (overrides: Partial<ChatItem> & { id: string }): ChatItem => ({
  id: overrides.id,
  title: overrides.title ?? "Initial",
  titleVersion: overrides.titleVersion,
  pinned: overrides.pinned,
  updatedAt: overrides.updatedAt,
  createdAt: overrides.createdAt ?? Date.now(),
  messages: overrides.messages ?? [],
  config: overrides.config ?? {
    systemPromptId: "general_assistant",
    baseSystemPrompt: "Base prompt",
    lastUsedEnhancedPrompt: null,
  },
});

const createTestStore = (): StoreApi<ChatSlice> => {
  const sliceCreator = createChatSlice as unknown as (
    set: StoreApi<ChatSlice>["setState"],
    get: StoreApi<ChatSlice>["getState"],
    api: StoreApi<ChatSlice>,
  ) => ChatSlice;
  return createStore<ChatSlice>()((set, get, api) => sliceCreator(set, get, api));
};

// =============================================================================
// F5: boot-replay → live-SSE handover.
//
// Both paths route through `applyReplayableSessionEvent`. This test pretends
// to be `applyRunningSnapshot` first (replay) then `useAgentEventSubscription`
// (live), and asserts the version-aware reducer keeps the highest-versioned
// title regardless of arrival order.
// =============================================================================

describe("replay → live handover via applyReplayableSessionEvent", () => {
  let store: StoreApi<ChatSlice>;

  beforeEach(() => {
    store = createTestStore();
    store.setState((state) => ({
      ...state,
      chats: [createChat({ id: "s1", title: "Initial", titleVersion: 0 })],
    }));
  });

  it("replay sets the title, then a higher-version live event overwrites it", () => {
    const replayEvent: ReplayableSessionMetadataEvent = {
      type: "session_title_updated",
      session_id: "s1",
      title: "Replayed Title",
      title_version: 3,
      source: "auto",
      updated_at: "2026-01-15T12:00:00.000Z",
    };
    applyReplayableSessionEvent(replayEvent, store.getState());

    let chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.title).toBe("Replayed Title");
    expect(chat?.titleVersion).toBe(3);

    const liveEvent: ReplayableSessionMetadataEvent = {
      type: "session_title_updated",
      session_id: "s1",
      title: "Live Title",
      title_version: 5,
      source: "manual",
      updated_at: "2026-01-15T13:00:00.000Z",
    };
    applyReplayableSessionEvent(liveEvent, store.getState());

    chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.title).toBe("Live Title");
    expect(chat?.titleVersion).toBe(5);
  });

  it("a stale replayed event after a live event is ignored (live wins)", () => {
    const liveEvent: ReplayableSessionMetadataEvent = {
      type: "session_title_updated",
      session_id: "s1",
      title: "Live First",
      title_version: 9,
      source: "manual",
      updated_at: "2026-01-15T13:00:00.000Z",
    };
    applyReplayableSessionEvent(liveEvent, store.getState());

    // A replay of an OLDER snapshot then arrives — the version-guard rejects it.
    const stale: ReplayableSessionMetadataEvent = {
      type: "session_title_updated",
      session_id: "s1",
      title: "Stale Replay",
      title_version: 4,
      source: "auto",
      updated_at: "2026-01-15T12:00:00.000Z",
    };
    applyReplayableSessionEvent(stale, store.getState());

    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.title).toBe("Live First");
    expect(chat?.titleVersion).toBe(9);
  });

  it("pinned replay then live toggle both apply (newer updated_at wins)", () => {
    store.setState((state) => ({
      ...state,
      chats: [createChat({ id: "s1", pinned: false, updatedAt: "2026-01-15T10:00:00.000Z" })],
    }));

    const replayed: ReplayableSessionMetadataEvent = {
      type: "session_pinned_updated",
      session_id: "s1",
      pinned: true,
      updated_at: "2026-01-15T11:00:00.000Z",
    };
    applyReplayableSessionEvent(replayed, store.getState());

    let chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.pinned).toBe(true);
    expect(chat?.updatedAt).toBe("2026-01-15T11:00:00.000Z");

    const live: ReplayableSessionMetadataEvent = {
      type: "session_pinned_updated",
      session_id: "s1",
      pinned: false,
      updated_at: "2026-01-15T12:00:00.000Z",
    };
    applyReplayableSessionEvent(live, store.getState());

    chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.pinned).toBe(false);
    expect(chat?.updatedAt).toBe("2026-01-15T12:00:00.000Z");
  });
});
