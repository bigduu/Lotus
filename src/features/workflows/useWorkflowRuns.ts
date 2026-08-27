import { useCallback, useEffect, useRef, useState } from "react";

import { bambooWorkflowRunClient, type WorkflowRunClient } from "./clients";
import type { WorkflowRunSnapshot } from "./domain";
import { isWorkflowRunTerminal, reconstructWorkflowRun } from "./runReconstruction";

const DEFAULT_POLL_INTERVAL_MS = 2_000;

export type WorkflowRunsSyncStatus = "idle" | "loading" | "ready" | "unavailable" | "out_of_sync";

export interface WorkflowRunsState {
  runs: WorkflowRunSnapshot[];
  status: WorkflowRunsSyncStatus;
  cancellingRunIds: ReadonlySet<string>;
  cancelErrorRunIds: ReadonlySet<string>;
}

export interface UseWorkflowRunsResult extends WorkflowRunsState {
  refresh: () => Promise<void>;
  cancel: (runId: string) => Promise<void>;
}

export interface UseWorkflowRunsOptions {
  client?: WorkflowRunClient;
  pollIntervalMs?: number;
}

const sortRuns = (runs: readonly WorkflowRunSnapshot[]): WorkflowRunSnapshot[] =>
  [...runs].sort(
    (left, right) =>
      Date.parse(right.created_at) - Date.parse(left.created_at) ||
      left.run_id.localeCompare(right.run_id),
  );

const replaceSnapshot = (
  runs: readonly WorkflowRunSnapshot[],
  snapshot: WorkflowRunSnapshot,
): WorkflowRunSnapshot[] =>
  sortRuns([snapshot, ...runs.filter((run) => run.run_id !== snapshot.run_id)]);

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError"
    : Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");

/**
 * Session-scoped WorkflowRun query. Server state stays behind this hook rather
 * than entering the global chat store; a generation + AbortSignal prevents an
 * old session's response from being committed after a pane switches sessions.
 */
