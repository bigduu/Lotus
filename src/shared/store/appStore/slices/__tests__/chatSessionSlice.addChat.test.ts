import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { SessionSummary } from "@services/chat/AgentService";
import { createChatSlice, type ChatSlice } from "../chatSessionSlice";
import type { ProjectManifest } from "@services/project";

const { mockCreateSession } = vi.hoisted(() => ({
  mockCreateSession: vi.fn(),
}));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      createSession: mockCreateSession,
      deleteSession: vi.fn(),
      patchSession: vi.fn(async () => undefined),
    })),
  },
}));

const makeSummary = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: "session-new",
  kind: "root",
  title: "New Session",
  title_version: 1,
  pinned: false,
  parent_session_id: null,
  root_session_id: "session-new",
  spawn_depth: 0,
  created_at: "2025-03-01T00:00:00Z",
  updated_at: "2025-03-01T00:00:00Z",
  ...overrides,
});

const makeProject = (id: string, status: "active" | "archived"): ProjectManifest => ({
  id,
  name: id,
  description: null,
  status,
  revision: 1,
  resource_revision: 1,
  project_path: `/repo/${id}`,
  project_path_status: "configured",
  workspace_count: 1,
  created_at: "2025-03-01T00:00:00Z",
  updated_at: "2025-03-01T00:00:00Z",
  schema_version: 1,
  workspace_bindings: [],
  legacy_project_keys: [],
});

type TestState = ChatSlice & {
  projects: Record<string, ProjectManifest>;
  activeProjectId: string | null;
};

const createTestStore = (state: Pick<TestState, "projects" | "activeProjectId">) => {
  const store = createStore<TestState>()((set, get, api) => ({
    ...(createChatSlice as any)(set, get, api),
    projects: state.projects,
    activeProjectId: state.activeProjectId,
  }));
  return store as StoreApi<TestState>;
};

const newChatData = () => ({
  title: "New Session",
  createdAt: Date.now(),
  messages: [],
  config: {
    systemPromptId: "general_assistant",
    baseSystemPrompt: "You are helpful.",
    lastUsedEnhancedPrompt: null,
  },
});

describe("chatSessionSlice addChat — Project membership (#134/#154)", () => {
  beforeEach(() => {
    mockCreateSession.mockReset();
  });

  it("sends the active Project when it is active", async () => {
    mockCreateSession.mockResolvedValue({
      session: makeSummary({ project_id: "proj-zenith" }),
    });
    const store = createTestStore({
      projects: { "proj-zenith": makeProject("proj-zenith", "active") },
      activeProjectId: "proj-zenith",
    });

    const sessionId = await store.getState().addChat(newChatData() as any);

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: "proj-zenith" }),
    );
    // Local config trusts the backend-assigned value.
    const chat = store.getState().chats.find((c) => c.id === sessionId);
    expect(chat?.config.projectId).toBe("proj-zenith");
  });

  it("retains the authoritative typed permission mode from the create response", async () => {
    mockCreateSession.mockResolvedValue({
      session: makeSummary({
        permission_mode: "auto",
        bypass_permissions: true,
      }),
    });
    const store = createTestStore({ projects: {}, activeProjectId: null });

    const sessionId = await store.getState().addChat(newChatData() as any);

    const chat = store.getState().chats.find((candidate) => candidate.id === sessionId);
    expect(chat?.config).toMatchObject({
      permissionMode: "auto",
      permissionModeSupported: true,
      bypassPermissions: true,
    });
  });

  it("does NOT send a dangling archived active Project", async () => {
    mockCreateSession.mockResolvedValue({ session: makeSummary() });
    const store = createTestStore({
      projects: { "proj-old": makeProject("proj-old", "archived") },
      activeProjectId: "proj-old",
    });

    await store.getState().addChat(newChatData() as any);

    // Sending the archived id would make the backend reject every new
    // session with 409 `project_archived`.
    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ project_id: null }));
  });

  it("does NOT send the active Project when its record is missing locally", async () => {
    mockCreateSession.mockResolvedValue({ session: makeSummary() });
    const store = createTestStore({ projects: {}, activeProjectId: "proj-ghost" });

    await store.getState().addChat(newChatData() as any);

    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ project_id: null }));
  });

  it("sends an explicit active Project and workspace atomically", async () => {
    mockCreateSession.mockResolvedValue({
      session: makeSummary({
        project_id: "proj-zenith",
        workspace_path: "/repo/zenith",
      }),
    });
    const store = createTestStore({
      projects: { "proj-zenith": makeProject("proj-zenith", "active") },
      activeProjectId: null,
    });
    const chatData = newChatData() as any;
    chatData.config.projectId = "proj-zenith";
    chatData.config.workspacePath = "/repo/zenith";

    await store.getState().addChat(chatData);

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "proj-zenith",
        workspace_path: "/repo/zenith",
      }),
    );
  });

  it("honors explicit Unassigned instead of falling back to the active Project", async () => {
    mockCreateSession.mockResolvedValue({ session: makeSummary({ project_id: null }) });
    const store = createTestStore({
      projects: { "proj-active": makeProject("proj-active", "active") },
      activeProjectId: "proj-active",
    });
    const chatData = newChatData() as any;
    chatData.config.projectId = null;

    await store.getState().addChat(chatData);

    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ project_id: null }));
  });

  it("does not send an explicit archived Project or fall back to another active Project", async () => {
    mockCreateSession.mockResolvedValue({ session: makeSummary({ project_id: null }) });
    const store = createTestStore({
      projects: {
        "proj-active": makeProject("proj-active", "active"),
        "proj-archived": makeProject("proj-archived", "archived"),
      },
      activeProjectId: "proj-active",
    });
    const chatData = newChatData() as any;
    chatData.config.projectId = "proj-archived";

    await store.getState().addChat(chatData);

    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ project_id: null }));
  });

  it("does not send an explicit dangling Project or fall back to another active Project", async () => {
    mockCreateSession.mockResolvedValue({ session: makeSummary({ project_id: null }) });
    const store = createTestStore({
      projects: { "proj-active": makeProject("proj-active", "active") },
      activeProjectId: "proj-active",
    });
    const chatData = newChatData() as any;
    chatData.config.projectId = "proj-missing";

    await store.getState().addChat(chatData);

    expect(mockCreateSession).toHaveBeenCalledWith(expect.objectContaining({ project_id: null }));
  });

  it("does not fabricate membership the backend did not assign", async () => {
    // Backend (or an older one) returns no project_id even though we asked.
    mockCreateSession.mockResolvedValue({ session: makeSummary({ project_id: undefined }) });
    const store = createTestStore({
      projects: { "proj-zenith": makeProject("proj-zenith", "active") },
      activeProjectId: "proj-zenith",
    });

    const sessionId = await store.getState().addChat(newChatData() as any);

    const chat = store.getState().chats.find((c) => c.id === sessionId);
    expect(chat?.config.projectId).toBeUndefined();
  });
});
