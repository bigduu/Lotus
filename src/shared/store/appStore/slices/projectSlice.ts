/**
 * Project slice (ID-normalized store).
 *
 * Projects are stored by opaque `id`. The list endpoint returns summaries; detail
 * and mutation endpoints return the full manifest. This slice preserves the
 * manifest-level fields (workspace_bindings, legacy_project_keys) when a later
 * summary refresh arrives with a newer revision but no bindings array.
 */
import type { StateCreator } from "zustand";
import {
  projectService,
  type CreateProjectRequest,
  type LegacyMemoryMigrationResponse,
  type LegacyProjectDryRunReport,
  type LegacySessionProjectInput,
  type PatchProjectRequest,
  type ProjectManifest,
  type ProjectResourceSummary,
  type ProjectSummary,
  type WorkspaceBindingRequest,
  NO_PROJECT_ID,
} from "@services/project";
import { isApiError } from "@services/api";
import type { AppState } from "../";

export interface ProjectSlice {
  projects: Record<string, ProjectManifest>;
  projectsLoading: boolean;
  projectsError: string | null;
  projectsLoadedAt: number | null;
  /** null = unknown; false = backend does not expose the Project API. */
  projectsAvailable: boolean | null;
  /** Project currently selected in the UI (for creation / workspace picker). */
  activeProjectId: string | null;
  projectResources: Record<string, ProjectResourceSummary>;
  projectResourcesLoading: Record<string, boolean>;
  projectResourcesError: Record<string, string | null>;

  setActiveProjectId: (projectId: string | null) => void;
  loadProjects: () => Promise<void>;
  ensureProject: (projectId: string) => Promise<void>;
  createProject: (req: CreateProjectRequest) => Promise<ProjectManifest>;
  updateProject: (
    projectId: string,
    revision: number,
    req: PatchProjectRequest,
  ) => Promise<ProjectManifest>;
  archiveProject: (projectId: string, revision: number) => Promise<ProjectManifest>;
  bindWorkspace: (
    projectId: string,
    revision: number,
    req: WorkspaceBindingRequest,
  ) => Promise<ProjectManifest>;
  unbindWorkspace: (projectId: string, revision: number, path: string) => Promise<ProjectManifest>;
  loadProjectResources: (projectId: string) => Promise<ProjectResourceSummary>;
  legacyDryRun: (sessions: LegacySessionProjectInput[]) => Promise<LegacyProjectDryRunReport>;
  migrateLegacyMemory: (
    projectId: string,
    revision: number,
    legacyProjectKey: string,
  ) => Promise<LegacyMemoryMigrationResponse>;
  applyProjectEvent: (event: ProjectAccountEvent) => void;
}

/** Account-feed event shape for Project lifecycle. */
export interface ProjectAccountEvent {
  type: "project_created" | "project_updated" | "project_archived";
  project_id: string;
  revision: number;
}

const isManifest = (project: ProjectSummary | ProjectManifest): project is ProjectManifest =>
  Array.isArray((project as ProjectManifest).workspace_bindings);

