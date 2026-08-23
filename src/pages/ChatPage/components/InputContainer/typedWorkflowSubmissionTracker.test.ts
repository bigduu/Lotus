import { afterEach, describe, expect, it, vi } from "vitest";

import {
  finishTypedWorkflowSubmission,
  isTypedWorkflowSubmissionPending,
  resetTypedWorkflowSubmissionTrackerForTests,
  subscribeToTypedWorkflowSubmissions,
  tryBeginTypedWorkflowSubmission,
} from "./typedWorkflowSubmissionTracker";

describe("typedWorkflowSubmissionTracker", () => {
  afterEach(() => resetTypedWorkflowSubmissionTrackerForTests());

  it("fences submissions by session across component lifetimes", () => {
    const firstRevision = tryBeginTypedWorkflowSubmission("session-1");

    expect(firstRevision).not.toBeNull();
    expect(tryBeginTypedWorkflowSubmission("session-1")).toBeNull();
    expect(tryBeginTypedWorkflowSubmission("session-2")).not.toBeNull();
    expect(isTypedWorkflowSubmissionPending("session-1")).toBe(true);
    expect(isTypedWorkflowSubmissionPending("session-2")).toBe(true);
  });

  it("does not let a stale completion clear a newer submission", () => {
    const firstRevision = tryBeginTypedWorkflowSubmission("session-1");
    expect(firstRevision).not.toBeNull();
    expect(finishTypedWorkflowSubmission("session-1", firstRevision!)).toBe(true);

    const secondRevision = tryBeginTypedWorkflowSubmission("session-1");
    expect(secondRevision).not.toBeNull();
    expect(finishTypedWorkflowSubmission("session-1", firstRevision!)).toBe(false);
    expect(isTypedWorkflowSubmissionPending("session-1")).toBe(true);
    expect(finishTypedWorkflowSubmission("session-1", secondRevision!)).toBe(true);
    expect(isTypedWorkflowSubmissionPending("session-1")).toBe(false);
  });

  it("notifies subscribers only when authoritative pending state changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToTypedWorkflowSubmissions(listener);

    const revision = tryBeginTypedWorkflowSubmission("session-1");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(tryBeginTypedWorkflowSubmission("session-1")).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(finishTypedWorkflowSubmission("session-1", revision!)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    tryBeginTypedWorkflowSubmission("session-2");
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
