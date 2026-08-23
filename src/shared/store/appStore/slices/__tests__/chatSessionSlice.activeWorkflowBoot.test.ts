import { describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import { createChatSlice, type ChatSlice } from "../chatSessionSlice";

const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getRunningSessions: vi.fn(),
  getHistory: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      listSessions: mocks.listSessions,
      getRunningSessions: mocks.getRunningSessions,
      getHistory: mocks.getHistory,
      getSession: mocks.getSession,
      deleteSession: vi.fn(),
      patchSession: vi.fn(async () => undefined),
    })),
  },
  isSessionCreateRecoveryError: () => false,
}));

const deferred = <T>() => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const session = {
  id: "session-1",
  kind: "root",
  title: "Session",
  title_version: 1,
  pinned: false,
  root_session_id: "session-1",
  spawn_depth: 0,
  model: "gpt-5",
  created_at: "2026-08-23T08:00:00Z",
  updated_at: "2026-08-23T08:00:00Z",
  last_activity_at: "2026-08-23T08:00:00Z",
  message_count: 0,
  has_attachments: false,
  is_running: false,
};

describe("chatSessionSlice active Workflow boot restore", () => {
  it("starts history and session-detail hydration together after the list is applied", async () => {
    const history = deferred<any>();
    const detail = deferred<any>();
    mocks.listSessions.mockResolvedValue({ sessions: [session] });
    mocks.getRunningSessions.mockResolvedValue({ sessions: [] });
    mocks.getHistory.mockReturnValue(history.promise);
    mocks.getSession.mockReturnValue(detail.promise);
    const store = createStore<ChatSlice>()((set, get, api) =>
      (createChatSlice as any)(set, get, api),
    );
    store.setState({ executionBySession: {} } as any);

    const loading = store.getState().loadChats();
    await vi.waitFor(() => expect(mocks.getHistory).toHaveBeenCalledWith("session-1"));
    expect(mocks.getSession).toHaveBeenCalledWith("session-1");

    detail.resolve({
      ...session,
      active_workflow: {
        id: "review",
        name: "Review",
        source: "project",
        revision: 12,
        version: "4",
        kind: "instruction",
        invoked_by: "user",
        activated_at: "2026-08-23T08:00:00Z",
        status: "active",
      },
    });
    history.resolve({ session_id: "session-1", messages: [], compression_events: [] });
    await loading;

    expect(store.getState().chats[0].activeWorkflow).toMatchObject({
      id: "review",
      revision: 12,
      invokedBy: "user",
    });
  });
});
