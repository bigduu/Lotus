import { describe, expect, it, vi } from "vitest";

import { createStore, type StoreApi } from "zustand/vanilla";

import type { AgentEvent, SessionSummary } from "@services/chat/AgentService";
import {
  applyExecutionEvent,
  createExecutionStateSlice,
  createInitialExecutionState,
  isBusyPhase,
  isInputLockedPhase,
  isCancellablePhase,
  type ExecutionMap,
  type ExecutionPhase,
  type ExecutionStateSlice,
} from "../slices/executionStateSlice";
import { deriveSidebarRunState } from "../selectors/executionSelectors";

// =============================================================================
// Phase 0 reducer tests — see plan §E.1.
// These tests target the pure reducer (no Zustand store) so each transition
// can be asserted in isolation. The reducer is invoked with a frozen `now()`
// fixture so timestamps are deterministic.
// =============================================================================

const SESSION = "session-1";

const fixedNow = (iso: string) => () => iso;

const T0 = "2026-05-02T10:00:00.000Z";
const T1 = "2026-05-02T10:00:00.500Z";
const T2 = "2026-05-02T10:00:01.000Z";
const T3 = "2026-05-02T10:00:01.500Z";
const T_AFTER_5S = "2026-05-02T10:00:06.000Z";
const T_AFTER_30S = "2026-05-02T10:00:31.000Z";

const seedIdle = (sessionId: string = SESSION): ExecutionMap => ({
  [sessionId]: createInitialExecutionState(sessionId),
});

