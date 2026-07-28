import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import { ApiError } from "@services/api";
import type { SessionSummary } from "@services/chat/AgentService";
import type { ChatItem } from "@shared/types/chat";
import { createChatSlice, type ChatSlice } from "../chatSessionSlice";

const { mockGetSessionWithVersion, mockSwitchSessionWorkspace } = vi.hoisted(() => ({
  mockGetSessionWithVersion: vi.fn(),
  mockSwitchSessionWorkspace: vi.fn(),
}));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      getSessionWithVersion: mockGetSessionWithVersion,
      switchSessionWorkspace: mockSwitchSessionWorkspace,
      patchSession: vi.fn(),
      deleteSession: vi.fn(),
    })),
  },
}));

const summary = (
  workspacePath: string,
  projectId = "proj-zenith",
  overrides: Partial<SessionSummary> = {},
): SessionSummary =>
  ({
    id: "session-1",
    project_id: projectId,
    workspace_path: workspacePath,
    ...overrides,
  }) as SessionSummary;

const chat = (workspacePath = "/repo/zenith"): ChatItem =>
  ({
    id: "session-1",
    title: "Session",
    kind: "root",
    createdAt: 1710000000000,
    messages: [],
    config: {
      systemPromptId: "general_assistant",
      baseSystemPrompt: "You are helpful.",
      lastUsedEnhancedPrompt: null,
      workspacePath,
      projectId: "proj-zenith",
      model: "gpt-test",
    },
  }) as ChatItem;

const createTestStore = (): StoreApi<ChatSlice> =>
  createStore<ChatSlice>()((set, get, api) => {
    const sliceCreator = createChatSlice as unknown as (
      setState: StoreApi<ChatSlice>["setState"],
      getState: StoreApi<ChatSlice>["getState"],
      store: StoreApi<ChatSlice>,
    ) => ChatSlice;
    return {
      ...sliceCreator(set, get, api),
      chats: [chat()],
      currentSessionId: "session-1",
      latestActiveSessionId: "session-1",
    };
  });

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const apiError = (status: number, code: string, message: string): ApiError =>
  new ApiError(
    message,
    status,
    status === 412 ? "Precondition Failed" : "Conflict",
    JSON.stringify({ error: { type: "api_error", code, message } }),
  );

