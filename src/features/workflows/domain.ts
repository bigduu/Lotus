export type WorkflowKind = "instruction" | "orchestration";

export type WorkflowSource = "builtin" | "project" | "workspace" | "user" | "plugin" | "legacy";

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

export type WorkflowRunStatus = "running" | "suspended" | "succeeded" | "failed" | "cancelled";

export type WorkflowStepStatus = "pending" | WorkflowRunStatus;

export interface WorkflowStepView {
  id: string;
  name: string;
  order: number;
  status: WorkflowStepStatus;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface WorkflowPhaseView {
  id: string;
  name: string;
  order: number;
  status: WorkflowStepStatus;
  steps: WorkflowStepView[];
}

export interface WorkflowRunView {
  runId: string;
  workflow: ActiveWorkflowView;
  status: WorkflowRunStatus;
  phases: WorkflowPhaseView[];
  startedAt: string;
  completedAt?: string;
  error?: string;
  lastSequence: number;
}

interface WorkflowRunEventBase {
  eventId: string;
  runId: string;
  sequence: number;
}

export type WorkflowRunEvent =
  | (WorkflowRunEventBase & {
      type: "run_status";
      status: WorkflowRunStatus;
      completedAt?: string;
      error?: string;
    })
  | (WorkflowRunEventBase & {
      type: "phase_upsert";
      phase: Omit<WorkflowPhaseView, "steps"> & { steps?: WorkflowStepView[] };
    })
  | (WorkflowRunEventBase & {
      type: "step_upsert";
      phaseId: string;
      step: WorkflowStepView;
    });
