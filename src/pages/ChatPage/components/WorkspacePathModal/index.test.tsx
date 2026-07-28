import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectManifest } from "@services/project";
import { useAppStore } from "@shared/store/appStore";
import WorkspacePathModal from "./index";

const { mockGetProject, mockAddRecentWorkspace } = vi.hoisted(() => ({
  mockGetProject: vi.fn(),
  mockAddRecentWorkspace: vi.fn(),
}));

vi.mock("@services/project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@services/project")>();
  return {
    ...actual,
    projectService: {
      ...actual.projectService,
      getProject: mockGetProject,
    },
  };
});

vi.mock("../../services/RecentWorkspacesManager", () => ({
  recentWorkspacesManager: {
    addRecentWorkspace: mockAddRecentWorkspace,
  },
}));

vi.mock("../WorkspacePicker", () => ({
  default: ({
    value,
    onChange,
    onValidationChange,
  }: {
    value: string;
    onChange?: (value: string) => void;
    onValidationChange?: (result: {
      path: string;
      is_valid: boolean;
      workspace_name: string;
    }) => void;
  }) => (
    <input
      data-testid="workspace-other-input"
      value={value}
      onChange={(event) => {
        const next = event.target.value;
        onChange?.(next);
        onValidationChange?.({
          path: next,
          is_valid: true,
          workspace_name: "Chosen workspace",
        });
      }}
    />
  ),
}));

const PROJECT: ProjectManifest = {
  id: "proj-zenith",
  name: "Zenith",
  description: null,
  status: "active",
  revision: 8,
  resource_revision: 3,
  project_path: "/repo/zenith",
  project_path_status: "configured",
  workspace_count: 3,
  created_at: "2026-07-28T00:00:00Z",
  updated_at: "2026-07-28T00:00:00Z",
  schema_version: 1,
  workspace_bindings: [
    { path: "/repo/zenith", label: "Duplicate primary", git_common_dir: null },
    {
      path: "/repo/zenith-worktree",
      label: "Issue 155 worktree",
      git_common_dir: "/repo/zenith/.git",
    },
  ],
  legacy_project_keys: [],
};

const renderModal = (
  onSubmit: (path: string) => boolean | Promise<boolean>,
  submitError: string | null = null,
) =>
  render(
    <AntdApp>
      <WorkspacePathModal
        open={true}
        initialPath="/repo/zenith"
        projectId="proj-zenith"
        submitError={submitError}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    </AntdApp>,
  );

describe("WorkspacePathModal Project options (#155)", () => {
  beforeEach(() => {
    mockGetProject.mockReset();
    mockAddRecentWorkspace.mockReset();
    mockGetProject.mockResolvedValue(PROJECT);
    mockAddRecentWorkspace.mockResolvedValue(undefined);
    useAppStore.setState((state) => ({
      ...state,
      projects: {},
      projectsMissing: {},
    }));
  });

  it("renders the authoritative primary path first, deduplicates it, then bound workspaces", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderModal(onSubmit);

    const primary = await screen.findByTestId("project-workspace-option-0");
    const worktree = screen.getByTestId("project-workspace-option-1");
    const primaryLabel = primary.closest("label");
    const worktreeLabel = worktree.closest("label");

    expect(primaryLabel).toHaveTextContent("Primary Project folder");
    expect(primaryLabel).toHaveTextContent("/repo/zenith");
    expect(worktreeLabel).toHaveTextContent("Issue 155 worktree");
    expect(worktreeLabel).toHaveTextContent("/repo/zenith-worktree");
    expect(screen.queryByTestId("project-workspace-option-2")).not.toBeInTheDocument();
    expect(
      primary.compareDocumentPosition(worktree) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(worktree);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("/repo/zenith-worktree"));
  });

  it("makes Other explicit and never records a rejected unbound path as recent", async () => {
    const onSubmit = vi.fn().mockResolvedValue(false);
    renderModal(onSubmit);

    await screen.findByTestId("project-workspace-option-0");
    fireEvent.click(screen.getByTestId("project-workspace-other"));
    const input = await screen.findByTestId("workspace-other-input");
    fireEvent.change(input, { target: { value: "/other/unbound" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("/other/unbound"));
    expect(mockAddRecentWorkspace).not.toHaveBeenCalled();
    expect(screen.getByText(/not bound automatically/i)).toBeInTheDocument();
  });

  it("records a valid Other path only after the backend confirms it", async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    renderModal(onSubmit);

    await screen.findByTestId("project-workspace-option-0");
    fireEvent.click(screen.getByTestId("project-workspace-other"));
    fireEvent.change(await screen.findByTestId("workspace-other-input"), {
      target: { value: "/repo/new-bound-worktree" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockAddRecentWorkspace).toHaveBeenCalledWith("/repo/new-bound-worktree", {
        workspace_name: "Chosen workspace",
      }),
    );
  });

  it("renders a structured submit failure without clearing the current choice", async () => {
    renderModal(vi.fn(), "This folder is not bound to this Project.");

    await screen.findByTestId("project-workspace-option-0");
    expect(screen.getByText("This folder is not bound to this Project.")).toBeInTheDocument();
    expect(screen.getByTestId("project-workspace-option-0")).toBeChecked();
  });
});
