import { apiClient } from "@services/api";
import type {
  ActiveWorkflowView,
  WorkflowCatalogItem,
  WorkflowRunEvent,
  WorkflowRunView,
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

/** Contract seam only. No run, cancel, or resume request is sent by Issue #125. */
export interface WorkflowRunClient {
  getSnapshot(runId: string, signal?: AbortSignal): Promise<WorkflowRunView>;
  getEvents(
    runId: string,
    afterSequence: number,
    signal?: AbortSignal,
  ): Promise<WorkflowRunEvent[]>;
  cancel(runId: string, signal?: AbortSignal): Promise<WorkflowRunView>;
  resume(runId: string, signal?: AbortSignal): Promise<WorkflowRunView>;
}
