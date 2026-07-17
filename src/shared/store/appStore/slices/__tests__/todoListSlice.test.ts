import { describe, expect, it, vi } from "vitest";

import { AgentClient } from "@services/chat/AgentService";
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

  describe("setTaskList monotonic guard (#39)", () => {
    it("drops a stale full snapshot arriving after a newer delta and leaves list + version unchanged", () => {
      const harness = createSliceHarness<TaskListSlice>(createTaskListSlice);
      harness.getState().setTaskList("session-1", makeTaskList(8));

      harness.getState().updateTaskListDelta("session-1", {
        session_id: "session-1",
        item_id: "item-1",
        status: "in_progress",
        tool_calls_count: 1,
        version: 10,
      });
      const afterDelta = harness.getState().taskLists["session-1"];
      expect(harness.getState().taskListVersions["session-1"]).toBe(10);

      // A child sub-agent forwards a snapshot it captured earlier, at v8 —
      // stale relative to the delta-updated v10 list.
      harness.getState().setTaskList("session-1", makeTaskList(8));

      expect(harness.getState().taskLists["session-1"]).toEqual(afterDelta);
      expect(harness.getState().taskListVersions["session-1"]).toBe(10);

      // The version counter must not have regressed: an old v9 delta must
      // still be rejected, not let back in by a corrupted version.
      harness.getState().updateTaskListDelta("session-1", {
        session_id: "session-1",
        item_id: "item-1",
        status: "completed",
        tool_calls_count: 2,
        version: 9,
      });
      expect(harness.getState().taskLists["session-1"]).toEqual(afterDelta);
      expect(harness.getState().taskListVersions["session-1"]).toBe(10);
    });

    it("applies a fresh full snapshot with a strictly newer version", () => {
      const harness = createSliceHarness<TaskListSlice>(createTaskListSlice);
      harness.getState().setTaskList("session-1", makeTaskList(5));

      const fresher = { ...makeTaskList(6), title: "Updated title" };
      harness.getState().setTaskList("session-1", fresher);

      expect(harness.getState().taskLists["session-1"]?.title).toBe("Updated title");
      expect(harness.getState().taskListVersions["session-1"]).toBe(6);
    });

    it("ignores an equal-version snapshot (same semantics as the delta path)", () => {
      const harness = createSliceHarness<TaskListSlice>(createTaskListSlice);
      harness.getState().setTaskList("session-1", makeTaskList(5));
      const before = harness.getState().taskLists["session-1"];

      const sameVersionDifferentTitle = { ...makeTaskList(5), title: "Different title" };
      harness.getState().setTaskList("session-1", sameVersionDifferentTitle);

      expect(harness.getState().taskLists["session-1"]).toEqual(before);
      expect(harness.getState().taskListVersions["session-1"]).toBe(5);
    });

    it("applies a versionless snapshot as a first load (no existing tracked list)", () => {
      const harness = createSliceHarness<TaskListSlice>(createTaskListSlice);
      const versionless: TaskList = { ...makeTaskList(5), version: undefined };

      harness.getState().setTaskList("session-1", versionless);

      expect(harness.getState().taskLists["session-1"]?.title).toBe("Test task");
      // Never resets to 0 semantics matter for a *pre-existing* tracked
      // version; with nothing tracked yet, 0 is simply the starting point.
      expect(harness.getState().taskListVersions["session-1"]).toBe(0);
    });

    it("ignores a versionless (e.g. REST baseline) snapshot over an already-tracked list, preserving the version", () => {
      const harness = createSliceHarness<TaskListSlice>(createTaskListSlice);
      harness.getState().setTaskList("session-1", makeTaskList(1));
      harness.getState().updateTaskListDelta("session-1", {
        session_id: "session-1",
        item_id: "item-1",
        status: "in_progress",
        tool_calls_count: 1,
        version: 10,
      });
      const afterDelta = harness.getState().taskLists["session-1"];

      const versionlessBaseline: TaskList = { ...makeTaskList(1), version: undefined };
      harness.getState().setTaskList("session-1", versionlessBaseline);

      expect(harness.getState().taskLists["session-1"]).toEqual(afterDelta);
      // Version counter must be preserved, not reset to 0.
      expect(harness.getState().taskListVersions["session-1"]).toBe(10);
    });

    it("applies a normal delta after a snapshot as usual", () => {
      const harness = createSliceHarness<TaskListSlice>(createTaskListSlice);
      harness.getState().setTaskList("session-1", makeTaskList(3));

      harness.getState().updateTaskListDelta("session-1", {
        session_id: "session-1",
        item_id: "item-1",
        status: "completed",
        tool_calls_count: 5,
        version: 4,
      });

      expect(harness.getState().taskListVersions["session-1"]).toBe(4);
      expect(harness.getState().taskLists["session-1"]?.items[0]).toMatchObject({
        status: "completed",
        tool_calls_count: 5,
      });
    });
  });
});
