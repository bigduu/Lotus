import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountStreamHandlers, ChangeEvent, SubagentSnapshotResponse } from "./AgentService";

// Capture the handlers passed to subscribeToAccountStream so the test can drive
// the feed without a real EventSource.
let captured: AccountStreamHandlers | null = null;
const closeSpy = vi.fn();
const getSubagentSnapshot = vi.fn<() => Promise<SubagentSnapshotResponse>>();

// Controls the mocked selectShouldObserve (true = this device already observes
// the run, i.e. driver / already-subscribed; false = passive viewer).
let shouldObserveValue = false;

const storeActions = {
  chats: [] as Array<{ id: string; parentSessionId?: string | null }>,
  executionBySession: {} as Record<string, { children: { byId: Record<string, unknown> } }>,
  currentSessionId: null as string | null,
  refreshSessionsIndex: vi.fn().mockResolvedValue(undefined),
  refreshChatsNow: vi.fn().mockResolvedValue(undefined),
  applyServerTitle: vi.fn(),
  applyServerPinned: vi.fn(),
  setAgentAvailability: vi.fn(),
  reconcileOpenSession: vi.fn(),
  enqueuePendingChildApproval: vi.fn(),
  dequeuePendingChildApproval: vi.fn(),
  clearPendingChildApprovalsForChild: vi.fn(),
  applyChildProgress: vi.fn(),
  clearChildProgress: vi.fn(),
  replaceSubagentSnapshot: vi.fn(),
};

vi.mock("./AgentService", () => ({
  AgentClient: {
    getInstance: () => ({
      subscribeToAccountStream: (handlers: AccountStreamHandlers) => {
        captured = handlers;
        return { close: closeSpy } as unknown as EventSource;
      },
      getSubagentSnapshot,
    }),
  },
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: { getState: () => storeActions },
  selectShouldObserve: () => () => shouldObserveValue,
}));

import { startAccountFeed, stopAccountFeed } from "./accountFeed";

const change = (seq: number, event: ChangeEvent["event"]): ChangeEvent => ({
  seq,
  ts: "2026-05-31T00:00:00Z",
  session_id: event.session_id,
  event,
});

const snapshot = (
  snapshotSeq = 0,
  overrides: Partial<SubagentSnapshotResponse> = {},
): SubagentSnapshotResponse => ({
  schema_version: 1,
  snapshot_seq: snapshotSeq,
  approvals_revision: 0,
  generated_at: "2026-05-31T00:00:00Z",
  approvals: [],
  children: [],
  ...overrides,
});

const startAndHydrate = async (): Promise<void> => {
  startAccountFeed();
  await vi.waitFor(() => expect(storeActions.replaceSubagentSnapshot).toHaveBeenCalledTimes(1));
  // Snapshot hydration itself refreshes the persisted session index. Most
  // legacy assertions below concern the later change event, so reset that
  // orthogonal call after the barrier opens.
  storeActions.refreshSessionsIndex.mockClear();
};

