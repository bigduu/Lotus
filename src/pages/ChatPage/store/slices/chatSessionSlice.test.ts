import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { ChatItem } from "../../types/chat";
import { createChatSlice, type ChatSlice } from "./chatSessionSlice";
import { useProviderStore } from "./providerSlice";

const {
  deleteSessionMock,
  deleteSessionMessageMock,
  getHistoryMock,
  listSessionsMock,
  createSessionMock,
  patchSessionMock,
} = vi.hoisted(() => ({
  deleteSessionMock: vi.fn(),
  deleteSessionMessageMock: vi.fn(async () => undefined),
  getHistoryMock: vi.fn(async () => ({
    session_id: "session-1",
    compression_events: [],
    messages: [],
  })),
  listSessionsMock: vi.fn(async () => ({ sessions: [] })),
  createSessionMock: vi.fn(async () => ({
    session: {
      id: "session-1",
      kind: "root",
      title: "New Session",
      pinned: false,
      root_session_id: "session-1",
      spawn_depth: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      message_count: 0,
      has_attachments: false,
      is_running: false,
    },
  })),
  patchSessionMock: vi.fn(async () => undefined),
}));

vi.mock("../../services/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      deleteSession: deleteSessionMock,
      listSessions: listSessionsMock,
      createSession: createSessionMock,
      patchSession: patchSessionMock,
      getHistory: getHistoryMock,
      deleteSessionMessage: deleteSessionMessageMock,
    })),
  },
}));

const createChat = (id: string): ChatItem => ({
  id,
  title: `Chat ${id}`,
  createdAt: Date.now(),
  pinned: false,
  messages: [],
  config: {
    systemPromptId: "general_assistant",
    baseSystemPrompt: "Base prompt",
    lastUsedEnhancedPrompt: null,
  },
  currentInteraction: null,
});

const createUserMessage = (id: string) =>
  ({
    id,
    role: "user",
    createdAt: new Date().toISOString(),
    content: "hello",
    images: [],
  }) as any;

const createTestStore = (): StoreApi<ChatSlice> => {
  const sliceCreator = createChatSlice as unknown as (
    set: StoreApi<ChatSlice>["setState"],
    get: StoreApi<ChatSlice>["getState"],
    api: StoreApi<ChatSlice>,
  ) => ChatSlice;

  return createStore<ChatSlice>()((set, get, api) => sliceCreator(set, get, api));
};

const resetProviderStore = () => {
  useProviderStore.setState({
    currentProvider: "copilot",
    providerConfig: {
      provider: "copilot",
      providers: {},
    },
    isLoading: false,
    error: null,
  });
};

