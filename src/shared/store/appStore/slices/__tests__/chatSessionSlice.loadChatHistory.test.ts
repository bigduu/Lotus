import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import { createChatSlice, type ChatSlice } from "../chatSessionSlice";
import type { ChatItem, UserMessage } from "@shared/types/chat";
import { useSessionReadStateStore } from "@shared/store/sessionReadStateStore";

const { mockGetHistory } = vi.hoisted(() => ({
  mockGetHistory: vi.fn(),
}));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      getHistory: mockGetHistory,
      patchSession: vi.fn(async () => undefined),
      deleteSession: vi.fn(),
    })),
  },
}));

const userMessage = (id: string, content: string): UserMessage => ({
  id,
  role: "user",
  content,
  createdAt: "2025-03-01T00:00:00Z",
});

const makeChat = (messages: UserMessage[]): ChatItem =>
  ({
    id: "s1",
    title: "Session",
    kind: "root",
    createdAt: 1710000000000,
    messages,
    messageCount: messages.length,
    config: {
      systemPromptId: "general_assistant",
      baseSystemPrompt: "You are helpful.",
      lastUsedEnhancedPrompt: null,
    },
  }) as ChatItem;

const historyOf = (ids: string[]) => ({
  session_id: "s1",
  compression_events: [],
  messages: ids.map((id) => ({
    id,
    role: "user" as const,
    content: `server-${id}`,
    created_at: "2025-03-01T00:00:00Z",
  })),
});

type TestState = ChatSlice;
const createTestStore = (chat: ChatItem) => {
  const store = createStore<TestState>()((set, get, api) => ({
    ...(createChatSlice as any)(set, get, api),
    chats: [chat],
    currentSessionId: chat.id,
  }));
  return store as StoreApi<TestState>;
};