describe("executionStateSlice — Zustand no-op notifications", () => {
  it("does not notify subscribers when an action resolves to a reducer no-op", () => {
    const store = createExecutionTestStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.getState().markSettleTimeout(SESSION);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("notifies once for markStreamStarted and treats repeated calls as no-ops", () => {
    const store = createExecutionTestStore();
    store.getState().markOptimisticStart(SESSION);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.getState().markStreamStarted(SESSION, 1);
    store.getState().markStreamStarted(SESSION, 1);
    store.getState().markStreamStarted(SESSION, 1);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState().executionBySession[SESSION].phase).toBe("streaming");
    expect(store.getState().executionBySession[SESSION].stream.hasTokens).toBe(true);
    unsubscribe();
  });

  it("does not notify subscribers when applyChildProgress resolves to an identical patch", () => {
    const store = createExecutionTestStore();
    store.getState().applyChildProgress(SESSION, "child-1", {
      status: "running",
      roundCount: 1,
      outputPreview: "hello",
      lastHeartbeatAt: T1,
      lastEventAt: T1,
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.getState().applyChildProgress(SESSION, "child-1", {
      status: "running",
      roundCount: 1,
      outputPreview: "hello",
      lastHeartbeatAt: T1,
      lastEventAt: T1,
    });

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

const startSession = (sessionId: string = SESSION): ExecutionMap => {
  return applyExecutionEvent(
    seedIdle(sessionId),
    { type: "markOptimisticStart", sessionId },
    fixedNow(T0),
  );
};

const createExecutionTestStore = (): StoreApi<ExecutionStateSlice> => {
  const sliceCreator = createExecutionStateSlice as unknown as (
    set: StoreApi<ExecutionStateSlice>["setState"],
    get: StoreApi<ExecutionStateSlice>["getState"],
    api: StoreApi<ExecutionStateSlice>,
  ) => ExecutionStateSlice;
  return createStore<ExecutionStateSlice>()((set, get, api) => sliceCreator(set, get, api));
};

const summary = (overrides: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    id: SESSION,
    kind: "root",
    title: "Session",
    pinned: false,
    root_session_id: SESSION,
    spawn_depth: 0,
    model: "test-model",
    created_at: T0,
    updated_at: T0,
    last_activity_at: T0,
    message_count: 0,
    has_attachments: false,
    is_running: false,
    ...overrides,
  }) as SessionSummary;

const tokenEvent: AgentEvent = { type: "token", content: "Hello" };

describe("executionStateSlice — applyExecutionEvent", () => {
  it("idle + markOptimisticStart → starting with bumped generation and reset stream", () => {
    // §E.1.1
    const next = applyExecutionEvent(
      seedIdle(),
      { type: "markOptimisticStart", sessionId: SESSION },
      fixedNow(T0),
    );

    const entry = next[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("starting");
    expect(entry.generation).toBe(1);
    expect(entry.timestamps.optimisticAt).toBe(T0);
    expect(entry.error).toBeNull();
    expect(entry.stream.tokenCount).toBe(0);
    expect(entry.stream.activeToolCalls).toHaveLength(0);
    expect(entry.activeReasons).toContain("optimistic:send");
  });

  it("starting + markStreamStarted → streaming with coarse token marker and firstTokenAt", () => {
    // §E.1.2
    const after = applyExecutionEvent(
      startSession(),
      { type: "markStreamStarted", sessionId: SESSION, generation: 1 },
      fixedNow(T1),
    );

    const entry = after[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("streaming");
    expect(entry.stream.hasTokens).toBe(true);
    expect(entry.stream.tokenCount).toBe(1);
    expect(entry.timestamps.firstTokenAt).toBe(T1);
    expect(entry.confidence).toBe("live");
  });

  it("streaming + tool_start → running_tools with one active call", () => {
    // §E.1.3
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
      fixedNow(T1),
    );

    const toolStart: AgentEvent = {
      type: "tool_start",
      tool_call_id: "call-1",
      tool_name: "Read",
    };
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: toolStart, generation: 1 },
      fixedNow(T2),
    );

    const entry = map[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("running_tools");
    expect(entry.stream.activeToolCalls).toHaveLength(1);
    expect(entry.stream.activeToolCalls[0].toolCallId).toBe("call-1");
    expect(entry.stream.activeToolCalls[0].toolName).toBe("Read");
  });

  it("running_tools + final tool_complete → back to streaming when tokens flowed", () => {
    // §E.1.4
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
      fixedNow(T1),
    );
    const toolStart: AgentEvent = {
      type: "tool_start",
      tool_call_id: "call-1",
      tool_name: "Read",
    };
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: toolStart, generation: 1 },
      fixedNow(T2),
    );

    const toolComplete: AgentEvent = {
      type: "tool_complete",
      tool_call_id: "call-1",
    };
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: toolComplete, generation: 1 },
      fixedNow(T3),
    );

    const entry = map[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("streaming");
    expect(entry.stream.activeToolCalls).toHaveLength(0);
  });

  it("concurrent tool_starts then progressive tool_completes track active count", () => {
    // §E.1.5
    let map = startSession();
    const toolStartA: AgentEvent = {
      type: "tool_start",
      tool_call_id: "call-a",
      tool_name: "ToolA",
    };
    const toolStartB: AgentEvent = {
      type: "tool_start",
      tool_call_id: "call-b",
      tool_name: "ToolB",
    };
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: toolStartA, generation: 1 },
      fixedNow(T1),
    );
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: toolStartB, generation: 1 },
      fixedNow(T2),
    );
    expect(map[SESSION].stream.activeToolCalls).toHaveLength(2);
    expect(map[SESSION].phase).toBe<ExecutionPhase>("running_tools");

    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "tool_complete", tool_call_id: "call-a" },
        generation: 1,
      },
      fixedNow(T3),
    );
    expect(map[SESSION].stream.activeToolCalls).toHaveLength(1);
    expect(map[SESSION].phase).toBe<ExecutionPhase>("running_tools");
    expect(map[SESSION].stream.activeToolCalls[0].toolCallId).toBe("call-b");

    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "tool_complete", tool_call_id: "call-b" },
        generation: 1,
      },
      fixedNow(T3),
    );
    expect(map[SESSION].stream.activeToolCalls).toHaveLength(0);
    expect(map[SESSION].phase).toBe<ExecutionPhase>("running");
  });

  it("streaming + sub_agent_started → running_children with runningCount=1", () => {
    // §E.1.6
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
      fixedNow(T1),
    );

    const sub: AgentEvent = {
      type: "sub_agent_started",
      child_session_id: "child-1",
      title: "Child",
    };
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: sub, generation: 1 },
      fixedNow(T2),
    );

    const entry = map[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("running_children");
    expect(entry.children.runningCount).toBe(1);
    expect(entry.children.byId["child-1"].title).toBe("Child");
    expect(entry.children.byId["child-1"].status).toBe("running");
  });

  it("running_children + sub_agent_completed → returns to streaming when tokens still flowing", () => {
    // §E.1.7
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
      fixedNow(T1),
    );
    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "sub_agent_started", child_session_id: "child-1" },
        generation: 1,
      },
      fixedNow(T2),
    );

    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: {
          type: "sub_agent_completed",
          child_session_id: "child-1",
          status: "completed",
        },
        generation: 1,
      },
      fixedNow(T3),
    );

    const entry = map[SESSION];
    expect(entry.children.runningCount).toBe(0);
    expect(entry.phase).toBe<ExecutionPhase>("streaming");
  });

  it("streaming + need_clarification → waiting_user_answer with respondMode set", () => {
    // §E.1.8
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
      fixedNow(T1),
    );

    const ask: AgentEvent = {
      type: "need_clarification",
      question: "Which file?",
      options: ["a.ts", "b.ts"],
      allow_custom: true,
      tool_call_id: "ask-1",
    };
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: ask, generation: 1 },
      fixedNow(T2),
    );

    const entry = map[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("waiting_user_answer");
    expect(entry.interaction.pendingQuestion).not.toBeNull();
    expect(entry.interaction.pendingQuestion?.question).toBe("Which file?");
    expect(entry.interaction.pendingQuestion?.options).toEqual(["a.ts", "b.ts"]);
    expect(entry.interaction.pendingQuestion?.allowCustom).toBe(true);
    expect(entry.interaction.respondMode).toBeNull();
  });

  it("waiting_user_answer + markRespondStart clears stale summary state and derives running", () => {
    // §E.1.9
    let map = startSession();
    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "need_clarification", question: "Which?" },
        generation: 1,
      },
      fixedNow(T1),
    );
    map = applyExecutionEvent(
      map,
      {
        type: "applySessionSummary",
        sessionId: SESSION,
        summary: summary({ is_running: true, has_pending_question: true }),
      },
      fixedNow(T1),
    );

    expect(deriveSidebarRunState(map[SESSION])).toBe("awaiting");

    map = applyExecutionEvent(map, { type: "markRespondStart", sessionId: SESSION }, fixedNow(T2));

    const entry = map[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("starting");
    expect(entry.generation).toBe(2);
    expect(entry.interaction.pendingQuestion).toBeNull();
    expect(entry.interaction.respondMode).toBeNull();
    expect(entry.backend.hasPendingQuestion).toBe(false);
    expect(deriveSidebarRunState(entry)).toBe("running");
    expect(entry.activeReasons).toContain("optimistic:respond");
  });

  it("authoritative endpoint clear resumes a cross-device waiting session and a later prompt restores awaiting", () => {
    let map = startSession();
    map = applyExecutionEvent(
      map,
      {
        type: "setPendingQuestion",
        sessionId: SESSION,
        payload: {
          question: "Approve?",
          options: ["Approve", "Deny"],
          allowCustom: false,
          toolCallId: "permission-1",
        },
      },
      fixedNow(T1),
    );

    map = applyExecutionEvent(
      map,
      {
        type: "applySessionSummary",
        sessionId: SESSION,
        summary: summary({ is_running: true, has_pending_question: true }),
      },
      fixedNow(T2),
    );
    map = applyExecutionEvent(
      map,
      { type: "clearPendingQuestion", sessionId: SESSION },
      fixedNow(T2),
    );

    expect(map[SESSION].phase).toBe<ExecutionPhase>("running");
    expect(map[SESSION].interaction.pendingQuestion).toBeNull();
    expect(map[SESSION].backend.hasPendingQuestion).toBe(false);
    expect(deriveSidebarRunState(map[SESSION])).toBe("running");

    map = applyExecutionEvent(
      map,
      {
        type: "setPendingQuestion",
        sessionId: SESSION,
        payload: {
          question: "Approve again?",
          options: ["Approve", "Deny"],
          allowCustom: false,
          toolCallId: "permission-2",
        },
      },
      fixedNow(T3),
    );

    expect(deriveSidebarRunState(map[SESSION])).toBe("awaiting");
  });

  it("an unknown summary pending state preserves a real prompt", () => {
    let map = seedIdle();
    map = applyExecutionEvent(
      map,
      {
        type: "setPendingQuestion",
        sessionId: SESSION,
        payload: {
          question: "Still waiting?",
          options: [],
          allowCustom: true,
          toolCallId: "question-2",
        },
      },
      fixedNow(T1),
    );

    map = applyExecutionEvent(
      map,
      {
        type: "applySessionSummary",
        sessionId: SESSION,
        summary: summary({ is_running: true, has_pending_question: undefined }),
      },
      fixedNow(T2),
    );

    expect(map[SESSION].phase).toBe<ExecutionPhase>("waiting_user_answer");
    expect(map[SESSION].interaction.pendingQuestion?.question).toBe("Still waiting?");
    expect(deriveSidebarRunState(map[SESSION])).toBe("awaiting");
  });

  it("duplicate setPendingQuestion payload is idempotent even with a fresh options array", () => {
    let map = seedIdle();
    const payload = {
      question: "Which file?",
      options: ["a.ts", "b.ts"],
      allowCustom: true,
      toolCallId: "ask-1",
    };

    map = applyExecutionEvent(
      map,
      { type: "setPendingQuestion", sessionId: SESSION, payload },
      fixedNow(T1),
    );

    const next = applyExecutionEvent(
      map,
      {
        type: "setPendingQuestion",
        sessionId: SESSION,
        payload: { ...payload, options: [...payload.options] },
      },
      fixedNow(T2),
    );

    expect(next).toBe(map);
    expect(next[SESSION].interaction.pendingQuestion?.receivedAt).toBe(T1);
  });

  it("updates a replayed permission request when its revision or allowed actions change", () => {
    let map = seedIdle();
    const base = {
      question: "Approve?",
      options: ["allow_once"],
      allowCustom: false,
      toolCallId: "ask-permission",
      permissionRequest: {
        requestId: "request-1",
        policyRevision: 1,
        allowedDecisions: [{ id: "allow_once" }],
        suggestedMatchers: [],
      },
    };
    map = applyExecutionEvent(
      map,
      { type: "setPendingQuestion", sessionId: SESSION, payload: base },
      fixedNow(T1),
    );
    const next = applyExecutionEvent(
      map,
      {
        type: "setPendingQuestion",
        sessionId: SESSION,
        payload: {
          ...base,
          options: ["allow_once", "deny_once"],
          permissionRequest: {
            ...base.permissionRequest,
            policyRevision: 2,
            allowedDecisions: [{ id: "allow_once" }, { id: "deny_once" }],
          },
        },
      },
      fixedNow(T2),
    );
    expect(next).not.toBe(map);
    expect(next[SESSION].interaction.pendingQuestion?.receivedAt).toBe(T2);
    expect(next[SESSION].interaction.pendingQuestion?.permissionRequest?.policyRevision).toBe(2);
  });

  it("enqueuePendingChildApproval stores the request without changing phase; dequeue removes it", () => {
    let map = seedIdle();
    const payload = {
      childSessionId: "child-9",
      requestId: "req-42",
      toolName: "Bash",
      permission: "execute",
      resource: "rm -rf /tmp/x",
    };

    map = applyExecutionEvent(
      map,
      { type: "enqueuePendingChildApproval", sessionId: SESSION, payload },
      fixedNow(T1),
    );

    const afterSet = map[SESSION];
    // Out-of-band approval does not move the parent off its current phase.
    expect(afterSet.phase).toBe<ExecutionPhase>("idle");
    expect(afterSet.interaction.pendingChildApprovals).toHaveLength(1);
    expect(afterSet.interaction.pendingChildApprovals[0].childSessionId).toBe("child-9");
    expect(afterSet.interaction.pendingChildApprovals[0].requestId).toBe("req-42");
    expect(afterSet.interaction.pendingChildApprovals[0].receivedAt).toBe(T1);

    // Duplicate payload is a no-op (returns the same map reference).
    const dup = applyExecutionEvent(
      map,
      { type: "enqueuePendingChildApproval", sessionId: SESSION, payload: { ...payload } },
      fixedNow(T2),
    );
    expect(dup).toBe(map);

    map = applyExecutionEvent(
      map,
      { type: "dequeuePendingChildApproval", sessionId: SESSION, requestId: "req-42" },
      fixedNow(T3),
    );
    expect(map[SESSION].interaction.pendingChildApprovals).toEqual([]);
  });

  // ===========================================================================
  // Child-approval FIFO queue (#25) — was a single-slot pendingChildApproval
  // that a second concurrent request from sub-agent fan-out would silently
  // overwrite (TODO #23). See also childHandlers.test.ts for the SSE-glue
  // layer (enqueue-on-request / clear-on-lifecycle) built on top of this.
  // ===========================================================================
  describe("child-approval FIFO queue (#25)", () => {
    const payloadFor = (requestId: string, childSessionId: string) => ({
      childSessionId,
      requestId,
      toolName: "Bash",
      permission: "execute",
      resource: null,
    });

    it("retains BOTH concurrent approvals from different requestIds (FIFO, not overwritten)", () => {
      let map = seedIdle();
      map = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-1", "child-A"),
        },
        fixedNow(T1),
      );
      map = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-2", "child-B"),
        },
        fixedNow(T2),
      );

      const queue = map[SESSION].interaction.pendingChildApprovals;
      expect(queue).toHaveLength(2);
      expect(queue.map((a) => a.requestId)).toEqual(["req-1", "req-2"]);
      expect(queue[0].childSessionId).toBe("child-A");
      expect(queue[1].childSessionId).toBe("child-B");
    });

    it("answering the head pops it and surfaces the next queued entry", () => {
      let map = seedIdle();
      map = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-1", "child-A"),
        },
        fixedNow(T1),
      );
      map = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-2", "child-B"),
        },
        fixedNow(T2),
      );

      map = applyExecutionEvent(
        map,
        { type: "dequeuePendingChildApproval", sessionId: SESSION, requestId: "req-1" },
        fixedNow(T3),
      );

      const queue = map[SESSION].interaction.pendingChildApprovals;
      expect(queue).toHaveLength(1);
      expect(queue[0].requestId).toBe("req-2");
    });

    it("a duplicate requestId delivery (reconnect/replay) is not double-enqueued", () => {
      let map = seedIdle();
      map = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-1", "child-A"),
        },
        fixedNow(T1),
      );
      const afterFirst = map;

      map = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-1", "child-A"),
        },
        fixedNow(T2),
      );

      // Identical re-delivery of the same still-pending request is a true no-op.
      expect(map).toBe(afterFirst);
      expect(map[SESSION].interaction.pendingChildApprovals).toHaveLength(1);
      // The original arrival time is preserved, not bumped to T2.
      expect(map[SESSION].interaction.pendingChildApprovals[0].receivedAt).toBe(T1);
    });

    it("an answered (dequeued) request is NOT resurrected by a later replay of the same requestId", () => {
      let map = seedIdle();
      map = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-1", "child-A"),
        },
        fixedNow(T1),
      );
      map = applyExecutionEvent(
        map,
        { type: "dequeuePendingChildApproval", sessionId: SESSION, requestId: "req-1" },
        fixedNow(T2),
      );
      expect(map[SESSION].interaction.pendingChildApprovals).toEqual([]);

      // A resync/reconcile replay (bamboo#544 gap-control, #91) can still carry
      // the same requestId in the backend's critical-events window after it was
      // answered. Re-enqueuing it must be a no-op.
      map = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-1", "child-A"),
        },
        fixedNow(T3),
      );

      expect(map[SESSION].interaction.pendingChildApprovals).toEqual([]);
    });

    it("lifecycle-clear (child finished on its own) removes only that child's entries, preserving order for others", () => {
      let map = seedIdle();
      map = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-1", "child-A"),
        },
        fixedNow(T1),
      );
      map = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-2", "child-B"),
        },
        fixedNow(T2),
      );

      map = applyExecutionEvent(
        map,
        {
          type: "clearPendingChildApprovalsForChild",
          sessionId: SESSION,
          childSessionId: "child-A",
        },
        fixedNow(T3),
      );

      const queue = map[SESSION].interaction.pendingChildApprovals;
      expect(queue).toHaveLength(1);
      expect(queue[0].requestId).toBe("req-2");

      // The cleared child's requestId is also tombstoned — a replay of its
      // stale request must not resurrect it either.
      const replayed = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-1", "child-A"),
        },
        fixedNow(T3),
      );
      expect(replayed[SESSION].interaction.pendingChildApprovals.map((a) => a.requestId)).toEqual([
        "req-2",
      ]);
    });

    it("clearPendingChildApprovalsForChild is a no-op when nothing is queued for that child", () => {
      const map = seedIdle();
      const next = applyExecutionEvent(
        map,
        {
          type: "clearPendingChildApprovalsForChild",
          sessionId: SESSION,
          childSessionId: "child-Z",
        },
        fixedNow(T1),
      );
      expect(next).toBe(map);
    });

    it("resync/reconcile replay (applyRunningSnapshot) rebuilds an outstanding approval from criticalEvents", () => {
      const map = seedIdle();
      const next = applyExecutionEvent(
        map,
        {
          type: "applyRunningSnapshot",
          sessions: [
            {
              sessionId: SESSION,
              runId: "run-resync-1",
              criticalEvents: [
                {
                  type: "child_approval_requested",
                  child_session_id: "child-A",
                  request_id: "req-1",
                  tool_name: "Bash",
                  permission: "execute",
                } as AgentEvent,
              ],
            },
          ],
        },
        fixedNow(T1),
      );

      const queue = next[SESSION].interaction.pendingChildApprovals;
      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        childSessionId: "child-A",
        requestId: "req-1",
        toolName: "Bash",
        permission: "execute",
      });
    });

    it("resync/reconcile replay does not resurrect a requestId already answered locally", () => {
      let map = seedIdle();
      map = applyExecutionEvent(
        map,
        {
          type: "enqueuePendingChildApproval",
          sessionId: SESSION,
          payload: payloadFor("req-1", "child-A"),
        },
        fixedNow(T1),
      );
      map = applyExecutionEvent(
        map,
        { type: "dequeuePendingChildApproval", sessionId: SESSION, requestId: "req-1" },
        fixedNow(T2),
      );

      // The backend's critical-events snapshot still carries the (now stale)
      // request — a gap-reconcile replay of it must stay dropped.
      const next = applyExecutionEvent(
        map,
        {
          type: "applyRunningSnapshot",
          sessions: [
            {
              sessionId: SESSION,
              runId: "run-resync-2",
              criticalEvents: [
                {
                  type: "child_approval_requested",
                  child_session_id: "child-A",
                  request_id: "req-1",
                } as AgentEvent,
              ],
            },
          ],
        },
        fixedNow(T3),
      );

      expect(next[SESSION].interaction.pendingChildApprovals).toEqual([]);
    });

    it("resync/reconcile replay clears a queued approval when the same snapshot also carries sub_agent_completed for that child", () => {
      const map = seedIdle();
      const next = applyExecutionEvent(
        map,
        {
          type: "applyRunningSnapshot",
          sessions: [
            {
              sessionId: SESSION,
              runId: "run-resync-3",
              criticalEvents: [
                {
                  type: "child_approval_requested",
                  child_session_id: "child-A",
                  request_id: "req-1",
                } as AgentEvent,
                {
                  type: "sub_agent_completed",
                  child_session_id: "child-A",
                  status: "completed",
                } as AgentEvent,
              ],
            },
          ],
        },
        fixedNow(T1),
      );

      // The child finished (fail-closed denied after its server-side timeout,
      // or otherwise) within the same replay window — the stale prompt must
      // not survive the reconcile.
      expect(next[SESSION].interaction.pendingChildApprovals).toEqual([]);
    });
  });

  it("streaming + complete → settling with terminalAt populated", () => {
    // §E.1.10
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
      fixedNow(T1),
    );
    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "complete" },
        generation: 1,
      },
      fixedNow(T2),
    );

    const entry = map[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("settling");
    expect(entry.timestamps.terminalAt).toBe(T2);
    expect(entry.timestamps.settlingStartedAt).toBe(T2);
  });

  it("idle + complete → stays idle (stray one-shot Complete cannot resurrect a settled session)", () => {
    // Regression: a premature optimistic SSE subscription (e.g. a /goal control
    // command opened before any runner exists) receives a one-shot `Complete`.
    // It must NOT push an idle session into `settling` (→ busy → resubscribe loop).
    let map = seedIdle();
    const before = map[SESSION];
    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "complete" },
        generation: 0,
      },
      fixedNow(T1),
    );

    // No-op: same map reference, phase unchanged.
    expect(map[SESSION]).toBe(before);
    expect(map[SESSION].phase).toBe<ExecutionPhase>("idle");
  });

  it("completed + complete → stays completed (idempotent terminal)", () => {
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: { type: "complete" }, generation: 1 },
      fixedNow(T1),
    );
    map = applyExecutionEvent(
      map,
      {
        type: "applySessionSummary",
        sessionId: SESSION,
        summary: summary({ is_running: false, last_run_status: "completed" }),
      },
      fixedNow(T2),
    );
    expect(map[SESSION].phase).toBe<ExecutionPhase>("completed");

    // A stray late `complete` for the same generation must not reopen the session.
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: { type: "complete" }, generation: 1 },
      fixedNow(T3),
    );
    expect(map[SESSION].phase).toBe<ExecutionPhase>("completed");
  });

  it("settling + applySessionSummary(completed) → completed with settledAt", () => {
    // §E.1.11
    let map = startSession();
    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "complete" },
        generation: 1,
      },
      fixedNow(T1),
    );

    map = applyExecutionEvent(
      map,
      {
        type: "applySessionSummary",
        sessionId: SESSION,
        summary: summary({ is_running: false, last_run_status: "completed" }),
      },
      fixedNow(T2),
    );

    const entry = map[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("completed");
    expect(entry.confidence).toBe("terminal");
    expect(entry.timestamps.settledAt).toBe(T2);
    expect(entry.backend.lastRunStatus).toBe("completed");
  });

  it("streaming + cancelled event → cancelled phase with terminal timestamp", () => {
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
      fixedNow(T1),
    );

    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "cancelled", message: "Agent execution cancelled by user" },
        generation: 1,
      },
      fixedNow(T2),
    );

    const entry = map[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("cancelled");
    expect(entry.timestamps.terminalAt).toBe(T2);
    expect(entry.timestamps.settledAt).toBe(T2);
    expect(entry.error?.source).toBe("user_cancel");
    expect(entry.error?.message).toBe("Agent execution cancelled by user");
  });

  it("streaming + error event → error phase with sse-source error", () => {
    // §E.1.12
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
      fixedNow(T1),
    );

    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "error", message: "boom" },
        generation: 1,
      },
      fixedNow(T2),
    );

    const entry = map[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("error");
    expect(entry.error?.message).toBe("boom");
    expect(entry.error?.source).toBe("sse");
    expect(entry.timestamps.terminalAt).toBe(T2);
  });

  it("applyAgentEvent with stale generation → no state change", () => {
    // §E.1.13
    const map = startSession(); // generation 1
    const next = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 0 },
      fixedNow(T1),
    );

    expect(next).toBe(map);
    expect(next[SESSION].stream.tokenCount).toBe(0);
  });

  it("starting + markSettleTimeout → idle with settledAt", () => {
    // §E.1.14
    const map = startSession();
    const next = applyExecutionEvent(
      map,
      { type: "markSettleTimeout", sessionId: SESSION },
      fixedNow(T_AFTER_30S),
    );

    const entry = next[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("idle");
    expect(entry.activeReasons).toContain("settle:timeout");
    expect(entry.timestamps.settledAt).toBe(T_AFTER_30S);
  });

  it("running + applySessionSummary(is_running=false, status=null) keeps phase within race window, drops to idle after", () => {
    // §E.1.15
    let map = startSession();
    // Promote starting → running by SSE token.
    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: tokenEvent,
        generation: 1,
      },
      fixedNow(T1),
    );

    // Within race window: should not collapse the phase.
    const within = applyExecutionEvent(
      map,
      {
        type: "applySessionSummary",
        sessionId: SESSION,
        summary: summary({ is_running: false, last_run_status: undefined }),
      },
      fixedNow(T1), // same time as last optimistic write — well under 5s
    );
    expect(within[SESSION].phase).toBe<ExecutionPhase>("streaming");

    // Past race window: collapses to idle.
    const past = applyExecutionEvent(
      map,
      {
        type: "applySessionSummary",
        sessionId: SESSION,
        summary: summary({ is_running: false, last_run_status: undefined }),
      },
      fixedNow(T_AFTER_5S),
    );
    expect(past[SESSION].phase).toBe<ExecutionPhase>("idle");
    expect(past[SESSION].activeReasons).toContain("summary:terminal");
  });

  it("idle + applyOneShotTerminal(completed) → completed directly", () => {
    // §E.1.16
    const map = seedIdle();
    const next = applyExecutionEvent(
      map,
      {
        type: "applyOneShotTerminal",
        sessionId: SESSION,
        generation: 0,
        payload: { status: "completed" },
      },
      fixedNow(T0),
    );

    const entry = next[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("completed");
    expect(entry.timestamps.terminalAt).toBe(T0);
    expect(entry.timestamps.settledAt).toBe(T0);
    expect(entry.confidence).toBe("terminal");
  });

  it("starting + applyExecutionStarted → running with backendRunId set", () => {
    // §E.1.17
    const map = startSession();
    const next = applyExecutionEvent(
      map,
      {
        type: "applyExecutionStarted",
        sessionId: SESSION,
        runId: "run-abc",
        generation: 1,
      },
      fixedNow(T1),
    );

    const entry = next[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("running");
    expect(entry.backendRunId).toBe("run-abc");
    expect(entry.timestamps.confirmedAt).toBe(T1);
    expect(entry.confidence).toBe("live");
  });

  it("settling + applyExecutionStarted → running again for the same generation", () => {
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: { type: "complete" }, generation: 1 },
      fixedNow(T1),
    );
    expect(map[SESSION].phase).toBe<ExecutionPhase>("settling");

    const next = applyExecutionEvent(
      map,
      {
        type: "applyExecutionStarted",
        sessionId: SESSION,
        runId: "run-resumed",
        generation: 1,
      },
      fixedNow(T2),
    );

    const entry = next[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("running");
    expect(entry.backendRunId).toBe("run-resumed");
    expect(entry.timestamps.confirmedAt).toBe(T2);
    expect(entry.confidence).toBe("live");
  });

  it("markCancel from any phase → cancelled with terminal confidence", () => {
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
      fixedNow(T1),
    );

    const next = applyExecutionEvent(map, { type: "markCancel", sessionId: SESSION }, fixedNow(T2));

    const entry = next[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("cancelled");
    expect(entry.confidence).toBe("terminal");
    expect(entry.activeReasons).toContain("user:cancel");
    expect(entry.timestamps.settledAt).toBe(T2);
  });

  it("ensureSession is idempotent and creates an idle entry when missing", () => {
    const empty: ExecutionMap = {};
    const created = applyExecutionEvent(
      empty,
      { type: "ensureSession", sessionId: SESSION },
      fixedNow(T0),
    );
    expect(created[SESSION].phase).toBe<ExecutionPhase>("idle");

    // Calling again with same id should return the same map reference.
    const second = applyExecutionEvent(
      created,
      { type: "ensureSession", sessionId: SESSION },
      fixedNow(T0),
    );
    expect(second).toBe(created);
  });

  it("resetSession removes the entry from the map", () => {
    const map = startSession();
    expect(SESSION in map).toBe(true);

    const next = applyExecutionEvent(
      map,
      { type: "resetSession", sessionId: SESSION },
      fixedNow(T1),
    );
    expect(SESSION in next).toBe(false);
  });

  it("clearPendingQuestion treats the endpoint clear as authoritative and converges to idle", () => {
    let map = startSession();
    map = applyExecutionEvent(
      map,
      {
        type: "setPendingQuestion",
        sessionId: SESSION,
        payload: {
          question: "Which?",
          options: [],
          allowCustom: false,
          toolCallId: null,
        },
      },
      fixedNow(T1),
    );
    expect(map[SESSION].interaction.pendingQuestion).not.toBeNull();
    expect(map[SESSION].phase).toBe<ExecutionPhase>("waiting_user_answer");

    map = applyExecutionEvent(
      map,
      { type: "clearPendingQuestion", sessionId: SESSION },
      fixedNow(T2),
    );
    expect(map[SESSION].interaction.pendingQuestion).toBeNull();
    expect(map[SESSION].interaction.respondMode).toBeNull();
    expect(map[SESSION].backend.hasPendingQuestion).toBe(false);
    expect(map[SESSION].phase).toBe<ExecutionPhase>("idle");
  });

  it("tool_token updates the matching active tool call's preview", () => {
    let map = startSession();
    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "tool_start", tool_call_id: "call-x", tool_name: "Bash" },
        generation: 1,
      },
      fixedNow(T1),
    );
    map = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "tool_token", tool_call_id: "call-x", content: "ls -la" },
        generation: 1,
      },
      fixedNow(T2),
    );

    const call = map[SESSION].stream.activeToolCalls[0];
    expect(call.preview).toContain("ls -la");
  });

  it("isBusyPhase recognizes only non-terminal, non-idle phases", () => {
    expect(isBusyPhase("idle")).toBe(false);
    expect(isBusyPhase("completed")).toBe(false);
    expect(isBusyPhase("error")).toBe(false);
    expect(isBusyPhase("cancelled")).toBe(false);
    expect(isBusyPhase("starting")).toBe(true);
    expect(isBusyPhase("running")).toBe(true);
    expect(isBusyPhase("streaming")).toBe(true);
    expect(isBusyPhase("running_tools")).toBe(true);
    expect(isBusyPhase("running_children")).toBe(true);
    expect(isBusyPhase("waiting_user_answer")).toBe(true);
    expect(isBusyPhase("settling")).toBe(true);
  });

  it("isInputLockedPhase recognizes only phases that should lock input", () => {
    expect(isInputLockedPhase("idle")).toBe(false);
    expect(isInputLockedPhase("completed")).toBe(false);
    expect(isInputLockedPhase("error")).toBe(false);
    expect(isInputLockedPhase("cancelled")).toBe(false);
    expect(isInputLockedPhase("waiting_user_answer")).toBe(false);
    expect(isInputLockedPhase("starting")).toBe(true);
    expect(isInputLockedPhase("running")).toBe(true);
    expect(isInputLockedPhase("streaming")).toBe(true);
    expect(isInputLockedPhase("running_tools")).toBe(true);
    expect(isInputLockedPhase("running_children")).toBe(true);
    expect(isInputLockedPhase("settling")).toBe(true);
  });

  it("isCancellablePhase recognizes only phases where cancel makes sense", () => {
    expect(isCancellablePhase("idle")).toBe(false);
    expect(isCancellablePhase("completed")).toBe(false);
    expect(isCancellablePhase("error")).toBe(false);
    expect(isCancellablePhase("cancelled")).toBe(false);
    expect(isCancellablePhase("settling")).toBe(false);
    expect(isCancellablePhase("waiting_user_answer")).toBe(false);
    expect(isCancellablePhase("starting")).toBe(true);
    expect(isCancellablePhase("running")).toBe(true);
    expect(isCancellablePhase("streaming")).toBe(true);
    expect(isCancellablePhase("running_tools")).toBe(true);
    expect(isCancellablePhase("running_children")).toBe(true);
  });

  it("starting + applyAgentEvent(execution_started) → running with backendRunId set (§E.1.17 via SSE)", () => {
    const map = startSession();
    const next = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "execution_started", run_id: "run-sse-123", started_at: T1 },
        generation: 1,
      },
      fixedNow(T1),
    );

    const entry = next[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("running");
    expect(entry.backendRunId).toBe("run-sse-123");
    expect(entry.confidence).toBe("live");
    expect(entry.activeReasons).toContain("sse:execution_started");
  });

  it("running + applyAgentEvent(execution_started) updates backendRunId without changing phase", () => {
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
      fixedNow(T1),
    );
    expect(map[SESSION].phase).toBe<ExecutionPhase>("streaming");

    const next = applyExecutionEvent(
      map,
      {
        type: "applyAgentEvent",
        sessionId: SESSION,
        event: { type: "execution_started", run_id: "run-late", started_at: T2 },
        generation: 1,
      },
      fixedNow(T2),
    );

    const entry = next[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("streaming");
    expect(entry.backendRunId).toBe("run-late");
    expect(entry.confidence).toBe("live");
  });

  it("applyRunningSnapshot promotes idle sessions to running and replays critical events", () => {
    const map = seedIdle();
    const next = applyExecutionEvent(
      map,
      {
        type: "applyRunningSnapshot",
        sessions: [
          {
            sessionId: SESSION,
            runId: "run-snap-1",
            criticalEvents: [
              { type: "sub_agent_started", child_session_id: "child-1", title: "Child" },
            ],
          },
        ],
      },
      fixedNow(T0),
    );

    const entry = next[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("running_children");
    expect(entry.backendRunId).toBe("run-snap-1");
    expect(entry.confidence).toBe("live");
    expect(entry.children.runningCount).toBe(1);
    expect(entry.generation).toBe(1);
  });
});
