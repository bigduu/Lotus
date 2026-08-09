import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ContextBar from ".";

const { mockStoreState } = vi.hoisted(() => ({
  mockStoreState: {
    chats: [] as Array<Record<string, unknown>>,
    systemPrompts: [] as Array<{ id: string; name: string }>,
    projects: {} as Record<string, { id: string; name: string }>,
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
  selectSessionById: (sessionId: string) => (state: typeof mockStoreState) =>
    state.chats.find((chat) => chat.id === sessionId),
}));

vi.mock("@shared/components/MachineTag", () => ({
  MachineTag: ({ placement }: { placement: { machine_id?: string } | null }) => (
    <span data-testid="machine-tag">{placement?.machine_id ?? "local"}</span>
  ),
}));

vi.mock("@pages/ChatPage/components/SessionProjectModal", () => ({
  default: ({
    open,
    sessionId,
    currentProjectId,
    currentWorkspacePath,
    isChildSession,
    onCancel,
  }: {
    open: boolean;
    sessionId: string;
    currentProjectId: string | null;
    currentWorkspacePath?: string;
    isChildSession: boolean;
    onCancel: () => void;
  }) => (
    <div
      data-testid="project-modal"
      data-open={String(open)}
      data-session-id={sessionId}
      data-project-id={currentProjectId ?? ""}
      data-workspace={currentWorkspacePath ?? ""}
      data-child={String(isChildSession)}
    >
      {open ? <button onClick={onCancel}>cancel project modal</button> : null}
    </div>
  ),
}));

beforeEach(() => {
  mockStoreState.chats = [];
  mockStoreState.systemPrompts = [];
  mockStoreState.projects = {};
});

describe("ContextBar", () => {
  it("derives workspace, file, prompt, summary, cache, project, and placement context", () => {
    mockStoreState.systemPrompts = [{ id: "prompt-1", name: "Review prompt" }];
    mockStoreState.projects = { project1: { id: "project1", name: "Project Alpha" } };
    mockStoreState.chats = [
      {
        id: "session-1",
        kind: "child",
        placement: { machine_id: "remote-mac" },
        config: {
          projectId: " project1 ",
          workspacePath: "/Users/alice/projects/repo",
          systemPromptId: "prompt-1",
          tokenUsage: {
            systemTokens: 1,
            summaryTokens: 800,
            windowTokens: 10,
            totalTokens: 811,
            budgetLimit: 1_000,
            promptCachedToolOutputs: 3,
            promptCachedToolTokensSaved: 1_500,
          },
          compressionEvents: [{ id: "compression-1" }],
        },
        messages: [
          { id: "f1", role: "user", type: "file_reference" },
          { id: "f2", role: "user", type: "file_reference" },
          { id: "text", role: "user", type: "text" },
        ],
      },
    ];

    render(<ContextBar sessionId="session-1" />);

    expect(screen.getByTestId("machine-tag")).toHaveTextContent("remote-mac");
    expect(screen.getByText("Project Alpha")).toBeInTheDocument();
    expect(screen.getByText("~/projects/repo")).toBeInTheDocument();
    expect(screen.getByText("Review prompt")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("chat.contextBar.summary")).toBeInTheDocument();
    expect(screen.getByText("1.5K")).toBeInTheDocument();

    const modal = screen.getByTestId("project-modal");
    expect(modal).toHaveAttribute("data-open", "false");
    expect(modal).toHaveAttribute("data-project-id", "project1");
    expect(modal).toHaveAttribute("data-workspace", "/Users/alice/projects/repo");
    expect(modal).toHaveAttribute("data-child", "true");

    const projectTag = screen.getByRole("button", { name: /Project Alpha/ });
    fireEvent.click(projectTag);
    expect(modal).toHaveAttribute("data-open", "true");
    fireEvent.click(screen.getByRole("button", { name: "cancel project modal" }));
    expect(modal).toHaveAttribute("data-open", "false");
    fireEvent.keyDown(projectTag, { key: "Enter" });
    expect(modal).toHaveAttribute("data-open", "true");
  });

  it("renders nothing for an unknown session", () => {
    const { container } = render(<ContextBar sessionId="missing" />);
    expect(container).toBeEmptyDOMElement();
  });
});
