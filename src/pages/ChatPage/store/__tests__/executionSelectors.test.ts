import { describe, expect, it } from "vitest";

import { createInitialExecutionState } from "../slices/executionStateSlice";
import {
  selectIsStreaming,
  selectIsInputLocked,
  selectCanCancel,
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
});
