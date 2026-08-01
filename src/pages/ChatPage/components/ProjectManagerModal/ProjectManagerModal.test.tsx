import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProjectManagerModal from "./index";
import { useAppStore } from "@shared/store/appStore";
import { ApiError } from "@services/api";
import type { ProjectManifest } from "@services/project";

const {
  mockListProjects,
  mockGetProject,
  mockCreateProject,
  mockPatchProject,
  mockArchiveProject,
  mockUnarchiveProject,
  mockBindWorkspace,
  mockUnbindWorkspace,
  mockGetProjectResources,
  mockFolderSelection,
} = vi.hoisted(() => ({
  mockListProjects: vi.fn(),
  mockGetProject: vi.fn(),
  mockCreateProject: vi.fn(),
  mockPatchProject: vi.fn(),
  mockArchiveProject: vi.fn(),
  mockUnarchiveProject: vi.fn(),
  mockBindWorkspace: vi.fn(),
  mockUnbindWorkspace: vi.fn(),
  mockGetProjectResources: vi.fn(),
  mockFolderSelection: { path: "/repo/selected" },
}));

vi.mock("@services/project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@services/project")>();
  return {
    ...actual,
    projectService: {
      ...actual.projectService,
      listProjects: mockListProjects,
      getProject: mockGetProject,
      createProject: mockCreateProject,
      patchProject: mockPatchProject,
      archiveProject: mockArchiveProject,
      unarchiveProject: mockUnarchiveProject,
      bindWorkspace: mockBindWorkspace,
      unbindWorkspace: mockUnbindWorkspace,
      getProjectResources: mockGetProjectResources,
    },
  };
});

vi.mock("../FolderBrowser", () => ({
  FolderBrowser: ({
    visible,
    onClose,
    onSelect,
  }: {
    visible: boolean;
    onClose: () => void;
    onSelect: (path: string) => void;
  }) =>
    visible ? (
      <button
        type="button"
        data-testid="folder-browser-select-current"
        onClick={() => {
          onSelect(mockFolderSelection.path);
          onClose();
        }}
      >
        Select current folder
      </button>
    ) : null,
}));

const makeProject = (
  id: string,
  name: string,
  overrides: Partial<ProjectManifest> = {},
): ProjectManifest =>
  ({
    id,
    name,
    description: null,
    status: "active",
    revision: 1,
    resource_revision: 1,
    project_path: `/repo/${id.replace("proj-", "")}`,
    project_path_status: "configured",
    workspace_count: 1,
    created_at: "2025-03-01T00:00:00Z",
    updated_at: "2025-03-01T00:00:00Z",
    schema_version: 1,
    workspace_bindings: [],
    legacy_project_keys: [],
    detail_loaded: true,
    ...overrides,
  }) as ProjectManifest;

const ZENITH = makeProject("proj-zenith", "zenith", {
  workspace_count: 2,
  workspace_bindings: [{ path: "/repo/zenith-worktree", label: null, git_common_dir: null }],
});
const BAMBOO = makeProject("proj-bamboo", "bamboo");
const LEGACY = makeProject("proj-legacy", "legacy", {
  project_path: null,
  project_path_status: "needs_selection",
  workspace_count: 2,
  workspace_bindings: [
    { path: "/repo/legacy-a", label: null, git_common_dir: null },
    { path: "/repo/legacy-b", label: null, git_common_dir: null },
  ],
});
const ARCHIVED = makeProject("proj-old", "old-stuff", { status: "archived" });

const renderModal = () =>
  render(
    <AntdApp>
      <ProjectManagerModal open={true} onClose={() => {}} onOpenMigration={() => {}} />
    </AntdApp>,
  );

const getWorkspaceInput = (testId: string) =>
  within(screen.getByTestId(testId)).getByRole("textbox");

const browseWorkspace = (testId: string, path: string) => {
  mockFolderSelection.path = path;
  fireEvent.click(
    within(screen.getByTestId(testId)).getByRole("button", {
      name: "Browse folder",
    }),
  );
  fireEvent.click(screen.getByTestId("folder-browser-select-current"));
};

