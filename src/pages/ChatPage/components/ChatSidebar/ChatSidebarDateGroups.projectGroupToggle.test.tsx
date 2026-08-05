/**
 * Coverage for the Project-group header accessibility restructure
 * (Lotus #202): the expand/collapse control is now its own explicit
 * native-button target instead of a focusable role="button" container
 * wrapping the independent Create/Delete buttons.
 *
 * What unit tests CAN prove here (jsdom):
 *  - the header row container is not interactive (no role/tabIndex);
 *  - the toggle is a native <button type="button"> with an accessible
 *    name and aria-expanded state — the HTML contract that supplies
 *    Enter/Space keyboard activation, touch, and focus-visible behavior;
 *  - Create/Delete are siblings of the toggle, never descendants, and the
 *    DOM (hence tab) focus order is toggle → create → delete;
 *  - activating Create/Delete never toggles the group, in every grouping
 *    mode (the header is shared by date/workspace/project).
 *
 * What unit tests CANNOT prove here: jsdom does not implement native
 * button keyboard activation, so real Enter/Space presses are covered by
 * the Playwright spec e2e/tests/sidebar-project-group-toggle.spec.ts.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp, theme } from "antd";

import { ChatSidebarDateGroups } from "./ChatSidebarDateGroups";
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

const PROJECT_ID = "proj-zenith";

const projectModeProps = {
  groupedChatsByDate: {
    [PROJECT_ID]: [makeChat(1)],
    [NO_PROJECT_GROUP_KEY]: [makeChat(2)],
  },
  sortedDateKeys: [PROJECT_ID, NO_PROJECT_GROUP_KEY],
  expandedKeys: [PROJECT_ID, NO_PROJECT_GROUP_KEY],
  groupingMode: "project" as const,
  groupLabels: { [PROJECT_ID]: "Zenith" },
  onCreateChatInProject: vi.fn(),
};

describe("ChatSidebarDateGroups group-header a11y structure (#202)", () => {
  it("gives expand/collapse an explicit native-button target with name and aria-expanded", () => {
    renderHarness(projectModeProps);

    for (const name of ["Zenith (1)", "Unassigned (1)"]) {
      const toggle = screen.getByRole("button", { name });
      expect(toggle.tagName).toBe("BUTTON");
      expect(toggle).toHaveAttribute("type", "button");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(toggle).toHaveClass("chat-sidebar-date-group-toggle");
    }

    // The header row container itself is no longer interactive.
    const headerRow = screen
      .getByRole("button", { name: "Zenith (1)" })
      .closest(".chat-sidebar-date-group-header");
    expect(headerRow).not.toBeNull();
    expect(headerRow).not.toHaveAttribute("role");
    expect(headerRow).not.toHaveAttribute("tabindex");
  });

  it("reflects the collapsed state on the toggle's aria-expanded", () => {
    renderHarness({ ...projectModeProps, expandedKeys: [NO_PROJECT_GROUP_KEY] });

    expect(screen.getByRole("button", { name: "Zenith (1)" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: "Unassigned (1)" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps Create and Delete as siblings of the toggle, in toggle → create → delete focus order", () => {
    renderHarness(projectModeProps);

    const toggle = screen.getByRole("button", { name: "Zenith (1)" });
    const create = screen.getAllByRole("button", {
      name: "Create session in this project",
    })[0];
    const headerRow = toggle.closest(".chat-sidebar-date-group-header") as HTMLElement;
    const deleteButton = headerRow.querySelector(".chat-sidebar-date-group-delete") as HTMLElement;

    // Siblings: the header row contains all three, but the toggle itself
    // contains no interactive descendants.
    expect(toggle.querySelectorAll("button")).toHaveLength(0);
    expect(headerRow.contains(create)).toBe(true);
    expect(headerRow.contains(deleteButton)).toBe(true);

    // Focusable elements in DOM order define the tab order (no tabindex
    // overrides anywhere in the header), so this is the keyboard focus
    // order a user experiences.
    const focusable = Array.from(headerRow.querySelectorAll("button"));
    expect(focusable).toEqual([toggle, create, deleteButton]);
    for (const el of focusable) {
      expect(el).not.toHaveAttribute("tabindex");
    }
  });

  it("activating Create or Delete never toggles the group, via mouse or keyboard events", () => {
    const onCollapseChange = vi.fn();
    const onCreateChatInProject = vi.fn();
    const onDeleteByDate = vi.fn();
    renderHarness({
      ...projectModeProps,
      onCollapseChange,
      onCreateChatInProject,
      onDeleteByDate,
    });

    const toggle = screen.getByRole("button", { name: "Zenith (1)" });
    const headerRow = toggle.closest(".chat-sidebar-date-group-header") as HTMLElement;
    const create = screen.getAllByRole("button", {
      name: "Create session in this project",
    })[0];
    const deleteButton = headerRow.querySelector(".chat-sidebar-date-group-delete") as HTMLElement;

    for (const action of [create, deleteButton]) {
      fireEvent.click(action);
      // Keyboard events on a real button bubble up — they must not reach
      // any toggle handler (regression: the old composite header toggled
      // on bubbled Enter/Space from child buttons).
      fireEvent.keyDown(action, { key: "Enter", code: "Enter" });
      fireEvent.keyUp(action, { key: "Enter", code: "Enter" });
      fireEvent.keyDown(action, { key: " ", code: "Space" });
      fireEvent.keyUp(action, { key: " ", code: "Space" });
    }

    expect(onCreateChatInProject).toHaveBeenCalledWith(PROJECT_ID);
    expect(onDeleteByDate).toHaveBeenCalledWith(PROJECT_ID);
    expect(onCollapseChange).not.toHaveBeenCalled();
  });

  it("toggles the group when the explicit toggle is clicked", () => {
    const onCollapseChange = vi.fn();
    renderHarness({ ...projectModeProps, onCollapseChange });

    fireEvent.click(screen.getByRole("button", { name: "Zenith (1)" }));
    expect(onCollapseChange).toHaveBeenCalledTimes(1);
    expect(onCollapseChange).toHaveBeenCalledWith([NO_PROJECT_GROUP_KEY]);

    fireEvent.click(screen.getByRole("button", { name: "Unassigned (1)" }));
    expect(onCollapseChange).toHaveBeenCalledTimes(2);
    expect(onCollapseChange).toHaveBeenLastCalledWith([PROJECT_ID]);
  });

  it("applies the same explicit toggle structure in date and workspace modes", () => {
    renderHarness({
      groupedChatsByDate: { Today: [makeChat(1)] },
      sortedDateKeys: ["Today"],
      expandedKeys: ["Today"],
    });

    const dateToggle = screen.getByRole("button", { name: /Today \(1\)/ });
    expect(dateToggle.tagName).toBe("BUTTON");
    expect(dateToggle).toHaveAttribute("aria-expanded", "true");
    expect(dateToggle.closest(".chat-sidebar-date-group-header")).not.toHaveAttribute("role");
  });
});
