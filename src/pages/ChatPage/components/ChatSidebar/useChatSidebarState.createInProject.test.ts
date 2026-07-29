import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectManifest } from "@services/project";
import type { ChatItem } from "@shared/types/chat";
import { useAppStore } from "@shared/store/appStore";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import { useChatSidebarState } from "./useChatSidebarState";

const { mockPatchSession, mockModalError } = vi.hoisted(() => ({
  mockPatchSession: vi.fn(),
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
  legacy_project_keys: [],
  ...overrides,
});

describe("useChatSidebarState — create session in Project (#198)", () => {
  let addChat: ReturnType<typeof vi.fn>;
  let updateSession: ReturnType<typeof vi.fn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;
  let nextSessionNumber: number;

  beforeEach(() => {
    localStorage.clear();
    mockPatchSession.mockReset();
    mockPatchSession.mockResolvedValue(undefined);
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
        }),
      },
      { skipBackendPatch: true },
    );
    expect(
      useAppStore.getState().chats.find((chat) => chat.id === "session-created-1")?.config
        .bypassPermissions,
    ).toBe(true);
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

  it("keeps the created session usable and warns once when bypass PATCH fails", async () => {
    const project = makeProject("proj-zenith");
    useAppStore.setState({ projects: { [project.id]: project } });
    mockPatchSession.mockRejectedValue(new Error("patch unavailable"));
    const { result } = renderHook(() => useChatSidebarState());

    await act(async () => {
      await expect(result.current.handleCreateChatInProject(project.id)).resolves.toBeUndefined();
    });

    expect(useAppStore.getState().chats.map((chat) => chat.id)).toContain("session-created-1");
    expect(useUILayoutStore.getState().leafSessionIds["pane-a"]).toBe("session-created-1");
    expect(updateSession).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    expect(mockModalError).not.toHaveBeenCalled();
  });

  it("keeps the created session usable and warns once when local bypass sync fails", async () => {
    const project = makeProject("proj-zenith");
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
  });
});