export const useWorkflowRuns = (
  sessionId: string | null,
  options: UseWorkflowRunsOptions = {},
): UseWorkflowRunsResult => {
  const client = options.client ?? bambooWorkflowRunClient;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const [state, setState] = useState<WorkflowRunsState>({
    runs: [],
    status: sessionId ? "loading" : "idle",
    cancellingRunIds: new Set(),
    cancelErrorRunIds: new Set(),
  });
  const runsRef = useRef<WorkflowRunSnapshot[]>([]);
  const generationRef = useRef(0);
  const activeRequestRef = useRef<{
    sessionId: string;
    generation: number;
    controller: AbortController;
  } | null>(null);
  const refreshRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    runsRef.current = state.runs;
  }, [state.runs]);

  useEffect(() => {
    const generation = ++generationRef.current;
    activeRequestRef.current?.controller.abort();

    if (!sessionId) {
      activeRequestRef.current = null;
      runsRef.current = [];
      setState({
        runs: [],
        status: "idle",
        cancellingRunIds: new Set(),
        cancelErrorRunIds: new Set(),
      });
      refreshRef.current = async () => {};
      return;
    }

    const controller = new AbortController();
    activeRequestRef.current = { sessionId, generation, controller };
    runsRef.current = [];
    setState({
      runs: [],
      status: "loading",
      cancellingRunIds: new Set(),
      cancelErrorRunIds: new Set(),
    });

    let syncInFlight: Promise<void> | null = null;
    const isCurrent = () =>
      !controller.signal.aborted &&
      generationRef.current === generation &&
      activeRequestRef.current?.sessionId === sessionId;

    const performSync = async (): Promise<void> => {
      const baseline = runsRef.current;
      const expectedAfterEvents = new Map<string, number>();
      const sequenceIssueRuns = new Set<string>();

      await Promise.all(
        baseline
          .filter((run) => !isWorkflowRunTerminal(run.status))
          .map(async (run) => {
            try {
              const events = await client.getEvents(
                sessionId,
                run.run_id,
                run.last_sequence,
                controller.signal,
              );
              if (!isCurrent()) return;
              const replay = reconstructWorkflowRun(run, events);
              if (replay.issue) {
                sequenceIssueRuns.add(run.run_id);
              } else if (replay.applied > 0) {
                // Events lack attempts, budget, usage, suspension and other
                // snapshot metadata. Record the required cursor, then publish
                // only a refetched authoritative snapshot at/after it.
                expectedAfterEvents.set(run.run_id, replay.run.last_sequence);
              }
            } catch (error) {
              // A failed event read does not poison a subsequent authoritative
              // list snapshot. The list call below is the recovery boundary.
              if (isAbortError(error)) return;
            }
          }),
      );

      if (!isCurrent()) return;

      try {
        const snapshots = await client.list(sessionId, controller.signal);
        if (!isCurrent()) return;

        // Cancellation and another UI mutation can settle while this list GET
        // is in flight. Compare against the latest committed snapshot, not the
        // pre-poll baseline, so a stale list cannot roll a terminal response
        // back to running.
        const currentById = new Map(runsRef.current.map((run) => [run.run_id, run]));
        let outOfSync = false;
        const nextRuns = snapshots.map((snapshot) => {
          const previous = currentById.get(snapshot.run_id);
          const requiredSequence = expectedAfterEvents.get(snapshot.run_id);

          if (requiredSequence !== undefined && snapshot.last_sequence < requiredSequence) {
            outOfSync = true;
            return previous ?? snapshot;
          }
          if (
            sequenceIssueRuns.has(snapshot.run_id) &&
            previous &&
            snapshot.last_sequence <= previous.last_sequence
          ) {
            outOfSync = true;
            return previous;
          }
          if (previous && snapshot.last_sequence < previous.last_sequence) {
            outOfSync = true;
            return previous;
          }
          return snapshot;
        });

        // A malformed/missing event tail for a run that disappeared from the
        // authoritative session list needs no local placeholder.
        runsRef.current = sortRuns(nextRuns);
        setState((current) => ({
          ...current,
          runs: runsRef.current,
          status: outOfSync ? "out_of_sync" : "ready",
        }));
      } catch (error) {
        if (!isCurrent() || isAbortError(error)) return;
        setState((current) => ({
          ...current,
          status:
            expectedAfterEvents.size > 0 || sequenceIssueRuns.size > 0
              ? "out_of_sync"
              : "unavailable",
        }));
      }
    };

    const sync = (): Promise<void> => {
      if (syncInFlight) return syncInFlight;
      syncInFlight = performSync().finally(() => {
        syncInFlight = null;
      });
      return syncInFlight;
    };
    refreshRef.current = sync;
    void sync();
    const interval = window.setInterval(() => void sync(), Math.max(250, pollIntervalMs));

    return () => {
      window.clearInterval(interval);
      controller.abort();
      if (activeRequestRef.current?.generation === generation) activeRequestRef.current = null;
    };
  }, [client, pollIntervalMs, sessionId]);

  const refresh = useCallback(() => refreshRef.current(), []);

  const cancel = useCallback(
    async (runId: string): Promise<void> => {
      const active = activeRequestRef.current;
      if (!active || active.sessionId !== sessionId || active.controller.signal.aborted) return;
      const { generation, controller } = active;
      const isCurrent = () =>
        !controller.signal.aborted &&
        generationRef.current === generation &&
        activeRequestRef.current?.sessionId === sessionId;

      setState((current) => ({
        ...current,
        cancellingRunIds: new Set(current.cancellingRunIds).add(runId),
        cancelErrorRunIds: new Set(
          [...current.cancelErrorRunIds].filter((candidate) => candidate !== runId),
        ),
      }));

      let settled = false;
      try {
        // Once sent, the mutation must finish independently of this pane's GET
        // lifecycle. The generation guard below prevents stale UI adoption.
        const snapshot = await client.cancel(sessionId, runId);
        if (!isCurrent()) return;
        runsRef.current = replaceSnapshot(runsRef.current, snapshot);
        setState((current) => ({ ...current, runs: runsRef.current, status: "ready" }));
        settled = isWorkflowRunTerminal(snapshot.status);
      } catch (error) {
        if (!isCurrent() || isAbortError(error)) return;
        // A terminal transition can race the cancel POST (notably HTTP 409) or
        // the response can be ambiguous. Rehydrate before allowing a retry;
        // never synthesize `cancelled` in the browser.
        try {
          const snapshot = await client.getSnapshot(sessionId, runId, controller.signal);
          if (!isCurrent()) return;
          runsRef.current = replaceSnapshot(runsRef.current, snapshot);
          setState((current) => ({ ...current, runs: runsRef.current, status: "ready" }));
          settled = isWorkflowRunTerminal(snapshot.status);
        } catch (rehydrateError) {
          if (!isCurrent() || isAbortError(rehydrateError)) return;
        }
      } finally {
        if (isCurrent()) {
          setState((current) => ({
            ...current,
            cancellingRunIds: new Set(
              [...current.cancellingRunIds].filter((candidate) => candidate !== runId),
            ),
            cancelErrorRunIds: settled
              ? new Set([...current.cancelErrorRunIds].filter((candidate) => candidate !== runId))
              : new Set(current.cancelErrorRunIds).add(runId),
          }));
        }
      }
    },
    [client, sessionId],
  );

  return { ...state, refresh, cancel };
};
