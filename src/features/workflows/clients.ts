import { apiClient } from "@services/api";
import type {
  ActiveWorkflowView,
  WorkflowCatalogItem,
  WorkflowBudgetUsage,
  WorkflowBudgets,
  WorkflowFailure,
  WorkflowFailureCode,
  WorkflowPlan,
  WorkflowRunEvent,
  WorkflowRunSnapshot,
  WorkflowRunStatus,
  WorkflowStepSnapshot,
  WorkflowStepStatus,
  WorkflowSuspension,
} from "./domain";

export interface WorkflowActivationRequest {
  workflow: Pick<WorkflowCatalogItem, "id" | "source" | "revision">;
  arguments: Record<string, unknown>;
}

/** Existing markdown CRUD retained only for the negotiated legacy catalog path. */
export interface LegacyWorkflowManagementClient {
  getWorkflow(name: string): Promise<{ name: string; content: string }>;
  saveWorkflow(name: string, content: string): Promise<void>;
  deleteWorkflow(name: string): Promise<void>;
}

export interface WorkflowMigrationResponse {
  workflow_id: string;
  outcome: "migrated" | "already_migrated";
  source_preserved: true;
  catalog_revision: number;
}

export interface WorkflowMigrationClient {
  migrate(workflowId: string, sessionId: string): Promise<WorkflowMigrationResponse>;
}

type WorkflowMigrationPost = (path: string, data?: unknown) => Promise<WorkflowMigrationResponse>;

export class BambooWorkflowMigrationClient implements WorkflowMigrationClient {
  constructor(
    private readonly post: WorkflowMigrationPost = (path, data) =>
      apiClient.post<WorkflowMigrationResponse>(path, data),
  ) {}

  migrate(workflowId: string, sessionId: string): Promise<WorkflowMigrationResponse> {
    return this.post(`bamboo/workflow-catalog/${encodeURIComponent(workflowId)}/migrate`, {
      session_id: sessionId,
    });
  }
}

/** Contract seam only. No production endpoint is connected by Issue #125. */
export interface WorkflowActivationClient {
  activate(request: WorkflowActivationRequest, signal?: AbortSignal): Promise<ActiveWorkflowView>;
  deactivate(workflowId: string, signal?: AbortSignal): Promise<void>;
}

/** Session-owned WorkflowRun reads and idempotent cancellation. */
export interface WorkflowRunClient {
  list(sessionId: string, signal?: AbortSignal): Promise<WorkflowRunSnapshot[]>;
  getSnapshot(sessionId: string, runId: string, signal?: AbortSignal): Promise<WorkflowRunSnapshot>;
  getEvents(
    sessionId: string,
    runId: string,
    afterSequence: number,
    signal?: AbortSignal,
  ): Promise<WorkflowRunEvent[]>;
  cancel(sessionId: string, runId: string, signal?: AbortSignal): Promise<WorkflowRunSnapshot>;
}

type WorkflowRunGet = (path: string, options?: RequestInit) => Promise<unknown>;
type WorkflowRunPost = (path: string, data?: unknown, options?: RequestInit) => Promise<unknown>;

const runStatuses = new Set<WorkflowRunStatus>([
  "queued",
  "running",
  "suspended",
  "succeeded",
  "failed",
  "cancelled",
]);
const stepStatuses = new Set<WorkflowStepStatus>([...runStatuses, "skipped"]);
const plannedStepKinds = new Set(["tool", "agent", "workflow"] as const);
const failureCodes = new Set<WorkflowFailureCode>([
  "invalid_definition",
  "invalid_input",
  "invalid_output",
  "unknown_reference",
  "permission_denied",
  "untrusted_workspace",
  "budget_exceeded",
  "retry_exhausted",
  "execution_failed",
  "cancelled",
  "recovery_suspended",
  "suspended",
  "dependency_skipped",
  "storage",
]);
const eventTypes = new Set<WorkflowRunEvent["type"]>([
  "run_queued",
  "run_started",
  "phase",
  "step_queued",
  "step_started",
  "step_suspended",
  "step_completed",
  "step_failed",
  "step_cancelled",
  "step_skipped",
  "run_suspended",
  "run_succeeded",
  "run_failed",
  "run_cancelled",
]);
const stepEventTypes = new Set<WorkflowRunEvent["type"]>([
  "step_queued",
  "step_started",
  "step_suspended",
  "step_completed",
  "step_failed",
  "step_cancelled",
  "step_skipped",
]);

