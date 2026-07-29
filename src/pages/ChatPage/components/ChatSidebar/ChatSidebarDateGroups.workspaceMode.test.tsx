/**
 * Coverage for ChatSidebarDateGroups' workspace-grouping presentation
 * (Lotus #95): when `groupingMode="workspace"`, group headers render the
 * friendly workspace label (falling back to the raw path, or the "No
 * workspace" translation for the sentinel key) instead of the date-bucket
 * translation, and skip the date-mode-only "Today" highlight color.
 *
 * The row-rendering internals (virtualization, status dots, scroll-to-
 * active, Schedule-this, keyboard a11y) are NOT re-tested here — they are
 * the exact same code path already covered by
 * ChatSidebarDateGroups.virtualization.test.tsx and
 * ChatSidebarDateGroups.scrollAndStatus.test.tsx, unaffected by this prop.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp, theme } from "antd";

import { ChatSidebarDateGroups } from "./ChatSidebarDateGroups";
import { NO_WORKSPACE_GROUP_KEY } from "../../utils/chatUtils";
import { NO_PROJECT_GROUP_KEY } from "@services/project";
import type { SidebarChatItem } from "@shared/types/sidebarChat";

const { useToken } = theme;
const noop = () => {};

const makeChat = (index: number, overrides: Partial<SidebarChatItem> = {}): SidebarChatItem => ({
  id: `session-${index}`,
  title: `Session ${index}`,
  kind: "root",
  pinned: false,
  parentSessionId: null,
  rootSessionId: null,
  createdByScheduleId: null,
  updatedAt: null,
  lastRunStatus: null,
  lastRunError: null,
  createdAt: index,
  config: { systemPromptId: "general_assistant", workspacePath: null },
  ...overrides,
});

type HarnessOverrides = Partial<React.ComponentProps<typeof ChatSidebarDateGroups>>;

const Harness: React.FC<HarnessOverrides> = (overrides) => {
  const { token } = useToken();

  const defaults: React.ComponentProps<typeof ChatSidebarDateGroups> = {
    groupedChatsByDate: {},
    childrenByRoot: {},
    expandedRootIds: new Set(),
    onToggleRootExpanded: noop,
    sortedDateKeys: [],
    expandedKeys: [],
    onCollapseChange: noop,
    currentSessionId: null,
    onSelectChat: noop,
    onDeleteChat: noop,
    onDeleteByDate: noop,
    onPinChat: noop,
    onUnpinChat: noop,
    onEditTitle: noop,
    onGenerateTitle: noop,
    onRunProjectDream: noop,
    onScheduleThis: noop,
    titleGenerationState: {},
    projectDreamState: {},
    token,
    hasActiveFilters: false,
    onClearFilters: noop,
    runStateBySessionId: {},
    rootHasRunningChildBySessionId: {},
    scrollTarget: null,
  };

  return <ChatSidebarDateGroups {...defaults} {...overrides} />;
};

function renderHarness(overrides: HarnessOverrides) {
  return render(
    <AntdApp>
      <Harness {...overrides} />
    </AntdApp>,
  );
}

describe("ChatSidebarDateGroups workspace mode (#95)", () => {
  beforeEach(() => localStorage.clear());
  it("renders the fixed workspace-first, date-second hierarchy", () => {
    renderHarness({
      groupedChatsByDate: {
        "/Users/alice/zenith": [
          makeChat(1, { pinned: true, createdAt: new Date(2026, 6, 18, 12).getTime() }),
          makeChat(2, {
            createdByScheduleId: "schedule-1",
            createdAt: new Date(2026, 6, 18, 11).getTime(),
          }),
        ],
      },
      sortedDateKeys: ["/Users/alice/zenith"],
      expandedKeys: ["/Users/alice/zenith"],
      groupingMode: "workspace",
      groupLabels: { "/Users/alice/zenith": "zenith" },
    });

    expect(screen.getByText("zenith (2)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Jul 18, 2026 \(2\)/ })).toBeInTheDocument();
    expect(screen.getByLabelText("pushpin")).toBeInTheDocument();
    expect(screen.queryByText("Pinned (1)")).toBeNull();
    expect(screen.queryByText("Scheduled (1)")).toBeNull();
  });

  it("persists stable workspace/date collapse keys but auto-expands a filtered match", () => {
    const workspace = "/Users/alice/zenith";
    const chat = makeChat(1, { pinned: true });
    const props = {
      groupedChatsByDate: { [workspace]: [chat] },
      sortedDateKeys: [workspace],
      expandedKeys: [workspace],
      groupingMode: "workspace" as const,
      groupLabels: { [workspace]: "zenith" },
    };
    const { rerender } = renderHarness(props);
    fireEvent.click(screen.getByRole("button", { name: /Jan 1, 1970 \(1\)/ }));
    expect(screen.queryByText("Session 1")).toBeNull();
    expect(localStorage.getItem("lotus.sidebar.workspace-date.collapsed.v1")).toContain(
      encodeURIComponent(workspace),
    );

    rerender(
      <AntdApp>
        <Harness {...props} hasActiveFilters />
      </AntdApp>,
    );
    expect(screen.getByText("Session 1")).toBeInTheDocument();
  });

  it("renders workspace → date → root → child and expands a selected child", () => {
    const root = makeChat(1, {
      createdAt: new Date(2026, 6, 18, 12).getTime(),
      config: { systemPromptId: "general_assistant", workspacePath: "/w/zenith" },
    });
    const child = makeChat(2, {
      kind: "child",
      parentSessionId: root.id,
      rootSessionId: root.id,
      title: "Selected child",
    });
    renderHarness({
      groupedChatsByDate: { "/w/zenith": [root] },
      sortedDateKeys: ["/w/zenith"],
      expandedKeys: ["/w/zenith"],
      groupingMode: "workspace",
      groupLabels: { "/w/zenith": "zenith" },
      childrenByRoot: { [root.id]: [child] },
      expandedRootIds: new Set([root.id]),
      currentSessionId: child.id,
    });

    expect(screen.getByText("zenith (1)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Jul 18, 2026 \(1\)/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("Session 1")).toBeInTheDocument();
    expect(screen.getByText("Selected child")).toBeInTheDocument();
  });
  it("defaults to date-mode label rendering when groupingMode is omitted", () => {
    renderHarness({
      groupedChatsByDate: { Today: [makeChat(0)] },
      sortedDateKeys: ["Today"],
      expandedKeys: ["Today"],
    });

    expect(screen.getByText("Today (1)")).toBeInTheDocument();
  });

  it("renders the friendly workspace label (with count) instead of a date translation", () => {
    renderHarness({
      groupedChatsByDate: { "/Users/alice/zenith": [makeChat(0), makeChat(1)] },
      sortedDateKeys: ["/Users/alice/zenith"],
      expandedKeys: ["/Users/alice/zenith"],
      groupingMode: "workspace",
      groupLabels: { "/Users/alice/zenith": "zenith" },
    });

    expect(screen.getByText("zenith (2)")).toBeInTheDocument();
    // The raw path was NOT rendered as the visible label.
    expect(screen.queryByText("/Users/alice/zenith (2)")).toBeNull();
  });

  it("falls back to the raw path when no label was resolved for it", () => {
    renderHarness({
      groupedChatsByDate: { "/Users/alice/zenith": [makeChat(0)] },
      sortedDateKeys: ["/Users/alice/zenith"],
      expandedKeys: ["/Users/alice/zenith"],
      groupingMode: "workspace",
      groupLabels: {},
    });

    expect(screen.getByText("/Users/alice/zenith (1)")).toBeInTheDocument();
  });

  it("renders the translated 'No workspace' label for the sentinel bucket", () => {
    renderHarness({
      groupedChatsByDate: { [NO_WORKSPACE_GROUP_KEY]: [makeChat(0)] },
      sortedDateKeys: [NO_WORKSPACE_GROUP_KEY],
      expandedKeys: [NO_WORKSPACE_GROUP_KEY],
      groupingMode: "workspace",
      groupLabels: {},
    });

    expect(screen.getByText("No workspace (1)")).toBeInTheDocument();
  });

  it("does not apply the date-mode 'Today' highlight color in workspace mode", () => {
    renderHarness({
      groupedChatsByDate: { Today: [makeChat(0)] },
      sortedDateKeys: ["Today"],
      expandedKeys: ["Today"],
      groupingMode: "workspace",
      groupLabels: { Today: "Today" },
    });

    const label = screen.getByText("Today (1)");
    expect(label).not.toHaveStyle({ color: "var(--lotus-primary)" });
  });

  it("shows an accessible Project action and maps Project and Unassigned keys without collapsing", () => {
    const onCreateChatInProject = vi.fn();
    const onCollapseChange = vi.fn();
    const projectId = "proj-zenith";
    renderHarness({
      groupedChatsByDate: {
        [projectId]: [
          makeChat(1, {
            config: {
              systemPromptId: "general_assistant",
              workspacePath: "/repo/zenith",
              projectId,
            },
          }),
        ],
        [NO_PROJECT_GROUP_KEY]: [makeChat(2)],
      },
      sortedDateKeys: [projectId, NO_PROJECT_GROUP_KEY],
      expandedKeys: [projectId, NO_PROJECT_GROUP_KEY],
      groupingMode: "project",
      groupLabels: { [projectId]: "Zenith" },
      onCollapseChange,
      onCreateChatInProject,
    });

    const createButtons = screen.getAllByRole("button", {
      name: "Create session in this project",
    });
    expect(createButtons).toHaveLength(2);
    expect(screen.queryByText("chat.sidebar.actions.createInProject")).not.toBeInTheDocument();

    const projectHeader = screen.getByRole("button", { name: "Zenith (1)" });
    const projectActions = projectHeader.querySelectorAll("button");
    expect(projectActions[0]).toBe(createButtons[0]);
    expect(projectActions[1]).toHaveClass("chat-sidebar-date-group-delete");

    createButtons[0].focus();
    expect(createButtons[0]).toHaveFocus();
    fireEvent.mouseLeave(projectHeader);
    expect(createButtons[0]).toHaveFocus();
    fireEvent.click(createButtons[0]);
    fireEvent.click(createButtons[1]);

    expect(onCreateChatInProject).toHaveBeenNthCalledWith(1, projectId);
    expect(onCreateChatInProject).toHaveBeenNthCalledWith(2, null);
    expect(onCollapseChange).not.toHaveBeenCalled();
  });

  it("does not render the Project create action in workspace mode", () => {
    renderHarness({
      groupedChatsByDate: { "/repo/zenith": [makeChat(1)] },
      sortedDateKeys: ["/repo/zenith"],
      expandedKeys: ["/repo/zenith"],
      groupingMode: "workspace",
      groupLabels: { "/repo/zenith": "Zenith" },
      onCreateChatInProject: vi.fn(),
    });

    expect(
      screen.queryByRole("button", { name: "Create session in this project" }),
    ).not.toBeInTheDocument();
  });
});
