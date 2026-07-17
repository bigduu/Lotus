/**
 * Coverage for ChatSidebarDateGroups' own responsibilities in issues #93
 * (scroll-to-active-session) and #94 (live per-item status indicator):
 *
 *  - #93: resolves `scrollTarget` into a `scrollIntoView` call for a plain
 *    (non-virtualized) row, or a `scrollToItemId` prop forwarded to the
 *    correct virtualized date group's `ChatSidebarVirtualRootList`
 *    instance; is a no-op when the target isn't present (filtered out);
 *    only re-fires when `scrollTarget` itself changes, not on an unrelated
 *    rerender.
 *  - #94: forwards `runStateBySessionId` / `rootHasRunningChildBySessionId`
 *    into each row's `status` prop and the root's child-count badge.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App as AntdApp, theme } from "antd";

const scrollToIndex = vi.fn();
const useVirtualizerMock = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (...args: unknown[]) => useVirtualizerMock(...args),
}));

import { ChatSidebarDateGroups } from "./ChatSidebarDateGroups";
import type { SidebarChatItem } from "@shared/types/sidebarChat";

const VIRTUALIZE_THRESHOLD = 50;
const VIRTUAL_LIST_TESTID = "chat-sidebar-virtual-root-list";

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

const DateGroupsHarness: React.FC<HarnessOverrides> = (overrides) => {
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
      <DateGroupsHarness {...overrides} />
    </AntdApp>,
  );
}

describe("ChatSidebarDateGroups scroll-to-active (#93)", () => {
  let originalScrollIntoView: unknown;

  beforeAll(() => {
    originalScrollIntoView = (HTMLElement.prototype as unknown as Record<string, unknown>)
      .scrollIntoView;
  });

  afterAll(() => {
    (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView =
      originalScrollIntoView;
  });

  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    scrollToIndex.mockClear();
    useVirtualizerMock.mockReset();
    useVirtualizerMock.mockReturnValue({
      getVirtualItems: () => [{ key: "session-0", index: 0, start: 0 }],
      getTotalSize: () => 500,
      measureElement: () => {},
      scrollToIndex,
    });
  });

  it("scrolls the matching plain-list row into view when scrollTarget names it", () => {
    const chats = [makeChat(0), makeChat(1), makeChat(2)];

    renderHarness({
      groupedChatsByDate: { Today: chats },
      sortedDateKeys: ["Today"],
      expandedKeys: ["Today"],
      scrollTarget: { dateKey: "Today", rootId: "session-1", childId: null },
    });

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("does nothing when scrollTarget is null (e.g. active session filtered out)", () => {
    const chats = [makeChat(0), makeChat(1)];

    renderHarness({
      groupedChatsByDate: { Today: chats },
      sortedDateKeys: ["Today"],
      expandedKeys: ["Today"],
      scrollTarget: null,
    });

    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("does not re-scroll on an unrelated rerender that keeps the same scrollTarget reference", () => {
    const chats = [makeChat(0), makeChat(1)];
    const scrollTarget = { dateKey: "Today", rootId: "session-1", childId: null };

    const { rerender } = render(
      <AntdApp>
        <DateGroupsHarness
          groupedChatsByDate={{ Today: chats }}
          sortedDateKeys={["Today"]}
          expandedKeys={["Today"]}
          scrollTarget={scrollTarget}
        />
      </AntdApp>,
    );
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    // Simulate an unrelated rerender (e.g. a filter-driven prop change)
    // that leaves the SAME scrollTarget object reference untouched — this
    // is exactly what useChatSidebarState guarantees: `scrollTarget` state
    // only gets a new reference from its own currentSessionId-gated effect.
    rerender(
      <AntdApp>
        <DateGroupsHarness
          groupedChatsByDate={{ Today: chats }}
          sortedDateKeys={["Today"]}
          expandedKeys={["Today"]}
          hasActiveFilters
          scrollTarget={scrollTarget}
        />
      </AntdApp>,
    );

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("scrolls again once scrollTarget changes to a different session", () => {
    const chats = [makeChat(0), makeChat(1)];

    const { rerender } = render(
      <AntdApp>
        <DateGroupsHarness
          groupedChatsByDate={{ Today: chats }}
          sortedDateKeys={["Today"]}
          expandedKeys={["Today"]}
          scrollTarget={{ dateKey: "Today", rootId: "session-0", childId: null }}
        />
      </AntdApp>,
    );
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    rerender(
      <AntdApp>
        <DateGroupsHarness
          groupedChatsByDate={{ Today: chats }}
          sortedDateKeys={["Today"]}
          expandedKeys={["Today"]}
          scrollTarget={{ dateKey: "Today", rootId: "session-1", childId: null }}
        />
      </AntdApp>,
    );

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("scrolls a child row into view once its (already-expanded) root is targeted", () => {
    const root = makeChat(0);
    const child = makeChat(100, { id: "child-1", kind: "child", parentSessionId: root.id });

    renderHarness({
      groupedChatsByDate: { Today: [root] },
      sortedDateKeys: ["Today"],
      expandedKeys: ["Today"],
      childrenByRoot: { [root.id]: [child] },
      expandedRootIds: new Set([root.id]),
      scrollTarget: { dateKey: "Today", rootId: root.id, childId: child.id },
    });

    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("uses the virtualizer's scrollToIndex for a session inside a virtualized date group", () => {
    const chats = Array.from({ length: VIRTUALIZE_THRESHOLD + 20 }, (_, i) => makeChat(i));

    renderHarness({
      groupedChatsByDate: { Today: chats },
      sortedDateKeys: ["Today"],
      expandedKeys: ["Today"],
      scrollTarget: { dateKey: "Today", rootId: "session-42", childId: null },
    });

    expect(screen.getByTestId(VIRTUAL_LIST_TESTID)).toBeInTheDocument();
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    expect(scrollToIndex).toHaveBeenCalledWith(42, { align: "auto" });
    // The plain scrollIntoView path is not used for the virtualized root row.
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("only forwards scrollToItemId to the date group that actually contains the target", () => {
    const todayChats = Array.from({ length: VIRTUALIZE_THRESHOLD + 5 }, (_, i) =>
      makeChat(i, { createdAt: 2_000_000 + i }),
    );
    const yesterdayChats = Array.from({ length: VIRTUALIZE_THRESHOLD + 5 }, (_, i) =>
      makeChat(i + 1000, { id: `y-session-${i}`, createdAt: 1_000_000 + i }),
    );

    renderHarness({
      groupedChatsByDate: { Today: todayChats, Yesterday: yesterdayChats },
      sortedDateKeys: ["Today", "Yesterday"],
      expandedKeys: ["Today", "Yesterday"],
      scrollTarget: { dateKey: "Yesterday", rootId: "y-session-3", childId: null },
    });

    // Two virtualized lists are mounted (one per date group); only the
    // "Yesterday" one should have received a non-null scrollToItemId, so
    // scrollToIndex fires exactly once, for the Yesterday-side index.
    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    expect(scrollToIndex).toHaveBeenCalledWith(3, { align: "auto" });
  });
});

describe("ChatSidebarDateGroups live status indicator (#94)", () => {
  it("renders a running status dot on the matching row", () => {
    const chats = [makeChat(0), makeChat(1)];

    render(
      <AntdApp>
        <DateGroupsHarness
          groupedChatsByDate={{ Today: chats }}
          sortedDateKeys={["Today"]}
          expandedKeys={["Today"]}
          runStateBySessionId={{ "session-1": "running" }}
        />
      </AntdApp>,
    );

    const dots = screen.getAllByTestId("chat-item-status");
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveClass("is-running");
  });

  it("prefers the live run state over a stale persisted error status", () => {
    const chats = [makeChat(0, { lastRunStatus: "error", lastRunError: "boom" })];

    render(
      <AntdApp>
        <DateGroupsHarness
          groupedChatsByDate={{ Today: chats }}
          sortedDateKeys={["Today"]}
          expandedKeys={["Today"]}
          runStateBySessionId={{ "session-0": "running" }}
        />
      </AntdApp>,
    );

    expect(screen.getByTestId("chat-item-status")).toHaveClass("is-running");
  });

  it("shows the persisted error status when the session isn't currently running", () => {
    const chats = [makeChat(0, { lastRunStatus: "error", lastRunError: "boom" })];

    render(
      <AntdApp>
        <DateGroupsHarness
          groupedChatsByDate={{ Today: chats }}
          sortedDateKeys={["Today"]}
          expandedKeys={["Today"]}
        />
      </AntdApp>,
    );

    const dot = screen.getByTestId("chat-item-status");
    expect(dot).toHaveClass("is-error");
    expect(dot).toHaveAttribute("aria-label", "Last run failed: boom");
  });

  it("does not render a status dot for an idle session", () => {
    const chats = [makeChat(0)];

    render(
      <AntdApp>
        <DateGroupsHarness
          groupedChatsByDate={{ Today: chats }}
          sortedDateKeys={["Today"]}
          expandedKeys={["Today"]}
        />
      </AntdApp>,
    );

    expect(screen.queryByTestId("chat-item-status")).toBeNull();
  });

  it("marks the collapsed root's sub-agent badge when a child is running", () => {
    const root = makeChat(0);
    const child = makeChat(100, { id: "child-1", kind: "child", parentSessionId: root.id });

    render(
      <AntdApp>
        <DateGroupsHarness
          groupedChatsByDate={{ Today: [root] }}
          sortedDateKeys={["Today"]}
          expandedKeys={["Today"]}
          childrenByRoot={{ [root.id]: [child] }}
          expandedRootIds={new Set()} // collapsed
          rootHasRunningChildBySessionId={{ [root.id]: true }}
        />
      </AntdApp>,
    );

    // The child row itself is not rendered (root collapsed)...
    expect(screen.queryByText(child.title)).toBeNull();
    // ...but the badge on the root row reflects the running child.
    expect(document.querySelector(".lotus-chat-item-child-badge-icon")).not.toBeNull();
  });
});
