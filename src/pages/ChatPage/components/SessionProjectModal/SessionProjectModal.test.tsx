import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectManifest } from "@services/project";
import { useAppStore } from "@shared/store/appStore";
import SessionProjectModal from "./index";

const project = (
  id: string,
  name: string,
  pathStatus: "configured" | "needs_configuration" = "configured",
): ProjectManifest => ({
  id,
  name,
  description: null,
  status: "active",
  revision: 1,
  resource_revision: 1,
  project_path: pathStatus === "configured" ? `/repo/${id}` : null,
  project_path_status: pathStatus,
  workspace_count: pathStatus === "configured" ? 1 : 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  schema_version: 2,
  workspace_bindings: [],
  legacy_project_keys: [],
});

describe("SessionProjectModal (#208)", () => {
  const assignSessionProject = vi.fn();
  const loadProjects = vi.fn();

  beforeEach(() => {
    assignSessionProject.mockReset().mockResolvedValue({
      id: "session-1",
      project_id: "proj-bamboo",
      workspace_path: "/repo/proj-bamboo",
    });
    loadProjects.mockReset().mockResolvedValue(undefined);
    useAppStore.setState({
      projects: {
        "proj-zenith": project("proj-zenith", "Zenith"),
        "proj-bamboo": project("proj-bamboo", "Bamboo"),
        "proj-unready": project("proj-unready", "Unready", "needs_configuration"),
      },
      projectsLoading: false,
      activeProjectId: "proj-zenith",
      assignSessionProject,
      loadProjects,
    });
  });

  it("assigns the selected Project to the current root session", async () => {
    const onCancel = vi.fn();
    render(
      <AntdApp>
        <SessionProjectModal
          open
          sessionId="session-1"
          currentProjectId="proj-zenith"
          onCancel={onCancel}
        />
      </AntdApp>,
    );

    fireEvent.mouseDown(screen.getByTestId("session-project-select").querySelector("input")!);
    fireEvent.click(await screen.findByText("Bamboo"));
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect(assignSessionProject).toHaveBeenCalledWith("session-1", "proj-bamboo"),
    );
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
  });

  it("disables direct assignment for child sessions", () => {
    render(
      <AntdApp>
        <SessionProjectModal
          open
          sessionId="child-1"
          currentProjectId="proj-zenith"
          isChildSession
          onCancel={() => {}}
        />
      </AntdApp>,
    );

    expect(screen.getByText(/Child sessions inherit/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
  });

  it("marks Projects without a primary folder as unavailable", async () => {
    render(
      <AntdApp>
        <SessionProjectModal
          open
          sessionId="session-1"
          currentProjectId="proj-zenith"
          onCancel={() => {}}
        />
      </AntdApp>,
    );

    fireEvent.mouseDown(screen.getByTestId("session-project-select").querySelector("input")!);
    const option = await screen.findByText(/Unready.*Folder required/);
    expect(option.closest(".ant-select-item-option")).toHaveClass(
      "ant-select-item-option-disabled",
    );
  });
});
