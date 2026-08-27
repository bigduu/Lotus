import { type WorkflowRunClient } from "./clients";
import type { WorkflowRunSnapshot } from "./domain";
import { isWorkflowRunTerminal, reconstructWorkflowRun } from "./runReconstruction";

export type WorkflowRunsSyncStatus = "idle" | "loading" | "ready" | "unavailable" | "out_of_sync";

export interface WorkflowRunsState {
  runs: WorkflowRunSnapshot[];
  status: WorkflowRunsSyncStatus;
  cancellingRunIds: ReadonlySet<string>;
  cancelErrorRunIds: ReadonlySet<string>;
}

export interface WorkflowRunsQueryConfig {
  pollIntervalMs: number;
  initialIdlePollIntervalMs: number;
  maxIdlePollIntervalMs: number;
}

export interface WorkflowRunsQuerySignals {
  availability?: boolean | null;
  activationKey?: string | null;
}

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
  runs: WorkflowRunSnapshot[],
  incoming: WorkflowRunSnapshot,
  minimumSequence = 0,
): MonotonicSnapshotAdoption => {
  const current = runs.find((run) => run.run_id === incoming.run_id);
  if (
    incoming.last_sequence < minimumSequence ||
    (current !== undefined && incoming.last_sequence < current.last_sequence)
  ) {
    return { runs, effectiveSnapshot: current ?? null };
  }
  return { runs: replaceSnapshot(runs, incoming), effectiveSnapshot: incoming };
};

const isAbortError = (error: unknown): boolean =>
  typeof DOMException !== "undefined" && error instanceof DOMException
    ? error.name === "AbortError"
    : Boolean(error && typeof error === "object" && "name" in error && error.name === "AbortError");

const stateEqual = (left: WorkflowRunsState, right: WorkflowRunsState): boolean =>
  left.runs === right.runs &&
  left.status === right.status &&
  left.cancellingRunIds === right.cancellingRunIds &&
  left.cancelErrorRunIds === right.cancelErrorRunIds;

/**
 * One authoritative WorkflowRun discovery stream shared by every mounted
 * consumer of the same client/session/polling configuration.
 */
export class WorkflowRunsQueryStore {
  private state: WorkflowRunsState = {
    runs: [],
    status: "loading",
    cancellingRunIds: EMPTY_RUN_IDS,
    cancelErrorRunIds: EMPTY_RUN_IDS,
  };

  private readonly listeners = new Set<() => void>();
  private readonly recoveryFloors = new Map<string, number>();
  private readonly cancelInFlight = new Map<string, Promise<void>>();
  private runs: WorkflowRunSnapshot[] = [];
  private active = false;
  private generation = 0;
  private controller: AbortController | null = null;
  private syncInFlight: Promise<void> | null = null;
  private queuedImmediateSync: {
    promise: Promise<void>;
    resolve: () => void;
    reject: (reason: unknown) => void;
  } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private idlePollIntervalMs: number;
  private observedAvailability: boolean | null | undefined;
  private observedActivationKey: string | null = null;

  constructor(
    readonly sessionId: string,
    private readonly client: WorkflowRunClient,
    private readonly config: WorkflowRunsQueryConfig,
    private readonly onUnused: (store: WorkflowRunsQueryStore) => void,
    initialSignals: WorkflowRunsQuerySignals,
  ) {
    this.idlePollIntervalMs = config.pollIntervalMs;
    this.observedAvailability = initialSignals.availability;
    this.observedActivationKey = initialSignals.activationKey?.trim() || null;
  }

  getSnapshot = (): WorkflowRunsState => this.state;

