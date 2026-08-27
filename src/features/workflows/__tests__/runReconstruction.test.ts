import { describe, expect, it } from "vitest";

import type { WorkflowRunEvent, WorkflowRunSnapshot } from "../domain";
import { reconstructWorkflowRun } from "../runReconstruction";

const snapshot = (overrides: Partial<WorkflowRunSnapshot> = {}): WorkflowRunSnapshot => ({
  run_id: "run-1",
  session_id: "session-1",
  workflow_id: "release",
  workflow_revision: 4,
  definition_bundle_hash: "safe-bundle-hash",
  status: "running",
  planned_steps: {
    inspect: { id: "inspect", kind: "tool" },
  },
  plan: { type: "sequence", nodes: [{ type: "step", step: "inspect" }] },
  steps: {
    inspect: { id: "inspect", status: "queued", attempts: 1 },
  },
  budget: {
    max_concurrency: 2,
    max_agents: 4,
    max_steps: 8,
    max_retries: 2,
    max_nesting_depth: 3,
    wall_time_ms: 60_000,
  },
  usage: { steps: 1, retries: 0, agents: 0, tokens: 0, cost_micros: 0 },
  child_agent_count: 0,
  last_sequence: 10,
  created_at: "2026-08-27T01:00:00Z",
  updated_at: "2026-08-27T01:00:10Z",
  ...overrides,
});

const event = (
  sequence: number,
  value: Omit<WorkflowRunEvent, "run_id" | "sequence" | "at">,
): WorkflowRunEvent =>
  ({
    run_id: "run-1",
    sequence,
    at: `2026-08-27T01:00:${sequence}Z`,
    ...value,
  }) as WorkflowRunEvent;

describe("reconstructWorkflowRun", () => {
  it.each([
    ["run_queued", "queued"],
    ["run_started", "running"],
    ["run_suspended", "suspended"],
    ["run_succeeded", "succeeded"],
    ["run_failed", "failed"],
    ["run_cancelled", "cancelled"],
  ] as const)("projects %s to the exact run status", (type, status) => {
    const base = snapshot({ status: "queued" });
    const next =
      type === "run_failed"
        ? event(11, {
            type,
            failure: {
              code: "execution_failed",
              message: "Workflow execution failed",
              retryable: false,
            },
          })
        : event(11, { type } as Omit<WorkflowRunEvent, "run_id" | "sequence" | "at">);

    const rebuilt = reconstructWorkflowRun(base, [next]);

    expect(rebuilt.issue).toBeNull();
    expect(rebuilt.run).toMatchObject({ status, last_sequence: 11 });
  });

  it("orders an event batch, collapses identical sequence duplicates, and keeps the snapshot immutable", () => {
    const base = snapshot();
    const untouched = structuredClone(base);
    const started = event(11, { type: "step_started", step_id: "inspect" });

    const rebuilt = reconstructWorkflowRun(base, [
      event(12, { type: "step_completed", step_id: "inspect" }),
      started,
      { ...started },
      event(10, { type: "run_cancelled" }),
    ]);

    expect(rebuilt).toMatchObject({ applied: 2, issue: null });
    expect(rebuilt.run.steps.inspect).toEqual({
      id: "inspect",
      status: "succeeded",
      attempts: 1,
    });
    expect(rebuilt.run.last_sequence).toBe(12);
    expect(base).toEqual(untouched);
    expect(rebuilt.run).not.toBe(base);
  });

  it("detects a sequence gap and never advances the durable cursor", () => {
    const rebuilt = reconstructWorkflowRun(snapshot(), [
      event(12, { type: "step_completed", step_id: "inspect" }),
    ]);

    expect(rebuilt.issue).toEqual({
      type: "gap",
      expected_sequence: 11,
      received_sequence: 12,
    });
    expect(rebuilt.run.last_sequence).toBe(10);
    expect(rebuilt.run.steps.inspect.status).toBe("queued");
  });

  it("ignores stale replay and detects a conflicting duplicate sequence", () => {
    const stale = reconstructWorkflowRun(snapshot(), [event(10, { type: "run_cancelled" })]);
    expect(stale).toMatchObject({ applied: 0, issue: null });
    expect(stale.run.status).toBe("running");

    const conflict = reconstructWorkflowRun(snapshot(), [
      event(11, { type: "run_suspended" }),
      event(11, { type: "run_cancelled" }),
    ]);
    expect(conflict.issue).toEqual({ type: "conflicting_duplicate", sequence: 11 });
    expect(conflict.run.last_sequence).toBe(10);
  });

  it("rejects terminal regression and a foreign run without adopting either event", () => {
    const regression = reconstructWorkflowRun(snapshot({ status: "succeeded" }), [
      event(11, { type: "run_started" }),
    ]);
    expect(regression.issue).toEqual({ type: "regressive_transition", sequence: 11 });
    expect(regression.run.status).toBe("succeeded");

    const foreign = reconstructWorkflowRun(snapshot(), [
      { ...event(11, { type: "run_suspended" }), run_id: "other-run" },
    ]);
    expect(foreign.issue).toEqual({ type: "foreign_run", sequence: 11 });
    expect(foreign.run.last_sequence).toBe(10);
  });

  it("rejects step progress after an authoritative terminal run", () => {
    const rebuilt = reconstructWorkflowRun(snapshot({ status: "cancelled" }), [
      event(11, { type: "step_started", step_id: "inspect" }),
    ]);

    expect(rebuilt.issue).toEqual({ type: "regressive_transition", sequence: 11 });
    expect(rebuilt.run.last_sequence).toBe(10);
    expect(rebuilt.run.steps.inspect.status).toBe("queued");
  });

  it("permits Bamboo's real failed-to-queued retry path without inventing attempt counts", () => {
    const base = snapshot({
      steps: {},
    });
    const rebuilt = reconstructWorkflowRun(base, [
      event(11, {
        type: "step_failed",
        step_id: "inspect",
        failure: {
          code: "execution_failed",
          message: "Workflow execution failed",
          retryable: true,
        },
      }),
      event(12, { type: "phase", name: "retry_reserved" }),
      event(13, { type: "step_queued", step_id: "inspect" }),
      event(14, { type: "step_started", step_id: "inspect" }),
    ]);

    expect(rebuilt.issue).toBeNull();
    expect(rebuilt.run.steps.inspect).toEqual({
      id: "inspect",
      status: "running",
      attempts: null,
    });
    expect(rebuilt.run.plan).toEqual(base.plan);
    expect(rebuilt.run).not.toHaveProperty("phase");
  });
});
