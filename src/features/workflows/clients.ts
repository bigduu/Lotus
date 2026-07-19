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
