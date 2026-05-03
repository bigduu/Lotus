import { describe, expect, it } from "vitest";

import type { AgentEvent, SessionSummary } from "../../services/AgentService";
import {
  applyExecutionEvent,
  createInitialExecutionState,
  isBusyPhase,
  isInputLockedPhase,
  isCancellablePhase,
  type ExecutionMap,
  type ExecutionPhase,
} from "../slices/executionStateSlice";

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

const startSession = (sessionId: string = SESSION): ExecutionMap => {
  return applyExecutionEvent(
    seedIdle(sessionId),
    { type: "markOptimisticStart", sessionId },
    fixedNow(T0),
  );
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

  it("starting + token → streaming with token counts and firstTokenAt", () => {
    // §E.1.2
    const after = applyExecutionEvent(
      startSession(),
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
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

  it("streaming + sub_session_started → running_children with runningCount=1", () => {
    // §E.1.6
    let map = startSession();
    map = applyExecutionEvent(
      map,
      { type: "applyAgentEvent", sessionId: SESSION, event: tokenEvent, generation: 1 },
      fixedNow(T1),
    );

    const sub: AgentEvent = {
      type: "sub_session_started",
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

  it("running_children + sub_session_completed → returns to streaming when tokens still flowing", () => {
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
        event: { type: "sub_session_started", child_session_id: "child-1" },
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
          type: "sub_session_completed",
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
    expect(entry.interaction.respondMode?.sessionId).toBe(SESSION);
    expect(entry.interaction.respondMode?.toolCallId).toBe("ask-1");
  });

  it("waiting_user_answer + markRespondStart → starting with bumped generation and cleared question", () => {
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

    map = applyExecutionEvent(map, { type: "markRespondStart", sessionId: SESSION }, fixedNow(T2));

    const entry = map[SESSION];
    expect(entry.phase).toBe<ExecutionPhase>("starting");
    expect(entry.generation).toBe(2);
    expect(entry.interaction.pendingQuestion).toBeNull();
    expect(entry.interaction.respondMode).toBeNull();
    expect(entry.activeReasons).toContain("optimistic:respond");
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

  it("clearPendingQuestion clears pendingQuestion and respondMode without touching phase", () => {
    let map = startSession();
    map = applyExecutionEvent(
      map,
      {
        type: "setPendingQuestionFromSse",
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
    // clearPendingQuestion does not auto-transition; phase remains.
    expect(map[SESSION].phase).toBe<ExecutionPhase>("waiting_user_answer");
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
              { type: "sub_session_started", child_session_id: "child-1", title: "Child" },
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
