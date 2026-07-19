import { describe, expect, it } from "vitest";
import type { WorkflowRunEvent, WorkflowRunView } from "../domain";
import { reconstructWorkflowRun } from "../runReconstruction";

const snapshot = (): WorkflowRunView => ({
  runId: "run-1",
  workflow: {
    workflowId: "release",
    name: "Release",
    source: "project",
    revision: 4,
    activatedAt: "2026-07-19T09:00:00Z",
    arguments: { version: "1.2.3" },
  },
  status: "running",
  phases: [
    {
      id: "publish",
      name: "Publish",
      order: 2,
      status: "pending",
      steps: [],
    },
  ],
  startedAt: "2026-07-19T09:00:01Z",
  lastSequence: 10,
});

describe("reconstructWorkflowRun", () => {
  it.each(["running", "suspended", "succeeded", "failed", "cancelled"] as const)(
    "reconstructs the %s run status from the event sequence",
    (status) => {
      const rebuilt = reconstructWorkflowRun(snapshot(), [
        {
          eventId: `event-${status}`,
          runId: "run-1",
          sequence: 11,
          type: "run_status",
          status,
          ...(status === "failed" ? { error: "publish failed" } : {}),
        },
      ]);

      expect(rebuilt.status).toBe(status);
      expect(rebuilt.lastSequence).toBe(11);
      if (status === "failed") expect(rebuilt.error).toBe("publish failed");
    },
  );

  it("rebuilds from an immutable snapshot with duplicate and out-of-order events", () => {
    const base = snapshot();
    const untouched = structuredClone(base);
    const phaseEvent: WorkflowRunEvent = {
      eventId: "event-11",
      runId: "run-1",
      sequence: 11,
      type: "phase_upsert",
      phase: {
        id: "prepare",
        name: "Prepare",
        order: 1,
        status: "running",
      },
    };
    const events: WorkflowRunEvent[] = [
      {
        eventId: "event-14",
        runId: "run-1",
        sequence: 14,
        type: "run_status",
        status: "succeeded",
        completedAt: "2026-07-19T09:03:00Z",
      },
      {
        eventId: "event-other-run",
        runId: "run-2",
        sequence: 99,
        type: "run_status",
        status: "failed",
        error: "must be ignored",
      },
      {
        eventId: "event-13",
        runId: "run-1",
        sequence: 13,
        type: "step_upsert",
        phaseId: "prepare",
        step: {
          id: "validate",
          name: "Validate",
          order: 1,
          status: "succeeded",
          completedAt: "2026-07-19T09:02:00Z",
        },
      },
      phaseEvent,
      { ...phaseEvent },
      {
        eventId: "event-stale",
        runId: "run-1",
        sequence: 10,
        type: "run_status",
        status: "cancelled",
      },
      {
        eventId: "event-12",
        runId: "run-1",
        sequence: 12,
        type: "step_upsert",
        phaseId: "prepare",
        step: {
          id: "checkout",
          name: "Checkout",
          order: 0,
          status: "succeeded",
          completedAt: "2026-07-19T09:01:00Z",
        },
      },
    ];

    const rebuilt = reconstructWorkflowRun(base, events);

    expect(rebuilt).toMatchObject({
      runId: "run-1",
      status: "succeeded",
      completedAt: "2026-07-19T09:03:00Z",
      lastSequence: 14,
    });
    expect(rebuilt.phases.map((phase) => phase.id)).toEqual(["prepare", "publish"]);
    expect(rebuilt.phases[0].steps.map((step) => step.id)).toEqual(["checkout", "validate"]);
    expect(base).toEqual(untouched);
    expect(rebuilt).not.toBe(base);
    expect(rebuilt.workflow.arguments).not.toBe(base.workflow.arguments);
  });

  it("preserves phase steps when a later phase event only updates phase status", () => {
    const base = snapshot();
    base.phases[0].steps.push({
      id: "crate",
      name: "Publish crate",
      order: 1,
      status: "running",
    });

    const rebuilt = reconstructWorkflowRun(base, [
      {
        eventId: "event-11",
        runId: "run-1",
        sequence: 11,
        type: "phase_upsert",
        phase: {
          id: "publish",
          name: "Publish",
          order: 2,
          status: "suspended",
        },
      },
    ]);

    expect(rebuilt.phases[0]).toMatchObject({ status: "suspended" });
    expect(rebuilt.phases[0].steps).toEqual(base.phases[0].steps);
    expect(rebuilt.phases[0].steps).not.toBe(base.phases[0].steps);
  });

  it("does not advance past a cross-batch sequence gap", () => {
    const event11: WorkflowRunEvent = {
      eventId: "event-11",
      runId: "run-1",
      sequence: 11,
      type: "run_status",
      status: "suspended",
    };
    const event12: WorkflowRunEvent = {
      eventId: "event-12",
      runId: "run-1",
      sequence: 12,
      type: "run_status",
      status: "failed",
      error: "late failure",
    };

    const waitingForGap = reconstructWorkflowRun(snapshot(), [event12]);
    expect(waitingForGap).toMatchObject({ status: "running", lastSequence: 10 });

    const rebuilt = reconstructWorkflowRun(waitingForGap, [event12, event11]);
    expect(rebuilt).toMatchObject({
      status: "failed",
      error: "late failure",
      lastSequence: 12,
    });
  });
});
