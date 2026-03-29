import { beforeEach, describe, expect, it } from "vitest";

import {
  createInputStateSlice,
  readPersistedInputReasoningEffort,
  type InputStateSlice,
} from "../inputStateSlice";
import { createSliceHarness } from "./sliceHarness";

describe("inputStateSlice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads persisted reasoning effort from session-specific key first", () => {
    localStorage.setItem(
      "chat_input_reasoning_by_session_v1",
      JSON.stringify({
        "session-1": "high",
        "session-2": "invalid",
      }),
    );
    localStorage.setItem("chat_input_reasoning_last_used_v1", "low");

    expect(readPersistedInputReasoningEffort("session-1")).toBe("high");
    expect(readPersistedInputReasoningEffort("session-2")).toBe("low");
    expect(readPersistedInputReasoningEffort("missing")).toBe("low");
  });

  it("returns undefined for invalid persisted payloads", () => {
    localStorage.setItem("chat_input_reasoning_by_session_v1", "invalid json");
    localStorage.setItem("chat_input_reasoning_last_used_v1", "invalid");

    expect(readPersistedInputReasoningEffort("session-1")).toBeUndefined();
  });

  it("updates input state and persists reasoning effort changes", () => {
    const harness = createSliceHarness<InputStateSlice>(createInputStateSlice as any);

    harness.getState().setInputContent("session-1", "hello");
    harness.getState().setReferenceText("session-1", "ref");
    harness.getState().setAttachments("session-1", [
      {
        id: "a-1",
        base64: "abc",
        name: "file.png",
        size: 123,
        type: "image/png",
      },
    ]);
    harness.getState().setInputReasoningEffort("session-1", "xhigh");

    expect(harness.getState().inputStates["session-1"]).toMatchObject({
      content: "hello",
      referenceText: "ref",
      reasoningEffort: "xhigh",
    });
    expect(harness.getState().inputStates["session-1"]?.attachments).toHaveLength(1);

    expect(
      JSON.parse(localStorage.getItem("chat_input_reasoning_by_session_v1") || "{}"),
    ).toMatchObject({
      "session-1": "xhigh",
    });
    expect(localStorage.getItem("chat_input_reasoning_last_used_v1")).toBe("xhigh");
  });

  it("returns default state for unknown sessions and supports clearInputState", () => {
    localStorage.setItem("chat_input_reasoning_last_used_v1", "high");
    const harness = createSliceHarness<InputStateSlice>(createInputStateSlice as any);

    expect(harness.getState().getInputState("unknown")).toMatchObject({
      content: "",
      referenceText: null,
      attachments: [],
      reasoningEffort: "high",
    });

    harness.getState().setInputContent("session-1", "hello");
    expect(harness.getState().inputStates["session-1"]?.content).toBe("hello");

    harness.getState().clearInputState("session-1");
    expect(harness.getState().inputStates["session-1"]).toBeUndefined();
  });

  it("clears pendingQuestionRespond only for the matching session", () => {
    const harness = createSliceHarness<InputStateSlice>(createInputStateSlice as any);

    harness.getState().setPendingQuestionRespond({
      sessionId: "session-1",
      question: "q1",
      options: ["a", "b"],
      allowCustom: false,
    });
    expect(harness.getState().pendingQuestionRespond).toMatchObject({
      sessionId: "session-1",
      question: "q1",
      options: ["a", "b"],
      allowCustom: false,
    });

    harness.getState().clearPendingQuestionRespondForSession("session-2");
    expect(harness.getState().pendingQuestionRespond).toMatchObject({
      sessionId: "session-1",
      question: "q1",
      options: ["a", "b"],
      allowCustom: false,
    });

    harness.getState().clearPendingQuestionRespondForSession("session-1");
    expect(harness.getState().pendingQuestionRespond).toBeNull();
  });
});
