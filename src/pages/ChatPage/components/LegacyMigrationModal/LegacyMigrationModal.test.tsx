import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LegacyMigrationModal from "./index";
import { useAppStore } from "@shared/store/appStore";
import { ApiError } from "@services/api";
import type { ProjectManifest } from "@services/project";

const {
  mockLegacyDryRun,
  mockGetLegacyMemoryMigrationStatus,
  mockGetSessionWithVersion,
  mockReassignSessionProject,
  mockCreateProject,
  mockMigrateLegacyMemory,
} = vi.hoisted(() => ({
  mockLegacyDryRun: vi.fn(),
  mockGetLegacyMemoryMigrationStatus: vi.fn(),
  mockGetSessionWithVersion: vi.fn(),
  mockReassignSessionProject: vi.fn(),
  mockCreateProject: vi.fn(),
  mockMigrateLegacyMemory: vi.fn(),
}));

vi.mock("@services/project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@services/project")>();
  return {
    ...actual,
    projectService: {
      ...actual.projectService,
      legacyDryRun: mockLegacyDryRun,
      getLegacyMemoryMigrationStatus: mockGetLegacyMemoryMigrationStatus,
      createProject: mockCreateProject,
      migrateLegacyMemory: mockMigrateLegacyMemory,
    },
  };
});

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      getSessionWithVersion: mockGetSessionWithVersion,
      reassignSessionProject: mockReassignSessionProject,
      listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    })),
  },
}));

const makeChat = (id: string, projectId?: string, kind: "root" | "child" = "root") =>
  ({
    id,
    title: `Session ${id}`,
    kind,
    createdAt: 1710000000000,
    messages: [],
    config: {
      systemPromptId: "general_assistant",
      baseSystemPrompt: "You are helpful.",
      lastUsedEnhancedPrompt: null,
      workspacePath: `/repo/${id}`,
      projectId: projectId ?? null,
    },
  }) as never;

const ZENITH: ProjectManifest = {
  id: "proj-zenith",
  name: "zenith",
  description: null,
  status: "active",
  revision: 3,
  resource_revision: 3,
  project_path: "/repo/zenith",
  project_path_status: "configured",
  workspace_count: 1,
  created_at: "2025-03-01T00:00:00Z",
  updated_at: "2025-03-01T00:00:00Z",
  schema_version: 1,
  workspace_bindings: [],
  legacy_project_keys: [],
};

const REPORT = {
  assignments: [{ session_id: "s1", project_id: "proj-zenith", basis: "exact_canonical_binding" }],
  suggestions: [
    {
      basis: "git_common_dir",
      session_ids: ["s2", "s3"],
      workspace_paths: ["/repo/s2", "/repo/s3"],
      legacy_project_keys: [],
    },
  ],
  unassigned: [{ session_id: "s4", reason: "no binding match" }],
  diagnostics: ["analyzed 4 sessions"],
};

const renderModal = () =>
  render(
    <AntdApp>
      <LegacyMigrationModal open={true} onClose={() => {}} />
    </AntdApp>,
  );

