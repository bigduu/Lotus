import { beforeEach, describe, expect, it, vi } from "vitest";

import { createChildHandlers } from "../childHandlers";
import type { RunContext } from "../../subscriptionContext";

/**
 * Mutable fake of the bits of the global store the child handlers read via
 * `useAppStore.getState()`: the children map. (The FIFO approval queue itself
 * lives entirely behind the `enqueuePendingChildApproval` /
 * `clearPendingChildApprovalsForChild` action mocks below — childHandlers no
 * longer reads it directly, since the reducer owns dedupe/idempotency; see
 * executionStateSlice.test.ts for queue-semantics coverage.)
 */
const mockStoreState: {
  children: Record<string, Record<string, unknown>>;
} = {
  children: {},
};

vi.mock("@shared/store/appStore", () => ({
  useAppStore: { getState: () => mockStoreState },
  selectChildren: (sessionId: string) => (state: typeof mockStoreState) =>
    state.children[sessionId] ?? {},
}));

interface RunOverrides {
  enqueuePendingChildApproval?: ReturnType<typeof vi.fn>;
  dequeuePendingChildApproval?: ReturnType<typeof vi.fn>;
  clearPendingChildApprovalsForChild?: ReturnType<typeof vi.fn>;
}

/**
 * Build a minimal RunContext exposing only what the child handlers under test
 * touch: the parent `sessionId` and the approval enqueue/clear actions.
 * Everything else is left as a typed stub so the factory can construct.
 */
