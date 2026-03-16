import { describe, expect, it, vi } from "vitest";

import {
  createTodoListSlice,
  type TodoList,
  type TodoListSlice,
} from "../todoListSlice";
import { createSliceHarness } from "./sliceHarness";

const makeTodoList = (version = 1): TodoList => ({
  session_id: "session-1",
  title: "Test todo",
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

describe("todoListSlice", () => {
  it("sets todo list and tracks version", () => {
    const harness = createSliceHarness<TodoListSlice>(createTodoListSlice);

    harness.getState().setTodoList("session-1", makeTodoList(3));

    expect(harness.getState().todoLists["session-1"]?.title).toBe("Test todo");
    expect(harness.getState().todoListVersions["session-1"]).toBe(3);
    expect(harness.getState().getTodoListVersion("missing")).toBe(0);
  });

  it("ignores outdated delta and unknown session deltas", () => {
    const harness = createSliceHarness<TodoListSlice>(createTodoListSlice);
    harness.getState().setTodoList("session-1", makeTodoList(2));

    const before = harness.getState().todoLists["session-1"];
    harness.getState().updateTodoListDelta("session-1", {
      session_id: "session-1",
      item_id: "item-1",
      status: "completed",
      tool_calls_count: 1,
      version: 2,
    });
    expect(harness.getState().todoLists["session-1"]).toEqual(before);

    harness.getState().updateTodoListDelta("missing", {
      session_id: "missing",
      item_id: "item-1",
      status: "completed",
      tool_calls_count: 1,
      version: 99,
    });
    expect(harness.getState().todoLists.missing).toBeUndefined();
  });

  it("applies newer deltas, updates active item, and clears state", () => {
    const isoSpy = vi
      .spyOn(Date.prototype, "toISOString")
      .mockReturnValue("2026-01-02T00:00:00.000Z");
    const harness = createSliceHarness<TodoListSlice>(createTodoListSlice);
    harness.getState().setTodoList("session-1", makeTodoList(1));

    harness.getState().setEvaluationState("session-1", {
      isEvaluating: true,
      reasoning: "thinking",
      timestamp: 123,
    });

    harness.getState().updateTodoListDelta("session-1", {
      session_id: "session-1",
      item_id: "item-1",
      status: "in_progress",
      tool_calls_count: 2,
      version: 4,
    });
    expect(harness.getState().activeItems["session-1"]).toBe("item-1");
    expect(harness.getState().todoListVersions["session-1"]).toBe(4);
    expect(harness.getState().todoLists["session-1"]?.updated_at).toBe(
      "2026-01-02T00:00:00.000Z",
    );
    expect(harness.getState().todoLists["session-1"]?.items[0]).toMatchObject({
      status: "in_progress",
      tool_calls_count: 2,
    });

    harness.getState().updateTodoListDelta("session-1", {
      session_id: "session-1",
      item_id: "item-1",
      status: "completed",
      tool_calls_count: 3,
      version: 5,
    });
    expect(harness.getState().activeItems["session-1"]).toBeNull();

    harness.getState().clearEvaluationState("session-1");
    expect(harness.getState().evaluationStates["session-1"]).toBeUndefined();

    harness.getState().clearTodoList("session-1");
    expect(harness.getState().todoLists["session-1"]).toBeUndefined();
    expect(harness.getState().todoListVersions["session-1"]).toBeUndefined();
    expect(harness.getState().activeItems["session-1"]).toBeUndefined();

    isoSpy.mockRestore();
  });
});
