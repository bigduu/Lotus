import { describe, expect, it } from "vitest";

import { createInitialExecutionState } from "../slices/executionStateSlice";
import {
  selectIsStreaming,
  selectIsInputLocked,
  selectCanCancel,
  selectPendingQuestion,
  selectRespondMode,
  selectShouldObserve,
  deriveSidebarRunState,
  selectSidebarRunStateMap,
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

describe("sidebar per-item status indicator (#94)", () => {
  describe("deriveSidebarRunState", () => {
    it("is idle when the session has no execution entry at all", () => {
      expect(deriveSidebarRunState(null)).toBe("idle");
      expect(deriveSidebarRunState(undefined)).toBe("idle");
    });

    it("is idle for idle/completed/error/cancelled phases", () => {
      for (const phase of ["idle", "completed", "error", "cancelled"] as const) {
        const entry = { ...createInitialExecutionState(SESSION), phase };
        expect(deriveSidebarRunState(entry)).toBe("idle");
      }
    });

    it("is running for actively-executing phases", () => {
      for (const phase of [
        "starting",
        "running",
        "streaming",
        "running_tools",
        "running_children",
        "settling",
      ] as const) {
        const entry = { ...createInitialExecutionState(SESSION), phase };
        expect(deriveSidebarRunState(entry)).toBe("running");
      }
    });

    it("is awaiting for the waiting_user_answer phase", () => {
      const entry = {
        ...createInitialExecutionState(SESSION),
        phase: "waiting_user_answer" as const,
      };
      expect(deriveSidebarRunState(entry)).toBe("awaiting");
    });

    it("is awaiting when a pending question is set, even in a busy (not waiting_user_answer) phase", () => {
      const entry = createInitialExecutionState(SESSION);
      entry.phase = "running_tools";
      entry.interaction.pendingQuestion = {
        question: "Continue?",
        options: ["Yes", "No"],
        allowCustom: false,
        toolCallId: "ask-1",
        receivedAt: "2026-07-16T00:00:00.000Z",
      };
      expect(deriveSidebarRunState(entry)).toBe("awaiting");
    });

    it("is awaiting when a pending child approval is set (broader than selectIsAwaitingUser)", () => {
      const entry = createInitialExecutionState(SESSION);
      entry.phase = "running_children";
      entry.interaction.pendingChildApproval = {
        childSessionId: "child-1",
        requestId: "req-1",
        toolName: "bash",
        permission: "execute",
        resource: null,
        receivedAt: "2026-07-16T00:00:00.000Z",
      };
      expect(deriveSidebarRunState(entry)).toBe("awaiting");
    });

    it("is awaiting when the backend summary flag says so, even before SSE catches up", () => {
      const entry = createInitialExecutionState(SESSION);
      entry.phase = "running";
      entry.backend.hasPendingQuestion = true;
      expect(deriveSidebarRunState(entry)).toBe("awaiting");
    });

    it("prioritizes awaiting over a plain busy phase", () => {
      const entry = createInitialExecutionState(SESSION);
      entry.phase = "waiting_user_answer";
      expect(deriveSidebarRunState(entry)).toBe("awaiting");
      expect(deriveSidebarRunState(entry)).not.toBe("running");
    });
  });

  describe("selectSidebarRunStateMap", () => {
    it("is sparse — idle sessions are omitted entirely, not present with value 'idle'", () => {
      const state = createState("idle");
      const map = selectSidebarRunStateMap([SESSION])(state);
      expect(map).toEqual({});
      expect(SESSION in map).toBe(false);
    });

    it("includes only non-idle sessions among the requested ids", () => {
      const state = {
        executionBySession: {
          busy: { ...createInitialExecutionState("busy"), phase: "streaming" as const },
          idle: { ...createInitialExecutionState("idle"), phase: "idle" as const },
        },
        chats: [],
      };
      const map = selectSidebarRunStateMap(["busy", "idle", "missing"])(state);
      expect(map).toEqual({ busy: "running" });
    });

    it("is unaffected by ids outside the requested set — only covers the given sessionIds", () => {
      const state = {
        executionBySession: {
          tracked: { ...createInitialExecutionState("tracked"), phase: "running" as const },
          untracked: { ...createInitialExecutionState("untracked"), phase: "streaming" as const },
        },
        chats: [],
      };
      const map = selectSidebarRunStateMap(["tracked"])(state);
      expect(map).toEqual({ tracked: "running" });
    });

    // This is the property `useShallow` at the call site relies on to avoid
    // cascading sidebar re-renders (#18/#3/#68/#74 precedent): a mutation
    // that does not change any covered session's *derived* status must
    // produce a structurally-equal (shallow-equal) map, even though the
    // underlying `executionBySession` entries are brand-new object
    // references (as they always are after a store update).
    it("produces a shallow-equal map when a covered session's phase changes within the same derived bucket", () => {
      const before = selectSidebarRunStateMap([SESSION])(createState("streaming"));
      // "streaming" -> "running_tools" is a different ExecutionPhase, but
      // both derive to "running" — a streaming token tick is exactly this.
      const after = selectSidebarRunStateMap([SESSION])(createState("running_tools"));
      expect(after).toEqual(before);
    });

    it("produces a different map when a covered session's derived status actually changes", () => {
      const before = selectSidebarRunStateMap([SESSION])(createState("streaming"));
      const after = selectSidebarRunStateMap([SESSION])(createState("waiting_user_answer"));
      expect(after).not.toEqual(before);
      expect(after).toEqual({ [SESSION]: "awaiting" });
    });
  });
});
