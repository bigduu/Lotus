import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

const capturedCollapseItems: any[] = [];
const { mockEnsureProject, mockLoadProjectResources, mockStoreState } = vi.hoisted(() => ({
  mockEnsureProject: vi.fn(),
  mockLoadProjectResources: vi.fn(),
  mockStoreState: {
    systemPrompts: [],
    projects: {
      "project-1": {
        id: "project-1",
        name: "Zenith",
        project_path: "/repo/zenith",
        project_path_status: "configured",
        resource_revision: 7,
      },
    },
    projectResources: {
      "project-1": {
        project_id: "project-1",
        resource_revision: 7,
        resources: [],
      },
    },
    ensureProject: vi.fn(),
    loadProjectResources: vi.fn(),
  } as any,
}));
mockStoreState.ensureProject = mockEnsureProject;
mockStoreState.loadProjectResources = mockLoadProjectResources;

vi.mock("antd", () => ({
  Button: vi.fn(({ children, ...props }: any) => (
    <button data-testid="button" {...props}>
      {children}
    </button>
  )),
  Card: vi.fn(({ children, ...props }: any) => (
    <div data-testid="card" {...props}>
      {children}
    </div>
  )),
  Collapse: vi.fn(({ items, defaultActiveKey, ...props }: any) => {
    capturedCollapseItems.splice(0, capturedCollapseItems.length, ...(items ?? []));
    return (
      <div
        data-testid="collapse"
        data-default-active-key={String(defaultActiveKey ?? "")}
        {...props}
      >
        {items?.map((item: any) => (
          <div key={item.key} data-testid={`collapse-item-${item.key}`}>
            <div>{item.label}</div>
            <div>{item.children}</div>
          </div>
        ))}
      </div>
    );
  }),
  Divider: vi.fn((props: any) => <hr data-testid="divider" {...props} />),
  Flex: vi.fn(({ children, vertical: _vertical, ...props }: any) => (
    <div data-testid={props["data-testid"] ?? "flex"} {...props}>
      {children}
    </div>
  )),
  Space: vi.fn(({ children }: any) => <div data-testid="space">{children}</div>),
  Typography: {
    Text: vi.fn(({ children, code: _code, strong: _strong, type: _type, ...props }: any) => (
      <span data-testid="text" {...props}>
        {children}
      </span>
    )),
  },
  theme: {
    useToken: () => ({
      token: {
        colorBgContainer: "#fff",
        colorPrimary: "#1677ff",
        borderRadiusLG: 8,
        marginSM: 8,
        marginXS: 4,
        paddingXS: 4,
        fontSizeSM: 12,
      },
    }),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: (selector: (state: any) => any) => selector(mockStoreState),
}));

vi.mock("../SystemPromptMarkdown", () => ({
  SystemPromptMarkdown: ({ content }: { content: string }) => (
    <div data-testid="system-prompt-markdown">{content}</div>
  ),
}));

vi.mock("../useSystemPromptContent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useSystemPromptContent")>();
  return {
    ...actual,
    useSystemPromptContent: () => ({
      basePrompt: "Base prompt",
      loadingEnhanced: false,
      loadEnhancedPrompt: vi.fn(),
      promptSnapshot: {
        session_id: "session-1",
        project_context: "Bamboo Project context\nProject path: /repo/from-prompt",
        workspace_context: "Bamboo Workspace context\nWorkspace path: /repo/from-prompt",
      },
      promptToDisplay: "Effective prompt",
      showEnhanced: true,
      setShowEnhanced: vi.fn(),
      snapshotSections: [
        { key: "base", content: "Base prompt" },
        {
          key: "project",
          content: "Bamboo Project context\nProject path: /repo/from-prompt",
        },
        {
          key: "workspace",
          content: "Bamboo Workspace context\nWorkspace path: /repo/from-prompt",
        },
        { key: "instruction", content: "Instruction layer" },
        { key: "sessionMemory", content: "Session memory note" },
        { key: "externalMemory", content: "Memory layers block" },
        { key: "effective", content: "Effective prompt" },
      ],
    }),
  };
});

vi.mock("@shared/utils/clipboard", () => ({
  copyText: vi.fn(),
}));

import SystemMessageCard from "../index";