const createProjectKey = (id: string | null | undefined): string | null => {
  if (!id || id === NO_PROJECT_ID) return null;
  return id;
};

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set, get) => ({
  projects: {},
  projectsLoading: false,
  projectsError: null,
  projectsLoadedAt: null,
  projectsAvailable: null,
  activeProjectId: null,
  projectResources: {},
  projectResourcesLoading: {},
  projectResourcesError: {},

  setActiveProjectId: (projectId) => {
    const id = createProjectKey(projectId);
    set({ activeProjectId: id });
  },

  loadProjects: async () => {
    set({ projectsLoading: true, projectsError: null });
    try {
      const list = await projectService.listProjects();
      set((state) => {
        const projects = { ...state.projects };
        for (const summary of list.projects) {
          mergeProjectIntoMap(projects, summary);
        }
        return {
          projects,
          projectsLoading: false,
          projectsLoadedAt: Date.now(),
          projectsAvailable: true,
          projectsError: null,
        };
      });
    } catch (error) {
      const available = isApiError(error) && error.status !== 404;
      set({
        projectsLoading: false,
        projectsError: error instanceof Error ? error.message : String(error),
        projectsAvailable: available,
      });
      throw error;
    }
  },

  ensureProject: async (projectId) => {
    const id = createProjectKey(projectId);
    if (!id) return;
    const existing = get().projects[id];
    if (existing && isManifest(existing)) return;

    try {
      const manifest = await projectService.getProject(id);
      set((state) => {
        const projects = { ...state.projects };
        mergeProjectIntoMap(projects, manifest);
        return { projects };
      });
    } catch (error) {
      if (isApiError(error) && error.status === 404) {
        set((state) => {
          const projects = { ...state.projects };
          delete projects[id];
          return { projects };
        });
      }
      throw error;
    }
  },

  createProject: async (req) => {
    const manifest = await projectService.createProject(req);
    set((state) => {
      const projects = { ...state.projects };
      mergeProjectIntoMap(projects, manifest);
      return { projects, activeProjectId: manifest.id };
    });
    return manifest;
  },

  updateProject: async (projectId, revision, req) => {
    const id = createProjectKey(projectId);
    if (!id) throw new Error("Invalid project id");
    const manifest = await projectService.patchProject(id, revision, req);
    set((state) => {
      const projects = { ...state.projects };
      mergeProjectIntoMap(projects, manifest);
      return { projects };
    });
    return manifest;
  },

  archiveProject: async (projectId, revision) => {
    const id = createProjectKey(projectId);
    if (!id) throw new Error("Invalid project id");
    const manifest = await projectService.archiveProject(id, revision);
    set((state) => {
      const projects = { ...state.projects };
      mergeProjectIntoMap(projects, manifest);
      return { projects };
    });
    return manifest;
  },

  bindWorkspace: async (projectId, revision, req) => {
    const id = createProjectKey(projectId);
    if (!id) throw new Error("Invalid project id");
    const manifest = await projectService.bindWorkspace(id, revision, req);
    set((state) => {
      const projects = { ...state.projects };
      mergeProjectIntoMap(projects, manifest);
      return { projects };
    });
    return manifest;
  },

  unbindWorkspace: async (projectId, revision, path) => {
    const id = createProjectKey(projectId);
    if (!id) throw new Error("Invalid project id");
    const manifest = await projectService.unbindWorkspace(id, revision, { path });
    set((state) => {
      const projects = { ...state.projects };
      mergeProjectIntoMap(projects, manifest);
      return { projects };
    });
    return manifest;
  },

  loadProjectResources: async (projectId) => {
    const id = createProjectKey(projectId);
    if (!id) throw new Error("Invalid project id");
    set((state) => ({
      projectResourcesLoading: { ...state.projectResourcesLoading, [id]: true },
      projectResourcesError: { ...state.projectResourcesError, [id]: null },
    }));
    try {
      const summary = await projectService.getProjectResources(id);
      set((state) => ({
        projectResources: { ...state.projectResources, [id]: summary },
        projectResourcesLoading: { ...state.projectResourcesLoading, [id]: false },
      }));
      return summary;
    } catch (error) {
      set((state) => ({
        projectResourcesLoading: { ...state.projectResourcesLoading, [id]: false },
        projectResourcesError: {
          ...state.projectResourcesError,
          [id]: error instanceof Error ? error.message : String(error),
        },
      }));
      throw error;
    }
  },

  legacyDryRun: async (sessions) => {
    return projectService.legacyDryRun({ sessions });
  },

  migrateLegacyMemory: async (projectId, revision, legacyProjectKey) => {
    const id = createProjectKey(projectId);
    if (!id) throw new Error("Invalid project id");
    const response = await projectService.migrateLegacyMemory(id, revision, {
      legacy_project_key: legacyProjectKey,
    });
    set((state) => {
      const projects = { ...state.projects };
      const manifest = { ...state.projects[id] };
      if (manifest && response.project_revision > manifest.revision) {
        manifest.revision = response.project_revision;
        manifest.resource_revision = response.project_revision;
        manifest.updated_at = new Date().toISOString();
        if (!manifest.legacy_project_keys.includes(legacyProjectKey)) {
          manifest.legacy_project_keys = [...manifest.legacy_project_keys, legacyProjectKey];
        }
        projects[id] = manifest;
      }
      return {
        projects,
        projectResources: {
          ...state.projectResources,
          [id]: {
            project_id: id,
            resource_revision: response.project_revision,
            resources: state.projectResources[id]?.resources ?? [],
          },
        },
      };
    });
    return response;
  },

  applyProjectEvent: (event) => {
    if (
      event.type !== "project_created" &&
      event.type !== "project_updated" &&
      event.type !== "project_archived"
    ) {
      return;
    }
    const id = createProjectKey(event.project_id);
    if (!id) return;

    set((state) => {
      const existing = state.projects[id];
      if (existing && event.revision < existing.revision) {
        return state;
      }
      // If we have no local record, refresh the project lazily. Do not block.
      if (!existing) {
        void get().ensureProject(id);
        return state;
      }
      const projects = { ...state.projects };
      if (event.type === "project_archived") {
        projects[id] = { ...existing, status: "archived", revision: event.revision };
      } else {
        projects[id] = {
          ...existing,
          revision: event.revision,
          updated_at: new Date().toISOString(),
        };
      }
      return { projects };
    });
  },
});

/**
 * Merge a ProjectSummary or ProjectManifest into a normalized map. Preserves
 * manifest-only fields (workspace_bindings, legacy_project_keys) when the
 * incoming payload is a newer summary without those arrays.
 */
function mergeProjectIntoMap(
  map: Record<string, ProjectManifest>,
  project: ProjectSummary | ProjectManifest,
): void {
  const existing = map[project.id];
  if (existing && project.revision < existing.revision) return;

  if (isManifest(project)) {
    map[project.id] = project;
    return;
  }

  const next: ProjectManifest = {
    ...project,
    schema_version: existing?.schema_version ?? 1,
    workspace_bindings: existing?.workspace_bindings ?? [],
    legacy_project_keys: existing?.legacy_project_keys ?? [],
  };
  map[project.id] = next;
}

export { NO_PROJECT_ID };
export type { ProjectManifest, ProjectSummary };
