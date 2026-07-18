/**
 * Regression test for Lotus issue #6: `selectRailModel` builds a brand-new
 * `RailModel` object literal on every invocation (`executionSelectors.ts`),
 * so a plain `useAppStore(selectRailModel(sessionId))` subscription (no
 * equality function, default `Object.is`) re-renders `ExecutionStatusRail`
 * on *every* store mutation — not just when this session's own execution
 * state changes. A token streaming in an unrelated session, or literally
 * any other slice mutating, produced a structurally-identical-but-
 * referentially-new object and forced a re-render.
 *
 * The fix wraps the subscription in `useShallow` (the idiom PR #74 already
 * established for this codebase): Zustand then shallow-compares the
 * `RailModel`'s own fields instead of the object reference. Because the
 * execution reducer (`executionStateSlice/reducer.ts`) preserves
 * referential identity for session entries / fields it doesn't touch —
 * spreading `...entry` and only replacing the sub-object an action
 * actually mutates — an update to an unrelated session (or an unrelated
 * store slice entirely) leaves this session's underlying fields
 * (`phase`, `stream.activeToolCalls`, `children.runningCount`, ...)
 * referentially unchanged, so the shallow comparison reports "same
 * output" and the component does not re-render.
 *
 * `ExecutionStatusRail` isn't wrapped in `React.memo` — like SubAgentsPanel
 * (#3/PR #74) it derives everything from the store directly, so the
 * boundary under test is Zustand's own `useSyncExternalStore` equality
 * check, not a memo comparator. This backs `@shared/store/appStore` with a
 * real zustand store (mirroring PR #74's approach, including reimplementing
 * `selectRailModel` inline to match the production selector's shape without
 * pulling in the real store module's side effects — health-check timers,
 * account feed, etc.) and drives updates through `useAppStore.setState(...)`,
 * observing whether the rail's render function actually re-executes by
 * spying on `useTranslation`, a hook it calls unconditionally on every
 * render before its only early return.
 */
import React from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { SESSION_ID, OTHER_SESSION_ID, baseExecutionEntry } = vi.hoisted(() => {
  const SESSION_ID = "session-1";
  const OTHER_SESSION_ID = "other-session";

  const baseExecutionEntry = (phase = "running") => ({
    sessionId: SESSION_ID,
    phase,
    confidence: "live",
    activeReasons: [],
    generation: 1,
    backendRunId: null,
    stream: { hasTokens: true, tokenCount: 3, activeToolCalls: [], lastStatusHint: null },
    backend: {
      isRunning: true,
      lastRunStatus: null,
      lastRunError: null,
      syncedAt: null,
      hasPendingQuestion: null,
      runningChildCount: null,
    },
    interaction: {
      pendingQuestion: null,
      respondMode: null,
      pendingChildApprovals: [],
      resolvedChildApprovalRequestIds: [],
    },
    children: { byId: {}, runningCount: 0 },
    timestamps: {
      optimisticAt: null,
      confirmedAt: null,
      firstTokenAt: null,
      terminalAt: null,
      settlingStartedAt: null,
      settledAt: null,
    },
    error: null,
  });

  return { SESSION_ID, OTHER_SESSION_ID, baseExecutionEntry };
});

vi.mock("@shared/store/appStore", async () => {
  const { create } = await import("zustand");

  const useAppStore = create(() => ({
    executionBySession: { [SESSION_ID]: baseExecutionEntry() },
    evaluationStates: {},
  }));

  // Mirrors the real `selectRailModel` in
  // `src/shared/store/appStore/selectors/executionSelectors.ts:223-239` —
  // including the object-literal-per-call shape that makes this a
  // regression risk if a future edit drops the `useShallow` wrapping at
  // the call site.
  const IDLE_RAIL = Object.freeze({
    state: "idle",
    activeToolCalls: [],
    runningChildCount: 0,
    hasQuestion: false,
    hasError: false,
    errorMessage: null,
    generation: 0,
  });

  const selectRailModel =
    (sessionId: string | null) => (state: ReturnType<typeof useAppStore.getState>) => {
      const entry = sessionId
        ? (state.executionBySession as Record<string, ReturnType<typeof baseExecutionEntry>>)[
            sessionId
          ]
        : undefined;
      if (!entry) {
        return IDLE_RAIL;
      }
      return {
        state: entry.phase,
        activeToolCalls: entry.stream.activeToolCalls,
        runningChildCount: entry.children.runningCount,
        hasQuestion: entry.interaction.pendingQuestion !== null,
        hasError: entry.error !== null,
        errorMessage: (entry.error as { message?: string } | null)?.message ?? null,
        generation: entry.generation,
      };
    };

  return { useAppStore, selectRailModel };
});

