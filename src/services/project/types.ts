/**
 * Project domain types.
 *
 * Mirrors the Bamboo Project API contract (bigduu/Bamboo-agent#674).
 * Field names are snake_case to match backend JSON directly, consistent with the
 * existing AgentService DTOs in `services/chat`.
 */

export type ProjectStatus = "active" | "archived";
export type ProjectPathStatus = "configured" | "needs_selection" | "needs_configuration";

export interface WorkspaceBinding {
  path: string;
  label?: string | null;
  git_common_dir?: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  description?: string | null;
  status: ProjectStatus;
  revision: number;
  resource_revision: number;
  /** Primary user source/work folder. Distinct from Bamboo's internal project home. */
  project_path: string | null;
  /** Migration/configuration state for the authoritative primary path. */
  project_path_status: ProjectPathStatus;
  /** Primary path plus additional workspace bindings. */
  workspace_count: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectManifest extends ProjectSummary {
  schema_version: number;
  workspace_bindings: WorkspaceBinding[];
}

export interface ProjectListResponse {
  projects: ProjectSummary[];
}

export interface CreateProjectRequest {
  name: string;
  description?: string | null;
  /** Required primary user source/work folder for every newly-created Project. */
  project_path: string;
  workspace_bindings?: WorkspaceBinding[];
}

export interface PatchProjectRequest {
  name?: string;
  description?: string | null;
  /** CAS-updated primary folder; never inferred from workspace binding order. */
  project_path?: string;
}

export interface WorkspaceBindingRequest {
  path: string;
  label?: string | null;
  git_common_dir?: string | null;
}

export interface ProjectResourceKind {
  kind: "settings" | "skills" | "commands" | "memory" | "artifacts" | "state";
  present: boolean;
  item_count: number;
}

export interface ProjectResourceSummary {
  project_id: string;
  resource_revision: number;
  resources: ProjectResourceKind[];
}

export interface LegacySessionProjectInput {
  session_id: string;
  workspace_path?: string | null;
  canonical_path?: string | null;
  git_common_dir?: string | null;
}

export interface LegacyProjectAssignment {
  session_id: string;
  project_id: string;
  basis: "exact_canonical_binding" | "git_common_dir";
}

export interface LegacyProjectSuggestion {
  basis: "exact_canonical_binding" | "git_common_dir";
  session_ids: string[];
  workspace_paths: string[];
}

export interface LegacyProjectUnassigned {
  session_id: string;
  reason: string;
}

export interface LegacyProjectDryRunReport {
  assignments: LegacyProjectAssignment[];
  suggestions: LegacyProjectSuggestion[];
  unassigned: LegacyProjectUnassigned[];
  diagnostics: string[];
}

export interface LegacyProjectDryRunRequest {
  sessions: LegacySessionProjectInput[];
}

export interface ProjectServiceOptions {
  requestTimeoutMs?: number;
}

/** Sentinel value for sessions that have no Project assignment. */
export const NO_PROJECT_ID = "__unassigned__";

/** Group key for sessions without a Project in sidebar projections. */
export const NO_PROJECT_GROUP_KEY = "__no_project__";
