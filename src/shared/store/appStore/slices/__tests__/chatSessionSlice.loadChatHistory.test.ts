import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import { createChatSlice, type ChatSlice } from "../chatSessionSlice";
import type { ChatItem, UserMessage } from "@shared/types/chat";

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
    await loadPromise;

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
});
