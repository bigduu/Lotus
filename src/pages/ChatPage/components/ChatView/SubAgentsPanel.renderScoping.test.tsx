/**
 * Regression test for Lotus issue #3: SubAgentsPanel used to subscribe to
 * the ENTIRE `chats` array via `useAppStore((s) => s.chats)`, so any
 * mutation to any chat anywhere in the store (a message in an unrelated
 * session, a title change on another conversation, a `lastRunStatus` flip
 * on a non-child) forced a full re-render of every SubAgentsPanel, even
 * ones with no relationship to the mutated chat.
 *
 * The fix narrows the subscription with a `useShallow`-wrapped selector
 * that filters to this parent's children inside the store hook. Because
 * the chat slice's reducers preserve object identity for chat items they
 * don't touch (`chats.map((c) => c.id === id ? { ...c, ... } : c)`), an
 * unrelated mutation produces a new top-level `chats` array but leaves
 * this parent's child items referentially unchanged — so the shallow
 * array comparison says "same" and Zustand does not notify the component.
 *
 * Unlike MessageCard (#18), SubAgentsPanel is not wrapped in `React.memo`
 * with props driving it — it derives everything from the store directly.
 * So the boundary under test here is Zustand's own `useSyncExternalStore`
 * equality check, not a memo comparator. To exercise that boundary for
 * real (rather than asserting on a hand-rolled selector-application mock),
 * this file backs `@shared/store/appStore` with an ACTUAL zustand store
 * and drives updates through `useAppStore.setState(...)`, observing
 * whether the panel's render function actually re-executes by spying on
 * `useSubagentProfiles`, a hook it calls unconditionally on every render
 * before its only early return.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { PARENT_SESSION_ID, OTHER_SESSION_ID, baseExecutionEntry, initialChats } = vi.hoisted(() => {
  const PARENT_SESSION_ID = "parent-session-1";
  const OTHER_SESSION_ID = "other-parent-session";

  const baseExecutionEntry = () => ({
    sessionId: PARENT_SESSION_ID,
    phase: "running",
    confidence: "live",
    activeReasons: [],
    generation: 1,
    backendRunId: null,
    stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
    backend: {
      isRunning: true,
      lastRunStatus: null,
      lastRunError: null,
      syncedAt: null,
      hasPendingQuestion: null,
      runningChildCount: null,
    },
    interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
    children: {
      byId: {
        "child-session-1": {
          title: "Child Session 1",
          status: "running",
          outputPreview: "Working...",
        },
      },
      runningCount: 1,
    },
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

  const initialChats = () => [
    {
      id: "child-session-1",
      kind: "child",
      parentSessionId: PARENT_SESSION_ID,
      title: "Child Session 1",
      updatedAt: "2026-03-12T00:00:00Z",
      pinned: false,
    },
    // A chat entirely unrelated to PARENT_SESSION_ID — mutating this one
    // is the scenario issue #3 is about.
    {
      id: "unrelated-session",
      kind: "root",
      parentSessionId: null,
      title: "Unrelated conversation",
      updatedAt: "2026-03-12T00:00:00Z",
      pinned: false,
    },
  ];

  return { PARENT_SESSION_ID, OTHER_SESSION_ID, baseExecutionEntry, initialChats };
});

vi.mock("@shared/store/appStore", async () => {
  const { create } = await import("zustand");

  const useAppStore = create(() => ({
    executionBySession: { [PARENT_SESSION_ID]: baseExecutionEntry() },
    chats: initialChats(),
    loadChatHistory: vi.fn(),
    refreshChats: vi.fn(),
    markOptimisticStart: vi.fn(),
    markRetryStart: vi.fn(),
    markSettleTimeout: vi.fn(),
    pinSession: vi.fn(),
    unpinSession: vi.fn(),
    deleteSession: vi.fn(),
    applyChildProgress: vi.fn(),
    clearChildProgress: vi.fn(),
  }));

  const selectChildren =
    (sessionId: string | null) => (state: ReturnType<typeof useAppStore.getState>) => {
      const entry = (state.executionBySession as Record<string, unknown>)[sessionId ?? ""] as
        | { children?: { byId?: unknown } }
        | undefined;
      return entry?.children?.byId ?? {};
    };

  return { useAppStore, selectChildren };
});

vi.mock("@shared/utils/openSession", () => ({
  openSession: vi.fn(),
}));

vi.mock("@services/chat/AgentService", () => ({
  agentClient: { truncateSessionMessages: vi.fn(), execute: vi.fn() },
}));

vi.mock("../../../../services/tool/ToolService", () => ({
  toolService: { executeTool: vi.fn() },
}));

vi.mock("../../hooks/useSubagentProfiles", () => ({
  useSubagentProfiles: vi.fn(() => ({ byId: new Map() })),
}));

vi.mock("../../hooks/useActiveModel", () => ({
  useActiveModel: () => "test-model",
}));

import { useAppStore } from "@shared/store/appStore";
import { useSubagentProfiles } from "../../hooks/useSubagentProfiles";
import { SubAgentsPanel } from "./SubAgentsPanel";

const renderSpy = vi.mocked(useSubagentProfiles);

// The mocked store is a module-level singleton (real zustand store), so
// reset its state before each test rather than recreating the module.
const resetStore = () => {
  useAppStore.setState(
    {
      executionBySession: { [PARENT_SESSION_ID]: baseExecutionEntry() },
      chats: initialChats(),
    },
    false,
  );
};

describe("SubAgentsPanel store subscription scoping (#3)", () => {
  beforeEach(() => {
    resetStore();
    renderSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not re-render when an unrelated chat mutates", () => {
    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);
    const countAfterMount = renderSpy.mock.calls.length;
    expect(countAfterMount).toBeGreaterThan(0);

    act(() => {
      useAppStore.setState((state) => ({
        chats: state.chats.map((c) =>
          c.id === "unrelated-session" ? { ...c, title: "Renamed unrelated chat" } : c,
        ),
      }));
    });

    // A new top-level `chats` array was produced, but this parent's own
    // child item ("child-session-1") kept its object identity, so the
    // narrowed selector's shallow-compared output is unchanged — the panel
    // must not re-render.
    expect(renderSpy.mock.calls.length).toBe(countAfterMount);
  });

  it("does not re-render when a chat belonging to a different parent mutates", () => {
    act(() => {
      useAppStore.setState((state) => ({
        chats: [
          ...state.chats,
          {
            id: "sibling-child",
            kind: "child",
            parentSessionId: OTHER_SESSION_ID,
            title: "Sibling child",
            updatedAt: "2026-03-12T00:00:00Z",
            pinned: false,
          },
        ],
      }));
    });

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);
    const countAfterMount = renderSpy.mock.calls.length;

    act(() => {
      useAppStore.setState((state) => ({
        chats: state.chats.map((c) =>
          c.id === "sibling-child" ? { ...c, lastRunStatus: "completed" } : c,
        ),
      }));
    });

    expect(renderSpy.mock.calls.length).toBe(countAfterMount);
  });

  it("still re-renders when this parent's own child set actually changes", () => {
    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);
    const countAfterMount = renderSpy.mock.calls.length;

    act(() => {
      useAppStore.setState((state) => ({
        chats: [
          ...state.chats,
          {
            id: "child-session-2",
            kind: "child",
            parentSessionId: PARENT_SESSION_ID,
            title: "Child Session 2",
            updatedAt: "2026-03-12T00:00:01Z",
            pinned: false,
          },
        ],
      }));
    });

    expect(renderSpy.mock.calls.length).toBeGreaterThan(countAfterMount);
  });

  it("still re-renders when an existing child of this parent is updated", () => {
    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);
    const countAfterMount = renderSpy.mock.calls.length;

    act(() => {
      useAppStore.setState((state) => ({
        chats: state.chats.map((c) =>
          c.id === "child-session-1" ? { ...c, title: "Renamed child" } : c,
        ),
      }));
    });

    expect(renderSpy.mock.calls.length).toBeGreaterThan(countAfterMount);
  });
});
