import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { SessionSummary } from "@services/chat/AgentService";
import type { ChatItem } from "@shared/types/chat";
import { createChatSlice, type ChatSlice } from "../chatSessionSlice";

const { mockCopySession, mockListSessions } = vi.hoisted(() => ({
  mockCopySession: vi.fn(),
  mockListSessions: vi.fn(),
}));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: () => ({
      copySession: mockCopySession,
      listSessions: mockListSessions,
    }),
  },
  isSessionCreateRecoveryError: () => false,
}));

const summary = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: "copied-session",
  kind: "root",
  title: "Copied conversation",
  title_version: 4,
  title_generated: true,
  pinned: false,
  parent_session_id: null,
  root_session_id: "copied-session",
  spawn_depth: 0,
  model: "gpt-copy",
  model_ref: { provider: "openai", model: "gpt-copy" },
  reasoning_effort: "high",
  gold_config: { enabled: true, goal: "Preserve this goal" },
  project_id: "project-1",
  workspace_path: "/work/project-1",
  created_at: "2026-08-14T01:00:00.000Z",
  updated_at: "2026-08-14T01:00:00.000Z",
  last_activity_at: "2026-08-14T01:00:00.000Z",
  message_count: 2,
  has_attachments: true,
  is_running: false,
  permission_mode: "auto",
  ...overrides,
});

const sourceChat = (): ChatItem => ({
  id: "source-session",
  kind: "child",
  parentSessionId: "parent-session",
  rootSessionId: "parent-session",
  spawnDepth: 1,
  title: "Original child",
  createdAt: Date.parse("2026-08-13T01:00:00.000Z"),
  messages: [{ id: "source-message", role: "user", content: "Original content" }],
  config: {
    systemPromptId: "general_assistant",
    baseSystemPrompt: "Original prompt",
    lastUsedEnhancedPrompt: null,
  },
});