  getServerSnapshot = (): WorkflowRunsState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (!this.active) this.start();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size !== 0) return;

      // Stop transport work immediately. Defer only registry eviction so a
      // StrictMode unsubscribe/subscribe pair can reuse this exact store.
      this.stop();
      queueMicrotask(() => {
        if (this.listeners.size === 0) this.onUnused(this);
      });
    };
  };

  refresh = (): Promise<void> => this.sync(true);

  observeAvailability = (availability: boolean | null | undefined): void => {
    const recovered = this.observedAvailability === false && availability === true;
    this.observedAvailability = availability;
    if (recovered) void this.refresh();
  };

  observeActivationKey = (activationKey: string | null | undefined): void => {
    const normalized = activationKey?.trim() || null;
    if (normalized === this.observedActivationKey) return;
    this.observedActivationKey = normalized;
    if (normalized !== null) void this.refresh();
  };

  cancel = (runId: string): Promise<void> => {
    const existing = this.cancelInFlight.get(runId);
    if (existing) return existing;
    // Before the first owned snapshot arrives, controls still belong to the
    // previous render generation and must remain inert. Once synchronized,
    // retain #232's public cancel semantics (including unknown/terminal ids).
    if (!this.active || this.state.status === "loading") return Promise.resolve();

    const operation = this.performCancel(runId).finally(() => {
      if (this.cancelInFlight.get(runId) === operation) this.cancelInFlight.delete(runId);
    });
    this.cancelInFlight.set(runId, operation);
    return operation;
  };

  disposeForHotReload = (): void => {
    this.listeners.clear();
    this.stop();
  };

  primeSignals(signals: WorkflowRunsQuerySignals): void {
    if (this.active) return;
    this.observedAvailability = signals.availability;
    this.observedActivationKey = signals.activationKey?.trim() || null;
  }

  private start(): void {
    this.active = true;
    this.generation += 1;
    this.controller = new AbortController();
    this.resetBackoff();
    activeStores.add(this);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
    }
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
    void this.sync(false);
  }

  private stop(): void {
    if (!this.active) return;
    this.active = false;
    this.generation += 1;
    this.clearTimer();
    this.controller?.abort();
    this.controller = null;
    this.syncInFlight = null;
    this.queuedImmediateSync?.resolve();
    this.queuedImmediateSync = null;
    activeStores.delete(this);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
    }
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
  }

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "visible") void this.refresh();
  };

  private readonly onOnline = (): void => {
    void this.refresh();
  };

  private isCurrent(generation: number, controller: AbortController): boolean {
    return (
      this.active &&
      this.generation === generation &&
      this.controller === controller &&
      !controller.signal.aborted
    );
  }

  private sync(resetBackoff: boolean): Promise<void> {
    if (!this.active || !this.controller) return Promise.resolve();
    if (resetBackoff) this.resetBackoff();
    if (this.syncInFlight) {
      if (!resetBackoff) return this.syncInFlight;
      if (!this.queuedImmediateSync) {
        let resolve!: () => void;
        let reject!: (reason: unknown) => void;
        const promise = new Promise<void>((resolvePromise, rejectPromise) => {
          resolve = resolvePromise;
          reject = rejectPromise;
        });
        this.queuedImmediateSync = { promise, resolve, reject };
      }
      return this.queuedImmediateSync.promise;
    }

    const generation = this.generation;
    const controller = this.controller;
    const syncStartedAt = Date.now();
    const operation = this.performSync(generation, controller).finally(() => {
      if (this.syncInFlight !== operation) return;
      this.syncInFlight = null;
      if (!this.isCurrent(generation, controller)) return;

      const queued = this.queuedImmediateSync;
      this.queuedImmediateSync = null;
      if (queued) {
        // A force signal that arrives during a request is not satisfied by a
        // request which may have started before that signal. Coalesce every
        // such signal into exactly one trailing authoritative sync.
        this.resetBackoff();
        this.sync(false).then(queued.resolve, queued.reject);
      } else {
        this.scheduleNextSync(syncStartedAt);
      }
    });
    this.syncInFlight = operation;
    return operation;
  }

  private async performSync(generation: number, controller: AbortController): Promise<void> {
    const baseline = this.runs;

    await Promise.all(
      baseline
        .filter((run) => !isWorkflowRunTerminal(run.status))
        .map(async (run) => {
          try {
            const events = await this.client.getEvents(
              this.sessionId,
              run.run_id,
              run.last_sequence,
              controller.signal,
            );
            if (!this.isCurrent(generation, controller)) return;
            const replay = reconstructWorkflowRun(run, events);
            if (replay.issue) {
              const recoveryFloor =
                replay.issue.type === "gap"
                  ? replay.issue.received_sequence
                  : replay.issue.sequence;
              this.recoveryFloors.set(
                run.run_id,
                Math.max(this.recoveryFloors.get(run.run_id) ?? 0, recoveryFloor),
              );
            } else if (replay.applied > 0) {
              // Events intentionally remain a cursor/invalidation signal. Only
              // a subsequent authoritative snapshot may enter React state.
              this.recoveryFloors.set(
                run.run_id,
                Math.max(this.recoveryFloors.get(run.run_id) ?? 0, replay.run.last_sequence),
              );
            }
          } catch (error) {
            if (isAbortError(error)) return;
            // The authoritative list below remains the recovery boundary.
          }
        }),
    );

    if (!this.isCurrent(generation, controller)) return;

    try {
      const snapshots = await this.client.list(this.sessionId, controller.signal);
      if (!this.isCurrent(generation, controller)) return;

      // A shared cancellation can settle while this list request is in flight.
      // Compare with the latest shared snapshot so stale discovery cannot roll
      // an authoritative mutation response backwards in any pane.
      const currentById = new Map(this.runs.map((run) => [run.run_id, run]));
      let outOfSync = false;
      const nextRuns = snapshots.map((snapshot) => {
        const previous = currentById.get(snapshot.run_id);
        const recoveryFloor = this.recoveryFloors.get(snapshot.run_id);

        if (recoveryFloor !== undefined && snapshot.last_sequence < recoveryFloor) {
          outOfSync = true;
          return previous ?? snapshot;
        }
        if (previous && snapshot.last_sequence < previous.last_sequence) {
          this.recoveryFloors.set(
            snapshot.run_id,
            Math.max(this.recoveryFloors.get(snapshot.run_id) ?? 0, previous.last_sequence),
          );
          outOfSync = true;
          return previous;
        }
        if (recoveryFloor !== undefined) this.recoveryFloors.delete(snapshot.run_id);
        return snapshot;
      });

      const listedRunIds = new Set(snapshots.map((snapshot) => snapshot.run_id));
      for (const runId of this.recoveryFloors.keys()) {
        if (!listedRunIds.has(runId)) this.recoveryFloors.delete(runId);
      }

      this.runs = reuseUnchangedSnapshots(this.runs, sortRuns(nextRuns));
      const liveRunIds = new Set(
        this.runs.filter((run) => !isWorkflowRunTerminal(run.status)).map((run) => run.run_id),
      );
      const cancellingRunIds = new Set(
        [...this.state.cancellingRunIds].filter((runId) => liveRunIds.has(runId)),
      );
      const cancelErrorRunIds = new Set(
        [...this.state.cancelErrorRunIds].filter((runId) => liveRunIds.has(runId)),
      );
      this.publish({
        runs: this.runs,
        status: outOfSync ? "out_of_sync" : "ready",
        cancellingRunIds: setsEqual(this.state.cancellingRunIds, cancellingRunIds)
          ? this.state.cancellingRunIds
          : cancellingRunIds,
        cancelErrorRunIds: setsEqual(this.state.cancelErrorRunIds, cancelErrorRunIds)
          ? this.state.cancelErrorRunIds
          : cancelErrorRunIds,
      });
      this.updateBackoff();
    } catch (error) {
      if (!this.isCurrent(generation, controller) || isAbortError(error)) return;
      this.publish({
        ...this.state,
        status: this.recoveryFloors.size > 0 ? "out_of_sync" : "unavailable",
      });
      this.updateBackoff();
    }
  }

  private async performCancel(runId: string): Promise<void> {
    const controller = this.controller;
    if (!controller) return;
    const generation = this.generation;
    const isCurrent = () => this.isCurrent(generation, controller);

    this.publish({
      ...this.state,
      cancellingRunIds: new Set(this.state.cancellingRunIds).add(runId),
      cancelErrorRunIds: new Set(
        [...this.state.cancelErrorRunIds].filter((candidate) => candidate !== runId),
      ),
    });

    let settled = false;
    const adoptSnapshot = (snapshot: WorkflowRunSnapshot): WorkflowRunSnapshot | null => {
      const recoveryFloor = this.recoveryFloors.get(runId);
      const adoption = adoptSnapshotMonotonically(this.runs, snapshot, recoveryFloor ?? 0);
      const effectiveSnapshot = adoption.effectiveSnapshot;
      if (
        recoveryFloor !== undefined &&
        effectiveSnapshot !== null &&
        effectiveSnapshot.last_sequence >= recoveryFloor
      ) {
        this.recoveryFloors.delete(runId);
      }
      if (adoption.runs !== this.runs) {
        this.runs = adoption.runs;
        this.publish({ ...this.state, runs: this.runs });
      }
      return effectiveSnapshot;
    };

    try {
      // The POST is intentionally independent from the shared GET controller;
      // generation checks prevent adoption after the final consumer unmounts.
      const snapshot = await this.client.cancel(this.sessionId, runId);
      if (!isCurrent()) return;
      const effectiveSnapshot = adoptSnapshot(snapshot);
      settled = effectiveSnapshot !== null && isWorkflowRunTerminal(effectiveSnapshot.status);
    } catch (error) {
      if (!isCurrent() || isAbortError(error)) return;
      try {
        const snapshot = await this.client.getSnapshot(this.sessionId, runId, controller.signal);
        if (!isCurrent()) return;
        const effectiveSnapshot = adoptSnapshot(snapshot);
        settled = effectiveSnapshot !== null && isWorkflowRunTerminal(effectiveSnapshot.status);
      } catch (rehydrateError) {
        if (!isCurrent() || isAbortError(rehydrateError)) return;
      }
    } finally {
      if (isCurrent()) {
        const currentSnapshot = this.runs.find((run) => run.run_id === runId);
        const terminalOrNoLongerListed =
          currentSnapshot === undefined || isWorkflowRunTerminal(currentSnapshot.status);
        const cancellingRunIds = new Set(
          [...this.state.cancellingRunIds].filter((candidate) => candidate !== runId),
        );
        const cancelErrorRunIds =
          settled || terminalOrNoLongerListed
            ? new Set([...this.state.cancelErrorRunIds].filter((candidate) => candidate !== runId))
            : new Set(this.state.cancelErrorRunIds).add(runId);
        this.publish({
          ...this.state,
          cancellingRunIds: setsEqual(this.state.cancellingRunIds, cancellingRunIds)
            ? this.state.cancellingRunIds
            : cancellingRunIds,
          cancelErrorRunIds: setsEqual(this.state.cancelErrorRunIds, cancelErrorRunIds)
            ? this.state.cancelErrorRunIds
            : cancelErrorRunIds,
        });
      }
    }
  }

  private publish(next: WorkflowRunsState): void {
    if (stateEqual(this.state, next)) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  private resetBackoff(): void {
    this.idlePollIntervalMs = this.config.pollIntervalMs;
    this.clearTimer();
  }

  private updateBackoff(): void {
    const hasActiveRun = this.runs.some((run) => !isWorkflowRunTerminal(run.status));
    this.idlePollIntervalMs =
      hasActiveRun || this.state.status === "out_of_sync"
        ? this.config.pollIntervalMs
        : Math.min(
            this.config.maxIdlePollIntervalMs,
            Math.max(this.config.initialIdlePollIntervalMs, this.idlePollIntervalMs * 2),
          );
  }

  private scheduleNextSync(syncStartedAt: number): void {
    this.clearTimer();
    const elapsedMs = Math.max(0, Date.now() - syncStartedAt);
    const delayMs = Math.max(0, this.idlePollIntervalMs - elapsedMs);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync(false);
    }, delayMs);
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

