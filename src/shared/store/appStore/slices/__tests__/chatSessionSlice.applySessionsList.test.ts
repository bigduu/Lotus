import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { ChatItem } from "@shared/types/chat";
import type { SessionSummary } from "@services/chat/AgentService";
import { createChatSlice, type ChatSlice } from "../chatSessionSlice";
import {
  beginBypassPermissionMutation,
  failBypassPermissionMutation,
  resetBypassPermissionMutations,
} from "../../bypassPermissionMutations";

// Hoisted mock so per-test re-stubbing of `listSessions` reaches the slice's
// singleton AgentClient instance.
const { mockListSessions } = vi.hoisted(() => ({
  mockListSessions: vi.fn<() => Promise<{ sessions: SessionSummary[] }>>(),
}));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      deleteSession: vi.fn(),
      listSessions: mockListSessions,
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

const createSummary = (overrides: Partial<SessionSummary> & { id: string }): SessionSummary => ({
  id: overrides.id,
  kind: overrides.kind ?? "root",
  title: overrides.title ?? "Remote Title",
  title_version: overrides.title_version ?? 0,
  title_generated: overrides.title_generated ?? true,
  pinned: overrides.pinned ?? false,
  parent_session_id: null,
  root_session_id: overrides.root_session_id ?? overrides.id,
  spawn_depth: 0,
  model: overrides.model ?? "gpt-test",
  model_ref: overrides.model_ref ?? null,
  reasoning_effort: overrides.reasoning_effort ?? null,
  created_by_schedule_id: overrides.created_by_schedule_id ?? null,
  workspace_path: overrides.workspace_path ?? null,
  token_usage: overrides.token_usage,
  created_at: overrides.created_at ?? "2026-01-01T00:00:00.000Z",
  updated_at: overrides.updated_at ?? "2026-01-15T12:00:00.000Z",
  last_activity_at: overrides.last_activity_at ?? "2026-01-15T12:00:00.000Z",
  message_count: overrides.message_count ?? 0,
  has_attachments: false,
  is_running: overrides.is_running ?? false,
  bypass_permissions: overrides.bypass_permissions ?? false,
  permission_mode: overrides.permission_mode,
});