describe("SystemMessageCard", () => {
  const currentChat = {
    id: "session-1",
    title: "Session",
    createdAt: Date.now(),
    messages: [],
    config: {
      systemPromptId: "preset-1",
      baseSystemPrompt: "",
      lastUsedEnhancedPrompt: null,
      projectId: "project-1",
    },
    currentInteraction: null,
  };
  const message = {
    id: "system-message-1",
    createdAt: "2026-04-03T00:00:00Z",
    role: "system" as const,
    content: "Persisted system prompt",
  };

  beforeEach(() => {
    mockEnsureProject.mockReset();
    mockEnsureProject.mockResolvedValue(undefined);
    mockLoadProjectResources.mockReset();
    mockLoadProjectResources.mockResolvedValue(mockStoreState.projectResources["project-1"]);
    mockStoreState.projects["project-1"] = {
      ...mockStoreState.projects["project-1"],
      project_path: "/repo/zenith",
      project_path_status: "configured",
      resource_revision: 7,
    };
    mockStoreState.projectResources["project-1"] = {
      project_id: "project-1",
      resource_revision: 7,
      resources: [],
    };
  });

  it("renders prompt snapshot sections when backend snapshot is available", () => {
    render(<SystemMessageCard currentChat={currentChat} message={message} />);

    expect(screen.getByText("chat.prompt.systemCard.title")).toBeInTheDocument();
    expect(screen.getByText("chat.prompt.systemCard.snapshotTitle")).toBeInTheDocument();
    expect(capturedCollapseItems.map((item) => item.key)).toEqual([
      "base",
      "project",
      "workspace",
      "instruction",
      "sessionMemory",
      "externalMemory",
      "effective",
    ]);
    expect(capturedCollapseItems.map((item) => item.label)).toEqual([
      "chat.prompt.systemCard.sections.base",
      "chat.prompt.systemCard.sections.project",
      "chat.prompt.systemCard.sections.workspace",
      "chat.prompt.systemCard.sections.instruction",
      "chat.prompt.systemCard.sections.sessionMemory",
      "chat.prompt.systemCard.sections.externalMemory",
      "chat.prompt.systemCard.sections.effective",
    ]);
    expect(screen.getByText("Instruction layer")).toBeInTheDocument();
    expect(screen.getByText("Session memory note")).toBeInTheDocument();
    expect(screen.getByText("Memory layers block")).toBeInTheDocument();
    expect(screen.getByText("chat.prompt.systemCard.bambooSource")).toBeInTheDocument();
    expect(screen.getByText("chat.prompt.systemCard.contextModelHint")).toBeInTheDocument();
    const details = screen.getByTestId("prompt-context-details");
    expect(within(details).getByTestId("prompt-project-path")).toHaveTextContent("/repo/zenith");
    expect(details).not.toHaveTextContent("/repo/from-prompt");
    expect(within(details).getByTestId("prompt-session-workspace")).toHaveTextContent(
      "chat.prompt.systemCard.notSet",
    );
    expect(within(details).getByTestId("prompt-effective-workspace")).toHaveTextContent(
      "/repo/zenith",
    );
    expect(within(details).getByTestId("prompt-resource-revision")).toHaveTextContent("7");
    expect(within(details).getByTestId("prompt-workspace-fallback")).toHaveTextContent(
      "chat.prompt.systemCard.projectPathFallback",
    );
  });

  it("keeps an explicit session workspace distinct from the Project path", () => {
    render(
      <SystemMessageCard
        currentChat={{
          ...currentChat,
          config: { ...currentChat.config, workspacePath: "/repo/zenith-worktree" },
        }}
        message={message}
      />,
    );

    const details = screen.getByTestId("prompt-context-details");
    expect(within(details).getByTestId("prompt-project-path")).toHaveTextContent("/repo/zenith");
    expect(within(details).getByTestId("prompt-session-workspace")).toHaveTextContent(
      "/repo/zenith-worktree",
    );
    expect(within(details).getByTestId("prompt-effective-workspace")).toHaveTextContent(
      "/repo/zenith-worktree",
    );
    expect(within(details).queryByTestId("prompt-workspace-fallback")).not.toBeInTheDocument();
  });

  it("keeps Bamboo context sections visible for legacy sessions with missing metadata", () => {
    delete mockStoreState.projects["project-1"];
    delete mockStoreState.projectResources["project-1"];

    render(
      <SystemMessageCard
        currentChat={{
          ...currentChat,
          config: { ...currentChat.config, projectId: undefined },
        }}
        message={message}
      />,
    );

    expect(screen.getByTestId("collapse-item-project")).toHaveTextContent("Bamboo Project context");
    expect(screen.getByTestId("collapse-item-workspace")).toHaveTextContent(
      "Bamboo Workspace context",
    );
    expect(screen.getByTestId("prompt-project-path")).toHaveTextContent(
      "chat.prompt.systemCard.unavailable",
    );
    expect(screen.getByTestId("prompt-session-workspace")).toHaveTextContent(
      "chat.prompt.systemCard.notSet",
    );
    expect(screen.getByTestId("prompt-effective-workspace")).toHaveTextContent(
      "chat.prompt.systemCard.unavailable",
    );
    expect(screen.getByTestId("prompt-resource-revision")).toHaveTextContent(
      "chat.prompt.systemCard.unavailable",
    );
  });

  it("reloads the resource summary when a Project event advances its revision", async () => {
    mockLoadProjectResources.mockImplementation(async () => {
      const refreshed = {
        project_id: "project-1",
        resource_revision: 8,
        resources: [],
      };
      mockStoreState.projectResources["project-1"] = refreshed;
      return refreshed;
    });
    const { rerender } = render(<SystemMessageCard currentChat={currentChat} message={message} />);
    expect(mockLoadProjectResources).not.toHaveBeenCalled();

    mockStoreState.projects["project-1"] = {
      ...mockStoreState.projects["project-1"],
      resource_revision: 8,
    };
    rerender(<SystemMessageCard currentChat={{ ...currentChat }} message={message} />);

    await waitFor(() => {
      expect(mockLoadProjectResources).toHaveBeenCalledWith("project-1");
    });
    rerender(<SystemMessageCard currentChat={{ ...currentChat }} message={message} />);
    expect(screen.getByTestId("prompt-resource-revision")).toHaveTextContent("8");
  });
});
