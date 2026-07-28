import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectService } from "../ProjectService";
import type { ProjectManifest } from "../types";

const manifest: ProjectManifest = {
  id: "project/with spaces",
  name: "Restored Project",
  description: null,
  status: "active",
  revision: 8,
  resource_revision: 3,
  project_path: "/repo/zenith",
  project_path_status: "configured",
  workspace_count: 2,
  created_at: "2026-07-28T00:00:00Z",
  updated_at: "2026-07-28T01:00:00Z",
  schema_version: 1,
  workspace_bindings: [{ path: "/repo/zenith-worktree" }],
  legacy_project_keys: ["legacy-zenith"],
};

describe("ProjectService", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("unarchives through the full agent API URL with a quoted If-Match revision", async () => {
    const service = new ProjectService();

    await expect(service.unarchiveProject("project/with spaces", 7)).resolves.toEqual(manifest);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9562/api/v1/projects/project%2Fwith%20spaces/unarchive",
      expect.objectContaining({
        method: "POST",
        body: "{}",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "If-Match": '"7"',
        },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("normalizes dry-run collections omitted by Bamboo when they are empty", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          assignments: [
            {
              session_id: "session-1",
              project_id: "project-1",
              basis: "exact_canonical_binding",
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    const service = new ProjectService();

    await expect(service.legacyDryRun({ sessions: [] })).resolves.toEqual({
      assignments: [
        {
          session_id: "session-1",
          project_id: "project-1",
          basis: "exact_canonical_binding",
        },
      ],
      suggestions: [],
      unassigned: [],
      diagnostics: [],
    });
  });

  it("routes every Project endpoint through the agent API client", async () => {
    const service = new ProjectService();

    await service.listProjects();
    await service.getProject("project/with spaces");
    await service.createProject({ name: "Project", project_path: "/repo/project" });
    await service.patchProject("project/with spaces", 7, { name: "Renamed" });
    await service.bindWorkspace("project/with spaces", 7, { path: "/repo/worktree" });
    await service.unbindWorkspace("project/with spaces", 7, { path: "/repo/worktree" });
    await service.archiveProject("project/with spaces", 7);
    await service.unarchiveProject("project/with spaces", 7);
    await service.getProjectResources("project/with spaces");
    await service.legacyDryRun({ sessions: [] });
    await service.migrateLegacyMemory("project/with spaces", 7, {
      legacy_project_key: "legacy/key",
    });
    await service.getLegacyMemoryMigrationStatus("project/with spaces", "legacy/key");

    expect(
      fetchMock.mock.calls.map(([url, init]) => [url, (init as RequestInit | undefined)?.method]),
    ).toEqual([
      ["http://127.0.0.1:9562/api/v1/projects", "GET"],
      ["http://127.0.0.1:9562/api/v1/projects/project%2Fwith%20spaces", "GET"],
      ["http://127.0.0.1:9562/api/v1/projects", "POST"],
      ["http://127.0.0.1:9562/api/v1/projects/project%2Fwith%20spaces", "PATCH"],
      ["http://127.0.0.1:9562/api/v1/projects/project%2Fwith%20spaces/workspaces", "POST"],
      ["http://127.0.0.1:9562/api/v1/projects/project%2Fwith%20spaces/workspaces", "DELETE"],
      ["http://127.0.0.1:9562/api/v1/projects/project%2Fwith%20spaces/archive", "POST"],
      ["http://127.0.0.1:9562/api/v1/projects/project%2Fwith%20spaces/unarchive", "POST"],
      ["http://127.0.0.1:9562/api/v1/projects/project%2Fwith%20spaces/resources", "GET"],
      ["http://127.0.0.1:9562/api/v1/projects/migrations/legacy/dry-run", "POST"],
      [
        "http://127.0.0.1:9562/api/v1/projects/project%2Fwith%20spaces/migrations/legacy-memory",
        "POST",
      ],
      [
        "http://127.0.0.1:9562/api/v1/projects/project%2Fwith%20spaces/migrations/legacy-memory?legacy_project_key=legacy%2Fkey",
        "GET",
      ],
    ]);
  });
});
