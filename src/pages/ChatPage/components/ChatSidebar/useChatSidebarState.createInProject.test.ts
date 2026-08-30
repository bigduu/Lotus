import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionSummary } from "@services/chat/AgentService";
import type { ProjectManifest } from "@services/project";
import type { ChatItem } from "@shared/types/chat";
import { useAppStore } from "@shared/store/appStore";
import {
  beginBypassPermissionMutation,
  resetBypassPermissionMutations,
} from "@shared/store/appStore/bypassPermissionMutations";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import { useChatSidebarState } from "./useChatSidebarState";

const { mockPatchSession, mockSetSessionPermissionMode, mockListSessions, mockModalError } =
  vi.hoisted(() => ({
    mockPatchSession: vi.fn(),
    mockSetSessionPermissionMode: vi.fn(),
    mockListSessions: vi.fn(),
    mockModalError: vi.fn(),
  }));

vi.mock("@services/chat/AgentService", async () => {
  const actual = await vi.importActual<typeof import("@services/chat/AgentService")>(
    "@services/chat/AgentService",
  );
  return {
    ...actual,
    AgentClient: {
      getInstance: () => ({
        patchSession: mockPatchSession,
        setSessionPermissionMode: mockSetSessionPermissionMode,
        listSessions: mockListSessions,
      }),
    },
  };
});

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    App: Object.assign(actual.App, {
      useApp: () => ({
        message: {
          success: vi.fn(),
          error: vi.fn(),
          warning: vi.fn(),
          info: vi.fn(),
          loading: vi.fn(() => vi.fn()),
        },
        notification: actual.notification,
        modal: {
          confirm: vi.fn(),
          error: mockModalError,
        },
      }),
    }),
  };
});

const originalUpdateSession = useAppStore.getState().updateSession;