describe("chatSessionSlice deletion", () => {
  beforeEach(() => {
    deleteSessionMock.mockReset();
    deleteSessionMock.mockResolvedValue(undefined);
    deleteSessionMessageMock.mockReset();
    deleteSessionMessageMock.mockResolvedValue(undefined);
    getHistoryMock.mockReset();
    getHistoryMock.mockResolvedValue({
      session_id: "session-1",
      compression_events: [],
      messages: [],
    });
  });

  it("deletes the linked backend session before removing a chat", async () => {
    const store = createTestStore();
    const chat = createChat("session-1");

    store.setState((state) => ({
      ...state,
      chats: [chat],
      currentSessionId: chat.id,
      latestActiveSessionId: chat.id,
    }));

    await store.getState().deleteSession(chat.id);

    expect(deleteSessionMock).toHaveBeenCalledWith("session-1");
    expect(store.getState().chats).toHaveLength(0);
  });

  it("still removes chat locally when backend deletion fails", async () => {
    const store = createTestStore();
    const chat = createChat("session-1");
    deleteSessionMock.mockRejectedValueOnce(new Error("delete failed"));

    store.setState((state) => ({
      ...state,
      chats: [chat],
      currentSessionId: chat.id,
      latestActiveSessionId: chat.id,
    }));

    await expect(store.getState().deleteSession(chat.id)).resolves.toBeUndefined();

    expect(deleteSessionMock).toHaveBeenCalledWith("session-1");
    expect(store.getState().chats).toHaveLength(0);
  });

  it("deletes all linked backend sessions when removing multiple chats", async () => {
    const store = createTestStore();
    const chats = [createChat("session-1"), createChat("session-2"), createChat("session-3")];

    store.setState((state) => ({
      ...state,
      chats,
      currentSessionId: chats[0].id,
      latestActiveSessionId: chats[0].id,
    }));

    await store.getState().deleteSessions(chats.map((chat) => chat.id));

    expect(deleteSessionMock).toHaveBeenCalledTimes(3);
    expect(deleteSessionMock).toHaveBeenNthCalledWith(1, "session-1");
    expect(deleteSessionMock).toHaveBeenNthCalledWith(2, "session-2");
    expect(deleteSessionMock).toHaveBeenNthCalledWith(3, "session-3");
    expect(store.getState().chats).toHaveLength(0);
  });

  it("deletes a message only after backend deletion succeeds", async () => {
    const store = createTestStore();
    const chat = createChat("session-1");
    chat.messages = [createUserMessage("msg-1")];

    store.setState((state) => ({
      ...state,
      chats: [chat],
      currentSessionId: chat.id,
      latestActiveSessionId: chat.id,
    }));

    const result = await store.getState().deleteMessage("session-1", "msg-1");

    expect(deleteSessionMessageMock).toHaveBeenCalledWith("session-1", "msg-1");
    expect(result).toMatchObject({ success: true, messageId: "msg-1" });
    expect(store.getState().chats[0]?.messages).toHaveLength(0);
  });

  it("keeps local message when backend deletion fails", async () => {
    const store = createTestStore();
    const chat = createChat("session-1");
    chat.messages = [createUserMessage("msg-1")];
    deleteSessionMessageMock.mockRejectedValueOnce(new Error("delete failed"));

    store.setState((state) => ({
      ...state,
      chats: [chat],
      currentSessionId: chat.id,
      latestActiveSessionId: chat.id,
    }));

    const result = await store.getState().deleteMessage("session-1", "msg-1");

    expect(deleteSessionMessageMock).toHaveBeenCalledWith("session-1", "msg-1");
    expect(result).toMatchObject({
      success: false,
      reason: "backend_error",
      messageId: "msg-1",
    });
    expect(store.getState().chats[0]?.messages).toHaveLength(1);
  });
});

