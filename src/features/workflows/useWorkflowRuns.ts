import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import { bambooWorkflowRunClient, type WorkflowRunClient } from "./clients";
import { getWorkflowRunsQueryStore, type WorkflowRunsState } from "./workflowRunsQueryStore";

export type { WorkflowRunsState, WorkflowRunsSyncStatus } from "./workflowRunsQueryStore";

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_INITIAL_IDLE_POLL_INTERVAL_MS = 5_000;
/**
 * The visible/available steady-state list-start interval is capped at 30s when
 * no prior request is still in flight. Reads remain serialized, so a longer
 * request and JavaScript scheduling still contribute to end-to-end discovery.
 */
const DEFAULT_MAX_IDLE_POLL_INTERVAL_MS = 30_000;
const MINIMUM_POLL_INTERVAL_MS = 250;

export interface UseWorkflowRunsResult extends WorkflowRunsState {
  refresh: () => Promise<void>;
  cancel: (runId: string) => Promise<void>;
}

export interface UseWorkflowRunsOptions {
  client?: WorkflowRunClient;
  pollIntervalMs?: number;
  initialIdlePollIntervalMs?: number;
  maxIdlePollIntervalMs?: number;
  /** Narrow reconnect signal supplied by the owning surface. */
  availability?: boolean | null;
  /** Safe receipt identity; never pass Workflow args, bodies, or paths. */
  activationKey?: string | null;
}

const EMPTY_RUNS: WorkflowRunsState["runs"] = [];
const EMPTY_RUN_IDS: ReadonlySet<string> = new Set();
const IDLE_STATE: WorkflowRunsState = {
  runs: EMPTY_RUNS,
  status: "idle",
  cancellingRunIds: EMPTY_RUN_IDS,
  cancelErrorRunIds: EMPTY_RUN_IDS,
};
const NOOP_SUBSCRIBE = (): (() => void) => () => {};
const GET_IDLE_STATE = (): WorkflowRunsState => IDLE_STATE;

/**
 * Session-scoped WorkflowRun query. Server state stays in a narrow external
 * query store rather than the global chat store. Stores are shared only when
 * client identity, session, and polling configuration are all identical.
 */
export const useWorkflowRuns = (
  sessionId: string | null,
  options: UseWorkflowRunsOptions = {},
): UseWorkflowRunsResult => {
  const client = options.client ?? bambooWorkflowRunClient;
  const pollIntervalMs = Math.max(
    MINIMUM_POLL_INTERVAL_MS,
    options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  );
  const initialIdlePollIntervalMs = Math.max(
    pollIntervalMs,
    options.initialIdlePollIntervalMs ?? DEFAULT_INITIAL_IDLE_POLL_INTERVAL_MS,
  );
  const maxIdlePollIntervalMs = Math.max(
    initialIdlePollIntervalMs,
    options.maxIdlePollIntervalMs ?? DEFAULT_MAX_IDLE_POLL_INTERVAL_MS,
  );
  const availability = options.availability;
  const activationKey = options.activationKey;

  const store = useMemo(
    () =>
      sessionId
        ? getWorkflowRunsQueryStore(
            client,
            sessionId,
            { pollIntervalMs, initialIdlePollIntervalMs, maxIdlePollIntervalMs },
            { availability, activationKey },
          )
        : null,
    [
      activationKey,
      availability,
      client,
      initialIdlePollIntervalMs,
      maxIdlePollIntervalMs,
      pollIntervalMs,
      sessionId,
    ],
  );

  const state = useSyncExternalStore(
    store?.subscribe ?? NOOP_SUBSCRIBE,
    store?.getSnapshot ?? GET_IDLE_STATE,
    store?.getServerSnapshot ?? GET_IDLE_STATE,
  );

  useEffect(() => {
    store?.observeAvailability(availability);
  }, [availability, store]);

  useEffect(() => {
    store?.observeActivationKey(activationKey);
  }, [activationKey, store]);

  const refresh = useCallback((): Promise<void> => store?.refresh() ?? Promise.resolve(), [store]);
  const cancel = useCallback(
    (runId: string): Promise<void> => store?.cancel(runId) ?? Promise.resolve(),
    [store],
  );

  return { ...state, refresh, cancel };
};
