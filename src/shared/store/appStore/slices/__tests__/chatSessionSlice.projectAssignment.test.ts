import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import { ApiError } from "@services/api";
import type { SessionSummary } from "@services/chat/AgentService";
import type { ProjectManifest } from "@services/project";
import type { ChatItem } from "@shared/types/chat";
import { createChatSlice, type ChatSlice } from "../chatSessionSlice";

const { mockGetSessionWithVersion, mockReassignSessionProject } = vi.hoisted(() => ({
  mockGetSessionWithVersion: vi.fn(),
  mockReassignSessionProject: vi.fn(),
}));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      getSessionWithVersion: mockGetSessionWithVersion,
      reassignSessionProject: mockReassignSessionProject,
      patchSession: vi.fn(),
      deleteSession: vi.fn(),
    })),
  },
}));

const summary = (projectId: string | null, workspacePath: string | null): SessionSummary =>
  ({
    id: "session-1",
    project_id: projectId,
    workspace_path: workspacePath,
  }) as SessionSummary;

const project = (id: string, status: "active" | "archived" = "active"): ProjectManifest => ({
  id,
  name: id,
  description: null,
  status,
  revision: 1,
  resource_revision: 1,
  project_path: `/repo/${id}`,
  project_path_status: "configured",
  workspace_count: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  schema_version: 2,
  workspace_bindings: [],
});

const chat = (kind: "root" | "child" = "root"): ChatItem =>
  ({
    id: "session-1",
    title: "Session",
    kind,
    createdAt: 1710000000000,
    messages: [],
    config: {
      systemPromptId: "general_assistant",
      baseSystemPrompt: "You are helpful.",
      lastUsedEnhancedPrompt: null,
      projectId: "proj-old",
      workspacePath: "/repo/proj-old",
    },
  }) as ChatItem;

type TestState = ChatSlice & {
  projects: Record<string, ProjectManifest>;
  activeProjectId: string | null;
  setActiveProjectId: (projectId: string | null) => void;
};

const createTestStore = (session = chat()): StoreApi<TestState> =>
  createStore<TestState>()((set, get, api) => {
    const sliceCreator = createChatSlice as unknown as (
      setState: StoreApi<TestState>["setState"],
      getState: StoreApi<TestState>["getState"],
      store: StoreApi<TestState>,
    ) => ChatSlice;
    return {
      ...sliceCreator(set, get, api),
      chats: [session],
      currentSessionId: session.id,
      latestActiveSessionId: session.id,
      projects: {
        "proj-old": project("proj-old"),
        "proj-new": project("proj-new"),
      },
      activeProjectId: "proj-old",
      setActiveProjectId: (projectId) => set({ activeProjectId: projectId }),
    };
  });

const metadataConflict = () =>
  new ApiError(
    "Version conflict",
    412,
    "Precondition Failed",
    JSON.stringify({
      error: { type: "api_error", code: "metadata_version_conflict", message: "Conflict" },
    }),
  );