const safeFailureMessages: Record<WorkflowFailureCode, string> = {
  invalid_definition: "Workflow definition is invalid",
  invalid_input: "Workflow input is invalid",
  invalid_output: "Workflow output is invalid",
  unknown_reference: "Workflow reference is unavailable",
  permission_denied: "Workflow permission was denied",
  untrusted_workspace: "Workflow workspace is not trusted",
  budget_exceeded: "Workflow execution budget was exceeded",
  retry_exhausted: "Workflow retry budget was exhausted",
  execution_failed: "Workflow execution failed",
  cancelled: "Workflow execution was cancelled",
  recovery_suspended: "Workflow recovery requires attention",
  suspended: "Workflow execution is suspended",
  dependency_skipped: "Workflow dependency was skipped",
  storage: "Workflow storage is unavailable",
};

class WorkflowRunContractError extends Error {
  constructor() {
    super("Bamboo returned an invalid WorkflowRun public contract");
    this.name = "WorkflowRunContractError";
  }
}

const invalidContract = (): never => {
  throw new WorkflowRunContractError();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const requiredRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : invalidContract();

const requiredString = (value: unknown): string =>
  typeof value === "string" ? value : invalidContract();

const requiredBoolean = (value: unknown): boolean =>
  typeof value === "boolean" ? value : invalidContract();

const unsignedInteger = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalidContract();

const parseFailure = (value: unknown): WorkflowFailure => {
  const record = requiredRecord(value);
  const code = requiredString(record.code);
  if (!failureCodes.has(code as WorkflowFailureCode)) invalidContract();
  const typedCode = code as WorkflowFailureCode;
  // Use the public code as the authority for the fixed summary. Ignoring an
  // unexpected wire message prevents a regressed backend from reflecting a
  // private path or diagnostic into the UI.
  return {
    code: typedCode,
    message: safeFailureMessages[typedCode],
    retryable: requiredBoolean(record.retryable),
  };
};

const parseBudget = (value: unknown): WorkflowBudgets => {
  const record = requiredRecord(value);
  return {
    max_concurrency: unsignedInteger(record.max_concurrency),
    max_agents: unsignedInteger(record.max_agents),
    max_steps: unsignedInteger(record.max_steps),
    max_retries: unsignedInteger(record.max_retries),
    max_nesting_depth: unsignedInteger(record.max_nesting_depth),
    wall_time_ms: unsignedInteger(record.wall_time_ms),
    ...(record.max_tokens === undefined ? {} : { max_tokens: unsignedInteger(record.max_tokens) }),
    ...(record.max_cost_micros === undefined
      ? {}
      : { max_cost_micros: unsignedInteger(record.max_cost_micros) }),
  };
};

const parseUsage = (value: unknown): WorkflowBudgetUsage => {
  const record = requiredRecord(value);
  return {
    steps: unsignedInteger(record.steps),
    retries: unsignedInteger(record.retries),
    agents: unsignedInteger(record.agents),
    tokens: unsignedInteger(record.tokens),
    cost_micros: unsignedInteger(record.cost_micros),
  };
};

const parseStep = (value: unknown): WorkflowStepSnapshot => {
  const record = requiredRecord(value);
  const status = requiredString(record.status);
  if (!stepStatuses.has(status as WorkflowStepStatus)) invalidContract();
  return {
    id: requiredString(record.id),
    status: status as WorkflowStepStatus,
    ...(record.failure === undefined ? {} : { failure: parseFailure(record.failure) }),
    attempts: unsignedInteger(record.attempts),
  };
};

type PlanParseBudget = { nodes: number };

const parsePlan = (
  value: unknown,
  depth = 0,
  budget: PlanParseBudget = { nodes: 0 },
): WorkflowPlan => {
  if (depth > 32 || ++budget.nodes > 2048) invalidContract();
  const record = requiredRecord(value);
  const type = requiredString(record.type);
  switch (type) {
    case "step":
      return { type, step: requiredString(record.step) };
    case "sequence":
    case "parallel": {
      const nodes = Array.isArray(record.nodes) ? record.nodes : invalidContract();
      return { type, nodes: nodes.map((node) => parsePlan(node, depth + 1, budget)) };
    }
    case "map":
      return { type, body: parsePlan(record.body, depth + 1, budget) };
    case "retry":
      return {
        type,
        node: parsePlan(record.node, depth + 1, budget),
        max_attempts: unsignedInteger(record.max_attempts),
      };
    default:
      return invalidContract();
  }
};

const parseSuspension = (value: unknown): WorkflowSuspension => {
  const record = requiredRecord(value);
  const type = requiredString(record.type);
  switch (type) {
    case "tool_approval":
      return { type, step_id: requiredString(record.step_id) };
    case "tool_running":
      return {
        type,
        step_id: requiredString(record.step_id),
        killed: requiredBoolean(record.killed),
      };
    case "recovery":
      return { type };
    default:
      return invalidContract();
  }
};

export const parseWorkflowRunSnapshot = (value: unknown): WorkflowRunSnapshot => {
  const record = requiredRecord(value);
  const status = requiredString(record.status);
  if (!runStatuses.has(status as WorkflowRunStatus)) invalidContract();

  const plannedStepsRecord = requiredRecord(record.planned_steps);
  const planned_steps = Object.fromEntries(
    Object.entries(plannedStepsRecord).map(([key, rawStep]) => {
      const step = requiredRecord(rawStep);
      const id = requiredString(step.id);
      const kind = requiredString(step.kind);
      if (id !== key || !plannedStepKinds.has(kind as "tool" | "agent" | "workflow")) {
        invalidContract();
      }
      return [key, { id, kind: kind as "tool" | "agent" | "workflow" }];
    }),
  );

  const stepsRecord = requiredRecord(record.steps);
  const steps = Object.fromEntries(
    Object.entries(stepsRecord).map(([key, rawStep]) => {
      const step = parseStep(rawStep);
      if (step.id !== key) invalidContract();
      return [key, step];
    }),
  );

  return {
    run_id: requiredString(record.run_id),
    ...(record.parent_run_id === undefined
      ? {}
      : { parent_run_id: requiredString(record.parent_run_id) }),
    ...(record.parent_step_id === undefined
      ? {}
      : { parent_step_id: requiredString(record.parent_step_id) }),
    session_id: requiredString(record.session_id),
    workflow_id: requiredString(record.workflow_id),
    workflow_revision: unsignedInteger(record.workflow_revision),
    definition_bundle_hash: requiredString(record.definition_bundle_hash),
    status: status as WorkflowRunStatus,
    planned_steps,
    plan: parsePlan(record.plan),
    steps,
    budget: parseBudget(record.budget),
    usage: parseUsage(record.usage),
    child_agent_count: unsignedInteger(record.child_agent_count),
    last_sequence: unsignedInteger(record.last_sequence),
    ...(record.failure === undefined ? {} : { failure: parseFailure(record.failure) }),
    ...(record.suspension === undefined ? {} : { suspension: parseSuspension(record.suspension) }),
    created_at: requiredString(record.created_at),
    updated_at: requiredString(record.updated_at),
  };
};

export const parseWorkflowRunEvent = (value: unknown): WorkflowRunEvent => {
  const record = requiredRecord(value);
  const type = requiredString(record.type);
  if (!eventTypes.has(type as WorkflowRunEvent["type"])) invalidContract();
  const base = {
    run_id: requiredString(record.run_id),
    sequence: unsignedInteger(record.sequence),
    at: requiredString(record.at),
    ...(record.step_id === undefined ? {} : { step_id: requiredString(record.step_id) }),
  };
  if (stepEventTypes.has(type as WorkflowRunEvent["type"])) {
    const step_id = requiredString(record.step_id);
    if (type === "step_failed") {
      return { ...base, type, step_id, failure: parseFailure(record.failure) };
    }
    return { ...base, type, step_id } as WorkflowRunEvent;
  }
  if (type === "run_failed") {
    return { ...base, type, failure: parseFailure(record.failure) };
  }
  if (type === "phase") {
    // Bamboo collapses arbitrary internal phase text to this fixed public set.
    const name = requiredString(record.name);
    const publicName = [
      "retry_reserved",
      "step_reserved",
      "agent_reserved",
      "agent_usage_recorded",
      "suspension_context_persisted",
      "workflow_progressed",
    ].includes(name)
      ? name
      : "workflow_progressed";
    return { ...base, type, name: publicName };
  }
  return { ...base, type } as WorkflowRunEvent;
};

const assertSnapshotOwnership = (
  snapshot: WorkflowRunSnapshot,
  sessionId: string,
  runId?: string,
): WorkflowRunSnapshot => {
  if (snapshot.session_id !== sessionId || (runId !== undefined && snapshot.run_id !== runId)) {
    invalidContract();
  }
  return snapshot;
};

/** Production adapter for Bamboo #871's stable metadata-only public contract. */
export class BambooWorkflowRunClient implements WorkflowRunClient {
  private readonly cancelInFlight = new Map<string, Promise<WorkflowRunSnapshot>>();

  constructor(
    private readonly get: WorkflowRunGet = (path, options) => apiClient.get(path, options),
    private readonly post: WorkflowRunPost = (path, data, options) =>
      apiClient.post(path, data, options),
  ) {}

  async list(sessionId: string, signal?: AbortSignal): Promise<WorkflowRunSnapshot[]> {
    const value = await this.get(
      `sessions/${encodeURIComponent(sessionId)}/workflow-runs`,
      signal ? { signal } : undefined,
    );
    const entries = Array.isArray(value) ? value : invalidContract();
    const snapshots = entries.map((entry) =>
      assertSnapshotOwnership(parseWorkflowRunSnapshot(entry), sessionId),
    );
    if (new Set(snapshots.map((snapshot) => snapshot.run_id)).size !== snapshots.length) {
      invalidContract();
    }
    return snapshots;
  }

  async getSnapshot(
    sessionId: string,
    runId: string,
    signal?: AbortSignal,
  ): Promise<WorkflowRunSnapshot> {
    const value = await this.get(
      `sessions/${encodeURIComponent(sessionId)}/workflow-runs/${encodeURIComponent(runId)}`,
      signal ? { signal } : undefined,
    );
    return assertSnapshotOwnership(parseWorkflowRunSnapshot(value), sessionId, runId);
  }

  async getEvents(
    sessionId: string,
    runId: string,
    afterSequence: number,
    signal?: AbortSignal,
  ): Promise<WorkflowRunEvent[]> {
    const since = unsignedInteger(afterSequence);
    const value = await this.get(
      `sessions/${encodeURIComponent(sessionId)}/workflow-runs/${encodeURIComponent(runId)}/events?since=${since}`,
      signal ? { signal } : undefined,
    );
    const entries = Array.isArray(value) ? value : invalidContract();
    return entries.map((entry) => {
      const event = parseWorkflowRunEvent(entry);
      if (event.run_id !== runId) invalidContract();
      return event;
    });
  }

  cancel(sessionId: string, runId: string, signal?: AbortSignal): Promise<WorkflowRunSnapshot> {
    const key = JSON.stringify([sessionId, runId]);
    const existing = this.cancelInFlight.get(key);
    if (existing) return existing;

    // One user intent produces exactly one POST. Bamboo's endpoint is
    // idempotent, so a later explicit retry is safe after rehydration, but the
    // generic transport must not fan an ambiguous POST into hidden retries.
    const options = signal ? { signal } : undefined;
    const request = this.post(
      `sessions/${encodeURIComponent(sessionId)}/workflow-runs/${encodeURIComponent(runId)}/cancel`,
      undefined,
      options,
    )
      .then(parseWorkflowRunSnapshot)
      .then((snapshot) => assertSnapshotOwnership(snapshot, sessionId, runId))
      .finally(() => {
        if (this.cancelInFlight.get(key) === request) this.cancelInFlight.delete(key);
      });
    this.cancelInFlight.set(key, request);
    return request;
  }
}

export const bambooWorkflowRunClient = new BambooWorkflowRunClient();
