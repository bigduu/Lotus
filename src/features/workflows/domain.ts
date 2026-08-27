export type WorkflowKind = "instruction" | "orchestration";

export type WorkflowSource = "builtin" | "project" | "workspace" | "user" | "plugin" | "legacy";

/** Sources accepted by Bamboo's typed selection wire contract. */
export type TypedWorkflowSource = Exclude<WorkflowSource, "legacy">;

const typedWorkflowSources = new Set<TypedWorkflowSource>([
  "builtin",
  "project",
  "workspace",
  "user",
  "plugin",
]);

export const isTypedWorkflowSource = (source: unknown): source is TypedWorkflowSource =>
  typeof source === "string" && typedWorkflowSources.has(source as TypedWorkflowSource);

export type WorkflowStatus = "valid" | "invalid" | "degraded" | "shadowed";

export type InvocationPolicy = "manual" | "automatic" | "both" | "unavailable";

export type WorkflowMigrationStatus = "available" | "migrated";

export interface WorkflowShadowedCandidate {
  source: WorkflowSource;
  status: Extract<WorkflowStatus, "valid" | "invalid">;
  legacy?: boolean;
  migrationStatus?: WorkflowMigrationStatus;
  lastError?: string;
}

export interface WorkflowCatalogItem {
  id: string;
  name: string;
  description: string;
  kind: WorkflowKind;
  source: WorkflowSource;
  status: WorkflowStatus;
  /** False only for a non-winning catalog row retained for diagnostics. */
  winner?: boolean;
  /** Invalid metadata rendered from Bamboo's sanitized last-known-good projection. */
  lastKnownGood?: boolean;
  legacy?: boolean;
  migrationStatus?: WorkflowMigrationStatus;
  invocationPolicy: InvocationPolicy;
  argumentHint?: string;
  argumentSchema?: Record<string, unknown>;
  readOnly: boolean;
  revision?: number;
  version?: string;
  lastError?: string;
  shadowedCandidates?: WorkflowShadowedCandidate[];
}

/**
 * Catalog ids are only unique inside a kind/source/revision namespace. Bamboo
 * can deliberately expose a migrated instruction and its preserved legacy
 * orchestration source with the same id, so UI/list identity must never use the
 * bare id alone.
 */
export const workflowCatalogItemKey = (item: WorkflowCatalogItem): string =>
  JSON.stringify([
    item.kind,
    item.source,
    item.id,
    item.revision ?? null,
    item.version ?? null,
    item.legacy === true,
    item.migrationStatus ?? null,
  ]);

export type WorkflowCatalogMode = "typed" | "legacy";

export interface WorkflowCatalogCapabilities {
  mode: WorkflowCatalogMode;
  clone: boolean;
  edit: boolean;
  activate: boolean;
  run: boolean;
  cancel: boolean;
}

export interface WorkflowCatalogDiagnostic {
  entryIndex?: number;
  itemId?: string;
  message: string;
}

export interface WorkflowCatalogView {
  revision?: number;
  items: WorkflowCatalogItem[];
  diagnostics: WorkflowCatalogDiagnostic[];
  capabilities: WorkflowCatalogCapabilities;
}

export interface ActiveWorkflowView {
  workflowId: string;
  name: string;
  source: WorkflowSource;
  revision?: number;
  activatedAt: string;
  arguments: Record<string, unknown>;
}

/** Exact status names from Bamboo's metadata-only WorkflowRun projection. */
export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "suspended"
  | "succeeded"
  | "failed"
  | "cancelled";

export type WorkflowStepStatus = WorkflowRunStatus | "skipped";

export type WorkflowPlannedStepKind = "tool" | "agent" | "workflow";

export interface WorkflowPlannedStep {
  id: string;
  kind: WorkflowPlannedStepKind;
}

/** Safe topology only. Bamboo deliberately omits bindings, arguments, prompts and outputs. */
export type WorkflowPlan =
  | { type: "step"; step: string }
  | { type: "sequence"; nodes: WorkflowPlan[] }
  | { type: "parallel"; nodes: WorkflowPlan[] }
  | { type: "map"; body: WorkflowPlan }
  | { type: "retry"; node: WorkflowPlan; max_attempts: number };

export interface WorkflowBudgets {
  max_concurrency: number;
  max_agents: number;
  max_steps: number;
  max_retries: number;
  max_nesting_depth: number;
  wall_time_ms: number;
  max_tokens?: number;
  max_cost_micros?: number;
}

export interface WorkflowBudgetUsage {
  steps: number;
  retries: number;
  agents: number;
  tokens: number;
  cost_micros: number;
}

export type WorkflowFailureCode =
  | "invalid_definition"
  | "invalid_input"
  | "invalid_output"
  | "unknown_reference"
  | "permission_denied"
  | "untrusted_workspace"
  | "budget_exceeded"
  | "retry_exhausted"
  | "execution_failed"
  | "cancelled"
  | "recovery_suspended"
  | "suspended"
  | "dependency_skipped"
  | "storage";

export interface WorkflowFailure {
  code: WorkflowFailureCode;
  /** Bamboo supplies a fixed, redacted public summary. */
  message: string;
  retryable: boolean;
}

export interface WorkflowStepSnapshot {
  id: string;
  status: WorkflowStepStatus;
  failure?: WorkflowFailure;
  attempts: number;
}

export type WorkflowSuspension =
  | { type: "tool_approval"; step_id: string }
  | { type: "tool_running"; step_id: string; killed: boolean }
  | { type: "recovery" };

/**
 * Safe, session-owned WorkflowRun view. Field names intentionally match the
 * Bamboo wire contract so no second invented frontend protocol can drift.
 */
export interface WorkflowRunSnapshot {
  run_id: string;
  parent_run_id?: string;
  parent_step_id?: string;
  session_id: string;
  workflow_id: string;
  workflow_revision: number;
  definition_bundle_hash: string;
  status: WorkflowRunStatus;
  planned_steps: Record<string, WorkflowPlannedStep>;
  plan: WorkflowPlan;
  steps: Record<string, WorkflowStepSnapshot>;
  budget: WorkflowBudgets;
  usage: WorkflowBudgetUsage;
  child_agent_count: number;
  last_sequence: number;
  failure?: WorkflowFailure;
  suspension?: WorkflowSuspension;
  created_at: string;
  updated_at: string;
}

interface WorkflowRunEventBase {
  run_id: string;
  sequence: number;
  at: string;
  step_id?: string;
}

export type WorkflowRunEvent =
  | (WorkflowRunEventBase & { type: "run_queued" })
  | (WorkflowRunEventBase & { type: "run_started" })
  | (WorkflowRunEventBase & { type: "phase"; name: string })
  | (WorkflowRunEventBase & { type: "step_queued"; step_id: string })
  | (WorkflowRunEventBase & { type: "step_started"; step_id: string })
  | (WorkflowRunEventBase & { type: "step_suspended"; step_id: string })
  | (WorkflowRunEventBase & { type: "step_completed"; step_id: string })
  | (WorkflowRunEventBase & {
      type: "step_failed";
      step_id: string;
      failure: WorkflowFailure;
    })
  | (WorkflowRunEventBase & { type: "step_cancelled"; step_id: string })
  | (WorkflowRunEventBase & { type: "step_skipped"; step_id: string })
  | (WorkflowRunEventBase & { type: "run_suspended" })
  | (WorkflowRunEventBase & { type: "run_succeeded" })
  | (WorkflowRunEventBase & { type: "run_failed"; failure: WorkflowFailure })
  | (WorkflowRunEventBase & { type: "run_cancelled" });
