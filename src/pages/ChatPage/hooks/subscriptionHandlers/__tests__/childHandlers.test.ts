import { beforeEach, describe, expect, it, vi } from "vitest";

import { createChildHandlers } from "../childHandlers";
import type { RunContext } from "../../subscriptionContext";

/**
 * Mutable fake of the bits of the global store the child handlers read via
 * `useAppStore.getState()`: the per-session pending child-approval slot and the
 * children map. Tests mutate `mockStoreState` before invoking a handler.
 */
const mockStoreState: {
  pendingChildApproval: Record<string, unknown>;
  children: Record<string, Record<string, unknown>>;
} = {
  pendingChildApproval: {},
  children: {},
};

vi.mock("@shared/store/appStore", () => ({
  useAppStore: { getState: () => mockStoreState },
  selectPendingChildApproval: (sessionId: string) => (state: typeof mockStoreState) =>
    state.pendingChildApproval[sessionId] ?? null,
  selectChildren: (sessionId: string) => (state: typeof mockStoreState) =>
    state.children[sessionId] ?? {},
}));

interface RunOverrides {
  setPendingChildApproval?: ReturnType<typeof vi.fn>;
  clearPendingChildApproval?: ReturnType<typeof vi.fn>;
}

/**
 * Build a minimal RunContext exposing only what the child handlers under test
 * touch: the parent `sessionId` and the approval set/clear actions. Everything
 * else is left as a typed stub so the factory can construct.
 */
function makeRun(overrides: RunOverrides = {}): RunContext {
  const ctx = {
    setPendingChildApproval: overrides.setPendingChildApproval ?? vi.fn(),
    clearPendingChildApproval: overrides.clearPendingChildApproval ?? vi.fn(),
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
  mockStoreState.pendingChildApproval = {};
  mockStoreState.children = {};
});

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

  it("warns (TODO #23) when overwriting a still-pending different request", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockStoreState.pendingChildApproval = {
      "parent-1": {
        childSessionId: "child-A",
        requestId: "req-old",
        toolName: null,
        permission: null,
        resource: null,
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const setPendingChildApproval = vi.fn();
    const handlers = createChildHandlers(makeRun({ setPendingChildApproval }));

    handlers.onChildApprovalRequested?.("child-B", "req-new", {});

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("Overwriting");
    // Still overwrites the single slot (single-slot semantics, per TODO #23).
    expect(setPendingChildApproval).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("does not warn when the same request is re-delivered", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockStoreState.pendingChildApproval = {
      "parent-1": {
        childSessionId: "child-A",
        requestId: "req-1",
        toolName: null,
        permission: null,
        resource: null,
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const handlers = createChildHandlers(makeRun());

    handlers.onChildApprovalRequested?.("child-A", "req-1", {});

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("createChildHandlers — onSubAgentCompleted (stale-prompt clear)", () => {
  it("clears a pending approval that belongs to the completing child", () => {
    mockStoreState.pendingChildApproval = {
      "parent-1": {
        childSessionId: "child-9",
        requestId: "req-42",
        toolName: null,
        permission: null,
        resource: null,
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const clearPendingChildApproval = vi.fn();
    const handlers = createChildHandlers(makeRun({ clearPendingChildApproval }));

    handlers.onSubAgentCompleted?.("parent-1", "child-9", "completed", undefined);

    expect(clearPendingChildApproval).toHaveBeenCalledTimes(1);
    expect(clearPendingChildApproval).toHaveBeenCalledWith("parent-1");
  });

  it("clears on an errored terminal status too", () => {
    mockStoreState.pendingChildApproval = {
      "parent-1": {
        childSessionId: "child-9",
        requestId: "req-42",
        toolName: null,
        permission: null,
        resource: null,
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const clearPendingChildApproval = vi.fn();
    const handlers = createChildHandlers(makeRun({ clearPendingChildApproval }));

    handlers.onSubAgentCompleted?.("parent-1", "child-9", "error", "boom");

    expect(clearPendingChildApproval).toHaveBeenCalledTimes(1);
    expect(clearPendingChildApproval).toHaveBeenCalledWith("parent-1");
  });

  it("does NOT clear a pending approval belonging to a different child", () => {
    mockStoreState.pendingChildApproval = {
      "parent-1": {
        childSessionId: "child-OTHER",
        requestId: "req-42",
        toolName: null,
        permission: null,
        resource: null,
        receivedAt: "2026-01-01T00:00:00.000Z",
      },
    };
    const clearPendingChildApproval = vi.fn();
    const handlers = createChildHandlers(makeRun({ clearPendingChildApproval }));

    handlers.onSubAgentCompleted?.("parent-1", "child-9", "completed", undefined);

    expect(clearPendingChildApproval).not.toHaveBeenCalled();
  });

  it("is a no-op when there is no pending approval", () => {
    const clearPendingChildApproval = vi.fn();
    const handlers = createChildHandlers(makeRun({ clearPendingChildApproval }));

    handlers.onSubAgentCompleted?.("parent-1", "child-9", "completed", undefined);

    expect(clearPendingChildApproval).not.toHaveBeenCalled();
  });
});