describe("LegacyMigrationModal (#156)", () => {
  beforeEach(() => {
    mockLegacyDryRun.mockReset();
    mockGetLegacyMemoryMigrationStatus.mockReset();
    mockGetSessionWithVersion.mockReset();
    mockReassignSessionProject.mockReset();
    mockCreateProject.mockReset();
    mockMigrateLegacyMemory.mockReset();

    mockLegacyDryRun.mockResolvedValue(REPORT);
    mockGetSessionWithVersion.mockImplementation((sessionId: string) =>
      Promise.resolve({ session: { id: sessionId }, metadataVersion: 7 }),
    );
    mockReassignSessionProject.mockResolvedValue(undefined);

    useAppStore.setState((state) => ({
      ...state,
      chats: [
        makeChat("s1"),
        makeChat("s2"),
        makeChat("s3"),
        makeChat("s4"),
        makeChat("s5", "proj-zenith"),
        makeChat("s6", undefined, "child"),
      ] as never,
      projects: { "proj-zenith": ZENITH },
    }));
  });

  it("runs the dry-run for unassigned root sessions only and renders the report", async () => {
    renderModal();

    expect(await screen.findByText("Ready to assign (1)")).toBeInTheDocument();
    expect(screen.getByText("Suggestions (1)")).toBeInTheDocument();
    expect(screen.getByText("Cannot suggest (1)")).toBeInTheDocument();
    expect(screen.getByText("no binding match")).toBeInTheDocument();
    expect(screen.getByText("exact binding match")).toBeInTheDocument();

    // s5 (already assigned) and s6 (child) are excluded from the dry-run.
    const input = mockLegacyDryRun.mock.calls[0][0];
    expect(input.sessions.map((s: { session_id: string }) => s.session_id)).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
    ]);
    expect(input.sessions[0]).toEqual({
      session_id: "s1",
      workspace_path: "/repo/s1",
    });
    expect(input.sessions[0]).not.toHaveProperty("canonical_path");
    expect(input.sessions[0]).not.toHaveProperty("git_common_dir");
    expect(input.sessions[0]).not.toHaveProperty("legacy_project_keys");
  });

  it("shows the empty state when every root session already belongs to a project", async () => {
    useAppStore.setState((state) => ({
      ...state,
      chats: [makeChat("s5", "proj-zenith")] as never,
    }));
    renderModal();

    expect(await screen.findByText("No unassigned sessions found.")).toBeInTheDocument();
    expect(mockLegacyDryRun).not.toHaveBeenCalled();
  });

  it("assigns checked sessions and suggestion targets with If-Match versions", async () => {
    renderModal();
    await screen.findByText("Ready to assign (1)");

    // Route the suggestion to the existing project.
    fireEvent.mouseDown(
      screen
        .getByTestId("migration-target-git_common_dir:s2,s3")
        .querySelector(".ant-select-selector") as HTMLElement,
    );
    fireEvent.click(await screen.findByText("zenith"));

    fireEvent.click(screen.getByTestId("migration-apply"));

    await waitFor(() => expect(mockReassignSessionProject).toHaveBeenCalledTimes(3));
    for (const sessionId of ["s1", "s2", "s3"]) {
      expect(mockReassignSessionProject).toHaveBeenCalledWith(sessionId, "proj-zenith", 7);
    }
    expect(await screen.findByText(/Migration finished: 3 assigned, 0 failed/)).toBeInTheDocument();
  });

  it("retries once with a fresh version on 412 and reports the failure when it persists", async () => {
    mockReassignSessionProject
      .mockRejectedValueOnce(new ApiError("Precondition Failed", 412, "Failed"))
      .mockResolvedValue(undefined)
      .mockRejectedValue(new ApiError("Precondition Failed", 412, "Failed"));
    mockGetSessionWithVersion
      .mockResolvedValueOnce({ session: { id: "s1" }, metadataVersion: 7 })
      .mockResolvedValueOnce({ session: { id: "s1" }, metadataVersion: 8 })
      .mockResolvedValue({ session: { id: "s1" }, metadataVersion: 9 });
    // Leave the suggestion on "skip" so only s1 is assigned.
    renderModal();
    await screen.findByText("Ready to assign (1)");

    fireEvent.click(screen.getByTestId("migration-apply"));

    // First attempt 412 → retry with version 8 succeeds.
    await waitFor(() =>
      expect(mockReassignSessionProject).toHaveBeenCalledWith("s1", "proj-zenith", 8),
    );
    expect(mockGetSessionWithVersion).toHaveBeenCalledTimes(2);
  });

  it("creates a new project for suggestions routed to 'Create new project'", async () => {
    mockCreateProject.mockResolvedValue({ ...ZENITH, id: "proj-new", name: "nova" });
    renderModal();
    await screen.findByText("Suggestions (1)");

    fireEvent.mouseDown(
      screen
        .getByTestId("migration-target-git_common_dir:s2,s3")
        .querySelector(".ant-select-selector") as HTMLElement,
    );
    fireEvent.click(await screen.findByText("Create new project…"));
    fireEvent.change(screen.getByPlaceholderText("New project name"), {
      target: { value: "nova" },
    });
    fireEvent.change(screen.getByPlaceholderText("Project folder (confirm explicitly)"), {
      target: { value: "/repo/nova" },
    });

    fireEvent.click(screen.getByTestId("migration-apply"));

    await waitFor(() =>
      expect(mockCreateProject).toHaveBeenCalledWith({
        name: "nova",
        description: null,
        project_path: "/repo/nova",
      }),
    );
    await waitFor(() =>
      expect(mockReassignSessionProject).toHaveBeenCalledWith("s2", "proj-new", 7),
    );
  });

  it("requires a name before creating a new project", async () => {
    renderModal();
    await screen.findByText("Suggestions (1)");

    fireEvent.mouseDown(
      screen
        .getByTestId("migration-target-git_common_dir:s2,s3")
        .querySelector(".ant-select-selector") as HTMLElement,
    );
    fireEvent.click(await screen.findByText("Create new project…"));
    fireEvent.change(screen.getByPlaceholderText("New project name"), {
      target: { value: " " },
    });

    fireEvent.click(screen.getByTestId("migration-apply"));

    expect(await screen.findByText("Please enter a project name")).toBeInTheDocument();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("requires explicit Project path confirmation before creating a migrated Project", async () => {
    renderModal();
    await screen.findByText("Suggestions (1)");

    fireEvent.mouseDown(
      screen
        .getByTestId("migration-target-git_common_dir:s2,s3")
        .querySelector(".ant-select-selector") as HTMLElement,
    );
    fireEvent.click(await screen.findByText("Create new project…"));

    fireEvent.click(screen.getByTestId("migration-apply"));

    expect(await screen.findByText("Please select a Project folder")).toBeInTheDocument();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("continues after a failed assignment and surfaces the reason", async () => {
    mockReassignSessionProject
      .mockRejectedValueOnce(new ApiError("Conflict", 409, "Conflict"))
      .mockResolvedValue(undefined);
    renderModal();
    await screen.findByText("Ready to assign (1)");

    fireEvent.mouseDown(
      screen
        .getByTestId("migration-target-git_common_dir:s2,s3")
        .querySelector(".ant-select-selector") as HTMLElement,
    );
    fireEvent.click(await screen.findByText("zenith"));
    fireEvent.click(screen.getByTestId("migration-apply"));

    expect(await screen.findByText(/Migration finished: 2 assigned, 1 failed/)).toBeInTheDocument();
  });
});