vi.mock("react-i18next", () => ({
  useTranslation: vi.fn(() => ({ t: (_key: string, fallback?: string) => fallback ?? _key })),
}));

import { useAppStore } from "@shared/store/appStore";
import { useTranslation } from "react-i18next";
import { ExecutionStatusRail } from "./index";

const renderSpy = vi.mocked(useTranslation);

// The mocked store is a module-level singleton (real zustand store), so
// reset its state before each test rather than recreating the module.
const resetStore = () => {
  useAppStore.setState(
    {
      executionBySession: { [SESSION_ID]: baseExecutionEntry() },
      evaluationStates: {},
    },
    false,
  );
};

describe("ExecutionStatusRail store subscription scoping (#6)", () => {
  beforeEach(() => {
    resetStore();
    renderSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not re-render when an unrelated store mutation leaves this session's execution state untouched", () => {
    render(<ExecutionStatusRail sessionId={SESSION_ID} />);
    const countAfterMount = renderSpy.mock.calls.length;
    expect(countAfterMount).toBeGreaterThan(0);

    act(() => {
      // Any `set()` call replaces the top-level store object, even when it
      // doesn't touch `executionBySession` at all — this is the "every
      // store change" scenario from the issue title.
      useAppStore.setState((state) => ({ ...state }));
    });

    expect(renderSpy.mock.calls.length).toBe(countAfterMount);
  });

  it("does not re-render when a different session's execution state mutates", () => {
    render(<ExecutionStatusRail sessionId={SESSION_ID} />);
    const countAfterMount = renderSpy.mock.calls.length;

    act(() => {
      useAppStore.setState((state) => ({
        executionBySession: {
          ...state.executionBySession,
          [OTHER_SESSION_ID]: baseExecutionEntry("streaming"),
        },
      }));
    });

    expect(renderSpy.mock.calls.length).toBe(countAfterMount);
  });

  it("still re-renders when this session's phase changes", () => {
    render(<ExecutionStatusRail sessionId={SESSION_ID} />);
    const countAfterMount = renderSpy.mock.calls.length;

    act(() => {
      useAppStore.setState((state) => ({
        executionBySession: {
          ...state.executionBySession,
          [SESSION_ID]: { ...state.executionBySession[SESSION_ID], phase: "completed" },
        },
      }));
    });

    expect(renderSpy.mock.calls.length).toBeGreaterThan(countAfterMount);
  });

  it("still re-renders when this session's active tool calls change", () => {
    render(<ExecutionStatusRail sessionId={SESSION_ID} />);
    const countAfterMount = renderSpy.mock.calls.length;

    act(() => {
      useAppStore.setState((state) => {
        const entry = state.executionBySession[SESSION_ID];
        return {
          executionBySession: {
            ...state.executionBySession,
            [SESSION_ID]: {
              ...entry,
              stream: {
                ...entry.stream,
                activeToolCalls: [{ toolCallId: "t1", toolName: "search", startedAt: "now" }],
              },
            },
          },
        };
      });
    });

    expect(renderSpy.mock.calls.length).toBeGreaterThan(countAfterMount);
  });

  it("shows evaluation independently when the main execution is idle", () => {
    useAppStore.setState({
      executionBySession: { [SESSION_ID]: baseExecutionEntry("idle") },
      evaluationStates: {
        [SESSION_ID]: {
          phase: "running",
          isEvaluating: true,
          reasoning: null,
          timestamp: Date.now(),
        },
      },
    } as never);

    render(<ExecutionStatusRail sessionId={SESSION_ID} />);

    expect(screen.getByText("Evaluating task progress…")).toBeTruthy();
    expect(screen.queryByText("Ready")).toBeNull();
  });
});
