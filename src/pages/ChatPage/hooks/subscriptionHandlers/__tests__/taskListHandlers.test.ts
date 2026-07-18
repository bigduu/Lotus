import { describe, expect, it, vi } from "vitest";

import { createTaskListHandlers } from "../taskListHandlers";
import type { RunContext } from "../../subscriptionContext";

const { mockStoreState } = vi.hoisted(() => ({
  mockStoreState: { taskLists: {}, evaluationStates: {} as Record<string, unknown> },
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: { getState: () => mockStoreState },
}));

function makeRun() {
  const setEvaluationState = vi.fn();
  const run = {
    ctx: {
      message: { info: vi.fn(), success: vi.fn() },
      setTaskList: vi.fn(),
      updateTaskListDelta: vi.fn(),
      setEvaluationState,
      ensureTaskListBaseline: vi.fn(),
      shouldShowTaskListCompletedNotice: vi.fn(() => false),
    },
  } as unknown as RunContext;
  return { run, setEvaluationState };
}

describe("createTaskListHandlers — evaluation lifecycle (#593)", () => {
  it("stores started then cancelled as an auxiliary lifecycle", () => {
    const { run, setEvaluationState } = makeRun();
    const handlers = createTaskListHandlers(run);

    handlers.onTaskEvaluationStarted?.("session-1", 4);
    handlers.onTaskEvaluationCancelled?.("session-1");

    expect(setEvaluationState).toHaveBeenNthCalledWith(1, "session-1", {
      phase: "running",
      isEvaluating: true,
      reasoning: null,
      timestamp: expect.any(Number),
      itemsCount: 4,
    });
    expect(setEvaluationState).toHaveBeenNthCalledWith(
      2,
      "session-1",
      expect.objectContaining({ phase: "completed", isEvaluating: false }),
    );
  });
});