describe("ProjectManagerModal (#154)", () => {
  beforeEach(() => {
    mockListProjects.mockReset();
    mockGetProject.mockReset();
    mockCreateProject.mockReset();
    mockPatchProject.mockReset();
    mockArchiveProject.mockReset();
    mockUnarchiveProject.mockReset();
    mockBindWorkspace.mockReset();
    mockUnbindWorkspace.mockReset();
    mockGetProjectResources.mockReset();
    mockFolderSelection.path = "/repo/selected";

    mockGetProject.mockImplementation((id: string) =>
      Promise.resolve(id === "proj-bamboo" ? BAMBOO : id === "proj-old" ? ARCHIVED : ZENITH),
    );
    mockGetProjectResources.mockResolvedValue({
      project_id: "proj-zenith",
      resource_revision: 3,
      resources: [
        { kind: "skills", present: true, item_count: 2 },
        { kind: "memory", present: true, item_count: 5 },
        { kind: "settings", present: false, item_count: 0 },
      ],
    });

    useAppStore.setState((state) => ({
      ...state,
      projects: {
        "proj-zenith": ZENITH,
        "proj-bamboo": BAMBOO,
        "proj-legacy": LEGACY,
        "proj-old": ARCHIVED,
      },
      activeProjectId: "proj-zenith",
      projectResources: {},
    }));
  });

  it("lists active projects before archived ones and shows the detail panel", async () => {
    renderModal();

    expect(await screen.findByTestId("project-list-item-proj-zenith")).toBeInTheDocument();
    expect(screen.queryByTestId("project-list-item-proj-old")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("project-archived-toggle"));
    expect(screen.getByTestId("project-list-item-proj-old")).toHaveTextContent("Archived");
    expect(screen.getByTestId("project-detail-name")).toHaveValue("zenith");
    expect(getWorkspaceInput("project-detail-path")).toHaveValue("/repo/zenith");
    // Additional workspace binding from the manifest.
    expect(await screen.findByText("/repo/zenith-worktree")).toBeInTheDocument();
    // Resource summary only shows present kinds, with counts and revision.
    expect(await screen.findByText("skills (2)")).toBeInTheDocument();
    expect(screen.getByText("memory (5)")).toBeInTheDocument();
    expect(screen.queryByText(/settings/)).not.toBeInTheDocument();
    expect(screen.getByText("Resource revision: 3")).toBeInTheDocument();
  });

  it("creates a project with an explicit authoritative Project path", async () => {
    const created = makeProject("proj-new", "nova", {
      project_path: "/repo/nova",
      revision: 1,
    });
    mockCreateProject.mockResolvedValue(created);
    renderModal();

    fireEvent.click(screen.getByTestId("project-create-open"));
    fireEvent.change(screen.getByTestId("project-create-name"), { target: { value: "nova" } });
    fireEvent.change(getWorkspaceInput("project-create-path"), {
      target: { value: "/repo/nova" },
    });
    fireEvent.click(screen.getByTestId("project-create-submit"));

    await waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith({
        name: "nova",
        description: null,
        project_path: "/repo/nova",
      }),
    );
    // Creating a project makes it the active project (projectSlice behavior).
    await waitFor(() => expect(useAppStore.getState().activeProjectId).toBe("proj-new"));
  });

  it("requires a name when creating", async () => {
    renderModal();

    fireEvent.click(screen.getByTestId("project-create-open"));
    fireEvent.click(screen.getByTestId("project-create-submit"));

    expect(await screen.findByText("Please enter a project name")).toBeInTheDocument();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("requires a Project path when creating", async () => {
    renderModal();

    fireEvent.click(screen.getByTestId("project-create-open"));
    fireEvent.change(screen.getByTestId("project-create-name"), { target: { value: "nova" } });
    fireEvent.click(screen.getByTestId("project-create-submit"));

    expect(await screen.findByText("Please select a Project folder")).toBeInTheDocument();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("saves rename/description through the CAS patch endpoint", async () => {
    mockPatchProject.mockResolvedValue(makeProject("proj-zenith", "zenith2", { revision: 2 }));
    renderModal();

    fireEvent.change(await screen.findByTestId("project-detail-name"), {
      target: { value: "zenith2" },
    });
    fireEvent.click(screen.getByTestId("project-detail-save"));

    await waitFor(() =>
      expect(mockPatchProject).toHaveBeenCalledWith("proj-zenith", 1, {
        name: "zenith2",
        description: null,
      }),
    );
  });

  it("updates the authoritative Project path through the same CAS patch", async () => {
    mockPatchProject.mockResolvedValue(
      makeProject("proj-zenith", "zenith", {
        project_path: "/repo/zenith-moved",
        revision: 2,
      }),
    );
    renderModal();

    await screen.findByTestId("project-detail-path");
    fireEvent.change(getWorkspaceInput("project-detail-path"), {
      target: { value: "/repo/zenith-moved" },
    });
    fireEvent.click(screen.getByTestId("project-detail-save"));

    await waitFor(() =>
      expect(mockPatchProject).toHaveBeenCalledWith("proj-zenith", 1, {
        name: "zenith",
        description: null,
        project_path: "/repo/zenith-moved",
      }),
    );
  });

  it("applies browsed folders to primary and additional Project paths", async () => {
    mockPatchProject.mockResolvedValue(
      makeProject("proj-zenith", "zenith", {
        project_path: "/repo/zenith-moved",
        revision: 2,
      }),
    );
    mockBindWorkspace.mockResolvedValue(
      makeProject("proj-zenith", "zenith", {
        project_path: "/repo/zenith-moved",
        revision: 3,
        workspace_count: 3,
        workspace_bindings: [
          { path: "/repo/zenith-worktree", label: null, git_common_dir: null },
          { path: "/repo/zenith-extra", label: null, git_common_dir: null },
        ],
      }),
    );
    renderModal();

    await screen.findByTestId("project-detail-path");
    browseWorkspace("project-detail-path", "/repo/zenith-moved");
    expect(getWorkspaceInput("project-detail-path")).toHaveValue("/repo/zenith-moved");
    fireEvent.click(screen.getByTestId("project-detail-save"));

    await waitFor(() =>
      expect(mockPatchProject).toHaveBeenCalledWith("proj-zenith", 1, {
        name: "zenith",
        description: null,
        project_path: "/repo/zenith-moved",
      }),
    );
    await waitFor(() => expect(useAppStore.getState().projects["proj-zenith"]?.revision).toBe(2));

    browseWorkspace("project-bind-input", "/repo/zenith-extra");
    expect(getWorkspaceInput("project-bind-input")).toHaveValue("/repo/zenith-extra");
    fireEvent.click(screen.getByTestId("project-bind-submit"));

    await waitFor(() =>
      expect(mockBindWorkspace).toHaveBeenCalledWith("proj-zenith", 2, {
        path: "/repo/zenith-extra",
        label: null,
        git_common_dir: null,
      }),
    );
  });

  it("requires explicit selection for legacy Projects with multiple bindings", async () => {
    renderModal();

    fireEvent.click(await screen.findByTestId("project-list-item-proj-legacy"));

    await waitFor(() => expect(getWorkspaceInput("project-detail-path")).toHaveValue(""));
    expect(screen.getByText("Choose primary folder")).toBeInTheDocument();
    expect(screen.getByText("/repo/legacy-a")).toBeInTheDocument();
    expect(screen.getByText("/repo/legacy-b")).toBeInTheDocument();
  });

  it("surfaces a revision conflict and reloads the manifest on 412", async () => {
    mockPatchProject.mockRejectedValue(new ApiError("Precondition Failed", 412, "Failed"));
    renderModal();

    fireEvent.change(await screen.findByTestId("project-detail-name"), {
      target: { value: "zenith2" },
    });
    fireEvent.click(screen.getByTestId("project-detail-save"));

    expect(await screen.findByText(/modified elsewhere/)).toBeInTheDocument();
    await waitFor(() => expect(mockGetProject).toHaveBeenCalledWith("proj-zenith"));
  });

  it("archives a project after confirmation", async () => {
    mockArchiveProject.mockResolvedValue(
      makeProject("proj-zenith", "zenith", { status: "archived", revision: 2 }),
    );
    renderModal();

    fireEvent.click(await screen.findByTestId("project-archive"));
    // The Popconfirm renders its own "Archive" OK button next to the trigger.
    const archiveButtons = await screen.findAllByRole("button", { name: "Archive" });
    fireEvent.click(archiveButtons[archiveButtons.length - 1]);

    await waitFor(() => expect(mockArchiveProject).toHaveBeenCalledWith("proj-zenith", 1));
  });

  it("restores an archived Project with pending state and keeps the active Project stable", async () => {
    let resolveRestore: (manifest: ProjectManifest) => void = () => {};
    mockUnarchiveProject.mockImplementation(
      () =>
        new Promise<ProjectManifest>((resolve) => {
          resolveRestore = resolve;
        }),
    );
    renderModal();

    fireEvent.click(await screen.findByTestId("project-archived-toggle"));
    fireEvent.click(await screen.findByTestId("project-list-item-proj-old"));
    const restoreButton = await screen.findByTestId("project-unarchive");
    fireEvent.click(restoreButton);

    await waitFor(() => expect(restoreButton).toBeDisabled());
    expect(useAppStore.getState().projects["proj-old"]?.status).toBe("archived");
    resolveRestore(makeProject("proj-old", "old-stuff", { status: "active", revision: 2 }));

    await waitFor(() => expect(mockUnarchiveProject).toHaveBeenCalledWith("proj-old", 1));
    await waitFor(() => expect(useAppStore.getState().projects["proj-old"]?.status).toBe("active"));
    expect(useAppStore.getState().activeProjectId).toBe("proj-zenith");
    expect(await screen.findByText("Project restored")).toBeInTheDocument();
  });

  it("reconciles a structured project_not_archived 409 without switching Projects", async () => {
    const restored = makeProject("proj-old", "old-stuff", {
      status: "active",
      revision: 2,
    });
    mockUnarchiveProject.mockRejectedValue(
      new ApiError(
        "Project is not archived",
        409,
        "Conflict",
        JSON.stringify({
          error: {
            type: "api_error",
            code: "project_not_archived",
            message: "Project is not archived",
          },
          project_id: "proj-old",
        }),
      ),
    );
    mockGetProject.mockResolvedValueOnce(restored);
    renderModal();

    fireEvent.click(await screen.findByTestId("project-archived-toggle"));
    fireEvent.click(await screen.findByTestId("project-list-item-proj-old"));
    fireEvent.click(await screen.findByTestId("project-unarchive"));

    expect(await screen.findByText("Project is not archived")).toBeInTheDocument();
    await waitFor(() => expect(mockGetProject).toHaveBeenCalledWith("proj-old"));
    await waitFor(() => expect(useAppStore.getState().projects["proj-old"]?.status).toBe("active"));
    expect(useAppStore.getState().activeProjectId).toBe("proj-zenith");
  });

  it("reloads the archived canonical manifest after a restore 412", async () => {
    mockUnarchiveProject.mockRejectedValue(
      new ApiError("project revision conflict", 412, "Precondition Failed"),
    );
    mockGetProject.mockResolvedValueOnce(
      makeProject("proj-old", "old-stuff", { status: "archived", revision: 2 }),
    );
    renderModal();

    fireEvent.click(await screen.findByTestId("project-archived-toggle"));
    fireEvent.click(await screen.findByTestId("project-list-item-proj-old"));
    fireEvent.click(await screen.findByTestId("project-unarchive"));

    expect(await screen.findByText(/modified elsewhere/)).toBeInTheDocument();
    await waitFor(() => expect(mockGetProject).toHaveBeenCalledWith("proj-old"));
    await waitFor(() => expect(useAppStore.getState().projects["proj-old"]?.revision).toBe(2));
    expect(useAppStore.getState().projects["proj-old"]?.status).toBe("archived");
    expect(useAppStore.getState().activeProjectId).toBe("proj-zenith");
  });

  it("does not overwrite another Project form when a restore 412 refetch resolves late", async () => {
    let resolveRefetch: (manifest: ProjectManifest) => void = () => {};
    mockUnarchiveProject.mockRejectedValue(
      new ApiError("project revision conflict", 412, "Precondition Failed"),
    );
    mockGetProject.mockImplementation((id: string) =>
      id === "proj-old"
        ? new Promise<ProjectManifest>((resolve) => {
            resolveRefetch = resolve;
          })
        : Promise.resolve(id === "proj-bamboo" ? BAMBOO : ZENITH),
    );
    renderModal();

    fireEvent.click(await screen.findByTestId("project-archived-toggle"));
    fireEvent.click(await screen.findByTestId("project-list-item-proj-old"));
    fireEvent.click(await screen.findByTestId("project-unarchive"));
    await waitFor(() => expect(mockGetProject).toHaveBeenCalledWith("proj-old"));

    fireEvent.click(screen.getByTestId("project-list-item-proj-bamboo"));
    const nameInput = await screen.findByTestId("project-detail-name");
    await waitFor(() => expect(nameInput).toHaveValue("bamboo"));
    fireEvent.change(nameInput, { target: { value: "bamboo-draft" } });

    await act(async () => {
      resolveRefetch(
        makeProject("proj-old", "old-canonical", {
          status: "archived",
          revision: 2,
        }),
      );
    });

    await waitFor(() => expect(useAppStore.getState().projects["proj-old"]?.revision).toBe(2));
    expect(nameInput).toHaveValue("bamboo-draft");
    expect(useAppStore.getState().activeProjectId).toBe("proj-zenith");
  });

  it("binds and unbinds workspaces with the current revision", async () => {
    mockBindWorkspace.mockResolvedValue(
      makeProject("proj-zenith", "zenith", {
        revision: 2,
        workspace_count: 3,
        workspace_bindings: [
          { path: "/repo/zenith-worktree", label: null, git_common_dir: null },
          { path: "/repo/nova", label: null, git_common_dir: null },
        ],
      }),
    );
    mockUnbindWorkspace.mockResolvedValue(
      makeProject("proj-zenith", "zenith", {
        revision: 3,
        workspace_count: 1,
        workspace_bindings: [],
      }),
    );
    renderModal();

    await screen.findByTestId("project-bind-input");
    fireEvent.change(getWorkspaceInput("project-bind-input"), {
      target: { value: "/repo/nova" },
    });
    fireEvent.click(screen.getByTestId("project-bind-submit"));
    await waitFor(() =>
      expect(mockBindWorkspace).toHaveBeenCalledWith("proj-zenith", 1, {
        path: "/repo/nova",
        label: null,
        git_common_dir: null,
      }),
    );

    // After the successful bind the store holds revision 2, which the
    // unbind call must use for its own CAS check.
    const unbindButtons = await screen.findAllByRole("button", { name: /unbind workspace/i });
    fireEvent.click(unbindButtons[0]);
    await waitFor(() =>
      expect(mockUnbindWorkspace).toHaveBeenCalledWith("proj-zenith", 2, {
        path: "/repo/zenith-worktree",
      }),
    );
  });

  it("keeps unsaved name edits when a bind/unbind bumps the revision", async () => {
    mockBindWorkspace.mockResolvedValue(
      makeProject("proj-zenith", "zenith", {
        revision: 2,
        workspace_count: 3,
        workspace_bindings: [
          { path: "/repo/zenith-worktree", label: null, git_common_dir: null },
          { path: "/repo/nova", label: null, git_common_dir: null },
        ],
      }),
    );
    renderModal();

    // Type an unsaved rename…
    fireEvent.change(await screen.findByTestId("project-detail-name"), {
      target: { value: "zenith-renamed-draft" },
    });
    // …then bind a workspace, which returns a new manifest (revision bump).
    await screen.findByTestId("project-bind-input");
    fireEvent.change(getWorkspaceInput("project-bind-input"), {
      target: { value: "/repo/nova" },
    });
    fireEvent.click(screen.getByTestId("project-bind-submit"));

    await waitFor(() => expect(mockBindWorkspace).toHaveBeenCalled());
    // The draft must survive — a revision bump is not a selection change.
    expect(screen.getByTestId("project-detail-name")).toHaveValue("zenith-renamed-draft");
  });

  it("hides edit/archive controls and exposes restore for archived projects", async () => {
    renderModal();

    fireEvent.click(await screen.findByTestId("project-archived-toggle"));
    fireEvent.click(await screen.findByTestId("project-list-item-proj-old"));

    await waitFor(() => expect(screen.getByTestId("project-detail-name")).toHaveValue("old-stuff"));
    expect(screen.queryByTestId("project-detail-save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-archive")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-bind-submit")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-unarchive")).toHaveTextContent("Restore");
    expect(screen.getByText(/without changing its sessions/)).toBeInTheDocument();
  });
});
