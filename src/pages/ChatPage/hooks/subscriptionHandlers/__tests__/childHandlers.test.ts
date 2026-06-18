import { describe, expect, it, vi } from "vitest";

import { createChildHandlers } from "../childHandlers";
import type { RunContext } from "../../subscriptionContext";

/**
 * Build a minimal RunContext exposing only what `onChildApprovalRequested`
 * touches: the parent `sessionId` and the `setPendingChildApproval` action.
 * Everything else is left as a typed stub so the factory can construct.
 */
function makeRun(overrides: { setPendingChildApproval: ReturnType<typeof vi.fn> }): RunContext {
  const ctx = {
    setPendingChildApproval: overrides.setPendingChildApproval,
    // Refs used only by other handlers; safe empty maps.
    backgroundChildrenByParentRef: { current: new Map() },
    lastChildHeartbeatAtRef: { current: new Map() },
    lastChildRoundCountRef: { current: new Map() },
    pendingChildPreviewRef: { current: new Map() },
    applyChildProgress: vi.fn(),
    ensureTaskListBaseline: vi.fn(),
    flushChildPreview: vi.fn(),
    persistSessionTitle: vi.fn().mockResolvedValue(undefined),
    refreshChatsNow: vi.fn().mockResolvedValue(undefined),
    scheduleChildPreviewFlush: vi.fn(),
    setEvaluationState: vi.fn(),
    setTaskList: vi.fn(),
    updateTaskListDelta: vi.fn(),
  } as unknown as RunContext["ctx"];

  return {
    ctx,
    sessionId: "parent-1",
    generation: 1,
    controller: new AbortController(),
    messageId: "m1",
    reasoningMessageId: "r1",
    statusMessageId: "s1",
    setStreamingStatus: vi.fn(),
    scheduleParentSettleCheck: vi.fn(),
  };
}

describe("createChildHandlers — onChildApprovalRequested", () => {
  it("sets the pending child-approval state on the parent session", () => {
    const setPendingChildApproval = vi.fn();
    const handlers = createChildHandlers(makeRun({ setPendingChildApproval }));

    handlers.onChildApprovalRequested?.("child-9", "req-42", {
      toolName: "Bash",
      permission: "execute",
      resource: "rm -rf /tmp/x",
    });

    expect(setPendingChildApproval).toHaveBeenCalledTimes(1);
    expect(setPendingChildApproval).toHaveBeenCalledWith("parent-1", {
      childSessionId: "child-9",
      requestId: "req-42",
      toolName: "Bash",
      permission: "execute",
      resource: "rm -rf /tmp/x",
    });
  });

  it("normalizes missing optional fields to null", () => {
    const setPendingChildApproval = vi.fn();
    const handlers = createChildHandlers(makeRun({ setPendingChildApproval }));

    handlers.onChildApprovalRequested?.("child-9", "req-42", {});

    expect(setPendingChildApproval).toHaveBeenCalledWith("parent-1", {
      childSessionId: "child-9",
      requestId: "req-42",
      toolName: null,
      permission: null,
      resource: null,
    });
  });
});
