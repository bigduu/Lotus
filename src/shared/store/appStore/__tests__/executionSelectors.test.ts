import { describe, expect, it } from "vitest";

import { createInitialExecutionState } from "../slices/executionStateSlice";
import {
  selectIsStreaming,
  selectIsInputLocked,
  selectCanCancel,
  selectPendingQuestion,
  selectRespondMode,
  selectShouldObserve,
} from "../selectors/executionSelectors";

const SESSION = "session-1";

const createState = (
  phase: ReturnType<typeof createInitialExecutionState>["phase"],
  options?: {
    hasTokens?: boolean;
  },
) => ({
  executionBySession: {
    [SESSION]: {
      ...createInitialExecutionState(SESSION),
      phase,
      stream: {
        ...createInitialExecutionState(SESSION).stream,
        hasTokens: options?.hasTokens ?? false,
      },
    },
  },
  chats: [],
});

describe("execution selectors", () => {
  it("returns idle defaults when sessionId is null", () => {
    expect(selectIsStreaming(null)({ executionBySession: {}, chats: [] })).toBe(false);
    expect(selectIsInputLocked(null)({ executionBySession: {}, chats: [] })).toBe(false);
    expect(selectCanCancel(null)({ executionBySession: {}, chats: [] })).toBe(false);
  });

  it("treats running as locked and cancellable, with no visible streaming", () => {
    const state = createState("running");

    expect(selectIsStreaming(SESSION)(state)).toBe(false);
    expect(selectIsInputLocked(SESSION)(state)).toBe(true);
    expect(selectCanCancel(SESSION)(state)).toBe(true);
  });

  it("treats running_tools with tokens as visible streaming", () => {
    const state = createState("running_tools", { hasTokens: true });

    expect(selectIsStreaming(SESSION)(state)).toBe(true);
    expect(selectIsInputLocked(SESSION)(state)).toBe(true);
    expect(selectCanCancel(SESSION)(state)).toBe(true);
  });

  it("keeps input locked during settling but disables cancel", () => {
    const state = createState("settling");

    expect(selectIsStreaming(SESSION)(state)).toBe(false);
    expect(selectIsInputLocked(SESSION)(state)).toBe(true);
    expect(selectCanCancel(SESSION)(state)).toBe(false);
  });

  it("derives respondMode from pendingQuestion so pendingQuestion is the single source of truth", () => {
    const state = createState("waiting_user_answer");
    state.executionBySession[SESSION].interaction.pendingQuestion = {
      question: "Continue?",
      options: ["Yes", "No"],
      allowCustom: true,
      toolCallId: "ask-1",
      receivedAt: "2026-05-14T00:00:00.000Z",
    };
    state.executionBySession[SESSION].interaction.respondMode = null;

    expect(selectPendingQuestion(SESSION)(state)).toEqual({
      question: "Continue?",
      options: ["Yes", "No"],
      allowCustom: true,
      toolCallId: "ask-1",
      receivedAt: "2026-05-14T00:00:00.000Z",
    });
    expect(selectRespondMode(SESSION)(state)).toEqual({
      sessionId: SESSION,
      question: "Continue?",
      options: ["Yes", "No"],
      allowCustom: true,
      toolCallId: "ask-1",
    });
  });

  it("does not observe waiting_user_answer over SSE even though the session remains busy", () => {
    const state = createState("waiting_user_answer");

    expect(selectShouldObserve(SESSION)(state)).toBe(false);
  });

  it("continues observing actively executing phases", () => {
    expect(selectShouldObserve(SESSION)(createState("running"))).toBe(true);
    expect(selectShouldObserve(SESSION)(createState("streaming"))).toBe(true);
    expect(selectShouldObserve(SESSION)(createState("running_tools"))).toBe(true);
  });
});
