import { useLayoutEffect } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WorkflowRunClient } from "../clients";
import type { WorkflowRunEvent, WorkflowRunSnapshot } from "../domain";
import { useWorkflowRuns } from "../useWorkflowRuns";

const snapshot = (overrides: Partial<WorkflowRunSnapshot> = {}): WorkflowRunSnapshot => ({
  run_id: "run-1",
  session_id: "session-1",
  workflow_id: "review",
  workflow_revision: 42,
  definition_bundle_hash: "safe-hash",
  status: "running",
  planned_steps: { inspect: { id: "inspect", kind: "tool" } },
  plan: { type: "step", step: "inspect" },
  steps: { inspect: { id: "inspect", status: "running", attempts: 1 } },
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

const runEvent = (
  sequence: number,
  value: Omit<WorkflowRunEvent, "run_id" | "sequence" | "at">,
): WorkflowRunEvent =>
  ({
    run_id: "run-1",
    sequence,
    at: `2026-08-27T01:00:${sequence}Z`,
    ...value,
  }) as WorkflowRunEvent;

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const client = (overrides: Partial<WorkflowRunClient> = {}): WorkflowRunClient => ({
  list: vi.fn(async () => []),
  getSnapshot: vi.fn(async () => snapshot()),
  getEvents: vi.fn(async () => []),
  cancel: vi.fn(async () => snapshot({ status: "cancelled" })),
  ...overrides,
});

const renderRuns = (sessionId: string | null, runClient: WorkflowRunClient) =>
  renderHook(
    ({ selectedSessionId }) =>
      useWorkflowRuns(selectedSessionId, { client: runClient, pollIntervalMs: 60_000 }),
    { initialProps: { selectedSessionId: sessionId } },
  );

describe("useWorkflowRuns", () => {
  it("ignores a late response from the previous session generation", async () => {
    const sessionOne = deferred<WorkflowRunSnapshot[]>();
    const sessionTwo = deferred<WorkflowRunSnapshot[]>();
    const runClient = client({
      list: vi.fn((sessionId) =>
        sessionId === "session-1" ? sessionOne.promise : sessionTwo.promise,
      ),
    });
    const { result, rerender } = renderRuns("session-1", runClient);

    rerender({ selectedSessionId: "session-2" });
    sessionTwo.resolve([
      snapshot({ run_id: "run-2", session_id: "session-2", workflow_id: "second" }),
    ]);
    await waitFor(() => expect(result.current.runs[0]?.run_id).toBe("run-2"));

    sessionOne.resolve([snapshot()]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.runs.map((run) => run.run_id)).toEqual(["run-2"]);
  });

  it("gates the previous owner before passive session reset and blocks stale controls", async () => {
    const sessionTwo = deferred<WorkflowRunSnapshot[]>();
    const list = vi.fn((sessionId: string) =>
      sessionId === "session-1" ? Promise.resolve([snapshot()]) : sessionTwo.promise,
    );
    const cancel = vi.fn(async () => snapshot({ status: "cancelled" }));
    const observations: Array<{
      sessionId: string;
      runIds: string[];
      status: string;
    }> = [];
    let probedSessionSwitch = false;
    const runClient = client({ list, cancel });

    const LayoutProbe = ({ selectedSessionId }: { selectedSessionId: string }) => {
      const runs = useWorkflowRuns(selectedSessionId, {
        client: runClient,
        pollIntervalMs: 60_000,
      });
      useLayoutEffect(() => {
        observations.push({
          sessionId: selectedSessionId,
          runIds: runs.runs.map((run) => run.run_id),
          status: runs.status,
        });
        if (selectedSessionId === "session-2" && !probedSessionSwitch) {
          probedSessionSwitch = true;
          void runs.refresh();
          void runs.cancel("run-1");
        }
      }, [runs, selectedSessionId]);
      return null;
    };

    const view = render(<LayoutProbe selectedSessionId="session-1" />);
    await waitFor(() =>
      expect(observations.some((entry) => entry.runIds.includes("run-1"))).toBe(true),
    );
    observations.length = 0;

    view.rerender(<LayoutProbe selectedSessionId="session-2" />);
    expect(observations[0]).toEqual({ sessionId: "session-2", runIds: [], status: "loading" });
    expect(list.mock.calls.filter(([sessionId]) => sessionId === "session-1")).toHaveLength(1);
    expect(cancel).not.toHaveBeenCalled();

    await act(async () => sessionTwo.resolve([]));
    await waitFor(() => expect(observations[observations.length - 1]?.status).toBe("ready"));
  });

  it("does not adopt a completed cancel mutation after switching sessions", async () => {
    const cancelRequest = deferred<WorkflowRunSnapshot>();
    const runClient = client({
      list: vi.fn(async (sessionId) =>
        sessionId === "session-1"
          ? [snapshot()]
          : [snapshot({ run_id: "run-2", session_id: "session-2", workflow_id: "second" })],
      ),
      cancel: vi.fn(() => cancelRequest.promise),
    });
    const { result, rerender } = renderRuns("session-1", runClient);
    await waitFor(() => expect(result.current.runs[0]?.run_id).toBe("run-1"));

    let cancelPromise!: Promise<void>;
    act(() => {
      cancelPromise = result.current.cancel("run-1");
    });
    rerender({ selectedSessionId: "session-2" });
    await waitFor(() => expect(result.current.runs[0]?.run_id).toBe("run-2"));

    cancelRequest.resolve(snapshot({ status: "cancelled", last_sequence: 12 }));
    await act(async () => cancelPromise);
    expect(runClient.cancel).toHaveBeenCalledWith("session-1", "run-1");
    expect(result.current.runs.map((run) => run.run_id)).toEqual(["run-2"]);
  });

  it("detects an event gap, discards the tail, and recovers only from an advanced snapshot", async () => {
    const base = snapshot();
    const stillBehindObservedTail = snapshot({
      status: "suspended",
      last_sequence: 11,
      updated_at: "2026-08-27T01:00:11Z",
    });
    const healed = snapshot({
      status: "suspended",
      last_sequence: 12,
      updated_at: "2026-08-27T01:00:12Z",
    });
    const list = vi
      .fn()
      .mockResolvedValueOnce([base])
      .mockResolvedValueOnce([stillBehindObservedTail])
      .mockResolvedValueOnce([healed]);
    const runClient = client({
      list,
      getEvents: vi
        .fn()
        .mockResolvedValueOnce([runEvent(12, { type: "run_suspended" })])
        .mockResolvedValueOnce([]),
    });
    const { result } = renderRuns("session-1", runClient);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => result.current.refresh());
    expect(result.current.status).toBe("out_of_sync");
    expect(result.current.runs[0]).toMatchObject({ status: "running", last_sequence: 10 });

    await act(async () => result.current.refresh());
    expect(result.current.status).toBe("ready");
    expect(result.current.runs[0]).toMatchObject({ status: "suspended", last_sequence: 12 });
  });

  it("does not publish an event projection until a snapshot reaches the event cursor", async () => {
    const base = snapshot();
    const authoritative = snapshot({
      status: "suspended",
      last_sequence: 11,
      usage: { steps: 1, retries: 0, agents: 1, tokens: 25, cost_micros: 3 },
      child_agent_count: 1,
    });
    const runClient = client({
      list: vi
        .fn()
        .mockResolvedValueOnce([base])
        .mockResolvedValueOnce([base])
        .mockResolvedValueOnce([authoritative]),
      getEvents: vi.fn(async () => [runEvent(11, { type: "run_suspended" })]),
    });
    const { result } = renderRuns("session-1", runClient);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => result.current.refresh());
    expect(result.current.status).toBe("out_of_sync");
    expect(result.current.runs[0]).toMatchObject({
      status: "running",
      last_sequence: 10,
      child_agent_count: 0,
    });

    await act(async () => result.current.refresh());
    expect(result.current.status).toBe("ready");
    expect(result.current.runs[0]).toMatchObject({
      status: "suspended",
      last_sequence: 11,
      child_agent_count: 1,
      usage: { tokens: 25 },
    });
  });

  it("keeps polling the authoritative list when it is empty or every known run is terminal", async () => {
    const terminal = snapshot({ status: "succeeded", last_sequence: 20 });
    const discovered = snapshot({
      run_id: "run-2",
      workflow_id: "new-run",
      created_at: "2026-08-27T02:00:00Z",
    });
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([terminal])
      .mockResolvedValueOnce([terminal, discovered]);
    const getEvents = vi.fn(async () => []);
    const { result } = renderRuns("session-1", client({ list, getEvents }));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.runs).toEqual([]);

    await act(async () => result.current.refresh());
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.runs[0].status).toBe("succeeded");

    await act(async () => result.current.refresh());
    expect(result.current.runs.map((run) => run.run_id)).toEqual(["run-2", "run-1"]);
    expect(getEvents).not.toHaveBeenCalled();
  });

  it("reuses unchanged authoritative snapshots across list discovery polls", async () => {
    const base = snapshot();
    const runClient = client({
      list: vi
        .fn()
        .mockResolvedValueOnce([base])
        .mockResolvedValueOnce([structuredClone(base)]),
    });
    const { result } = renderRuns("session-1", runClient);
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const firstRuns = result.current.runs;

    await act(async () => result.current.refresh());
    expect(result.current.runs).toBe(firstRuns);
  });

  it("never optimistically cancels and rehydrates a terminal race after one cancel intent", async () => {
    const cancelRequest = deferred<WorkflowRunSnapshot>();
    const runClient = client({
      list: vi.fn(async () => [snapshot()]),
      cancel: vi.fn(() => cancelRequest.promise),
      getSnapshot: vi.fn(async () =>
        snapshot({ status: "succeeded", last_sequence: 12, updated_at: "2026-08-27T01:00:12Z" }),
      ),
    });
    const { result } = renderRuns("session-1", runClient);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let cancelPromise!: Promise<void>;
    act(() => {
      cancelPromise = result.current.cancel("run-1");
    });
    await waitFor(() => expect(result.current.cancellingRunIds.has("run-1")).toBe(true));
    expect(result.current.runs[0].status).toBe("running");
    expect(runClient.cancel).toHaveBeenCalledWith("session-1", "run-1");

    cancelRequest.reject(new Error("terminal race"));
    await act(async () => cancelPromise);
    expect(runClient.getSnapshot).toHaveBeenCalledWith(
      "session-1",
      "run-1",
      expect.any(AbortSignal),
    );
    expect(result.current.runs[0].status).toBe("succeeded");
    expect(result.current.cancelErrorRunIds.has("run-1")).toBe(false);
  });

  it("never lets a stale cancel rehydrate roll back a newer poll snapshot", async () => {
    const rehydrate = deferred<WorkflowRunSnapshot>();
    const advanced = snapshot({
      status: "succeeded",
      last_sequence: 13,
      updated_at: "2026-08-27T01:00:13Z",
    });
    const runClient = client({
      list: vi.fn().mockResolvedValueOnce([snapshot()]).mockResolvedValueOnce([advanced]),
      cancel: vi.fn(async () => {
        throw new Error("ambiguous response");
      }),
      getSnapshot: vi.fn(() => rehydrate.promise),
    });
    const { result } = renderRuns("session-1", runClient);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let cancelPromise!: Promise<void>;
    act(() => {
      cancelPromise = result.current.cancel("run-1");
    });
    await waitFor(() => expect(runClient.getSnapshot).toHaveBeenCalledTimes(1));

    await act(async () => result.current.refresh());
    expect(result.current.runs[0]).toMatchObject({ status: "succeeded", last_sequence: 13 });

    rehydrate.resolve(
      snapshot({
        status: "cancelled",
        last_sequence: 12,
        updated_at: "2026-08-27T01:00:12Z",
      }),
    );
    await act(async () => cancelPromise);
    expect(result.current.runs[0]).toMatchObject({ status: "succeeded", last_sequence: 13 });
    expect(result.current.cancelErrorRunIds.has("run-1")).toBe(false);
  });

  it("preserves another run's out-of-sync status when cancellation settles", async () => {
    const runOne = snapshot();
    const runTwo = snapshot({
      run_id: "run-2",
      workflow_id: "second",
      last_sequence: 20,
      created_at: "2026-08-27T02:00:00Z",
      updated_at: "2026-08-27T02:00:20Z",
    });
    const runClient = client({
      list: vi.fn().mockResolvedValueOnce([runOne, runTwo]).mockResolvedValueOnce([runOne, runTwo]),
      getEvents: vi.fn(async (_sessionId, runId) =>
        runId === "run-1" ? [runEvent(12, { type: "run_suspended" })] : [],
      ),
      cancel: vi.fn(async () =>
        snapshot({
          ...runTwo,
          status: "cancelled",
          last_sequence: 21,
          updated_at: "2026-08-27T02:00:21Z",
        }),
      ),
    });
    const { result } = renderRuns("session-1", runClient);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => result.current.refresh());
    expect(result.current.status).toBe("out_of_sync");

    await act(async () => result.current.cancel("run-2"));
    expect(result.current.runs.find((run) => run.run_id === "run-2")).toMatchObject({
      status: "cancelled",
      last_sequence: 21,
    });
    expect(result.current.status).toBe("out_of_sync");
  });

  it("clears a prior cancel warning when the authoritative list confirms terminal state", async () => {
    const terminal = snapshot({
      status: "failed",
      last_sequence: 12,
      updated_at: "2026-08-27T01:00:12Z",
    });
    const runClient = client({
      list: vi.fn().mockResolvedValueOnce([snapshot()]).mockResolvedValueOnce([terminal]),
      cancel: vi.fn(async () => {
        throw new Error("not confirmed");
      }),
      getSnapshot: vi.fn(async () => snapshot()),
    });
    const { result } = renderRuns("session-1", runClient);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => result.current.cancel("run-1"));
    expect(result.current.cancelErrorRunIds.has("run-1")).toBe(true);

    await act(async () => result.current.refresh());
    expect(result.current.runs[0].status).toBe("failed");
    expect(result.current.cancelErrorRunIds.has("run-1")).toBe(false);
    expect(result.current.cancellingRunIds.has("run-1")).toBe(false);
  });

  it("does not let an in-flight stale list roll back an authoritative cancel response", async () => {
    const base = snapshot();
    const staleList = deferred<WorkflowRunSnapshot[]>();
    const runClient = client({
      list: vi.fn().mockResolvedValueOnce([base]).mockReturnValueOnce(staleList.promise),
      getEvents: vi.fn(async () => []),
      cancel: vi.fn(async () =>
        snapshot({ status: "cancelled", last_sequence: 12, updated_at: "2026-08-27T01:00:12Z" }),
      ),
    });
    const { result } = renderRuns("session-1", runClient);
    await waitFor(() => expect(result.current.status).toBe("ready"));

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refresh();
    });
    await waitFor(() => expect(runClient.list).toHaveBeenCalledTimes(2));

    await act(async () => result.current.cancel("run-1"));
    expect(result.current.runs[0]).toMatchObject({ status: "cancelled", last_sequence: 12 });

    staleList.resolve([base]);
    await act(async () => refreshPromise);
    expect(result.current.runs[0]).toMatchObject({ status: "cancelled", last_sequence: 12 });
    expect(result.current.status).toBe("out_of_sync");
  });
});
