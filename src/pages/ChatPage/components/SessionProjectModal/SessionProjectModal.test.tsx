import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectManifest } from "@services/project";
import { useAppStore } from "@shared/store/appStore";
import SessionProjectModal from "./index";

vi.mock("../ProjectManagerModal", () => ({
  default: ({ open, initialView }: { open: boolean; initialView?: "manage" | "create" }) =>
    open ? (
      <div data-testid="project-manager-stub" data-initial-view={initialView}>
        Project manager
      </div>
    ) : null,
}));

const project = (
  id: string,
  name: string,
  projectPath: string,
  bindings: ProjectManifest["workspace_bindings"] = [],
): ProjectManifest => ({
  id,
  name,
  description: null,
  status: "active",
  revision: 1,
  resource_revision: 1,
  project_path: projectPath,
  project_path_status: "configured",
  workspace_count: 1 + bindings.length,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  schema_version: 2,
  workspace_bindings: bindings,
  legacy_project_keys: [],
});

const ZENITH = project("proj-zenith", "Zenith", "/repo/zenith", [
  { path: "/repo/zenith-worktree", label: "Issue worktree", git_common_dir: null },
]);
const BAMBOO = project("proj-bamboo", "Bamboo", "/repo/bamboo");

describe("SessionProjectModal (#210)", () => {
  const assignSessionProject = vi.fn();
  const loadProjects = vi.fn();
  const ensureProject = vi.fn();

  beforeEach(() => {
    assignSessionProject.mockReset().mockResolvedValue({
      id: "session-1",
      project_id: "proj-zenith",
      workspace_path: "/repo/zenith-worktree",
    });
    loadProjects.mockReset().mockResolvedValue(undefined);
    ensureProject.mockReset().mockResolvedValue(undefined);
    useAppStore.setState({
      projects: {
        [ZENITH.id]: ZENITH,
        [BAMBOO.id]: BAMBOO,
      },
      projectsLoading: false,
      projectsError: null,
      projectsLoadedAt: Date.now(),
      projectsAvailable: true,
      activeProjectId: ZENITH.id,
      assignSessionProject,
      loadProjects,
      ensureProject,
    });
  });

  it("shows the primary and every additional workspace bound to the selected Project", async () => {
    render(
      <AntdApp>
        <SessionProjectModal
          open
          sessionId="session-1"
          currentProjectId="proj-zenith"
          currentWorkspacePath="/repo/zenith"
          onCancel={() => {}}
        />
      </AntdApp>,
    );

    expect(await screen.findByTestId("session-project-select")).toHaveTextContent("Zenith");
    expect(screen.getByTestId("session-project-workspace-0").closest("label")).toHaveTextContent(
      "Primary Project folder",
    );
    expect(screen.getByTestId("session-project-workspace-0").closest("label")).toHaveTextContent(
      "/repo/zenith",
    );
    expect(screen.getByTestId("session-project-workspace-1").closest("label")).toHaveTextContent(
      "Issue worktree",
    );
    expect(screen.getByTestId("session-project-workspace-1").closest("label")).toHaveTextContent(
      "/repo/zenith-worktree",
    );
    expect(ensureProject).toHaveBeenCalledWith("proj-zenith", { force: true });
  });

  it("atomically assigns the selected Project and bound workspace", async () => {
    const onCancel = vi.fn();
    render(
      <AntdApp>
        <SessionProjectModal
          open
          sessionId="session-1"
          currentProjectId="proj-zenith"
          currentWorkspacePath="/repo/zenith"
          onCancel={onCancel}
        />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByTestId("session-project-workspace-1"));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect(assignSessionProject).toHaveBeenCalledWith(
        "session-1",
        "proj-zenith",
        "/repo/zenith-worktree",
      ),
    );
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it("switches Projects with the target Project primary workspace selected by default", async () => {
    render(
      <AntdApp>
        <SessionProjectModal
          open
          sessionId="session-1"
          currentProjectId="proj-zenith"
          currentWorkspacePath="/repo/zenith"
          onCancel={() => {}}
        />
      </AntdApp>,
    );

    fireEvent.mouseDown(screen.getByTestId("session-project-select").querySelector("input")!);
    fireEvent.click(await screen.findByText("Bamboo"));
    await waitFor(() =>
      expect(screen.getByTestId("session-project-workspace-0").closest("label")).toHaveTextContent(
        "/repo/bamboo",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect(assignSessionProject).toHaveBeenCalledWith("session-1", "proj-bamboo", "/repo/bamboo"),
    );
  });

  it("keeps assignment disabled until the selected Project detail is authoritative", async () => {
    let resolveBambooDetail: (() => void) | undefined;
    ensureProject.mockImplementation((projectId: string) => {
      if (projectId !== "proj-bamboo") return Promise.resolve();
      return new Promise<void>((resolve) => {
        resolveBambooDetail = resolve;
      });
    });
    render(
      <AntdApp>
        <SessionProjectModal
          open
          sessionId="session-1"
          currentProjectId="proj-zenith"
          currentWorkspacePath="/repo/zenith"
          onCancel={() => {}}
        />
      </AntdApp>,
    );

    fireEvent.mouseDown(screen.getByTestId("session-project-select").querySelector("input")!);
    fireEvent.click(await screen.findByText("Bamboo"));
    await waitFor(() => expect(ensureProject).toHaveBeenCalledWith("proj-bamboo", { force: true }));
    expect(screen.getByRole("button", { name: /Assign$/ })).toBeDisabled();

    resolveBambooDetail?.();
    await waitFor(() => expect(screen.getByRole("button", { name: /Assign$/ })).toBeEnabled());
  });

  it("opens Project creation and workspace management from the session picker", async () => {
    const { unmount } = render(
      <AntdApp>
        <SessionProjectModal open sessionId="session-1" onCancel={() => {}} />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByTestId("session-project-create"));
    expect(await screen.findByTestId("project-manager-stub")).toHaveAttribute(
      "data-initial-view",
      "create",
    );

    unmount();
    render(
      <AntdApp>
        <SessionProjectModal open sessionId="session-1" onCancel={() => {}} />
      </AntdApp>,
    );
    fireEvent.click(await screen.findByTestId("session-project-manage"));
    expect(await screen.findByTestId("project-manager-stub")).toHaveAttribute(
      "data-initial-view",
      "manage",
    );
  });

  it("offers creation in the Project-first empty state", async () => {
    useAppStore.setState({ projects: {}, activeProjectId: null });
    render(
      <AntdApp>
        <SessionProjectModal open sessionId="session-1" onCancel={() => {}} />
      </AntdApp>,
    );

    expect(
      await screen.findByText(/No active Project has a configured primary workspace/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("session-project-create")).toBeEnabled();
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
  });

  it("keeps child sessions read-only and hides Project registry mutations", async () => {
    render(
      <AntdApp>
        <SessionProjectModal
          open
          sessionId="child-1"
          currentProjectId="proj-zenith"
          currentWorkspacePath="/repo/zenith"
          isChildSession
          onCancel={() => {}}
        />
      </AntdApp>,
    );

    expect(await screen.findByText(/Child sessions inherit/)).toBeInTheDocument();
    expect(screen.queryByTestId("session-project-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-project-manage")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
  });
});
