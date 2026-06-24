import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AccountStreamHandlers, ChangeEvent } from "./AgentService";

// Capture the handlers passed to subscribeToAccountStream so the test can drive
// the feed without a real EventSource.
let captured: AccountStreamHandlers | null = null;
const closeSpy = vi.fn();

const storeActions = {
  currentSessionId: null as string | null,
  refreshSessionsIndex: vi.fn().mockResolvedValue(undefined),
  applyServerTitle: vi.fn(),
  applyServerPinned: vi.fn(),
  setAgentAvailability: vi.fn(),
  reconcileOpenSession: vi.fn(),
};

vi.mock("./AgentService", () => ({
  AgentClient: {
    getInstance: () => ({
      subscribeToAccountStream: (handlers: AccountStreamHandlers) => {
        captured = handlers;
        return { close: closeSpy } as unknown as EventSource;
      },
    }),
  },
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: { getState: () => storeActions },
}));

import { startAccountFeed, stopAccountFeed } from "./accountFeed";

const change = (seq: number, event: ChangeEvent["event"]): ChangeEvent => ({
  seq,
  ts: "2026-05-31T00:00:00Z",
  session_id: event.session_id,
  event,
});

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
    storeActions.refreshSessionsIndex.mockResolvedValue(undefined);
    localStorage.clear();
  });

  afterEach(() => {
    stopAccountFeed();
    vi.useRealTimers();
  });

  it("applies title and pinned events directly to the store", () => {
    startAccountFeed();
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

  it("debounces a session-index refresh for coarse change events", () => {
    vi.useFakeTimers();
    startAccountFeed();

    captured!.onChange(change(1, { type: "session_created", session_id: "s1" }));
    captured!.onChange(change(2, { type: "message_appended", session_id: "s1" }));
    captured!.onChange(change(3, { type: "session_deleted", session_id: "s2" }));

    // Debounced: not yet called.
    expect(storeActions.refreshSessionsIndex).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(storeActions.refreshSessionsIndex).toHaveBeenCalledTimes(1);
  });

  it("reconciles the OPEN session on a content change driven elsewhere (multi-device)", () => {
    storeActions.currentSessionId = "s1";
    startAccountFeed();

    // A message appended to the open session on another device.
    captured!.onChange(change(5, { type: "message_appended", session_id: "s1" }));

    expect(storeActions.reconcileOpenSession).toHaveBeenCalledWith("s1", "message_appended");
  });

  it("does NOT reconcile when the changed session is not the open one", () => {
    storeActions.currentSessionId = "open-session";
    startAccountFeed();

    captured!.onChange(change(6, { type: "message_appended", session_id: "other-session" }));
    captured!.onChange(change(7, { type: "complete", session_id: "other-session" }));

    expect(storeActions.reconcileOpenSession).not.toHaveBeenCalled();
  });

  it("does NOT reconcile for list-only events even on the open session", () => {
    storeActions.currentSessionId = "s1";
    startAccountFeed();

    captured!.onChange(
      change(8, { type: "session_title_updated", session_id: "s1", title: "x", title_version: 1 }),
    );
    captured!.onChange(
      change(9, { type: "session_pinned_updated", session_id: "s1", pinned: true }),
    );

    expect(storeActions.reconcileOpenSession).not.toHaveBeenCalled();
  });

  it("persists the resume cursor and marks availability on each change", () => {
    startAccountFeed();
    captured!.onChange(change(7, { type: "session_created", session_id: "s1" }));

    expect(localStorage.getItem("lotus_account_feed_cursor_v1")).toBe("7");
    expect(storeActions.setAgentAvailability).toHaveBeenCalledWith(true);
  });

  it("clears the cursor and full-resyncs on feed_reset", () => {
    localStorage.setItem("lotus_account_feed_cursor_v1", "42");
    startAccountFeed();

    captured!.onReset?.();
    expect(localStorage.getItem("lotus_account_feed_cursor_v1")).toBeNull();
    expect(storeActions.refreshSessionsIndex).toHaveBeenCalledTimes(1);
  });

  it("toggles availability on connection open/error", () => {
    startAccountFeed();
    captured!.onOpen?.();
    expect(storeActions.setAgentAvailability).toHaveBeenLastCalledWith(true);
    captured!.onError?.();
    expect(storeActions.setAgentAvailability).toHaveBeenLastCalledWith(false);
  });
});