const makeSessionSummary = (
  id: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary => ({
  id,
  kind: "root",
  title: "New Session",
  title_version: 0,
  pinned: false,
  parent_session_id: null,
  root_session_id: id,
  spawn_depth: 0,
  model: "gpt-test",
  model_ref: null,
  reasoning_effort: null,
  created_by_schedule_id: null,
  project_id: null,
  workspace_path: null,
  created_at: "2026-07-29T00:00:00Z",
  updated_at: "2026-07-29T00:00:00Z",
  last_activity_at: "2026-07-29T00:00:00Z",
  message_count: 0,
  has_attachments: false,
  is_running: false,
  bypass_permissions: false,
  ...overrides,
});

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const makeProject = (id: string, overrides: Partial<ProjectManifest> = {}): ProjectManifest => ({
  id,
  name: id,
  description: null,
  status: "active",
  revision: 1,
  resource_revision: 1,
  project_path: `/repo/${id}`,
  project_path_status: "configured",
  workspace_count: 1,
  created_at: "2026-07-29T00:00:00Z",
  updated_at: "2026-07-29T00:00:00Z",
  schema_version: 1,
  workspace_bindings: [],
  ...overrides,
});

describe("useChatSidebarState — create session in Project (#198)", () => {
  let addChat: ReturnType<typeof vi.fn>;
  let updateSession: ReturnType<typeof vi.fn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;
  let nextSessionNumber: number;

  beforeEach(() => {
    localStorage.clear();
    resetBypassPermissionMutations();
    mockPatchSession.mockReset();
    mockPatchSession.mockResolvedValue(undefined);
    mockSetSessionPermissionMode.mockReset();
    mockListSessions.mockReset();
    mockModalError.mockReset();
    consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    nextSessionNumber = 1;

    addChat = vi.fn(async (chatData: Omit<ChatItem, "id">) => {
      const sessionId = `session-created-${nextSessionNumber}`;
      nextSessionNumber += 1;
      const createdChat: ChatItem = {
        id: sessionId,
        kind: "root",
        currentInteraction: null,
        ...chatData,
      };
      useAppStore.setState((state) => ({
        chats: [createdChat, ...state.chats],
        currentSessionId: sessionId,
        latestActiveSessionId: sessionId,
      }));
      return sessionId;
    });
    updateSession = vi.fn((...args: Parameters<typeof originalUpdateSession>) =>
      originalUpdateSession(...args),
    );

    useAppStore.setState({
      chats: [],
      currentSessionId: null,
      latestActiveSessionId: null,
      projects: {},
      projectsMissing: {},
      activeProjectId: null,
      systemPrompts: [
        {
          id: "general_assistant",
          name: "General Assistant",
          content: "You are helpful.",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isDefault: true,
        },
      ],
      lastSelectedPromptId: "general_assistant",
      addChat,
      updateSession,
      loadProjects: vi.fn().mockResolvedValue(undefined),
      ensureProject: vi.fn().mockResolvedValue(undefined),
    });

    useUILayoutStore.setState({
      sidebar: {
        collapsed: false,
        widthPx: 260,
        collapsedWidthPx: 72,
        minWidthPx: 180,
        maxWidthPx: 520,
        groupingMode: "project",
      },
      tree: {
        type: "split",
        id: "split-root",
        layout: "horizontal",
        children: [
          { type: "leaf", id: "pane-a" },
          { type: "leaf", id: "pane-b" },
        ],
      },
      activeLeafId: "pane-a",
      leafSessionIds: {
        "pane-a": null,
        "pane-b": null,
      },
      splitSizesPx: {},
    });
  });

  afterEach(() => {
    consoleWarn.mockRestore();
  });

  it("uses the configured Project path, latest active pane, and synchronized bypass state", async () => {
    const project = makeProject("proj-zenith", { project_path: "/repo/zenith" });
    useAppStore.setState({ projects: { [project.id]: project } });
    const { result } = renderHook(() => useChatSidebarState());

    act(() => {
      useUILayoutStore.getState().setActiveLeafId("pane-b");
    });
    await act(async () => {
      await result.current.handleCreateChatInProject(project.id);
    });

    expect(addChat).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          systemPromptId: "general_assistant",
          baseSystemPrompt: "You are helpful.",
          projectId: project.id,
          workspacePath: "/repo/zenith",
        }),
      }),
    );
    expect(useUILayoutStore.getState().leafSessionIds).toEqual({
      "pane-a": null,
      "pane-b": "session-created-1",
    });
    expect(useUILayoutStore.getState().activeLeafId).toBe("pane-b");
    expect(mockPatchSession).toHaveBeenCalledWith("session-created-1", {
      bypass_permissions: true,
    });
    expect(updateSession).toHaveBeenCalledWith(
      "session-created-1",
      {
        config: expect.objectContaining({
          projectId: project.id,
          workspacePath: "/repo/zenith",
          bypassPermissions: true,
          permissionMode: "bypass",
        }),
      },
      { skipBackendPatch: true },
    );
    expect(
      useAppStore.getState().chats.find((chat) => chat.id === "session-created-1")?.config
        .bypassPermissions,
    ).toBe(true);
    expect(
      useAppStore.getState().chats.find((chat) => chat.id === "session-created-1")?.config
        .permissionMode,
    ).toBe("bypass");
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("uses the typed CAS mode mutation when the create response advertises support", async () => {
    const project = makeProject("proj-zenith", { project_path: "/repo/zenith" });
    useAppStore.setState({ projects: { [project.id]: project } });
    addChat.mockImplementationOnce(async (chatData: Omit<ChatItem, "id">) => {
      const sessionId = "session-created-1";
      const createdChat: ChatItem = {
        id: sessionId,
        kind: "root",
        currentInteraction: null,
        ...chatData,
        config: {
          ...chatData.config,
          permissionMode: "default",
          permissionModeSupported: true,
          bypassPermissions: false,
        },
      };
      useAppStore.setState((state) => ({
        chats: [createdChat, ...state.chats],
        currentSessionId: sessionId,
        latestActiveSessionId: sessionId,
      }));
      return sessionId;
    });
    mockSetSessionPermissionMode.mockResolvedValueOnce(
      makeSessionSummary("session-created-1", {
        permission_mode: "bypass",
        bypass_permissions: true,
      }),
    );
    const { result } = renderHook(() => useChatSidebarState());

    await act(async () => {
      await result.current.handleCreateChatInProject(project.id);
    });

    expect(mockSetSessionPermissionMode).toHaveBeenCalledWith("session-created-1", "bypass");
    expect(mockPatchSession).not.toHaveBeenCalled();
    expect(
      useAppStore.getState().chats.find((chat) => chat.id === "session-created-1")?.config,
    ).toMatchObject({
      permissionMode: "bypass",
      permissionModeSupported: true,
      bypassPermissions: true,
    });
  });

  it("fences a stale summary started before the bypass PATCH completes", async () => {
    const project = makeProject("proj-zenith", { project_path: "/repo/zenith" });
    useAppStore.setState({ projects: { [project.id]: project } });
    const staleList = createDeferred<{ sessions: SessionSummary[] }>();
    mockListSessions.mockReturnValueOnce(staleList.promise);
    const { result } = renderHook(() => useChatSidebarState());

    const staleRefresh = useAppStore.getState().refreshChatsNow();
    expect(mockListSessions).toHaveBeenCalledOnce();

    await act(async () => {
      await result.current.handleCreateChatInProject(project.id);
    });
    expect(
      useAppStore.getState().chats.find((chat) => chat.id === "session-created-1")?.config
        .bypassPermissions,
    ).toBe(true);

    await act(async () => {
      staleList.resolve({
        sessions: [
          makeSessionSummary("session-created-1", {
            project_id: project.id,
            workspace_path: "/repo/zenith",
            bypass_permissions: false,
          }),
        ],
      });
      await staleRefresh;
    });

    expect(
      useAppStore.getState().chats.find((chat) => chat.id === "session-created-1")?.config
        .bypassPermissions,
    ).toBe(true);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("does not overwrite a newer bypass mutation after the auto-enable PATCH", async () => {
    const project = makeProject("proj-zenith");
    useAppStore.setState({ projects: { [project.id]: project } });
    const patch = createDeferred<void>();
    mockPatchSession.mockReturnValueOnce(patch.promise);
    const { result } = renderHook(() => useChatSidebarState());

    let creation!: Promise<void>;
    act(() => {
      creation = result.current.handleCreateChatInProject(project.id);
    });
    await vi.waitFor(() => expect(mockPatchSession).toHaveBeenCalledOnce());

    beginBypassPermissionMutation("session-created-1", false, true);
    await act(async () => {
      patch.resolve();
      await creation;
    });

    expect(updateSession).not.toHaveBeenCalled();
    expect(
      useAppStore.getState().chats.find((chat) => chat.id === "session-created-1")?.config
        .bypassPermissions ?? false,
    ).toBe(false);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "unset",
      projectPath: null,
      pathStatus: "needs_configuration" as const,
    },
    {
      label: "not yet selected",
      projectPath: "/must/not/be/used",
      pathStatus: "needs_selection" as const,
    },
  ])(
    "leaves workspace unset when the Project path is $label",
    async ({ projectPath, pathStatus }) => {
      const project = makeProject("proj-needs-path", {
        project_path: projectPath,
        project_path_status: pathStatus,
      });
      useAppStore.setState({ projects: { [project.id]: project } });
      const { result } = renderHook(() => useChatSidebarState());

      await act(async () => {
        await result.current.handleCreateChatInProject(project.id);
      });

      const config = addChat.mock.calls[0][0].config as ChatItem["config"];
      expect(config.projectId).toBe(project.id);
      expect(config).not.toHaveProperty("workspacePath");
    },
  );

  it("passes an explicit null for the Unassigned group even when another Project is active", async () => {
    const activeProject = makeProject("proj-active");
    useAppStore.setState({
      projects: { [activeProject.id]: activeProject },
      activeProjectId: activeProject.id,
    });
    const { result } = renderHook(() => useChatSidebarState());

    await act(async () => {
      await result.current.handleCreateChatInProject(null);
    });

    const config = addChat.mock.calls[0][0].config as ChatItem["config"];
    expect(config.projectId).toBeNull();
    expect(config).not.toHaveProperty("workspacePath");
    expect(mockPatchSession).toHaveBeenCalledWith("session-created-1", {
      bypass_permissions: true,
    });
  });

  it("refreshes authoritative state when the bypass PATCH response is lost", async () => {
    const project = makeProject("proj-zenith");
    useAppStore.setState({ projects: { [project.id]: project } });
    const patch = createDeferred<void>();
    mockPatchSession.mockReturnValueOnce(patch.promise);
    const { result } = renderHook(() => useChatSidebarState());

    let creation!: Promise<void>;
    act(() => {
      creation = result.current.handleCreateChatInProject(project.id);
    });
    await vi.waitFor(() => expect(mockPatchSession).toHaveBeenCalledOnce());

    mockListSessions
      .mockResolvedValueOnce({
        sessions: [
          makeSessionSummary("session-created-1", {
            project_id: project.id,
            workspace_path: project.project_path,
            bypass_permissions: false,
          }),
        ],
      })
      .mockResolvedValueOnce({
        // Simulate a lost PATCH response: Bamboo committed Bypass even though
        // the client observed a rejection.
        sessions: [
          makeSessionSummary("session-created-1", {
            project_id: project.id,
            workspace_path: project.project_path,
            bypass_permissions: true,
          }),
        ],
      });
    await act(async () => {
      await useAppStore.getState().refreshChatsNow();
    });
    expect(
      useAppStore.getState().chats.find((chat) => chat.id === "session-created-1")?.config
        .bypassPermissions,
    ).toBe(true);

    await act(async () => {
      patch.reject(new Error("patch unavailable"));
      await expect(creation).resolves.toBeUndefined();
    });

    await vi.waitFor(() => expect(mockListSessions).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(
        useAppStore.getState().chats.find((chat) => chat.id === "session-created-1")?.config
          .bypassPermissions,
      ).toBe(true),
    );

    expect(useAppStore.getState().chats.map((chat) => chat.id)).toContain("session-created-1");
    expect(useUILayoutStore.getState().leafSessionIds["pane-a"]).toBe("session-created-1");
    expect(updateSession).toHaveBeenCalledWith(
      "session-created-1",
      {
        config: expect.objectContaining({
          bypassPermissions: false,
          permissionMode: "default",
        }),
      },
      { skipBackendPatch: true },
    );
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(mockModalError).not.toHaveBeenCalled();
  });

  it("keeps the created session usable and warns once when local bypass sync fails", async () => {
    const project = makeProject("proj-zenith");
    mockListSessions.mockResolvedValueOnce({
      sessions: [
        makeSessionSummary("session-created-1", {
          project_id: project.id,
          workspace_path: project.project_path,
          bypass_permissions: true,
        }),
      ],
    });
    useAppStore.setState({
      projects: { [project.id]: project },
      updateSession: vi.fn(() => {
        throw new Error("local sync failed");
      }),
    });
    const { result } = renderHook(() => useChatSidebarState());

    await act(async () => {
      await expect(result.current.handleCreateChatInProject(project.id)).resolves.toBeUndefined();
    });

    expect(mockPatchSession).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().chats.map((chat) => chat.id)).toContain("session-created-1");
    expect(useUILayoutStore.getState().leafSessionIds["pane-a"]).toBe("session-created-1");
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(mockModalError).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mockListSessions).toHaveBeenCalledOnce());
  });
});