let storesByClient = new WeakMap<WorkflowRunClient, Map<string, WorkflowRunsQueryStore>>();
const activeStores = new Set<WorkflowRunsQueryStore>();

const registryKey = (sessionId: string, config: WorkflowRunsQueryConfig): string =>
  JSON.stringify([
    sessionId,
    config.pollIntervalMs,
    config.initialIdlePollIntervalMs,
    config.maxIdlePollIntervalMs,
  ]);

export const getWorkflowRunsQueryStore = (
  client: WorkflowRunClient,
  sessionId: string,
  config: WorkflowRunsQueryConfig,
  signals: WorkflowRunsQuerySignals,
): WorkflowRunsQueryStore => {
  let clientStores = storesByClient.get(client);
  if (!clientStores) {
    clientStores = new Map();
    storesByClient.set(client, clientStores);
  }

  const key = registryKey(sessionId, config);
  const existing = clientStores.get(key);
  if (existing) {
    existing.primeSignals(signals);
    return existing;
  }

  const store = new WorkflowRunsQueryStore(
    sessionId,
    client,
    config,
    (unusedStore) => {
      if (clientStores?.get(key) === unusedStore) clientStores.delete(key);
    },
    signals,
  );
  clientStores.set(key, store);
  return store;
};

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const store of activeStores) store.disposeForHotReload();
    activeStores.clear();
    storesByClient = new WeakMap();
  });
}
