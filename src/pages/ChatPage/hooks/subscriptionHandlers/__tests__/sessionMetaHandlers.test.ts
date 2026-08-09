import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RunContext } from "../../subscriptionContext";
import { createSessionMetaHandlers } from "../sessionMetaHandlers";

const { mockApplyReplayableSessionEvent, mockStoreState } = vi.hoisted(() => ({
  mockApplyReplayableSessionEvent: vi.fn(),
  mockStoreState: {
    chats: [] as Array<{
      id: string;
      config?: Record<string, unknown>;
      planMode?: Record<string, unknown> | null;
    }>,
  },
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: { getState: () => mockStoreState },
}));

vi.mock("@shared/store/appStore/slices/sessionMetadataSlice", () => ({
  applyReplayableSessionEvent: mockApplyReplayableSessionEvent,
}));

function makeRun() {
  const updateSession = vi.fn();
  const refreshChatsNow = vi.fn().mockResolvedValue(undefined);
  const ctx = { updateSession, refreshChatsNow } as unknown as RunContext["ctx"];
  const run = { ctx, sessionId: "fallback-session" } as unknown as RunContext;
  return { run, updateSession, refreshChatsNow };
}

beforeEach(() => {
  mockStoreState.chats = [];
  mockApplyReplayableSessionEvent.mockClear();
});

describe("createSessionMetaHandlers", () => {
  it("routes replayable title and pin events through the metadata reducer", () => {
    const { run } = makeRun();
    const handlers = createSessionMetaHandlers(run);
    const titleEvent = {
      type: "session_title_updated",
      session_id: "session-1",
      title: "New title",
      title_version: 2,
      title_generated: false,
      source: "manual",
      updated_at: "2026-08-09T00:00:00Z",
    } as const;
    const pinnedEvent = {
      type: "session_pinned_updated",
      session_id: "session-1",
      pinned: true,
      updated_at: "2026-08-09T00:00:01Z",
    } as const;

    handlers.onSessionTitleUpdated?.(titleEvent);
    handlers.onSessionPinnedUpdated?.(pinnedEvent);

    expect(mockApplyReplayableSessionEvent).toHaveBeenNthCalledWith(1, titleEvent, mockStoreState);
    expect(mockApplyReplayableSessionEvent).toHaveBeenNthCalledWith(2, pinnedEvent, mockStoreState);
  });

  it("enters a valid plan mode for the event session and refreshes malformed events", () => {
    const { run, updateSession, refreshChatsNow } = makeRun();
    const handlers = createSessionMetaHandlers(run);

    handlers.onPlanModeEntered?.({
      type: "plan_mode_entered",
      session_id: "session-1",
      entered_at: "2026-08-09T00:00:00Z",
      pre_permission_mode: "ask",
      plan_file_path: "/tmp/plan.md",
      status: "designing",
    });
    handlers.onPlanModeEntered?.({
      type: "plan_mode_entered",
      session_id: "session-2",
      status: "invalid",
    });

    expect(updateSession).toHaveBeenCalledWith("session-1", {
      planMode: {
        entered_at: "2026-08-09T00:00:00Z",
        pre_permission_mode: "ask",
        plan_file_path: "/tmp/plan.md",
        status: "designing",
      },
    });
    expect(refreshChatsNow).toHaveBeenCalledTimes(1);
  });

  it("clears plan mode for the fallback session and reconciles with the backend", () => {
    const { run, updateSession, refreshChatsNow } = makeRun();
    const handlers = createSessionMetaHandlers(run);

    handlers.onPlanModeExited?.({ type: "plan_mode_exited" });

    expect(updateSession).toHaveBeenCalledWith("fallback-session", { planMode: null });
    expect(refreshChatsNow).toHaveBeenCalledTimes(1);
  });

  it("patches goal state without losing config and refreshes a missing session", () => {
    mockStoreState.chats = [{ id: "session-1", config: { workspacePath: "/repo" } }];
    const { run, updateSession, refreshChatsNow } = makeRun();
    const handlers = createSessionMetaHandlers(run);
    const goalState = { status: "active", objective: "Ship it" };

    handlers.onGoalStatusChanged?.({
      type: "goal_status_changed",
      session_id: "session-1",
      goal_state: goalState,
    });
    handlers.onGoalStatusChanged?.({
      type: "goal_status_changed",
      session_id: "missing",
      goal_state: null,
    });

    expect(updateSession).toHaveBeenCalledWith("session-1", {
      config: { workspacePath: "/repo", goalState },
    });
    expect(refreshChatsNow).toHaveBeenCalledTimes(1);
  });

  it("updates the plan file and valid status while preserving existing plan fields", () => {
    mockStoreState.chats = [
      {
        id: "session-1",
        planMode: {
          entered_at: "earlier",
          pre_permission_mode: "ask",
          plan_file_path: "/old.md",
          status: "exploring",
        },
      },
    ];
    const { run, updateSession, refreshChatsNow } = makeRun();
    const handlers = createSessionMetaHandlers(run);

    handlers.onPlanFileUpdated?.({
      type: "plan_file_updated",
      session_id: "session-1",
      plan_file_path: "/new.md",
      status: "awaiting_approval",
    });
    handlers.onPlanFileUpdated?.({
      type: "plan_file_updated",
      session_id: "missing",
      plan_file_path: "/missing.md",
      status: "designing",
    });

    expect(updateSession).toHaveBeenCalledWith("session-1", {
      planMode: {
        entered_at: "earlier",
        pre_permission_mode: "ask",
        plan_file_path: "/new.md",
        status: "awaiting_approval",
      },
    });
    expect(refreshChatsNow).toHaveBeenCalledTimes(1);
  });
});