function makeRun(overrides: RunOverrides = {}): RunContext {
  const ctx = {
    enqueuePendingChildApproval: overrides.enqueuePendingChildApproval ?? vi.fn(),
    dequeuePendingChildApproval: overrides.dequeuePendingChildApproval ?? vi.fn(),
    clearPendingChildApprovalsForChild: overrides.clearPendingChildApprovalsForChild ?? vi.fn(),
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

beforeEach(() => {
  mockStoreState.children = {};
});

describe("createChildHandlers — onChildApprovalRequested (FIFO queue, #25)", () => {
  it("folds versioned nested approval outcomes into the existing FIFO", () => {
    const enqueuePendingChildApproval = vi.fn();
    const dequeuePendingChildApproval = vi.fn();
    const handlers = createChildHandlers(
      makeRun({ enqueuePendingChildApproval, dequeuePendingChildApproval }),
    );

    handlers.onSubAgentEvent?.("parent-1", "child-9", {
      type: "child_approval_changed",
      parent_session_id: "parent-1",
      child_session_id: "child-9",
      request_id: "request-versioned",
      version: 1,
      status: "pending",
      tool_name: "Bash",
    });
    handlers.onSubAgentEvent?.("parent-1", "child-9", {
      type: "child_approval_changed",
      parent_session_id: "parent-1",
      child_session_id: "child-9",
      request_id: "request-versioned",
      version: 2,
      status: "denied",
    });

    expect(enqueuePendingChildApproval).toHaveBeenCalledWith(
      "parent-1",
      expect.objectContaining({ childSessionId: "child-9", requestId: "request-versioned" }),
    );
    expect(dequeuePendingChildApproval).toHaveBeenCalledWith("parent-1", "request-versioned");
  });
  it("enqueues the pending child-approval request for the parent session", () => {
    const enqueuePendingChildApproval = vi.fn();
    const handlers = createChildHandlers(makeRun({ enqueuePendingChildApproval }));

    handlers.onChildApprovalRequested?.("child-9", "req-42", {
      toolName: "Bash",
      permission: "execute",
      resource: "rm -rf /tmp/x",
    });

    expect(enqueuePendingChildApproval).toHaveBeenCalledTimes(1);
    expect(enqueuePendingChildApproval).toHaveBeenCalledWith("parent-1", {
      childSessionId: "child-9",
      requestId: "req-42",
      toolName: "Bash",
      permission: "execute",
      resource: "rm -rf /tmp/x",
    });
  });

  it("normalizes missing optional fields to null", () => {
    const enqueuePendingChildApproval = vi.fn();
    const handlers = createChildHandlers(makeRun({ enqueuePendingChildApproval }));

    handlers.onChildApprovalRequested?.("child-9", "req-42", {});

    expect(enqueuePendingChildApproval).toHaveBeenCalledWith("parent-1", {
      childSessionId: "child-9",
      requestId: "req-42",
      toolName: null,
      permission: null,
      resource: null,
    });
  });

  it("enqueues a SECOND concurrent request from a different child without dropping the first — the reducer's FIFO queue retains both (no more single-slot overwrite / TODO #23)", () => {
    const enqueuePendingChildApproval = vi.fn();
    const handlers = createChildHandlers(makeRun({ enqueuePendingChildApproval }));

    handlers.onChildApprovalRequested?.("child-A", "req-old", {});
    handlers.onChildApprovalRequested?.("child-B", "req-new", {});

    // Both requests reach the store as independent enqueue calls; the queue
    // (not this handler) is responsible for retaining both — see
    // executionStateSlice.test.ts "retains BOTH concurrent approvals".
    expect(enqueuePendingChildApproval).toHaveBeenCalledTimes(2);
    expect(enqueuePendingChildApproval).toHaveBeenNthCalledWith(1, "parent-1", {
      childSessionId: "child-A",
      requestId: "req-old",
      toolName: null,
      permission: null,
      resource: null,
    });
    expect(enqueuePendingChildApproval).toHaveBeenNthCalledWith(2, "parent-1", {
      childSessionId: "child-B",
      requestId: "req-new",
      toolName: null,
      permission: null,
      resource: null,
    });
  });

  it("re-delivering the same request (reconnect/replay) still calls enqueue — dedup is the reducer's job, not this handler's", () => {
    const enqueuePendingChildApproval = vi.fn();
    const handlers = createChildHandlers(makeRun({ enqueuePendingChildApproval }));

    handlers.onChildApprovalRequested?.("child-A", "req-1", {});
    handlers.onChildApprovalRequested?.("child-A", "req-1", {});

    // No warning, no special-casing here: the store's enqueue action is
    // idempotent for a duplicate requestId (see executionStateSlice.test.ts).
    expect(enqueuePendingChildApproval).toHaveBeenCalledTimes(2);
  });
});

describe("createChildHandlers — onSubAgentCompleted (lifecycle-clear, #25)", () => {
  it("clears any queued approvals belonging to the completing child", () => {
    const clearPendingChildApprovalsForChild = vi.fn();
    const handlers = createChildHandlers(makeRun({ clearPendingChildApprovalsForChild }));

    handlers.onSubAgentCompleted?.("parent-1", "child-9", "completed", undefined);

    expect(clearPendingChildApprovalsForChild).toHaveBeenCalledTimes(1);
    expect(clearPendingChildApprovalsForChild).toHaveBeenCalledWith("parent-1", "child-9");
  });

  it("clears on an errored terminal status too", () => {
    const clearPendingChildApprovalsForChild = vi.fn();
    const handlers = createChildHandlers(makeRun({ clearPendingChildApprovalsForChild }));

    handlers.onSubAgentCompleted?.("parent-1", "child-9", "error", "boom");

    expect(clearPendingChildApprovalsForChild).toHaveBeenCalledTimes(1);
    expect(clearPendingChildApprovalsForChild).toHaveBeenCalledWith("parent-1", "child-9");
  });

  it("always scopes the clear to the completing child's own id — a different child's queued entry is the reducer's concern to preserve, not this handler's", () => {
    const clearPendingChildApprovalsForChild = vi.fn();
    const handlers = createChildHandlers(makeRun({ clearPendingChildApprovalsForChild }));

    handlers.onSubAgentCompleted?.("parent-1", "child-9", "completed", undefined);

    expect(clearPendingChildApprovalsForChild).toHaveBeenCalledWith("parent-1", "child-9");
    // Never called with any OTHER child's id from this single completion.
    expect(clearPendingChildApprovalsForChild).not.toHaveBeenCalledWith("parent-1", "child-OTHER");
  });

  it("calls clear unconditionally even when nothing is queued — idempotent no-op at the reducer layer", () => {
    const clearPendingChildApprovalsForChild = vi.fn();
    const handlers = createChildHandlers(makeRun({ clearPendingChildApprovalsForChild }));

    handlers.onSubAgentCompleted?.("parent-1", "child-9", "completed", undefined);

    // The handler doesn't pre-check store state before clearing (that would
    // require reading through the queue itself); it always calls through and
    // relies on `clearPendingChildApprovalsForChildSnapshot` being a true
    // no-op when nothing matches (see executionStateSlice.test.ts).
    expect(clearPendingChildApprovalsForChild).toHaveBeenCalledTimes(1);
  });
});
