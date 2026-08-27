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

interface OwnedWorkflowRunsState extends WorkflowRunsState {
  ownerSessionId: string | null;
}

const EMPTY_RUNS: WorkflowRunSnapshot[] = [];
const EMPTY_RUN_IDS: ReadonlySet<string> = new Set();

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

const reuseUnchangedSnapshots = (
  current: WorkflowRunSnapshot[],
  incoming: WorkflowRunSnapshot[],
): WorkflowRunSnapshot[] => {
  const currentById = new Map(current.map((run) => [run.run_id, run]));
  const reused = incoming.map((run) => {
    const previous = currentById.get(run.run_id);
    return previous?.last_sequence === run.last_sequence && previous.updated_at === run.updated_at
      ? previous
      : run;
  });
  return reused.length === current.length && reused.every((run, index) => run === current[index])
    ? current
    : reused;
};

const setsEqual = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean =>
  left.size === right.size && [...left].every((value) => right.has(value));

interface MonotonicSnapshotAdoption {
  runs: WorkflowRunSnapshot[];
  effectiveSnapshot: WorkflowRunSnapshot | null;
}

const adoptSnapshotMonotonically = (
  runs: readonly WorkflowRunSnapshot[],
  incoming: WorkflowRunSnapshot,
  minimumSequence = 0,
): MonotonicSnapshotAdoption => {
  const current = runs.find((run) => run.run_id === incoming.run_id);
  if (
    incoming.last_sequence < minimumSequence ||
    (current !== undefined && incoming.last_sequence < current.last_sequence)
  ) {
    return { runs: [...runs], effectiveSnapshot: current ?? null };
  }
  return { runs: replaceSnapshot(runs, incoming), effectiveSnapshot: incoming };
};

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
  const [state, setState] = useState<OwnedWorkflowRunsState>({
    ownerSessionId: sessionId,
    runs: [],
    status: sessionId ? "loading" : "idle",
    cancellingRunIds: new Set(),
    cancelErrorRunIds: new Set(),
  });
  const runsRef = useRef<WorkflowRunSnapshot[]>([]);
  const recoveryFloorsRef = useRef<Map<string, number>>(new Map());
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
      recoveryFloorsRef.current.clear();
      setState({
        ownerSessionId: null,
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
    recoveryFloorsRef.current.clear();
    setState({
      ownerSessionId: sessionId,
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
                const recoveryFloor =
                  replay.issue.type === "gap"
                    ? replay.issue.received_sequence
                    : replay.issue.sequence;
                recoveryFloorsRef.current.set(
                  run.run_id,
                  Math.max(recoveryFloorsRef.current.get(run.run_id) ?? 0, recoveryFloor),
                );
              } else if (replay.applied > 0) {
                // Events lack attempts, budget, usage, suspension and other
                // snapshot metadata. Record the required cursor, then publish
                // only a refetched authoritative snapshot at/after it.
                recoveryFloorsRef.current.set(
                  run.run_id,
                  Math.max(
                    recoveryFloorsRef.current.get(run.run_id) ?? 0,
                    replay.run.last_sequence,
                  ),
                );
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
          const recoveryFloor = recoveryFloorsRef.current.get(snapshot.run_id);

          if (recoveryFloor !== undefined && snapshot.last_sequence < recoveryFloor) {
            outOfSync = true;
            return previous ?? snapshot;
          }
          if (previous && snapshot.last_sequence < previous.last_sequence) {
            recoveryFloorsRef.current.set(
              snapshot.run_id,
              Math.max(recoveryFloorsRef.current.get(snapshot.run_id) ?? 0, previous.last_sequence),
            );
            outOfSync = true;
            return previous;
          }
          if (recoveryFloor !== undefined) recoveryFloorsRef.current.delete(snapshot.run_id);
          return snapshot;
        });

        const listedRunIds = new Set(snapshots.map((snapshot) => snapshot.run_id));
        for (const runId of recoveryFloorsRef.current.keys()) {
          if (!listedRunIds.has(runId)) recoveryFloorsRef.current.delete(runId);
        }

        // A malformed/missing event tail for a run that disappeared from the
        // authoritative session list needs no local placeholder.
        runsRef.current = reuseUnchangedSnapshots(runsRef.current, sortRuns(nextRuns));
        const liveRunIds = new Set(
          runsRef.current
            .filter((run) => !isWorkflowRunTerminal(run.status))
            .map((run) => run.run_id),
        );
        setState((current) => {
          const status = outOfSync ? "out_of_sync" : "ready";
          const cancellingRunIds = new Set(
            [...current.cancellingRunIds].filter((runId) => liveRunIds.has(runId)),
          );
          const cancelErrorRunIds = new Set(
            [...current.cancelErrorRunIds].filter((runId) => liveRunIds.has(runId)),
          );
          if (
            current.runs === runsRef.current &&
            current.status === status &&
            setsEqual(current.cancellingRunIds, cancellingRunIds) &&
            setsEqual(current.cancelErrorRunIds, cancelErrorRunIds)
          ) {
            return current;
          }
          return {
            ...current,
            runs: runsRef.current,
            status,
            cancellingRunIds,
            cancelErrorRunIds,
          };
        });
      } catch (error) {
        if (!isCurrent() || isAbortError(error)) return;
        setState((current) => ({
          ...current,
          status: recoveryFloorsRef.current.size > 0 ? "out_of_sync" : "unavailable",
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

  const refresh = useCallback((): Promise<void> => {
    const active = activeRequestRef.current;
    if (
      !sessionId ||
      !active ||
      active.sessionId !== sessionId ||
      active.generation !== generationRef.current ||
      active.controller.signal.aborted
    ) {
      return Promise.resolve();
    }
    return refreshRef.current();
  }, [sessionId]);

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
      const adoptSnapshot = (snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot | null => {
        const recoveryFloor = recoveryFloorsRef.current.get(runId);
        const adoption = adoptSnapshotMonotonically(runsRef.current, snapshot, recoveryFloor ?? 0);
        const effectiveSnapshot = adoption.effectiveSnapshot;
        if (
          recoveryFloor !== undefined &&
          effectiveSnapshot !== null &&
          effectiveSnapshot.last_sequence >= recoveryFloor
        ) {
          recoveryFloorsRef.current.delete(runId);
        }
        runsRef.current = adoption.runs;
        // A mutation only updates its target snapshot. Global sync health is
        // owned by performSync, since another run can still be out of sync.
        setState((current) => ({ ...current, runs: runsRef.current }));
        return effectiveSnapshot;
      };
      try {
        // Once sent, the mutation must finish independently of this pane's GET
        // lifecycle. The generation guard below prevents stale UI adoption.
        const snapshot = await client.cancel(sessionId, runId);
        if (!isCurrent()) return;
        const effectiveSnapshot = adoptSnapshot(snapshot);
        settled = effectiveSnapshot !== null && isWorkflowRunTerminal(effectiveSnapshot.status);
      } catch (error) {
        if (!isCurrent() || isAbortError(error)) return;
        // A terminal transition can race the cancel POST (notably HTTP 409) or
        // the response can be ambiguous. Rehydrate before allowing a retry;
        // never synthesize `cancelled` in the browser.
        try {
          const snapshot = await client.getSnapshot(sessionId, runId, controller.signal);
          if (!isCurrent()) return;
          const effectiveSnapshot = adoptSnapshot(snapshot);
          settled = effectiveSnapshot !== null && isWorkflowRunTerminal(effectiveSnapshot.status);
        } catch (rehydrateError) {
          if (!isCurrent() || isAbortError(rehydrateError)) return;
        }
      } finally {
        if (isCurrent()) {
          const currentSnapshot = runsRef.current.find((run) => run.run_id === runId);
          const terminalOrNoLongerListed =
            currentSnapshot === undefined || isWorkflowRunTerminal(currentSnapshot.status);
          setState((current) => ({
            ...current,
            cancellingRunIds: new Set(
              [...current.cancellingRunIds].filter((candidate) => candidate !== runId),
            ),
            cancelErrorRunIds:
              settled || terminalOrNoLongerListed
                ? new Set([...current.cancelErrorRunIds].filter((candidate) => candidate !== runId))
                : new Set(current.cancelErrorRunIds).add(runId),
          }));
        }
      }
    },
    [client, sessionId],
  );

  const ownsCurrentSession = state.ownerSessionId === sessionId;
  const visibleState: WorkflowRunsState = ownsCurrentSession
    ? {
        runs: state.runs,
        status: state.status,
        cancellingRunIds: state.cancellingRunIds,
        cancelErrorRunIds: state.cancelErrorRunIds,
      }
    : {
        runs: EMPTY_RUNS,
        status: sessionId ? "loading" : "idle",
        cancellingRunIds: EMPTY_RUN_IDS,
        cancelErrorRunIds: EMPTY_RUN_IDS,
      };

  return { ...visibleState, refresh, cancel };
};