const createChat = (overrides: Partial<ChatItem> & { id: string }): ChatItem => ({
  id: overrides.id,
  title: overrides.title ?? "Local Title",
  titleVersion: overrides.titleVersion,
  titleGenerated: overrides.titleGenerated,
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
  const store = createStore<ChatSlice>()((set, get, api) => sliceCreator(set, get, api));
  // applySessionsList reaches into `executionBySession` to reconcile per-summary
  // execution state. The chatSlice harness here doesn't include the execution
  // slice, so seed an empty map so the reconcile loop has a stable starting
  // point.
  store.setState((state) => ({ ...state, executionBySession: {} }) as ChatSlice);
  return store;
};

// =============================================================================
// F4: applySessionsList — version-aware title precedence on baseline merge.
// =============================================================================

describe("applySessionsList (via refreshChats)", () => {
  let store: StoreApi<ChatSlice>;

  beforeEach(() => {
    resetBypassPermissionMutations();
    store = createTestStore();
    mockListSessions.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("maps and refreshes the authoritative workspace_path", async () => {
    mockListSessions.mockResolvedValueOnce({
      sessions: [createSummary({ id: "s1", workspace_path: "/work/zenith" })],
    });

    await store.getState().refreshChatsNow();

    expect(store.getState().chats[0].config.workspacePath).toBe("/work/zenith");
  });

  it("maps pending title lifecycle independently of the visible title text", async () => {
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          title: "Looks Completely Custom",
          title_generated: false,
        }),
      ],
    });

    await store.getState().refreshChatsNow();

    expect(store.getState().chats[0].title).toBe("Looks Completely Custom");
    expect(store.getState().chats[0].titleGenerated).toBe(false);
  });

  it("upgrades pending title lifecycle without letting stale summaries regress it", async () => {
    store.setState((state) => ({
      ...state,
      chats: [
        createChat({
          id: "s1",
          title: "Generated",
          titleVersion: 1,
          titleGenerated: true,
        }),
      ],
    }));
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          title: "Stale Pending",
          title_version: 0,
          title_generated: false,
        }),
      ],
    });

    await store.getState().refreshChatsNow();

    const chat = store.getState().chats[0];
    expect(chat.title).toBe("Generated");
    expect(chat.titleVersion).toBe(1);
    expect(chat.titleGenerated).toBe(true);
  });

  it("lets server OFF replace stale local bypass ON after refresh", async () => {
    store.setState((state) => ({
      ...state,
      chats: [
        createChat({
          id: "s1",
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "Base prompt",
            lastUsedEnhancedPrompt: null,
            bypassPermissions: true,
          },
        }),
      ],
    }));
    mockListSessions.mockResolvedValueOnce({
      sessions: [createSummary({ id: "s1", bypass_permissions: false })],
    });

    await store.getState().refreshChatsNow();

    expect(store.getState().chats[0].config.bypassPermissions).toBe(false);
  });

  it("round-trips server Auto distinctly from the true compatibility boolean", async () => {
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          bypass_permissions: true,
          permission_mode: "auto",
        }),
      ],
    });

    await store.getState().refreshChatsNow();

    expect(store.getState().chats[0].config).toMatchObject({
      permissionMode: "auto",
      permissionModeSupported: true,
      bypassPermissions: true,
    });
  });

  it("never displays legacy Bypass as Auto when permission_mode is absent", async () => {
    mockListSessions.mockResolvedValueOnce({
      sessions: [createSummary({ id: "s1", bypass_permissions: true })],
    });

    await store.getState().refreshChatsNow();

    expect(store.getState().chats[0].config).toMatchObject({
      permissionMode: "bypass",
      permissionModeSupported: false,
      bypassPermissions: true,
    });
  });

  it("reconnect replaces stale local Auto with authoritative server Bypass", async () => {
    store.setState((state) => ({
      ...state,
      chats: [
        createChat({
          id: "s1",
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "Base prompt",
            lastUsedEnhancedPrompt: null,
            permissionMode: "auto",
            permissionModeSupported: true,
            bypassPermissions: true,
          },
        }),
      ],
    }));
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          bypass_permissions: true,
          permission_mode: "bypass",
        }),
      ],
    });

    await store.getState().refreshChatsNow();

    expect(store.getState().chats[0].config.permissionMode).toBe("bypass");
  });

  it("keeps optimistic bypass only during PATCH and rolls back to refreshed server truth", async () => {
    const revision = beginBypassPermissionMutation("s1", true, false);
    store.setState((state) => ({
      ...state,
      chats: [createChat({ id: "s1" })],
    }));
    mockListSessions.mockResolvedValueOnce({
      sessions: [createSummary({ id: "s1", bypass_permissions: false })],
    });

    await store.getState().refreshChatsNow();

    expect(store.getState().chats[0].config.bypassPermissions).toBe(true);
    expect(failBypassPermissionMutation("s1", revision)).toBe(false);
  });

  it("keeps the locally-newer title when remote summary is at a lower title_version", async () => {
    store.setState((state) => ({
      ...state,
      chats: [
        createChat({
          id: "s1",
          title: "Local High Version",
          titleVersion: 5,
          updatedAt: "2026-01-15T12:00:00.000Z",
        }),
      ],
    }));

    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          title: "Remote Stale",
          title_version: 3,
          updated_at: "2026-01-15T12:30:00.000Z",
        }),
      ],
    });

    await store.getState().refreshChatsNow();

    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.title).toBe("Local High Version");
    expect(chat?.titleVersion).toBe(5);
  });

  it("adopts the remotely-newer title when remote summary is at a higher title_version", async () => {
    store.setState((state) => ({
      ...state,
      chats: [
        createChat({
          id: "s1",
          title: "Local Stale",
          titleVersion: 2,
          updatedAt: "2026-01-15T12:00:00.000Z",
        }),
      ],
    }));

    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          title: "Remote Fresh",
          title_version: 7,
          updated_at: "2026-01-15T12:30:00.000Z",
        }),
      ],
    });

    await store.getState().refreshChatsNow();

    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.title).toBe("Remote Fresh");
    expect(chat?.titleVersion).toBe(7);
  });

  it("treats missing local titleVersion as 0 so any remote version wins", async () => {
    store.setState((state) => ({
      ...state,
      chats: [
        createChat({
          id: "s1",
          title: "Legacy Local",
          updatedAt: "2026-01-15T12:00:00.000Z",
        }),
      ],
    }));

    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          title: "Remote With Version",
          title_version: 1,
          updated_at: "2026-01-15T12:30:00.000Z",
        }),
      ],
    });

    await store.getState().refreshChatsNow();

    const chat = store.getState().chats.find((c) => c.id === "s1");
    expect(chat?.title).toBe("Remote With Version");
    expect(chat?.titleVersion).toBe(1);
  });

  it("maps remote token usage fields including thinking and provider cache hits", async () => {
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s-token",
          token_usage: {
            system_tokens: 10,
            summary_tokens: 20,
            window_tokens: 30,
            total_tokens: 60,
            max_context_tokens: 1000,
            budget_limit: 900,
            truncation_occurred: false,
            segments_removed: 0,
            prompt_cached_tool_outputs: 2,
            prompt_cached_tool_tokens_saved: 111,
            thinking_tokens: 45,
            cache_read_input_tokens: 67,
          },
        }),
      ],
    });

    await store.getState().refreshChatsNow();

    const chat = store.getState().chats.find((c) => c.id === "s-token");
    expect(chat?.config.tokenUsage).toEqual({
      systemTokens: 10,
      summaryTokens: 20,
      windowTokens: 30,
      totalTokens: 60,
      maxContextTokens: 1000,
      budgetLimit: 900,
      promptCachedToolOutputs: 2,
      promptCachedToolTokensSaved: 111,
      thinkingTokens: 45,
      cacheReadInputTokens: 67,
    });
  });

  it("reuses the previous chat object when refresh summary does not change the merged session", async () => {
    const stableSummary = createSummary({
      id: "s1",
      title: "Stable Title",
      title_version: 2,
      pinned: true,
      updated_at: "2026-01-15T12:30:00.000Z",
      last_activity_at: "2026-01-15T12:30:00.000Z",
      message_count: 1,
    });

    mockListSessions.mockResolvedValueOnce({ sessions: [stableSummary] });
    await store.getState().refreshChatsNow();

    const normalizedChat = store.getState().chats.find((c) => c.id === "s1");
    expect(normalizedChat).toBeTruthy();

    const existingChat = {
      ...normalizedChat!,
      messages: [
        {
          id: "m1",
          role: "user" as const,
          content: "hello",
          createdAt: "2026-01-15T12:00:00.000Z",
        },
      ],
    };

    store.setState((state) => ({
      ...state,
      chats: [existingChat],
    }));

    mockListSessions.mockResolvedValueOnce({ sessions: [stableSummary] });
    await store.getState().refreshChatsNow();

    const nextChat = store.getState().chats.find((c) => c.id === "s1");
    expect(nextChat).toBe(existingChat);
  });

  it("keeps reset and append generations authoritative across a stale high-count list", async () => {
    store.setState((state) => ({
      ...state,
      chats: [
        createChat({
          id: "s1",
          lastActivityAt: "2026-01-15T12:00:00.000001Z",
          messageCount: 100,
        }),
      ],
    }));

    // A newer clear/truncate is authoritative even though its count is lower.
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          updated_at: "2026-01-15T12:00:00.000002Z",
          last_activity_at: "2026-01-15T12:00:00.000002Z",
          message_count: 0,
        }),
      ],
    });
    await store.getState().refreshChatsNow();
    expect(store.getState().chats[0]).toMatchObject({
      lastActivityAt: "2026-01-15T12:00:00.000002Z",
      messageCount: 0,
    });

    // A delayed pre-reset snapshot must not restore the old high watermark.
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          updated_at: "2026-01-15T12:00:00.000001Z",
          last_activity_at: "2026-01-15T12:00:00.000001Z",
          message_count: 100,
        }),
      ],
    });
    await store.getState().refreshChatsNow();
    expect(store.getState().chats[0]).toMatchObject({
      lastActivityAt: "2026-01-15T12:00:00.000002Z",
      messageCount: 0,
    });

    // The first post-reset append must now advance 0 -> 1 instead of being
    // hidden behind the pre-reset count of 100.
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        createSummary({
          id: "s1",
          updated_at: "2026-01-15T12:00:00.000003Z",
          last_activity_at: "2026-01-15T12:00:00.000003Z",
          message_count: 1,
        }),
      ],
    });
    await store.getState().refreshChatsNow();
    expect(store.getState().chats[0]).toMatchObject({
      lastActivityAt: "2026-01-15T12:00:00.000003Z",
      messageCount: 1,
    });
  });
});
