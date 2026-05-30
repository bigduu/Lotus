import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { ChatItem } from "../../../types/chat";
import { createChatSlice, type ChatSlice } from "../chatSessionSlice";

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
// F2: applyServerTitle — version-aware precedence.
// =============================================================================

describe("applyServerTitle", () => {
  let store: StoreApi<ChatSlice>;

  beforeEach(() => {
    store = createTestStore();
    store.setState((state) => ({
      ...state,
      chats: [createChat({ id: "s1", title: "Original", titleVersion: 3 })],
    }));
  });

  it("ignores events with title_version <= current version", () => {
    store.getState().applyServerTitle("s1", "Stale Replay", 2);
    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.title).toBe("Original");
    expect(chat?.titleVersion).toBe(3);
  });

  it("ignores events with title_version equal to current version", () => {
    store.getState().applyServerTitle("s1", "Same Version", 3);
    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.title).toBe("Original");
    expect(chat?.titleVersion).toBe(3);
  });

  it("applies events with title_version strictly greater than current version", () => {
    store.getState().applyServerTitle("s1", "Newer Title", 5);
    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.title).toBe("Newer Title");
    expect(chat?.titleVersion).toBe(5);
  });

  it("treats missing local titleVersion as 0", () => {
    store.setState((state) => ({
      ...state,
      chats: [createChat({ id: "s2", title: "Legacy" })],
    }));
    store.getState().applyServerTitle("s2", "Versioned", 1);
    const chat = store.getState().chats.find((c) => c.id === "s2");
    expect(chat?.title).toBe("Versioned");
    expect(chat?.titleVersion).toBe(1);
  });

  it("does nothing when the session is not in the chat list", () => {
    const before = store.getState().chats;
    store.getState().applyServerTitle("missing", "Anything", 99);
    expect(store.getState().chats).toBe(before);
  });
});

// =============================================================================
// F3: applyServerPinned — updatedAt-aware precedence + idempotency.
// =============================================================================

describe("applyServerPinned", () => {
  let store: StoreApi<ChatSlice>;
  const baseTime = "2026-01-15T12:00:00.000Z";

  beforeEach(() => {
    store = createTestStore();
    store.setState((state) => ({
      ...state,
      chats: [createChat({ id: "s1", pinned: false, updatedAt: baseTime })],
    }));
  });

  it("applies a pinned change with a newer updated_at", () => {
    const newer = "2026-01-15T13:00:00.000Z";
    store.getState().applyServerPinned("s1", true, newer);
    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.pinned).toBe(true);
    expect(chat?.updatedAt).toBe(newer);
  });

  it("ignores stale replays whose updated_at is older than the local copy", () => {
    const stale = "2026-01-15T11:00:00.000Z";
    const before = store.getState().chats;
    store.getState().applyServerPinned("s1", true, stale);
    expect(store.getState().chats).toBe(before);
  });

  it("is idempotent — skips the write when pinned matches", () => {
    const before = store.getState().chats;
    store.getState().applyServerPinned("s1", false, "2026-01-15T13:00:00.000Z");
    expect(store.getState().chats).toBe(before);
  });

  it("applies the change when local updatedAt is missing (no stale baseline)", () => {
    store.setState((state) => ({
      ...state,
      chats: [createChat({ id: "s2", pinned: false })],
    }));
    store.getState().applyServerPinned("s2", true, "2026-01-15T11:00:00.000Z");
    const chat = store.getState().chats.find((c) => c.id === "s2");
    expect(chat?.pinned).toBe(true);
  });

  it("does nothing when the session is not in the chat list", () => {
    const before = store.getState().chats;
    store.getState().applyServerPinned("missing", true, "2026-01-15T13:00:00.000Z");
    expect(store.getState().chats).toBe(before);
  });
});
