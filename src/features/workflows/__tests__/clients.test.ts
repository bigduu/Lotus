import { describe, expect, it, vi } from "vitest";
import {
  BambooWorkflowMigrationClient,
  BambooWorkflowRunClient,
  parseWorkflowRunEvent,
  parseWorkflowRunSnapshot,
} from "../clients";

const rawSnapshot = (overrides: Record<string, unknown> = {}) => ({
  run_id: "run-1",
  session_id: "session-1",
  workflow_id: "review",
  workflow_revision: 42,
  definition_bundle_hash: "safe-hash",
  status: "running",
  planned_steps: {
    inspect: { id: "inspect", kind: "tool", prompt: "PRIVATE-PROMPT" },
  },
  plan: { type: "retry", node: { type: "step", step: "inspect" }, max_attempts: 3 },
  steps: {
    inspect: {
      id: "inspect",
      status: "failed",
      attempts: 2,
      failure: {
        code: "execution_failed",
        message: "/private/workspace/PRIVATE-CREDENTIAL",
        retryable: true,
      },
      output: "PRIVATE-OUTPUT",
    },
  },
  budget: {
    max_concurrency: 2,
    max_agents: 4,
    max_steps: 8,
    max_retries: 2,
    max_nesting_depth: 3,
    wall_time_ms: 60_000,
  },
  usage: { steps: 1, retries: 1, agents: 2, tokens: 40, cost_micros: 50 },
  child_agent_count: 2,
  last_sequence: 9,
  failure: {
    code: "execution_failed",
    message: "/private/workspace/PRIVATE-RUN-FAILURE",
    retryable: false,
  },
  created_at: "2026-08-27T01:00:00Z",
  updated_at: "2026-08-27T01:00:09Z",
  validated_args: { token: "PRIVATE-TOKEN" },
  output: "PRIVATE-RUN-OUTPUT",
  ...overrides,
});

describe("BambooWorkflowMigrationClient", () => {
  it("posts the encoded workflow id with only the trusted session scope", async () => {
    const post = vi.fn(async () => ({
      workflow_id: "review/legacy",
      outcome: "migrated" as const,
      source_preserved: true as const,
      catalog_revision: 8,
    }));
    const client = new BambooWorkflowMigrationClient(post);

    const result = await client.migrate("review/legacy", "session-561");

    expect(post).toHaveBeenCalledWith("bamboo/workflow-catalog/review%2Flegacy/migrate", {
      session_id: "session-561",
    });
    expect(result.source_preserved).toBe(true);
  });
});

describe("BambooWorkflowRunClient", () => {
  it("loads the session-scoped list and keeps only Bamboo's metadata-only fields", async () => {
    const signal = new AbortController().signal;
    const get = vi.fn(async () => [rawSnapshot()]);
    const client = new BambooWorkflowRunClient(get, vi.fn());

    const runs = await client.list("session-1", signal);

    expect(get).toHaveBeenCalledWith("sessions/session-1/workflow-runs", { signal });
    expect(runs[0]).toMatchObject({
      run_id: "run-1",
      status: "running",
      child_agent_count: 2,
      usage: { retries: 1, agents: 2 },
      budget: { max_steps: 8, max_retries: 2 },
      steps: {
        inspect: {
          status: "failed",
          attempts: 2,
          failure: { message: "Workflow execution failed" },
        },
      },
    });
    expect(runs[0].budget).not.toHaveProperty("max_tokens");
    expect(runs[0].budget).not.toHaveProperty("max_cost_micros");
    const publicState = JSON.stringify(runs);
    for (const sentinel of [
      "PRIVATE-",
      "validated_args",
      "output",
      "/private/workspace",
      "prompt",
    ]) {
      expect(publicState).not.toContain(sentinel);
    }
  });

  it("parses sequenced safe events without inventing an event id or exposing phase diagnostics", () => {
    const phase = parseWorkflowRunEvent({
      run_id: "run-1",
      sequence: 10,
      at: "2026-08-27T01:00:10Z",
      type: "phase",
      name: "/private/PRIVATE-PHASE",
      raw_output: "PRIVATE-OUTPUT",
    });
    const failed = parseWorkflowRunEvent({
      run_id: "run-1",
      sequence: 11,
      at: "2026-08-27T01:00:11Z",
      step_id: "inspect",
      type: "step_failed",
      failure: {
        code: "permission_denied",
        message: "credential PRIVATE-CREDENTIAL",
        retryable: false,
      },
    });

    expect(phase).toEqual({
      run_id: "run-1",
      sequence: 10,
      at: "2026-08-27T01:00:10Z",
      type: "phase",
      name: "workflow_progressed",
    });
    expect(phase).not.toHaveProperty("eventId");
    expect(failed).toMatchObject({
      type: "step_failed",
      failure: { message: "Workflow permission was denied" },
    });
    expect(JSON.stringify([phase, failed])).not.toContain("PRIVATE-");
  });

  it("encodes event cursors and rejects a foreign session snapshot", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce([
        {
          run_id: "run/1",
          sequence: 12,
          at: "2026-08-27T01:00:12Z",
          type: "run_suspended",
        },
      ])
      .mockResolvedValueOnce(rawSnapshot({ session_id: "other-session" }));
    const client = new BambooWorkflowRunClient(get, vi.fn());

    await expect(client.getEvents("session 1", "run/1", 11)).resolves.toMatchObject([
      { sequence: 12, type: "run_suspended" },
    ]);
    expect(get).toHaveBeenNthCalledWith(
      1,
      "sessions/session%201/workflow-runs/run%2F1/events?since=11",
      undefined,
    );
    await expect(client.getSnapshot("session-1", "run-1")).rejects.toThrow(
      "invalid WorkflowRun public contract",
    );
  });

  it("deduplicates concurrent cancel intents into exactly one POST and allows a later retry", async () => {
    let resolvePost: ((value: unknown) => void) | undefined;
    const post = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolvePost = resolve;
        }),
    );
    const client = new BambooWorkflowRunClient(vi.fn(), post);

    const first = client.cancel("session-1", "run-1");
    const duplicate = client.cancel("session-1", "run-1");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      "sessions/session-1/workflow-runs/run-1/cancel",
      undefined,
      undefined,
    );

    resolvePost?.(rawSnapshot({ status: "cancelled", last_sequence: 10 }));
    await expect(Promise.all([first, duplicate])).resolves.toMatchObject([
      { status: "cancelled" },
      { status: "cancelled" },
    ]);

    const retry = client.cancel("session-1", "run-1");
    expect(post).toHaveBeenCalledTimes(2);
    resolvePost?.(rawSnapshot({ status: "cancelled", last_sequence: 10 }));
    await retry;
  });

  it("parses optional token and cost budgets when Bamboo supplies them", () => {
    const parsed = parseWorkflowRunSnapshot(
      rawSnapshot({
        budget: {
          max_concurrency: 2,
          max_agents: 4,
          max_steps: 8,
          max_retries: 2,
          max_nesting_depth: 3,
          wall_time_ms: 60_000,
          max_tokens: 10_000,
          max_cost_micros: 25_000,
        },
      }),
    );

    expect(parsed.budget).toMatchObject({ max_tokens: 10_000, max_cost_micros: 25_000 });
  });
});
