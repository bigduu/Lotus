/**
 * Project slice (ID-normalized store).
 *
 * Projects are stored by opaque `id`. Today Bamboo's list endpoint returns
 * full manifests; a future slim summary (Bamboo-agent#727) would arrive
 * without `workspace_bindings`. The slice preserves that manifest-level field
 * when a newer summary without it arrives,
 * and tracks which ids actually had their detail loaded (`detail_loaded`)
 * so `ensureProject` can tell a real manifest apart from a summary
 * synthesis. Ids that returned 404 are tombstoned (`projectsMissing`) to
 * avoid an unbounded refetch loop for sessions referencing deleted or
 * invisible Projects.
 */
import type { StateCreator } from "zustand";
import {
  projectService,
  type CreateProjectRequest,
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

/** Stored record: the API manifest plus internal bookkeeping. */
type StoredProject = ProjectManifest & {
  /** True once the full manifest (bindings etc.) came from the API. */
  detail_loaded?: boolean;
};

export interface ProjectSlice {
  projects: Record<string, ProjectManifest>;
  projectsLoading: boolean;
  projectsError: string | null;
  projectsLoadedAt: number | null;
  /** null = unknown; false = backend does not expose the Project API. */
  projectsAvailable: boolean | null;
  /** Tombstones for ids that 404'd — sessions may keep referencing them. */
  projectsMissing: Record<string, true>;
  /** Project currently selected in the UI (for creation / workspace picker). */
  activeProjectId: string | null;
  projectResources: Record<string, ProjectResourceSummary>;
  projectResourcesLoading: Record<string, boolean>;
  projectResourcesError: Record<string, string | null>;

  setActiveProjectId: (projectId: string | null) => void;
  loadProjects: () => Promise<void>;
  ensureProject: (projectId: string, opts?: { force?: boolean }) => Promise<void>;
  createProject: (req: CreateProjectRequest) => Promise<ProjectManifest>;
  updateProject: (
    projectId: string,
    revision: number,
    req: PatchProjectRequest,
  ) => Promise<ProjectManifest>;
  archiveProject: (projectId: string, revision: number) => Promise<ProjectManifest>;
  unarchiveProject: (projectId: string, revision: number) => Promise<ProjectManifest>;
  bindWorkspace: (
    projectId: string,
    revision: number,
    req: WorkspaceBindingRequest,
  ) => Promise<ProjectManifest>;
  unbindWorkspace: (projectId: string, revision: number, path: string) => Promise<ProjectManifest>;
  loadProjectResources: (projectId: string) => Promise<ProjectResourceSummary>;
  legacyDryRun: (sessions: LegacySessionProjectInput[]) => Promise<LegacyProjectDryRunReport>;
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

export const ACTIVE_PROJECT_PREFERENCE_STORAGE_KEY = "lotus_active_project_v1";

type ActiveProjectPreference = {
  isSet: boolean;
  projectId: string | null;
};

const readActiveProjectPreference = (): ActiveProjectPreference => {
  try {
    if (typeof localStorage === "undefined") return { isSet: false, projectId: null };
    const raw = localStorage.getItem(ACTIVE_PROJECT_PREFERENCE_STORAGE_KEY);
    if (raw === null) return { isSet: false, projectId: null };

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("projectId" in parsed)) {
      return { isSet: false, projectId: null };
    }
    const projectId = (parsed as { projectId?: unknown }).projectId;
    if (projectId === null) return { isSet: true, projectId: null };
    if (typeof projectId === "string" && projectId.trim()) {
      return { isSet: true, projectId: projectId.trim() };
    }
  } catch {
    // Corrupt or unavailable storage is equivalent to no saved preference.
  }
  return { isSet: false, projectId: null };
};

const writeActiveProjectPreference = (projectId: string | null): void => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(ACTIVE_PROJECT_PREFERENCE_STORAGE_KEY, JSON.stringify({ projectId }));
  } catch {
    // Best-effort UI preference; storage failures must not block Project use.
  }
};

