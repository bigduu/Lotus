import { describe, expect, it, vi } from "vitest";

import { AgentClient } from "../../../services/AgentService";
import { createTaskListSlice, type TaskList, type TaskListSlice } from "../todoListSlice";
import { createSliceHarness } from "./sliceHarness";

const makeTaskList = (version = 1): TaskList => ({
  session_id: "session-1",
  title: "Test task",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  version,
  items: [
    {
      id: "item-1",
      description: "Do something",
      status: "pending",
      depends_on: [],
      notes: "",
    },
  ],
});

describe("taskListSlice", () => {
  it("sets task list and tracks version", () => {
    const harness = createSliceHarness<TaskListSlice>(createTaskListSlice);

    harness.getState().setTaskList("session-1", makeTaskList(3));

    expect(harness.getState().taskLists["session-1"]?.title).toBe("Test task");
    expect(harness.getState().taskListVersions["session-1"]).toBe(3);
    expect(harness.getState().getTaskListVersion("missing")).toBe(0);
  });

  it("ignores outdated delta and unknown session deltas", () => {
    const harness = createSliceHarness<TaskListSlice>(createTaskListSlice);
    harness.getState().setTaskList("session-1", makeTaskList(2));

    const before = harness.getState().taskLists["session-1"];
    harness.getState().updateTaskListDelta("session-1", {
      session_id: "session-1",
      item_id: "item-1",
      status: "completed",
      tool_calls_count: 1,
      version: 2,
    });
    expect(harness.getState().taskLists["session-1"]).toEqual(before);

    harness.getState().updateTaskListDelta("missing", {
      session_id: "missing",
      item_id: "item-1",
      status: "completed",
      tool_calls_count: 1,
      version: 99,
    });
    expect(harness.getState().taskLists.missing).toBeUndefined();
  });

  it("loads task list snapshot from backend and stores it", async () => {
    const getTaskListSpy = vi
      .spyOn(AgentClient.getInstance(), "getTaskList")
      .mockResolvedValue(makeTaskList(7));
    const harness = createSliceHarness<TaskListSlice>(createTaskListSlice);

    const taskList = await harness.getState().loadTaskList("session-1");

    expect(getTaskListSpy).toHaveBeenCalledWith("session-1");
    expect(taskList?.title).toBe("Test task");
    expect(harness.getState().taskLists["session-1"]?.title).toBe("Test task");
    expect(harness.getState().taskListVersions["session-1"]).toBe(7);
  });

  it("applies newer deltas, updates active item, and clears state", () => {
    const isoSpy = vi
      .spyOn(Date.prototype, "toISOString")
      .mockReturnValue("2026-01-02T00:00:00.000Z");
    const harness = createSliceHarness<TaskListSlice>(createTaskListSlice);
    harness.getState().setTaskList("session-1", makeTaskList(1));

    harness.getState().setEvaluationState("session-1", {
      isEvaluating: true,
      reasoning: "thinking",
      timestamp: 123,
    });

    harness.getState().updateTaskListDelta("session-1", {
      session_id: "session-1",
      item_id: "item-1",
      status: "in_progress",
      tool_calls_count: 2,
      version: 4,
    });
    expect(harness.getState().activeItems["session-1"]).toBe("item-1");
    expect(harness.getState().taskListVersions["session-1"]).toBe(4);
    expect(harness.getState().taskLists["session-1"]?.updated_at).toBe("2026-01-02T00:00:00.000Z");
    expect(harness.getState().taskLists["session-1"]?.items[0]).toMatchObject({
      status: "in_progress",
      tool_calls_count: 2,
    });

    harness.getState().updateTaskListDelta("session-1", {
      session_id: "session-1",
      item_id: "item-1",
      status: "completed",
      tool_calls_count: 3,
      version: 5,
    });
    expect(harness.getState().activeItems["session-1"]).toBeNull();

    harness.getState().clearEvaluationState("session-1");
    expect(harness.getState().evaluationStates["session-1"]).toBeUndefined();

    harness.getState().clearTaskList("session-1");
    expect(harness.getState().taskLists["session-1"]).toBeUndefined();
    expect(harness.getState().taskListVersions["session-1"]).toBeUndefined();
    expect(harness.getState().activeItems["session-1"]).toBeUndefined();

    isoSpy.mockRestore();
  });
});