describe("chatSessionSlice history mapping", () => {
  beforeEach(() => {
    getHistoryMock.mockReset();
  });

  it("keeps assistant text when message also contains tool calls", async () => {
    const store = createTestStore();
    const chat = createChat("session-1");

    store.setState((state) => ({
      ...state,
      chats: [chat],
      currentSessionId: chat.id,
      latestActiveSessionId: chat.id,
    }));

    getHistoryMock.mockResolvedValueOnce({
      session_id: "session-1",
      compression_events: [],
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "Detailed report body",
          tool_calls: [
            {
              id: "tool-call-1",
              type: "function",
              function: {
                name: "Task",
                arguments: '{"tasks":[]}',
              },
            },
          ],
          created_at: "2026-03-15T00:00:00Z",
        },
        {
          id: "tool-1",
          role: "tool",
          content: "Task list updated",
          tool_call_id: "tool-call-1",
          created_at: "2026-03-15T00:00:01Z",
        },
      ],
    } as any);

    await store.getState().loadChatHistory("session-1", { mode: "replace" });

    const updated = store.getState().chats.find((c) => c.id === "session-1");
    expect(updated?.messages).toHaveLength(3);
    expect(updated?.messages[0]).toMatchObject({
      role: "assistant",
      type: "text",
      content: "Detailed report body",
    });
    expect(updated?.messages[1]).toMatchObject({
      role: "assistant",
      type: "tool_call",
    });
    expect(updated?.messages[2]).toMatchObject({
      role: "assistant",
      type: "tool_result",
      toolCallId: "tool-call-1",
      isError: false,
    });
  });

  it("keeps assistant reasoning when tool-call message has empty text", async () => {
    const store = createTestStore();
    const chat = createChat("session-1");

    store.setState((state) => ({
      ...state,
      chats: [chat],
      currentSessionId: chat.id,
      latestActiveSessionId: chat.id,
    }));

    getHistoryMock.mockResolvedValueOnce({
      session_id: "session-1",
      compression_events: [],
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          reasoning: "I should inspect project files before editing.",
          tool_calls: [
            {
              id: "tool-call-1",
              type: "function",
              function: {
                name: "read_file",
                arguments: '{"path":"README.md"}',
              },
            },
          ],
          created_at: "2026-03-15T00:00:00Z",
        },
      ],
    } as any);

    await store.getState().loadChatHistory("session-1", { mode: "replace" });

    const updated = store.getState().chats.find((c) => c.id === "session-1");
    expect(updated?.messages).toHaveLength(2);
    expect(updated?.messages[0]).toMatchObject({
      role: "assistant",
      type: "text",
      content: "",
      metadata: {
        reasoning: "I should inspect project files before editing.",
      },
    });
    expect(updated?.messages[1]).toMatchObject({
      role: "assistant",
      type: "tool_call",
    });
  });

  it("preserves failed tool status from history", async () => {
    const store = createTestStore();
    const chat = createChat("session-1");

    store.setState((state) => ({
      ...state,
      chats: [chat],
      currentSessionId: chat.id,
      latestActiveSessionId: chat.id,
    }));

    getHistoryMock.mockResolvedValueOnce({
      session_id: "session-1",
      compression_events: [],
      messages: [
        {
          id: "assistant-1",
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "tool-call-err",
              type: "function",
              function: {
                name: "Edit",
                arguments: '{"file_path":"/tmp/demo.ts","patch":"..."}',
              },
            },
          ],
          created_at: "2026-03-15T00:00:00Z",
        },
        {
          id: "tool-err",
          role: "tool",
          content: "Error: Invalid arguments",
          tool_call_id: "tool-call-err",
          tool_success: false,
          created_at: "2026-03-15T00:00:01Z",
        },
      ],
    } as any);

    await store.getState().loadChatHistory("session-1", { mode: "replace" });

    const updated = store.getState().chats.find((c) => c.id === "session-1");
    expect(updated?.messages[0]).toMatchObject({
      role: "assistant",
      type: "tool_call",
    });
    expect(updated?.messages[1]).toMatchObject({
      role: "assistant",
      type: "tool_result",
      toolCallId: "tool-call-err",
      isError: true,
    });
  });

  it("maps compressed flags and compression events from history", async () => {
    const store = createTestStore();
    const chat = createChat("session-1");

    store.setState((state) => ({
      ...state,
      chats: [chat],
      currentSessionId: chat.id,
      latestActiveSessionId: chat.id,
    }));

    getHistoryMock.mockResolvedValueOnce({
      session_id: "session-1",
      compression_events: [
        {
          id: "cevt-1",
          created_at: "2026-03-15T10:00:00Z",
          messages_compressed: 2,
          segments_removed: 1,
        },
      ],
      messages: [
        {
          id: "old-user",
          role: "user",
          content: "old context",
          compressed: true,
          compressed_by_event_id: "cevt-1",
          created_at: "2026-03-15T09:59:00Z",
        },
        {
          id: "new-user",
          role: "user",
          content: "active context",
          created_at: "2026-03-15T10:01:00Z",
        },
      ],
    } as any);

    await store.getState().loadChatHistory("session-1", { mode: "replace" });

    const updated = store.getState().chats.find((c) => c.id === "session-1");
    expect(updated?.messages[0]).toMatchObject({
      id: "old-user",
      role: "user",
      isCompressed: true,
      compressedEventId: "cevt-1",
    });
    expect(updated?.config.compressionEvents).toEqual([
      {
        id: "cevt-1",
        createdAt: "2026-03-15T10:00:00Z",
        messagesCompressed: 2,
        segmentsRemoved: 1,
      },
    ]);
  });

  it("monotonic mode does not replace local messages with a shorter backend snapshot", async () => {
    const store = createTestStore();
    const chat = createChat("session-1");
    chat.messages = [
      {
        id: "local-user-1",
        role: "user",
        content: "continue",
        createdAt: "2026-03-15T10:00:00Z",
      } as any,
      {
        id: "local-assistant-1",
        role: "assistant",
        type: "text",
        content: "streaming draft",
        createdAt: "2026-03-15T10:00:01Z",
      } as any,
    ];

    store.setState((state) => ({
      ...state,
      chats: [chat],
      currentSessionId: chat.id,
      latestActiveSessionId: chat.id,
    }));

    // Backend lags and returns fewer messages ending with assistant (previously could overwrite).
    getHistoryMock.mockResolvedValueOnce({
      session_id: "session-1",
      compression_events: [],
      messages: [
        {
          id: "backend-assistant-1",
          role: "assistant",
          content: "older snapshot",
          created_at: "2026-03-15T10:00:01Z",
        },
      ],
    } as any);

    await store.getState().loadChatHistory("session-1", { mode: "monotonic" });

    const updated = store.getState().chats.find((c) => c.id === "session-1");
    expect(updated?.messages).toHaveLength(2);
    expect(updated?.messages[0]).toMatchObject({ id: "local-user-1" });
    expect(updated?.messages[1]).toMatchObject({ id: "local-assistant-1" });
  });

  it("monotonic mode replaces equal-length local placeholders when backend terminal id changes", async () => {
    const store = createTestStore();
    const chat = createChat("session-1");
    chat.messages = [
      {
        id: "local-user-1",
        role: "user",
        content: "continue",
        createdAt: "2026-03-15T10:00:00Z",
      } as any,
      {
        id: "local-assistant-temp",
        role: "assistant",
        type: "text",
        content: "draft",
        createdAt: "2026-03-15T10:00:01Z",
      } as any,
    ];

    store.setState((state) => ({
      ...state,
      chats: [chat],
      currentSessionId: chat.id,
      latestActiveSessionId: chat.id,
    }));

    getHistoryMock.mockResolvedValueOnce({
      session_id: "session-1",
      compression_events: [],
      messages: [
        {
          id: "backend-user-1",
          role: "user",
          content: "continue",
          created_at: "2026-03-15T10:00:00Z",
        },
        {
          id: "backend-assistant-1",
          role: "assistant",
          content: "finalized",
          created_at: "2026-03-15T10:00:01Z",
        },
      ],
    } as any);

    await store.getState().loadChatHistory("session-1", { mode: "monotonic" });

    const updated = store.getState().chats.find((c) => c.id === "session-1");
    expect(updated?.messages).toHaveLength(2);
    expect(updated?.messages[0]).toMatchObject({ id: "backend-user-1" });
    expect(updated?.messages[1]).toMatchObject({ id: "backend-assistant-1" });
  });
});

describe("chatSessionSlice session model propagation", () => {
  beforeEach(() => {
    createSessionMock.mockReset();
    createSessionMock.mockResolvedValue({
      session: {
        id: "session-1",
        kind: "root",
        title: "New Session",
        pinned: false,
        root_session_id: "session-1",
        spawn_depth: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        message_count: 0,
        has_attachments: false,
        is_running: false,
      },
    });
    resetProviderStore();
  });

  it("passes active provider model into createSession", async () => {
    const store = createTestStore();
    useProviderStore.setState({
      currentProvider: "copilot",
      providerConfig: {
        provider: "copilot",
        providers: {
          copilot: { model: "gpt-5.2" },
        },
      },
    });

    const { id: _id, ...chatData } = createChat("temp-chat");
    await store.getState().addChat(chatData);

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.2",
      }),
    );
  });

  it("keeps model undefined when provider model is unavailable", async () => {
    const store = createTestStore();
    const { id: _id, ...chatData } = createChat("temp-chat");
    await store.getState().addChat(chatData);

    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: undefined,
      }),
    );
  });
});