describe("chatSessionSlice assignSessionProject (#208)", () => {
  beforeEach(() => {
    mockGetSessionWithVersion.mockReset();
    mockReassignSessionProject.mockReset();
  });

  it("atomically assigns the Project and its authoritative primary path", async () => {
    mockGetSessionWithVersion.mockResolvedValue({
      session: summary("proj-old", "/repo/proj-old"),
      metadataVersion: 7,
    });
    mockReassignSessionProject.mockResolvedValue(summary("proj-new", "/canonical/proj-new"));
    const store = createTestStore();

    await expect(
      store.getState().assignSessionProject("session-1", "proj-new"),
    ).resolves.toMatchObject({ project_id: "proj-new" });

    expect(mockReassignSessionProject).toHaveBeenCalledWith(
      "session-1",
      "proj-new",
      7,
      "/repo/proj-new",
    );
    expect(store.getState().chats[0].config).toMatchObject({
      projectId: "proj-new",
      workspacePath: "/canonical/proj-new",
    });
    expect(store.getState().activeProjectId).toBe("proj-new");
  });

  it("atomically assigns an explicitly selected workspace bound to the target Project", async () => {
    mockGetSessionWithVersion.mockResolvedValue({
      session: summary("proj-old", "/repo/proj-old"),
      metadataVersion: 9,
    });
    mockReassignSessionProject.mockResolvedValue(summary("proj-new", "/repo/proj-new-worktree"));
    const store = createTestStore();
    store.setState((state) => ({
      projects: {
        ...state.projects,
        "proj-new": {
          ...state.projects["proj-new"],
          workspace_count: 2,
          workspace_bindings: [
            { path: "/repo/proj-new-worktree", label: null, git_common_dir: null },
          ],
        },
      },
    }));

    await store.getState().assignSessionProject("session-1", "proj-new", "/repo/proj-new-worktree");

    expect(mockReassignSessionProject).toHaveBeenCalledWith(
      "session-1",
      "proj-new",
      9,
      "/repo/proj-new-worktree",
    );
    expect(store.getState().chats[0].config).toMatchObject({
      projectId: "proj-new",
      workspacePath: "/repo/proj-new-worktree",
    });
  });

  it("switches to another bound workspace without changing Project identity", async () => {
    mockGetSessionWithVersion.mockResolvedValue({
      session: summary("proj-old", "/repo/proj-old"),
      metadataVersion: 10,
    });
    mockReassignSessionProject.mockResolvedValue(summary("proj-old", "/repo/proj-old-worktree"));
    const store = createTestStore();

    await store.getState().assignSessionProject("session-1", "proj-old", "/repo/proj-old-worktree");

    expect(mockReassignSessionProject).toHaveBeenCalledWith(
      "session-1",
      "proj-old",
      10,
      "/repo/proj-old-worktree",
    );
    expect(store.getState().chats[0].config).toMatchObject({
      projectId: "proj-old",
      workspacePath: "/repo/proj-old-worktree",
    });
  });

  it("rejects direct child reassignment so root/child Project identity cannot diverge", async () => {
    const store = createTestStore(chat("child"));

    await expect(store.getState().assignSessionProject("session-1", "proj-new")).rejects.toThrow(
      "Child sessions inherit their root session Project",
    );
    expect(mockGetSessionWithVersion).not.toHaveBeenCalled();
    expect(mockReassignSessionProject).not.toHaveBeenCalled();
  });

  it("rejects a Project without an available primary path before touching the session", async () => {
    const store = createTestStore();
    store.setState((state) => ({
      projects: {
        ...state.projects,
        "proj-unready": {
          ...project("proj-unready"),
          project_path: null,
          project_path_status: "needs_configuration",
        },
      },
    }));

    await expect(
      store.getState().assignSessionProject("session-1", "proj-unready"),
    ).rejects.toThrow("no available primary folder");
    expect(mockGetSessionWithVersion).not.toHaveBeenCalled();
    expect(mockReassignSessionProject).not.toHaveBeenCalled();
  });

  it("refreshes server truth after a metadata CAS conflict without changing local context", async () => {
    mockGetSessionWithVersion.mockResolvedValue({
      session: summary("proj-old", "/repo/proj-old"),
      metadataVersion: 4,
    });
    mockReassignSessionProject.mockRejectedValue(metadataConflict());
    const store = createTestStore();
    const refreshChatsNow = vi.fn().mockResolvedValue(undefined);
    store.setState({ refreshChatsNow });

    await expect(
      store.getState().assignSessionProject("session-1", "proj-new"),
    ).rejects.toMatchObject({ status: 412 });

    expect(store.getState().chats[0].config).toMatchObject({
      projectId: "proj-old",
      workspacePath: "/repo/proj-old",
    });
    expect(refreshChatsNow).toHaveBeenCalledOnce();
  });

  it("does not submit a stale picker result after local session context changes", async () => {
    let resolveSnapshot!: (value: { session: SessionSummary; metadataVersion: number }) => void;
    mockGetSessionWithVersion.mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const store = createTestStore();

    const assignment = store.getState().assignSessionProject("session-1", "proj-new");
    store.setState((state) => ({
      chats: state.chats.map((item) =>
        item.id === "session-1"
          ? { ...item, config: { ...item.config, workspacePath: "/newer/path" } }
          : item,
      ),
    }));
    resolveSnapshot({
      session: summary("proj-old", "/repo/proj-old"),
      metadataVersion: 8,
    });

    await expect(assignment).rejects.toThrow(
      "Session context changed while the Project picker was loading",
    );
    expect(mockReassignSessionProject).not.toHaveBeenCalled();
  });

  it("refreshes instead of overwriting a workspace changed on the server", async () => {
    mockGetSessionWithVersion.mockResolvedValue({
      session: summary("proj-old", "/server/newer-workspace"),
      metadataVersion: 11,
    });
    const store = createTestStore();
    const refreshChatsNow = vi.fn().mockResolvedValue(undefined);
    store.setState({ refreshChatsNow });

    await expect(store.getState().assignSessionProject("session-1", "proj-new")).rejects.toThrow(
      "Session context changed while the picker was open",
    );

    expect(refreshChatsNow).toHaveBeenCalledOnce();
    expect(mockReassignSessionProject).not.toHaveBeenCalled();
  });

  it("refreshes instead of applying an unexpected Project response", async () => {
    mockGetSessionWithVersion.mockResolvedValue({
      session: summary("proj-old", "/repo/proj-old"),
      metadataVersion: 7,
    });
    mockReassignSessionProject.mockResolvedValue(summary("proj-other", "/canonical/proj-other"));
    const store = createTestStore();
    const refreshChatsNow = vi.fn().mockResolvedValue(undefined);
    store.setState({ refreshChatsNow });

    await expect(store.getState().assignSessionProject("session-1", "proj-new")).rejects.toThrow(
      "Bamboo returned an unexpected Project",
    );
    expect(store.getState().chats[0].config.projectId).toBe("proj-old");
    expect(refreshChatsNow).toHaveBeenCalledOnce();
  });

  it("refreshes instead of accepting a Project response without an execution directory", async () => {
    mockGetSessionWithVersion.mockResolvedValue({
      session: summary("proj-old", "/repo/proj-old"),
      metadataVersion: 7,
    });
    mockReassignSessionProject.mockResolvedValue(summary("proj-new", null));
    const store = createTestStore();
    const refreshChatsNow = vi.fn().mockResolvedValue(undefined);
    store.setState({ refreshChatsNow });

    await expect(store.getState().assignSessionProject("session-1", "proj-new")).rejects.toThrow(
      "no execution directory",
    );
    expect(store.getState().chats[0].config.projectId).toBe("proj-old");
    expect(refreshChatsNow).toHaveBeenCalledOnce();
  });
});