const clearActiveProjectPreference = (): void => {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(ACTIVE_PROJECT_PREFERENCE_STORAGE_KEY);
  } catch {
    // Best-effort cleanup.
  }
};

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set, get) => {
  // In-flight dedupe for ensureProject: concurrent lazy loads and forced
  // event-driven refetches share one request per Project id.
  const projectInflight = new Map<string, Promise<void>>();
  let activeProjectPreference = readActiveProjectPreference();

  const rememberActiveProject = (projectId: string | null): void => {
    activeProjectPreference = { isSet: true, projectId };
    writeActiveProjectPreference(projectId);
  };

  const forgetActiveProject = (): void => {
    activeProjectPreference = { isSet: false, projectId: null };
    clearActiveProjectPreference();
  };

  return {
    projects: {},
    projectsLoading: false,
    projectsError: null,
    projectsLoadedAt: null,
    projectsAvailable: null,
    projectsMissing: {},
    activeProjectId: activeProjectPreference.projectId,
    projectResources: {},
    projectResourcesLoading: {},
    projectResourcesError: {},

    setActiveProjectId: (projectId) => {
      const id = createProjectKey(projectId);
      rememberActiveProject(id);
      set({ activeProjectId: id });
    },

    loadProjects: async () => {
      set({ projectsLoading: true, projectsError: null });
      try {
        const list = await projectService.listProjects();
        const preferenceUpdate: {
          current: { type: "write"; projectId: string } | { type: "clear" } | null;
        } = { current: null };
        set((state) => {
          // The remote list is authoritative: ids absent from it were
          // deleted (or are invisible) and are pruned instead of lingering
          // as stale tombstones. Manifest-only fields of surviving ids are
          // preserved via mergeProjectIntoMap.
          const projects: Record<string, ProjectManifest> = {};
          for (const item of list.projects) {
            const existing = state.projects[item.id];
            if (existing) projects[item.id] = existing;
          }
          for (const item of list.projects) {
            mergeProjectIntoMap(projects, item);
          }

          const isSelectable = (id: string | null): id is string =>
            Boolean(
              id &&
                projects[id]?.status === "active" &&
                projects[id]?.project_path_status === "configured" &&
                projects[id]?.project_path?.trim(),
            );
          const stateProjectId = createProjectKey(state.activeProjectId);
          const storedProjectId = createProjectKey(activeProjectPreference.projectId);

          let activeProjectId: string | null;
          if (isSelectable(stateProjectId)) {
            activeProjectId = stateProjectId;
            if (!activeProjectPreference.isSet || storedProjectId !== stateProjectId) {
              preferenceUpdate.current = { type: "write", projectId: stateProjectId };
            }
          } else if (activeProjectPreference.isSet && activeProjectPreference.projectId === null) {
            // An explicit "No project" is a real user preference, not an
            // uninitialized value. Preserve it across reloads.
            activeProjectId = null;
          } else if (isSelectable(storedProjectId)) {
            activeProjectId = storedProjectId;
          } else {
            // No usable explicit preference. Prefer the authoritative Project
            // of the current session, then the only active Project when the
            // choice is unambiguous. Never infer identity from workspace paths.
            const currentSessionProjectId = createProjectKey(
              state.currentSessionId
                ? state.chats?.find((chat) => chat.id === state.currentSessionId)?.config.projectId
                : null,
            );
            const activeProjects = Object.values(projects).filter(
              (project) =>
                project.status === "active" &&
                project.project_path_status === "configured" &&
                Boolean(project.project_path?.trim()),
            );
            activeProjectId = isSelectable(currentSessionProjectId)
              ? currentSessionProjectId
              : activeProjects.length === 1
                ? activeProjects[0].id
                : null;
            preferenceUpdate.current = activeProjectId
              ? { type: "write", projectId: activeProjectId }
              : activeProjectPreference.isSet
                ? { type: "clear" }
                : null;
          }
          return {
            projects,
            projectsLoading: false,
            projectsLoadedAt: Date.now(),
            projectsAvailable: true,
            projectsError: null,
            activeProjectId,
          };
        });
        if (preferenceUpdate.current?.type === "write") {
          rememberActiveProject(preferenceUpdate.current.projectId);
        } else if (preferenceUpdate.current?.type === "clear") {
          forgetActiveProject();
        }
      } catch (error) {
        // 404 means the backend predates the Project API. Anything else
        // (network, 5xx) leaves availability unknown so the UI does not
        // misreport a transient failure as "feature missing".
        const unavailable = isApiError(error) && error.status === 404;
        set((state) => ({
          projectsLoading: false,
          projectsError: error instanceof Error ? error.message : String(error),
          projectsAvailable: unavailable ? false : state.projectsAvailable,
        }));
        throw error;
      }
    },

    ensureProject: async (projectId, opts) => {
      const id = createProjectKey(projectId);
      if (!id) return;
      if (get().projectsMissing[id]) return;
      const existing = get().projects[id] as StoredProject | undefined;
      if (!opts?.force && existing?.detail_loaded) return;

      const inflight = projectInflight.get(id);
      if (inflight) {
        await inflight;
        return;
      }

      const request = (async () => {
        try {
          const manifest = await projectService.getProject(id);
          set((state) => {
            const projects = { ...state.projects };
            mergeProjectIntoMap(projects, manifest);
            const projectsMissing = { ...state.projectsMissing };
            delete projectsMissing[id];
            return { projects, projectsMissing };
          });
        } catch (error) {
          if (isApiError(error) && error.status === 404) {
            const clearsPreference =
              get().activeProjectId === id || activeProjectPreference.projectId === id;
            set((state) => {
              const projects = { ...state.projects };
              delete projects[id];
              return {
                projects,
                projectsMissing: { ...state.projectsMissing, [id]: true },
                activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
              };
            });
            if (clearsPreference) forgetActiveProject();
            return;
          }
          throw error;
        }
      })();
      projectInflight.set(id, request);
      try {
        await request;
      } finally {
        projectInflight.delete(id);
      }
    },

    createProject: async (req) => {
      const manifest = await projectService.createProject(req);
      set((state) => {
        const projects = { ...state.projects };
        mergeProjectIntoMap(projects, manifest);
        return { projects, activeProjectId: manifest.id };
      });
      rememberActiveProject(manifest.id);
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
      const clearsPreference =
        get().activeProjectId === id || activeProjectPreference.projectId === id;
      set((state) => {
        const projects = { ...state.projects };
        mergeProjectIntoMap(projects, manifest);
        // An archived Project cannot take new sessions (backend 409
        // `project_archived`) — never leave it as the creation default.
        return {
          projects,
          activeProjectId: state.activeProjectId === id ? null : state.activeProjectId,
        };
      });
      if (clearsPreference) forgetActiveProject();
      return manifest;
    },

    unarchiveProject: async (projectId, revision) => {
      const id = createProjectKey(projectId);
      if (!id) throw new Error("Invalid project id");
      const manifest = await projectService.unarchiveProject(id, revision);
      set((state) => {
        const projects = { ...state.projects };
        // Merge only the canonical response. mergeProjectIntoMap rejects an
        // out-of-order response, so a late restore can never roll a newer
        // archive/update backward.
        mergeProjectIntoMap(projects, manifest);
        // Restoring is not a selection action. Keep the current creation
        // default and session grouping stable even when another Project was
        // active while this request completed.
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

      const existing = get().projects[id];
      if (existing && event.revision < existing.revision) return;
      const clearsPreference =
        event.type === "project_archived" &&
        (get().activeProjectId === id || activeProjectPreference.projectId === id);

      // Bamboo's project events carry only {project_id, revision} — a rename
      // or binding change is NOT in the payload. Refetch the authoritative
      // manifest (deduped in ensureProject) so the UI never shows a stale
      // name until the next full reload.
      get()
        .ensureProject(id, { force: true })
        .catch(() => {
          // 404s tombstone inside ensureProject; other failures leave the
          // last-known manifest in place.
        });

      if (!existing) return;
      set((state) => {
        const current = state.projects[id];
        if (!current || event.revision < current.revision) return state;
        const projects = { ...state.projects };
        projects[id] = {
          ...current,
          status: event.type === "project_archived" ? "archived" : current.status,
          revision: event.revision,
          updated_at: new Date().toISOString(),
        };
        return {
          projects,
          // Archived elsewhere → drop it as the creation default here too.
          activeProjectId:
            event.type === "project_archived" && state.activeProjectId === id
              ? null
              : state.activeProjectId,
        };
      });
      if (clearsPreference) forgetActiveProject();
    },
  };
};

/**
 * Merge a ProjectSummary or ProjectManifest into a normalized map. Preserves
 * the manifest-only `workspace_bindings` field when the incoming payload is a
 * newer summary without that array, and marks records
 * whose detail genuinely came from the API (`detail_loaded`).
 */
function mergeProjectIntoMap(
  map: Record<string, ProjectManifest>,
  project: ProjectSummary | ProjectManifest,
): void {
  const existing = map[project.id] as StoredProject | undefined;
  if (existing && project.revision < existing.revision) return;

  if (isManifest(project)) {
    map[project.id] = { ...project, detail_loaded: true } as ProjectManifest;
    return;
  }

  const next: StoredProject = {
    ...project,
    schema_version: existing?.schema_version ?? 1,
    workspace_bindings: existing?.workspace_bindings ?? [],
    detail_loaded: existing?.detail_loaded ?? false,
  };
  map[project.id] = next;
}

export { NO_PROJECT_ID };
export type { ProjectManifest, ProjectSummary };
