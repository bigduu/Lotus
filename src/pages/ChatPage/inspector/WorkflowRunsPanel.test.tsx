import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowRunSnapshot } from "../../../features/workflows";
import type { UseWorkflowRunsResult } from "../../../features/workflows/useWorkflowRuns";
import { WorkflowRunsPanel } from "./WorkflowRunsPanel";

const run = (overrides: Partial<WorkflowRunSnapshot> = {}): WorkflowRunSnapshot => ({
  run_id: "run-1",
  session_id: "session-1",
  workflow_id: "review",
  workflow_revision: 42,
  definition_bundle_hash: "safe-hash",
  status: "running",
  planned_steps: {
    queued: { id: "queued", kind: "tool" },
    running: { id: "running", kind: "agent" },
    suspended: { id: "suspended", kind: "workflow" },
    succeeded: { id: "succeeded", kind: "tool" },
    failed: { id: "failed", kind: "tool" },
    cancelled: { id: "cancelled", kind: "tool" },
    skipped: { id: "skipped", kind: "tool" },
    template: { id: "template", kind: "agent" },
  },
  plan: {
    type: "sequence",
    nodes: [
      { type: "step", step: "queued" },
      {
        type: "parallel",
        nodes: [
          { type: "step", step: "running" },
          { type: "step", step: "suspended" },
          { type: "step", step: "succeeded" },
        ],
      },
      {
        type: "retry",
        max_attempts: 3,
        node: { type: "step", step: "failed" },
      },
      { type: "step", step: "cancelled" },
      { type: "step", step: "skipped" },
      { type: "map", body: { type: "step", step: "template" } },
    ],
  },
  steps: {
    queued: { id: "queued", status: "queued", attempts: 0 },
    running: { id: "running", status: "running", attempts: 1 },
    suspended: { id: "suspended", status: "suspended", attempts: 1 },
    succeeded: { id: "succeeded", status: "succeeded", attempts: 1 },
    failed: {
      id: "failed",
      status: "failed",
      attempts: 2,
      failure: {
        code: "execution_failed",
        message: "Workflow execution failed",
        retryable: true,
      },
    },
    cancelled: { id: "cancelled", status: "cancelled", attempts: 1 },
    skipped: { id: "skipped", status: "skipped", attempts: 0 },
    "dynamic-instance": { id: "dynamic-instance", status: "running", attempts: 1 },
  },
  budget: {
    max_concurrency: 3,
    max_agents: 5,
    max_steps: 20,
    max_retries: 4,
    max_nesting_depth: 3,
    wall_time_ms: 60_000,
  },
  usage: { steps: 7, retries: 1, agents: 2, tokens: 40, cost_micros: 50 },
  child_agent_count: 2,
  last_sequence: 30,
  created_at: "2026-08-27T01:00:00Z",
  updated_at: "2026-08-27T01:00:30Z",
  ...overrides,
});

const query = (
  runs: WorkflowRunSnapshot[],
  overrides: Partial<UseWorkflowRunsResult> = {},
): UseWorkflowRunsResult => ({
  runs,
  status: "ready",
  cancellingRunIds: new Set(),
  cancelErrorRunIds: new Set(),
  refresh: vi.fn(async () => {}),
  cancel: vi.fn(async () => {}),
  ...overrides,
});

describe("WorkflowRunsPanel", () => {
  it("renders the safe topology, every backend state, supplied metrics, retries, and runtime instances", () => {
    render(<WorkflowRunsPanel workflowRuns={query([run()])} />);

    expect(screen.getByText("Workflow runs")).toBeInTheDocument();
    expect(screen.getByText("Sequence group")).toBeInTheDocument();
    expect(screen.getByText("Parallel group")).toBeInTheDocument();
    expect(screen.getByText("Retry group · up to 3 attempts")).toBeInTheDocument();
    expect(screen.getByText("Map group")).toBeInTheDocument();
    for (const status of [
      "Queued",
      "Running",
      "Suspended",
      "Succeeded",
      "Failed",
      "Cancelled",
      "Skipped",
      "Not reported",
    ]) {
      expect(screen.getAllByText(status).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("7 / 20")).toBeInTheDocument();
    expect(screen.getByText("1 / 4")).toBeInTheDocument();
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    expect(screen.getByText("40")).toBeInTheDocument();
    expect(screen.getByText("50")).toBeInTheDocument();
    expect(screen.getByText("Concurrency limit").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Nesting limit").parentElement).toHaveTextContent("3");
    expect(screen.getByText("Wall-time limit").parentElement).toHaveTextContent("60000 ms");
    expect(screen.getByText("Attempts: 2")).toBeInTheDocument();
    expect(screen.getByText("Retries: 1")).toBeInTheDocument();
    expect(screen.getByText("Workflow execution failed")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-runtime-steps-run-1")).toHaveTextContent(
      "dynamic-instance",
    );
    expect(screen.getByTestId("workflow-runtime-steps-run-1")).toHaveTextContent(
      "Runtime instance",
    );
    expect(screen.getByRole("tree", { name: "Workflow plan progress" })).toBeInTheDocument();
    expect(screen.getAllByRole("treeitem").length).toBeGreaterThan(1);
    expect(screen.getByRole("list", { name: "Runtime instances" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("dynamic-instance");
    expect(screen.getByRole("status")).toHaveTextContent("Running");
  });

  it("exposes only cancel for a live run and delegates without optimistic terminal state", () => {
    const cancel = vi.fn(async () => {});
    render(<WorkflowRunsPanel workflowRuns={query([run()], { cancel })} />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith("run-1");
    expect(screen.getAllByText("Running").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /resume/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry run/i })).not.toBeInTheDocument();
  });

  it.each(["succeeded", "failed", "cancelled"] as const)(
    "shows the authoritative %s terminal state without a cancel control",
    (status) => {
      const { unmount } = render(
        <WorkflowRunsPanel workflowRuns={query([run({ status, failure: undefined })])} />,
      );

      expect(screen.queryByRole("button", { name: "Cancel run" })).not.toBeInTheDocument();
      expect(screen.getAllByText(status[0].toUpperCase() + status.slice(1)).length).toBeGreaterThan(
        0,
      );
      unmount();
    },
  );

  it("shows only generic resync and cancel errors", () => {
    render(
      <WorkflowRunsPanel
        workflowRuns={query([run()], {
          status: "out_of_sync",
          cancelErrorRunIds: new Set(["run-1"]),
        })}
      />,
    );

    expect(
      screen.getByText("Workflow progress is resynchronizing after an event sequence mismatch."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cancellation was not confirmed. The authoritative run state was refreshed.",
      ),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/credential|private\/|tool output/i);
  });

  it.each([
    [false, "Suspended while a backend tool is running"],
    [true, "Suspended after the backend tool was stopped"],
  ] as const)("renders tool-running killed=%s without reversing backend state", (killed, text) => {
    render(
      <WorkflowRunsPanel
        workflowRuns={query([
          run({
            status: "suspended",
            suspension: { type: "tool_running", step_id: "running", killed },
          }),
        ])}
      />,
    );

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("keeps an empty unavailable query visible with a safe retry action", () => {
    const refresh = vi.fn(async () => {});
    render(<WorkflowRunsPanel workflowRuns={query([], { status: "unavailable", refresh })} />);

    expect(screen.getByText("Workflow progress is temporarily unavailable.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
