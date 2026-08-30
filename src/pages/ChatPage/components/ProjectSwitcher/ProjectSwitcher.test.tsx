import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSwitcher } from "./index";
import { useAppStore } from "@shared/store/appStore";
import type { ProjectManifest } from "@services/project";
import type { ChatItem } from "@shared/types/chat";

vi.mock("../ProjectManagerModal", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>ProjectManagerModalStub</div> : null),
}));

vi.mock("../LegacyMigrationModal", () => ({
  default: () => null,
}));

const makeProject = (id: string, name: string, status: "active" | "archived" = "active") =>
  ({
    id,
    name,
    description: null,
    status,
    revision: 1,
    resource_revision: 1,
    project_path: `/repo/${id}`,
    project_path_status: "configured",
    workspace_count: 1,
    created_at: "2025-03-01T00:00:00Z",
    updated_at: "2025-03-01T00:00:00Z",
    schema_version: 1,
    workspace_bindings: [],
    detail_loaded: true,
  }) as ProjectManifest;

const openSelect = async () => {
  const selector = screen
    .getByTestId("project-switcher")
    .querySelector(".ant-select-selector") as HTMLElement;
  fireEvent.mouseDown(selector);
  await waitFor(() => expect(document.querySelector(".ant-select-dropdown")).not.toBeNull());
};

describe("ProjectSwitcher (#154)", () => {
  beforeEach(() => {
    useAppStore.setState((state) => ({
      ...state,
      projects: {
        "proj-zenith": makeProject("proj-zenith", "zenith"),
        "proj-bamboo": makeProject("proj-bamboo", "bamboo"),
        "proj-old": makeProject("proj-old", "old-stuff", "archived"),
      },
      projectsAvailable: true,
      activeProjectId: "proj-zenith",
      chats: [],
      currentSessionId: null,
    }));
  });

  it("shows the active project and excludes archived ones from the options", async () => {
    render(
      <AntdApp>
        <ProjectSwitcher />
      </AntdApp>,
    );

    expect(screen.getByTestId("project-switcher")).toHaveTextContent("zenith");

    await openSelect();
    const dropdown = document.querySelector(".ant-select-dropdown") as HTMLElement;
    expect(dropdown).toHaveTextContent("bamboo");
    expect(dropdown).not.toHaveTextContent("old-stuff");
  });

  it("switches the new-session default when no session is selected", async () => {
    render(
      <AntdApp>
        <ProjectSwitcher />
      </AntdApp>,
    );

    await openSelect();
    fireEvent.click(await screen.findByText("bamboo"));
    await waitFor(() => expect(useAppStore.getState().activeProjectId).toBe("proj-bamboo"));
  });

  it("shows and reassigns the selected session's authoritative Project", async () => {
    const assignSessionProject = vi.fn().mockResolvedValue({
      id: "session-1",
      project_id: "proj-bamboo",
      workspace_path: "/repo/proj-bamboo",
    });
    const session = {
      id: "session-1",
      title: "Session",
      kind: "root",
      createdAt: Date.now(),
      messages: [],
      config: {
        systemPromptId: "general_assistant",
        baseSystemPrompt: "You are helpful.",
        lastUsedEnhancedPrompt: null,
        projectId: "proj-zenith",
      },
    } as ChatItem;
    useAppStore.setState({
      chats: [session],
      currentSessionId: session.id,
      activeProjectId: "proj-bamboo",
      assignSessionProject,
    });

    render(
      <AntdApp>
        <ProjectSwitcher />
      </AntdApp>,
    );

    expect(screen.getByTestId("project-switcher")).toHaveTextContent("zenith");

    await openSelect();
    fireEvent.click(await screen.findByText("bamboo"));
    await waitFor(() =>
      expect(assignSessionProject).toHaveBeenCalledWith("session-1", "proj-bamboo"),
    );
  });

  it("hides entirely when the backend has no Project API", () => {
    useAppStore.setState({ projectsAvailable: false });

    render(
      <AntdApp>
        <ProjectSwitcher />
      </AntdApp>,
    );

    expect(screen.queryByTestId("project-switcher")).not.toBeInTheDocument();
  });

  it("opens the project manager from the toolbar button", async () => {
    render(
      <AntdApp>
        <ProjectSwitcher />
      </AntdApp>,
    );

    fireEvent.click(screen.getByTestId("open-project-manager"));
    expect(await screen.findByText("ProjectManagerModalStub")).toBeInTheDocument();
  });
});
