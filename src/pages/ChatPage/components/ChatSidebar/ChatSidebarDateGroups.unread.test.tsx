import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App as AntdApp, theme } from "antd";

import { ChatSidebarDateGroups } from "./ChatSidebarDateGroups";
import { countUnreadSessions } from "./chatSidebarUnread";
import type { SidebarChatItem } from "@shared/types/sidebarChat";

const { useToken } = theme;
const noop = () => undefined;

const chat = (id: string, overrides: Partial<SidebarChatItem> = {}): SidebarChatItem => ({
  id,
  title: id,
  kind: "root",
  pinned: false,
  parentSessionId: null,
  rootSessionId: null,
  createdByScheduleId: null,
  updatedAt: "2026-08-14T01:00:00.000Z",
  lastActivityAt: "2026-08-14T01:00:00.000Z",
  messageCount: 1,
  unread: false,
  lastRunStatus: null,
  lastRunError: null,
  createdAt: Date.parse("2026-08-14T01:00:00.000Z"),
  config: { systemPromptId: "general", workspacePath: null, projectId: "project-1" },
  ...overrides,
});

const Harness = (
  props: Partial<React.ComponentProps<typeof ChatSidebarDateGroups>>,
): React.ReactElement => {
  const { token } = useToken();
  return (
    <ChatSidebarDateGroups
      groupedChatsByDate={{}}
      childrenByRoot={{}}
      expandedRootIds={new Set()}
      onToggleRootExpanded={noop}
      sortedDateKeys={[]}
      expandedKeys={[]}
      onCollapseChange={noop}
      currentSessionId={null}
      onSelectChat={noop}
      onDeleteChat={noop}
      onDeleteByDate={noop}
      onPinChat={noop}
      onUnpinChat={noop}
      onEditTitle={noop}
      onGenerateTitle={noop}
      onRunProjectDream={noop}
      onScheduleThis={noop}
      titleGenerationState={{}}
      projectDreamState={{}}
      token={token}
      hasActiveFilters={false}
      onClearFilters={noop}
      runStateBySessionId={{}}
      rootHasRunningChildBySessionId={{}}
      scrollTarget={null}
      {...props}
    />
  );
};

const renderHarness = (props: Partial<React.ComponentProps<typeof ChatSidebarDateGroups>>) =>
  render(
    <AntdApp>
      <Harness {...props} />
    </AntdApp>,
  );

describe("ChatSidebarDateGroups unread aggregation (#129)", () => {
  it("counts unread roots and children", () => {
    expect(
      countUnreadSessions([chat("root", { unread: true })], {
        root: [chat("child", { kind: "child", unread: true })],
      }),
    ).toBe(2);
  });

  it("shows Project unread aggregation even while collapsed", () => {
    const root = chat("root", { unread: true });
    const child = chat("child", { kind: "child", unread: true });
    renderHarness({
      groupedChatsByDate: { "project-1": [root] },
      childrenByRoot: { root: [child] },
      sortedDateKeys: ["project-1"],
      expandedKeys: [],
      groupingMode: "project",
      groupLabels: { "project-1": "Zenith" },
    });

    const groupToggle = screen.getByRole("button", { name: "Zenith (1)" });
    expect(groupToggle).toHaveAttribute("aria-expanded", "false");
    expect(groupToggle).toHaveAccessibleDescription("Zenith (2), 2 unread sessions");
    expect(screen.getByTestId("chat-group-unread")).toBeVisible();
    expect(screen.queryByTestId("chat-item-unread")).toBeNull();
  });

  it("shows nested date aggregation for a hidden child", () => {
    const root = chat("root");
    const child = chat("child", { kind: "child", unread: true });
    renderHarness({
      groupedChatsByDate: { "project-1": [root] },
      childrenByRoot: { root: [child] },
      sortedDateKeys: ["project-1"],
      expandedKeys: ["project-1"],
      groupingMode: "project",
      groupLabels: { "project-1": "Zenith" },
    });

    const unreadGroupToggles = screen
      .getAllByRole("button")
      .filter((button) =>
        button.getAttribute("aria-describedby")?.startsWith("lotus-chat-group-unread-"),
      );
    expect(unreadGroupToggles).toHaveLength(2);
    for (const toggle of unreadGroupToggles) {
      expect(toggle).toHaveAccessibleDescription(/1 unread session$/);
    }
  });

  it("uses full-group unread/count overrides while rows are filtered", () => {
    renderHarness({
      groupedChatsByDate: { "project-1": [chat("matching-root")] },
      sortedDateKeys: ["project-1"],
      expandedKeys: [],
      groupingMode: "project",
      groupLabels: { "project-1": "Zenith" },
      hasActiveFilters: true,
      unreadCountByGroup: { "project-1": 3 },
      sessionCountByGroup: { "project-1": 8 },
    });

    const groupToggle = screen.getByRole("button", { name: "Zenith (1)" });
    expect(groupToggle).toBeVisible();
    expect(groupToggle).toHaveAccessibleDescription("Zenith (8), 3 unread sessions");
  });
});
