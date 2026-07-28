import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@services/api";
import type { ProjectManifest, ProjectSummary } from "@services/project";
import { createProjectSlice, type ProjectSlice } from "../projectSlice";
import { createSliceHarness } from "./sliceHarness";

const { listProjects, getProject } = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock("@services/project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@services/project")>();
  return {
    ...actual,
    projectService: {
      ...actual.projectService,
      listProjects,
      getProject,
    },
  };
});

const makeManifest = (id: string, overrides: Partial<ProjectManifest> = {}): ProjectManifest => ({
  id,
  name: `Project ${id}`,
  description: null,
  status: "active",
  revision: 1,
  resource_revision: 1,
  project_path: `/repo/${id}`,
  project_path_status: "configured",
  workspace_count: 2,
  created_at: "2025-03-01T00:00:00Z",
  updated_at: "2025-03-01T00:00:00Z",
  schema_version: 1,
  workspace_bindings: [{ path: `/repo/${id}-worktree`, label: null, git_common_dir: null }],
  legacy_project_keys: [],
  ...overrides,
});

/** A slim summary (Bamboo-agent#727 shape) — no bindings arrays. */
const makeSummary = (id: string, overrides: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id,
  name: `Project ${id}`,
  description: null,
  status: "active",
  revision: 1,
  resource_revision: 1,
  project_path: `/repo/${id}`,
  project_path_status: "configured",
  workspace_count: 1,
  created_at: "2025-03-01T00:00:00Z",
  updated_at: "2025-03-01T00:00:00Z",
  ...overrides,
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Store-ready record: manifests land in the map via mergeProjectIntoMap,
 * which stamps `detail_loaded`. */
const stored = (manifest: ProjectManifest): ProjectManifest =>
  ({ ...manifest, detail_loaded: true }) as ProjectManifest;

type Harness = ReturnType<typeof createSliceHarness<ProjectSlice>>;
const createHarness = (): Harness => createSliceHarness<ProjectSlice>(createProjectSlice);

describe("projectSlice", () => {
  beforeEach(() => {
    listProjects.mockReset();
    getProject.mockReset();
  });

  describe("loadProjects", () => {
    it("stores manifests and marks the Project API available", async () => {
      listProjects.mockResolvedValue({ projects: [makeManifest("p1")] });
      const harness = createHarness();

      await harness.getState().loadProjects();

      const state = harness.getState();
      expect(state.projects["p1"]?.name).toBe("Project p1");
      expect((state.projects["p1"] as { detail_loaded?: boolean }).detail_loaded).toBe(true);
      expect(state.projectsAvailable).toBe(true);
      expect(state.projectsError).toBeNull();
    });

    it("prunes projects that disappeared from the remote list", async () => {
      listProjects.mockResolvedValue({ projects: [makeManifest("p2")] });
      const harness = createHarness();
      harness.setState({ projects: { p1: stored(makeManifest("p1")) } });

      await harness.getState().loadProjects();

      expect(harness.getState().projects["p1"]).toBeUndefined();
      expect(harness.getState().projects["p2"]).toBeDefined();
    });

    it("preserves manifest-only fields when a slim summary arrives", async () => {
      listProjects.mockResolvedValue({
        projects: [makeSummary("p1", { revision: 2, name: "Renamed" })],
      });
      const harness = createHarness();
      harness.setState({ projects: { p1: stored(makeManifest("p1")) } });

      await harness.getState().loadProjects();

      const project = harness.getState().projects["p1"];
      expect(project?.name).toBe("Renamed");
      expect(project?.workspace_bindings).toEqual([
        { path: "/repo/p1-worktree", label: null, git_common_dir: null },
      ]);
      expect((project as { detail_loaded?: boolean }).detail_loaded).toBe(true);
    });

    it("treats 404 as 'Project API missing' but keeps availability unknown on network errors", async () => {
      listProjects.mockRejectedValueOnce(new ApiError("Not Found", 404, "Not Found"));
      const harness = createHarness();
      await expect(harness.getState().loadProjects()).rejects.toThrow();
      expect(harness.getState().projectsAvailable).toBe(false);

      listProjects.mockRejectedValueOnce(new TypeError("fetch failed"));
      const harness2 = createHarness();
      await expect(harness2.getState().loadProjects()).rejects.toThrow();
      expect(harness2.getState().projectsAvailable).toBeNull();
    });
  });

  describe("ensureProject", () => {
    it("skips the fetch when the full manifest is already loaded", async () => {
      const harness = createHarness();
      harness.setState({ projects: { p1: stored(makeManifest("p1")) } });

      await harness.getState().ensureProject("p1");

      expect(getProject).not.toHaveBeenCalled();
    });

    it("fetches the detail for summary-only records and keeps it", async () => {
      getProject.mockResolvedValue(makeManifest("p1", { revision: 2 }));
      const harness = createHarness();
      harness.setState({
        projects: {
          p1: {
            ...makeSummary("p1"),
            schema_version: 1,
            workspace_bindings: [],
            legacy_project_keys: [],
          },
        },
      });

      await harness.getState().ensureProject("p1");

      expect(getProject).toHaveBeenCalledWith("p1");
      expect(harness.getState().projects["p1"]?.workspace_bindings).toHaveLength(1);
    });

    it("tombstones 404s and never refetches them", async () => {
      getProject.mockRejectedValue(new ApiError("Not Found", 404, "Not Found"));
      const harness = createHarness();

      await harness.getState().ensureProject("ghost");
      await harness.getState().ensureProject("ghost");

      expect(getProject).toHaveBeenCalledTimes(1);
      expect(harness.getState().projectsMissing["ghost"]).toBe(true);
      expect(harness.getState().projects["ghost"]).toBeUndefined();
    });

    it("dedupes concurrent fetches for the same id", async () => {
      let resolveFetch: (value: ProjectManifest) => void = () => {};
      getProject.mockImplementation(
        () =>
          new Promise<ProjectManifest>((resolve) => {
            resolveFetch = resolve;
          }),
      );
      const harness = createHarness();

      const first = harness.getState().ensureProject("p1");
      const second = harness.getState().ensureProject("p1");
      resolveFetch(makeManifest("p1"));
      await Promise.all([first, second]);

      expect(getProject).toHaveBeenCalledTimes(1);
    });
  });

  describe("applyProjectEvent", () => {
    it("ignores events with a stale revision", async () => {
      const harness = createHarness();
      harness.setState({ projects: { p1: stored(makeManifest("p1", { revision: 5 })) } });

      harness
        .getState()
        .applyProjectEvent({ type: "project_updated", project_id: "p1", revision: 3 });
      await flush();

      expect(harness.getState().projects["p1"]?.revision).toBe(5);
      expect(getProject).not.toHaveBeenCalled();
    });

    it("applies archived status immediately and refetches the manifest", async () => {
      getProject.mockResolvedValue(makeManifest("p1", { status: "archived", revision: 2 }));
      const harness = createHarness();
      harness.setState({ projects: { p1: stored(makeManifest("p1")) } });

      harness
        .getState()
        .applyProjectEvent({ type: "project_archived", project_id: "p1", revision: 2 });

      // Status flips synchronously from the event itself.
      expect(harness.getState().projects["p1"]?.status).toBe("archived");
      // The authoritative manifest follows from the forced refetch.
      await flush();
      expect(getProject).toHaveBeenCalledWith("p1");
      expect(harness.getState().projects["p1"]?.revision).toBe(2);
    });

    it("picks up renames, which the event payload does not carry", async () => {
      getProject.mockResolvedValue(makeManifest("p1", { name: "New name", revision: 2 }));
      const harness = createHarness();
      harness.setState({ projects: { p1: stored(makeManifest("p1")) } });

      harness
        .getState()
        .applyProjectEvent({ type: "project_updated", project_id: "p1", revision: 2 });
      await flush();

      expect(harness.getState().projects["p1"]?.name).toBe("New name");
    });

    it("refreshes the Project resource revision carried by the authoritative manifest", async () => {
      getProject.mockResolvedValue(makeManifest("p1", { revision: 2, resource_revision: 7 }));
      const harness = createHarness();
      harness.setState({ projects: { p1: stored(makeManifest("p1")) } });

      harness
        .getState()
        .applyProjectEvent({ type: "project_updated", project_id: "p1", revision: 2 });
      await flush();

      expect(harness.getState().projects["p1"]?.resource_revision).toBe(7);
    });

    it("lazily loads unknown projects", async () => {
      getProject.mockResolvedValue(makeManifest("p9"));
      const harness = createHarness();

      harness
        .getState()
        .applyProjectEvent({ type: "project_created", project_id: "p9", revision: 1 });
      await flush();

      expect(harness.getState().projects["p9"]?.name).toBe("Project p9");
    });
  });

  describe("activeProjectId hygiene (#154)", () => {
    it("clears the active project when it is archived locally", async () => {
      const { projectService } = await import("@services/project");
      const original = projectService.archiveProject;
      projectService.archiveProject = vi
        .fn()
        .mockResolvedValue(makeManifest("p1", { status: "archived", revision: 2 }));
      const harness = createHarness();
      harness.setState({
        projects: { p1: stored(makeManifest("p1")) },
        activeProjectId: "p1",
      });
      try {
        await harness.getState().archiveProject("p1", 1);
      } finally {
        projectService.archiveProject = original;
      }

      expect(harness.getState().projects["p1"]?.status).toBe("archived");
      expect(harness.getState().activeProjectId).toBeNull();
    });

    it("clears the active project when an archived event arrives", () => {
      const harness = createHarness();
      harness.setState({
        projects: { p1: stored(makeManifest("p1")) },
        activeProjectId: "p1",
      });

      harness
        .getState()
        .applyProjectEvent({ type: "project_archived", project_id: "p1", revision: 2 });

      expect(harness.getState().activeProjectId).toBeNull();
    });

    it("clears the active project when the remote list prunes it", async () => {
      listProjects.mockResolvedValue({ projects: [] });
      const harness = createHarness();
      harness.setState({
        projects: { p1: stored(makeManifest("p1")) },
        activeProjectId: "p1",
      });

      await harness.getState().loadProjects();

      expect(harness.getState().activeProjectId).toBeNull();
    });
  });

  describe("migrateLegacyMemory", () => {
    it("does not fabricate a manifest for an unknown project", async () => {
      const harness = createHarness();
      const migrateLegacyMemory = vi.fn().mockResolvedValue({
        project_id: "ghost",
        project_revision: 7,
        migration: null,
      });
      // Swap the service method for this test only.
      const { projectService } = await import("@services/project");
      const original = projectService.migrateLegacyMemory;
      projectService.migrateLegacyMemory = migrateLegacyMemory;
      try {
        await harness.getState().migrateLegacyMemory("ghost", 1, "legacy-key");
      } finally {
        projectService.migrateLegacyMemory = original;
      }

      expect(harness.getState().projects["ghost"]).toBeUndefined();
    });
  });
});