describe("loadChatHistory replace-mode staleness guard (#164)", () => {
  beforeEach(() => {
    mockGetHistory.mockReset();
    localStorage.clear();
    useSessionReadStateStore.setState({
      v: 2,
      initialized: true,
      feedResetThrough: 0,
      markers: {},
    });
  });

  it("skips a stale snapshot when the session advanced while fetching", async () => {
    const store = createTestStore(makeChat([userMessage("local-1", "first")]));

    let resolveHistory: (value: unknown) => void = () => {};
    mockGetHistory.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );

    const loadPromise = store.getState().loadChatHistory("s1", { mode: "replace" });

    // The session advances while the fetch is in flight (streaming append).
    store.getState().updateSession("s1", {
      messages: [userMessage("local-1", "first"), userMessage("local-2", "streamed")],
    });

    resolveHistory(historyOf(["h1"]));
    expect(await loadPromise).toBe(false);

    const messages = store.getState().chats[0].messages;
    expect(messages.map((m) => m.id)).toEqual(["local-1", "local-2"]);
  });

  it("applies the replace snapshot when the session did not advance", async () => {
    const store = createTestStore(makeChat([userMessage("local-1", "first")]));
    mockGetHistory.mockResolvedValue(historyOf(["h1", "h2"]));

    await store.getState().loadChatHistory("s1", { mode: "replace" });

    const messages = store.getState().chats[0].messages;
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe("h1");
    expect(messages[1].id).toBe("h2");
  });

  it("leaves read acknowledgement to the visible caller after applying history", async () => {
    const store = createTestStore(makeChat([userMessage("local-1", "first")]));
    useSessionReadStateStore.getState().markUnreadFromFeed("s1", 10);
    let resolveHistory: (value: ReturnType<typeof historyOf>) => void = () => {};
    mockGetHistory.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );

    const loadPromise = store.getState().loadChatHistory("s1", { mode: "replace" });
    useSessionReadStateStore.getState().markUnreadFromFeed("s1", 11);
    resolveHistory(historyOf(["h1", "h2"]));

    expect(await loadPromise).toBe(true);
    expect(useSessionReadStateStore.getState().markers.s1).toMatchObject({
      dirtyContentThrough: 11,
    });
    expect(useSessionReadStateStore.getState().markers.s1.readContentThrough ?? 0).toBe(0);
  });

  it("returns false and leaves dirty state unread after a history failure", async () => {
    const store = createTestStore(makeChat([userMessage("local-1", "first")]));
    useSessionReadStateStore.getState().markUnreadFromFeed("s1", 10);
    mockGetHistory.mockRejectedValue(new Error("offline"));

    expect(await store.getState().loadChatHistory("s1")).toBe(false);
    expect(useSessionReadStateStore.getState().markers.s1.readContentThrough ?? 0).toBe(0);
  });

  it("still applies an intentional shrink (retry truncate resync)", async () => {
    const store = createTestStore(
      makeChat([userMessage("m1", "1"), userMessage("m2", "2"), userMessage("m3", "3")]),
    );
    mockGetHistory.mockResolvedValue(historyOf(["h1"]));

    await store.getState().loadChatHistory("s1", { mode: "replace" });

    const messages = store.getState().chats[0].messages;
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe("h1");
  });

  it("skips the overwrite when the session was deleted while fetching", async () => {
    const store = createTestStore(makeChat([userMessage("local-1", "first")]));

    let resolveHistory: (value: unknown) => void = () => {};
    mockGetHistory.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );

    const loadPromise = store.getState().loadChatHistory("s1", { mode: "replace" });
    store.setState({ chats: [] });
    resolveHistory(historyOf(["h1", "h2"]));
    await loadPromise;

    expect(store.getState().chats).toHaveLength(0);
  });

  it("uses total_message_count (not the capped tail length) for sync position (#152)", async () => {
    // A >2000-message session's cold fetch is capped to the newest 2000
    // messages; the pre-cap count is the authoritative sync position.
    // Writing the capped length would wedge the session into a permanent
    // need_sync loop.
    const store = createTestStore(makeChat([userMessage("local-1", "first")]));
    mockGetHistory.mockResolvedValue({
      ...historyOf(["h1", "h2"]),
      truncated: true,
      total_message_count: 2218,
    });

    await store.getState().loadChatHistory("s1", { mode: "replace" });

    const chat = store.getState().chats[0];
    expect(chat.messages).toHaveLength(2); // the capped tail only
    expect(chat.messageCount).toBe(2218);
    expect(chat.config.syncCursor?.messageCount).toBe(2218);
  });

  it("falls back to messages.length when total_message_count is absent", async () => {
    const store = createTestStore(makeChat([userMessage("local-1", "first")]));
    mockGetHistory.mockResolvedValue(historyOf(["h1", "h2"]));

    await store.getState().loadChatHistory("s1", { mode: "replace" });

    const chat = store.getState().chats[0];
    expect(chat.messageCount).toBe(2);
    expect(chat.config.syncCursor?.messageCount).toBe(2);
  });

  it("re-marks per attempt: an advance during attempt 0 does not block a settled retry", async () => {
    const store = createTestStore(makeChat([userMessage("local-1", "first")]));

    // Attempt 0: resolve slowly and advance the session mid-flight — the
    // guard skips. Attempt 1 (retried): nothing advances, so the snapshot
    // applies. `waitForAssistant` forces a retry when the tail is a user
    // message; give attempt 1 an assistant tail.
    let call = 0;
    mockGetHistory.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(historyOf(["h1"])), 0);
        });
      }
      return Promise.resolve({
        ...historyOf(["h1"]),
        messages: [
          ...historyOf(["h1"]).messages,
          {
            id: "a1",
            role: "assistant" as const,
            content: "reply",
            created_at: "2025-03-01T00:00:01Z",
          },
        ],
      });
    });

    const loadPromise = store.getState().loadChatHistory("s1", {
      mode: "replace",
      waitForAssistant: true,
      retries: 1,
      retryDelayMs: 1,
    });

    // Advance while attempt 0 is in flight.
    store.getState().updateSession("s1", {
      messages: [userMessage("local-1", "first"), userMessage("local-2", "streamed")],
    });

    await loadPromise;

    // Attempt 0's stale snapshot was skipped; attempt 1 saw a settled
    // session and applied its snapshot.
    const messages = store.getState().chats[0].messages;
    expect(messages.map((m) => m.id)).toEqual(["h1", "a1"]);
  });
});

describe("loadChatHistory monotonic-mode staleness guard (#178)", () => {
  beforeEach(() => {
    mockGetHistory.mockReset();
  });

  it("preserves messages appended while a longer snapshot is in flight", async () => {
    const localFirst = userMessage("local-1", "first");
    const localStreamed = userMessage("local-2", "streamed");
    const store = createTestStore(makeChat([localFirst]));

    let resolveHistory: (value: unknown) => void = () => {};
    mockGetHistory.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );

    const loadPromise = store.getState().loadChatHistory("s1", { mode: "monotonic" });

    // The backend response is longer than the pre-fetch state, but the
    // session has independently advanced to newer messages while waiting.
    store.getState().updateSession("s1", {
      messages: [localFirst, localStreamed],
    });

    resolveHistory({
      ...historyOf(["h1", "h2"]),
      total_message_count: 4,
    });
    await loadPromise;

    const chat = store.getState().chats[0];
    expect(chat.messages.map((message) => message.id)).toEqual(["local-1", "local-2"]);
    expect(chat.messageCount).toBe(4);
  });

  it("reports a settled shorter snapshot as unapplied so callers cannot acknowledge it", async () => {
    const store = createTestStore(
      makeChat([userMessage("local-1", "first"), userMessage("local-2", "second")]),
    );
    mockGetHistory.mockResolvedValue(historyOf(["h1"]));

    const loaded = await store.getState().loadChatHistory("s1", { mode: "monotonic" });

    expect(loaded).toBe(false);
    expect(store.getState().chats[0].messages.map((message) => message.id)).toEqual([
      "local-1",
      "local-2",
    ]);
  });
});