describe("accountFeed runner", () => {
  beforeEach(() => {
    // The runner guards on a browser EventSource; provide a stub global.
    (globalThis as Record<string, unknown>).EventSource = class {};
    captured = null;
    closeSpy.mockReset();
    Object.values(storeActions).forEach((s) => {
      if (typeof (s as { mockReset?: () => void })?.mockReset === "function") {
        (s as { mockReset: () => void }).mockReset();
      }
    });
    storeActions.currentSessionId = null;
    storeActions.chats = [];
    storeActions.executionBySession = {};
    shouldObserveValue = false;
    getSubagentSnapshot.mockReset();
    getSubagentSnapshot.mockResolvedValue(snapshot());
    storeActions.refreshSessionsIndex.mockResolvedValue(undefined);
    storeActions.refreshChatsNow.mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    stopAccountFeed();
    vi.useRealTimers();
  });

  it("applies title and pinned events directly to the store", async () => {
    await startAndHydrate();
    expect(captured).not.toBeNull();

    captured!.onChange(
      change(1, {
        type: "session_title_updated",
        session_id: "s1",
        title: "Renamed",
        title_version: 3,
      }),
    );
    expect(storeActions.applyServerTitle).toHaveBeenCalledWith("s1", "Renamed", 3);

    captured!.onChange(
      change(2, {
        type: "session_pinned_updated",
        session_id: "s1",
        pinned: true,
        updated_at: "2026-05-31T00:00:01Z",
      }),
    );
    expect(storeActions.applyServerPinned).toHaveBeenCalledWith("s1", true, "2026-05-31T00:00:01Z");
  });

  it("routes versioned child approval outcomes by payload parent id", async () => {
    await startAndHydrate();
    const pending = {
      type: "child_approval_changed" as const,
      session_id: "child-1",
      parent_session_id: "parent-1",
      child_session_id: "child-1",
      request_id: "request-1",
      version: 1,
      status: "pending",
      tool_name: "Bash",
      permission: "execute",
      resource: "npm test",
    };
    captured!.onChange(change(20, pending));
    expect(storeActions.enqueuePendingChildApproval).toHaveBeenCalledWith("parent-1", {
      childSessionId: "child-1",
      requestId: "request-1",
      toolName: "Bash",
      permission: "execute",
      resource: "npm test",
    });

    captured!.onChange(change(21, { ...pending, version: 2, status: "approved" }));
    expect(storeActions.dequeuePendingChildApproval).toHaveBeenCalledWith("parent-1", "request-1");

    captured!.onChange(change(22, { ...pending, version: 1, status: "denied" }));
    expect(storeActions.dequeuePendingChildApproval).toHaveBeenCalledTimes(1);
  });

  it("removes an actionable prompt once the durable decision is recorded", async () => {
    await startAndHydrate();
    captured!.onChange(
      change(23, {
        type: "child_approval_changed",
        parent_session_id: "parent-1",
        child_session_id: "child-1",
        child_attempt: 1,
        request_id: "request-recorded",
        version: 2,
        status: "decision_recorded",
      }),
    );

    expect(storeActions.dequeuePendingChildApproval).toHaveBeenCalledWith(
      "parent-1",
      "request-recorded",
    );
  });

  it("replays lifecycle completion and a later child retry without stale progress", async () => {
    await startAndHydrate();
    storeActions.executionBySession = {
      "parent-1": { children: { byId: { "child-1": { status: "running" } } } },
    };

    captured!.onChange(
      change(24, {
        type: "sub_agent_completed",
        parent_session_id: "parent-1",
        child_session_id: "child-1",
        status: "error",
        error: "worker exited",
      }),
    );
    captured!.onChange(
      change(25, {
        type: "execution_started",
        session_id: "child-1",
        run_id: "retry-1",
        started_at: "2026-05-31T00:00:02Z",
      }),
    );

    expect(storeActions.clearPendingChildApprovalsForChild).toHaveBeenCalledWith(
      "parent-1",
      "child-1",
    );
    expect(storeActions.applyChildProgress).toHaveBeenNthCalledWith(1, "parent-1", "child-1", {
      status: "error",
      error: "worker exited",
      lastEventAt: "2026-05-31T00:00:00Z",
    });
    expect(storeActions.applyChildProgress).toHaveBeenNthCalledWith(2, "parent-1", "child-1", {
      status: "running",
      error: undefined,
      lastEventAt: "2026-05-31T00:00:02Z",
    });
  });

  it("debounces a session-index refresh for coarse change events", async () => {
    await startAndHydrate();
    vi.useFakeTimers();

    captured!.onChange(change(1, { type: "session_created", session_id: "s1" }));
    captured!.onChange(change(2, { type: "message_appended", session_id: "s1" }));
    captured!.onChange(change(3, { type: "session_deleted", session_id: "s2" }));

    // Debounced: not yet called.
    expect(storeActions.refreshSessionsIndex).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(storeActions.refreshSessionsIndex).toHaveBeenCalledTimes(1);
  });

  it("reconciles the OPEN session on a content change driven elsewhere (multi-device)", async () => {
    storeActions.currentSessionId = "s1";
    await startAndHydrate();

    // A message appended to the open session on another device.
    captured!.onChange(change(5, { type: "message_appended", session_id: "s1" }));

    expect(storeActions.reconcileOpenSession).toHaveBeenCalledWith("s1", "message_appended");
  });

  it("does NOT reconcile when the changed session is not the open one", async () => {
    storeActions.currentSessionId = "open-session";
    await startAndHydrate();

    captured!.onChange(change(6, { type: "message_appended", session_id: "other-session" }));
    captured!.onChange(change(7, { type: "complete", session_id: "other-session" }));

    expect(storeActions.reconcileOpenSession).not.toHaveBeenCalled();
  });

  it("engages live observation (refreshChatsNow) when a run starts on the open session and we are passive", async () => {
    storeActions.currentSessionId = "s1";
    shouldObserveValue = false; // passive viewer, not yet observing

    await startAndHydrate();
    captured!.onChange(change(10, { type: "execution_started", session_id: "s1", run_id: "r1" }));

    // Immediate (un-debounced) so the summary flips phase->running and the agent
    // subscription engages for live tokens.
    expect(storeActions.refreshChatsNow).toHaveBeenCalledTimes(1);
  });

  it("does NOT force-observe when already observing the run (driver / already subscribed)", async () => {
    storeActions.currentSessionId = "s1";
    shouldObserveValue = true; // already observing

    await startAndHydrate();
    captured!.onChange(change(11, { type: "execution_started", session_id: "s1", run_id: "r1" }));

    expect(storeActions.refreshChatsNow).not.toHaveBeenCalled();
  });

  it("does NOT force-observe for a run starting on a non-open session", async () => {
    storeActions.currentSessionId = "open";
    shouldObserveValue = false;

    await startAndHydrate();
    captured!.onChange(
      change(12, { type: "execution_started", session_id: "other", run_id: "r1" }),
    );

    expect(storeActions.refreshChatsNow).not.toHaveBeenCalled();
  });

  it("does NOT reconcile for list-only events even on the open session", async () => {
    storeActions.currentSessionId = "s1";
    await startAndHydrate();

    captured!.onChange(
      change(8, { type: "session_title_updated", session_id: "s1", title: "x", title_version: 1 }),
    );
    captured!.onChange(
      change(9, { type: "session_pinned_updated", session_id: "s1", pinned: true }),
    );

    expect(storeActions.reconcileOpenSession).not.toHaveBeenCalled();
  });

  it("persists the resume cursor and marks availability on each change", async () => {
    await startAndHydrate();
    captured!.onChange(change(7, { type: "session_created", session_id: "s1" }));

    expect(localStorage.getItem("lotus_account_feed_cursor_v1")).toBe("7");
    expect(storeActions.setAgentAvailability).toHaveBeenCalledWith(true);
  });

  it("replaces from an advanced-cursor snapshot then replays only events above its watermark", async () => {
    localStorage.setItem("lotus_account_feed_cursor_v1", "42");
    let resolveSnapshot!: (value: SubagentSnapshotResponse) => void;
    getSubagentSnapshot.mockImplementationOnce(
      () =>
        new Promise<SubagentSnapshotResponse>((resolve) => {
          resolveSnapshot = resolve;
        }),
    );

    startAccountFeed();
    const approvalEvent = {
      type: "child_approval_changed" as const,
      parent_session_id: "parent-1",
      child_session_id: "child-1",
      child_attempt: 3,
      request_id: "request-1",
      version: 1,
      status: "pending",
      tool_name: "Bash",
      permission: "execute",
      resource: "cargo test",
    };
    captured!.onChange(change(49, approvalEvent));
    captured!.onChange(change(51, { ...approvalEvent, version: 2, status: "approved" }));

    const authoritative = snapshot(50, {
      approvals_revision: 7,
      approvals: [
        {
          parent_session_id: "parent-1",
          child_session_id: "child-1",
          child_attempt: 3,
          request_id: "request-1",
          tool_name: "Bash",
          permission: "execute",
          resource: "cargo test",
          created_at: "2026-05-31T00:00:00Z",
          updated_at: "2026-05-31T00:00:00Z",
          version: 1,
          state: "pending",
        },
      ],
    });
    resolveSnapshot(authoritative);

    await vi.waitFor(() =>
      expect(storeActions.replaceSubagentSnapshot).toHaveBeenCalledWith(authoritative),
    );
    expect(storeActions.enqueuePendingChildApproval).not.toHaveBeenCalled();
    expect(storeActions.dequeuePendingChildApproval).toHaveBeenCalledTimes(1);
    expect(storeActions.dequeuePendingChildApproval).toHaveBeenCalledWith("parent-1", "request-1");
    expect(localStorage.getItem("lotus_account_feed_cursor_v1")).toBe("51");
  });

  it("clears the cursor and full-resyncs on feed_reset", async () => {
    localStorage.setItem("lotus_account_feed_cursor_v1", "42");
    getSubagentSnapshot.mockResolvedValueOnce(snapshot(10)).mockResolvedValueOnce(snapshot(20));
    await startAndHydrate();

    captured!.onReset?.();
    await vi.waitFor(() => expect(getSubagentSnapshot).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(localStorage.getItem("lotus_account_feed_cursor_v1")).toBe("20"));
    expect(storeActions.replaceSubagentSnapshot).toHaveBeenCalledTimes(2);
  });

  it("rehydrates from a new watermark after transport reconnect", async () => {
    getSubagentSnapshot.mockResolvedValueOnce(snapshot(10)).mockResolvedValueOnce(snapshot(20));
    await startAndHydrate();

    captured!.onOpen?.();
    captured!.onError?.();
    captured!.onOpen?.();

    await vi.waitFor(() => expect(getSubagentSnapshot).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(localStorage.getItem("lotus_account_feed_cursor_v1")).toBe("20"));
    expect(storeActions.replaceSubagentSnapshot).toHaveBeenCalledTimes(2);
  });

  it("toggles availability on connection open/error", async () => {
    await startAndHydrate();
    captured!.onOpen?.();
    expect(storeActions.setAgentAvailability).toHaveBeenLastCalledWith(true);
    captured!.onError?.();
    expect(storeActions.setAgentAvailability).toHaveBeenLastCalledWith(false);
  });
});