const sourceSummary = (): SessionSummary => ({
  id: "source-session",
  kind: "child",
  title: "Original child",
  title_version: 0,
  title_generated: false,
  pinned: false,
  parent_session_id: "parent-session",
  root_session_id: "parent-session",
  spawn_depth: 1,
  created_at: "2026-08-13T01:00:00.000Z",
  updated_at: "2026-08-13T01:00:00.000Z",
  last_activity_at: "2026-08-13T01:00:00.000Z",
  message_count: 1,
  has_attachments: false,
  is_running: false,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
};

type TestState = ChatSlice & { executionBySession: Record<string, never> };

const createTestStore = (): StoreApi<TestState> => {
  const store = createStore<TestState>()((set, get, api) => ({
    ...(
      createChatSlice as never as (set: typeof set, get: typeof get, api: typeof api) => ChatSlice
    )(set, get, api),
    executionBySession: {},
  }));
  return store;
};

describe("chatSessionSlice copySession (#153)", () => {
  beforeEach(() => {
    mockCopySession.mockReset();
    mockListSessions.mockReset();
    mockListSessions.mockResolvedValue({
      sessions: [summary(), sourceSummary()],
    });
  });

  it("atomically upserts the authoritative root summary without racing pane selection", async () => {
    const store = createTestStore();
    const source = sourceChat();
    store.setState((state) => ({
      ...state,
      chats: [source],
      currentSessionId: source.id,
      latestActiveSessionId: source.id,
    }));
    mockCopySession.mockResolvedValue({ session: summary() });

    await expect(store.getState().copySession(source.id)).resolves.toEqual(summary());

    expect(mockCopySession).toHaveBeenCalledWith("source-session");
    expect(store.getState().chats).toHaveLength(2);
    expect(store.getState().chats[0]).toMatchObject({
      id: "copied-session",
      kind: "root",
      parentSessionId: null,
      rootSessionId: "copied-session",
      spawnDepth: 0,
      messageCount: 2,
      hasAttachments: true,
      config: {
        projectId: "project-1",
        workspacePath: "/work/project-1",
        model: "gpt-copy",
        model_ref: { provider: "openai", model: "gpt-copy" },
        reasoningEffort: "high",
        permissionMode: "auto",
      },
    });
    // Pane assignment and selection are intentionally owned by openSession so
    // it can update both synchronously and in the required order.
    expect(store.getState().currentSessionId).toBe(source.id);
    expect(store.getState().latestActiveSessionId).toBe(source.id);
    expect(store.getState().chats[1]).toMatchObject({
      id: source.id,
      kind: source.kind,
      parentSessionId: source.parentSessionId,
      rootSessionId: source.rootSessionId,
      title: source.title,
      messages: source.messages,
    });
    expect(store.getState().executionBySession).toHaveProperty("copied-session");
  });

  it("preserves history when the account feed inserts and hydrates the copy first", async () => {
    const store = createTestStore();
    const racedMessage = { id: "copied-message", role: "user" as const, content: "Copied history" };
    store.setState((state) => ({
      ...state,
      chats: [
        {
          ...sourceChat(),
          id: "copied-session",
          kind: "root",
          messages: [racedMessage],
        },
        sourceChat(),
      ],
    }));
    mockCopySession.mockResolvedValue({ session: summary({ title: "Authoritative title" }) });

    await store.getState().copySession("source-session");

    expect(store.getState().chats[0].title).toBe("Authoritative title");
    expect(store.getState().chats[0].messages).toEqual([racedMessage]);
    expect(store.getState().chats.filter((chat) => chat.id === "copied-session")).toHaveLength(1);
  });

  it("protects the committed copy from an older in-flight full-list snapshot", async () => {
    const store = createTestStore();
    const source = sourceChat();
    store.setState((state) => ({
      ...state,
      chats: [source],
      currentSessionId: source.id,
      latestActiveSessionId: source.id,
    }));

    const staleList = deferred<{ sessions: SessionSummary[] }>();
    const freshList = deferred<{ sessions: SessionSummary[] }>();
    mockListSessions
      .mockImplementationOnce(() => staleList.promise)
      .mockImplementationOnce(() => freshList.promise);
    mockCopySession.mockResolvedValue({ session: summary() });

    const olderRefresh = store.getState().refreshChatsNow();
    const copy = store.getState().copySession(source.id);
    await expect(copy).resolves.toEqual(summary());

    expect(store.getState().chats.some((chat) => chat.id === "copied-session")).toBe(true);
    expect(store.getState().currentSessionId).toBe(source.id);

    staleList.resolve({ sessions: [sourceSummary()] });
    await olderRefresh;
    await Promise.resolve();
    await Promise.resolve();

    // The forced post-copy read is still pending. The older authoritative
    // snapshot must not remove the already-committed target in the meantime.
    expect(store.getState().chats.some((chat) => chat.id === "copied-session")).toBe(true);
    expect(store.getState().currentSessionId).toBe(source.id);

    freshList.resolve({ sessions: [summary(), sourceSummary()] });
    await vi.waitFor(() => {
      expect(mockListSessions).toHaveBeenCalledTimes(2);
    });
    await Promise.resolve();

    expect(store.getState().chats.filter((chat) => chat.id === "copied-session")).toHaveLength(1);
    expect(store.getState().currentSessionId).toBe(source.id);
  });

  it("leaves all local state untouched when Bamboo rejects the copy", async () => {
    const store = createTestStore();
    const source = sourceChat();
    store.setState((state) => ({
      ...state,
      chats: [source],
      currentSessionId: source.id,
      latestActiveSessionId: source.id,
    }));
    const before = store.getState();
    mockCopySession.mockRejectedValue(new Error("copy transaction failed"));

    await expect(store.getState().copySession(source.id)).rejects.toThrow(
      "copy transaction failed",
    );

    expect(store.getState()).toBe(before);
  });

  it("rejects a non-independent identity without inserting it", async () => {
    const store = createTestStore();
    const source = sourceChat();
    store.setState((state) => ({ ...state, chats: [source], currentSessionId: source.id }));
    mockCopySession.mockResolvedValue({ session: summary({ id: source.id }) });

    await expect(store.getState().copySession(source.id)).rejects.toThrow(
      "invalid copied session identity",
    );
    expect(store.getState().chats).toEqual([source]);
    expect(store.getState().currentSessionId).toBe(source.id);
  });
});
