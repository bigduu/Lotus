export type WorkflowKind = "instruction" | "orchestration";

export type WorkflowSource = "builtin" | "project" | "user" | "plugin" | "legacy";

export type WorkflowStatus = "valid" | "invalid" | "degraded" | "shadowed";

export type InvocationPolicy = "manual" | "implicit" | "both";

export interface WorkflowShadowedCandidate {
  source: WorkflowSource;
  status: Extract<WorkflowStatus, "valid" | "invalid">;
  lastError?: string;
}

export interface WorkflowCatalogItem {
  id: string;
  name: string;
  description: string;
  kind: WorkflowKind;
  source: WorkflowSource;
  status: WorkflowStatus;
  invocationPolicy: InvocationPolicy;
  argumentHint?: string;
  argumentSchema?: Record<string, unknown>;
  readOnly: boolean;
  revision?: number;
  version?: string;
  lastError?: string;
  shadowedCandidates?: WorkflowShadowedCandidate[];
}

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