describe("chatSessionSlice switchSessionWorkspace (#155)", () => {
  beforeEach(() => {
    mockGetSessionWithVersion.mockReset();
    mockSwitchSessionWorkspace.mockReset();
  });

  it("optimistically updates only workspacePath, then applies the authoritative response", async () => {
    const confirmation = deferred<SessionSummary>();
    mockGetSessionWithVersion.mockResolvedValue({
      session: summary("/repo/zenith"),
      metadataVersion: 7,
    });
    mockSwitchSessionWorkspace.mockReturnValue(confirmation.promise);
    const store = createTestStore();

    const mutation = store.getState().switchSessionWorkspace("session-1", "/repo/zenith-worktree");

    await vi.waitFor(() => {
      expect(store.getState().chats[0].config.workspacePath).toBe("/repo/zenith-worktree");
    });
    expect(store.getState().chats[0].config.projectId).toBe("proj-zenith");
    expect(store.getState().chats[0].config.model).toBe("gpt-test");
    expect(store.getState().currentSessionId).toBe("session-1");
    expect(mockSwitchSessionWorkspace).toHaveBeenCalledWith(
      "session-1",
      "/repo/zenith-worktree",
      7,
    );

    confirmation.resolve(summary("/canonical/zenith-worktree"));
    await expect(mutation).resolves.toMatchObject({
      project_id: "proj-zenith",
      workspace_path: "/canonical/zenith-worktree",
    });

    expect(store.getState().chats[0].config.workspacePath).toBe("/canonical/zenith-worktree");
    expect(store.getState().chats[0].config.projectId).toBe("proj-zenith");
    expect(store.getState().currentSessionId).toBe("session-1");
  });

  it("keeps the confirmed workspace and refreshes after a successful response violates Project identity", async () => {
    mockGetSessionWithVersion.mockResolvedValue({
      session: summary("/repo/zenith"),
      metadataVersion: 7,
    });
    mockSwitchSessionWorkspace.mockResolvedValue(
      summary("/canonical/zenith-worktree", "proj-unexpected"),
    );
    const store = createTestStore();
    const refreshChatsNow = vi.fn().mockResolvedValue(undefined);
    store.setState({ refreshChatsNow });

    await expect(
      store.getState().switchSessionWorkspace("session-1", "/repo/zenith-worktree"),
    ).rejects.toThrow(
      "Workspace switch was saved, but Bamboo returned an unexpected Project; refreshing session state",
    );

    expect(store.getState().chats[0].config.workspacePath).toBe("/canonical/zenith-worktree");
    expect(store.getState().chats[0].config.workspacePath).not.toBe("/repo/zenith");
    expect(store.getState().chats[0].config.projectId).toBe("proj-zenith");
    expect(refreshChatsNow).toHaveBeenCalledOnce();
  });

  it("rolls a structured 409 back to the server-confirmed workspace", async () => {
    mockGetSessionWithVersion.mockResolvedValue({
      session: summary("/repo/zenith"),
      metadataVersion: 4,
    });
    mockSwitchSessionWorkspace.mockRejectedValue(
      apiError(
        409,
        "project_workspace_unbound",
        "Workspace must be bound to the session Project before switching",
      ),
    );
    const store = createTestStore();

    await expect(
      store.getState().switchSessionWorkspace("session-1", "/other/unbound"),
    ).rejects.toMatchObject({ status: 409 });

    expect(store.getState().chats[0].config.workspacePath).toBe("/repo/zenith");
    expect(store.getState().chats[0].config.projectId).toBe("proj-zenith");
    expect(store.getState().currentSessionId).toBe("session-1");
  });

  it("refetches after 412 and rolls back to the fresh authoritative workspace", async () => {
    mockGetSessionWithVersion
      .mockResolvedValueOnce({
        session: summary("/repo/zenith"),
        metadataVersion: 4,
      })
      .mockResolvedValueOnce({
        session: summary("/repo/server-newer"),
        metadataVersion: 5,
      });
    mockSwitchSessionWorkspace.mockRejectedValue(
      apiError(
        412,
        "metadata_version_conflict",
        "Version conflict: the session was modified by another client",
      ),
    );
    const store = createTestStore();

    await expect(
      store.getState().switchSessionWorkspace("session-1", "/repo/attempted"),
    ).rejects.toMatchObject({ status: 412 });

    expect(mockGetSessionWithVersion).toHaveBeenCalledTimes(2);
    expect(store.getState().chats[0].config.workspacePath).toBe("/repo/server-newer");
    expect(store.getState().chats[0].config.projectId).toBe("proj-zenith");
  });

  it("does not let a stale completion overwrite a newer local workspace", async () => {
    const confirmation = deferred<SessionSummary>();
    mockGetSessionWithVersion.mockResolvedValue({
      session: summary("/repo/zenith"),
      metadataVersion: 2,
    });
    mockSwitchSessionWorkspace.mockReturnValue(confirmation.promise);
    const store = createTestStore();

    const mutation = store.getState().switchSessionWorkspace("session-1", "/repo/first-attempt");
    await vi.waitFor(() =>
      expect(store.getState().chats[0].config.workspacePath).toBe("/repo/first-attempt"),
    );

    store.setState((state) => ({
      ...state,
      chats: state.chats.map((item) =>
        item.id === "session-1"
          ? {
              ...item,
              config: { ...item.config, workspacePath: "/repo/newer-authoritative" },
            }
          : item,
      ),
    }));

    confirmation.resolve(summary("/repo/first-attempt"));
    await mutation;

    expect(store.getState().chats[0].config.workspacePath).toBe("/repo/newer-authoritative");
    expect(store.getState().chats[0].config.projectId).toBe("proj-zenith");
  });
});
