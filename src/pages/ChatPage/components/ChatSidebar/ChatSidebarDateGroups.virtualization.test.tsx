import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp, theme } from "antd";

import { ChatSidebarDateGroups } from "./ChatSidebarDateGroups";
import type { SidebarChatItem } from "@shared/types/sidebarChat";

// Mirrors ChatSidebarDateGroups.tsx's internal constants (not exported, so
// duplicated here) — used to give jsdom's `offsetHeight` mock below numbers
// consistent with what the component itself assumes.
const VIRTUALIZE_THRESHOLD = 50;
const ROOT_ROW_HEIGHT_PX = 36;
const VIRTUAL_LIST_MAX_HEIGHT_PX = 480;
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
    onScheduleThis: noop,
    titleGenerationState: {},
    projectDreamState: {},
    token,
    hasActiveFilters: false,
    onClearFilters: noop,
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

describe("ChatSidebarDateGroups virtualization (#4)", () => {
  // jsdom performs no real layout, so every element's `offsetHeight` is 0 by
  // default. `@tanstack/react-virtual` reads `offsetHeight` both for the
  // scrollable viewport (to know how many rows fit) and per-row (to
  // self-correct its initial size estimate) — see
  // node_modules/@tanstack/virtual-core `getRect`/`measureElement`. Without
  // this, the virtualizer would see a 0px viewport and render nothing.
  // Stubbing it to match the component's own estimates is the standard way
  // to exercise this kind of virtualized list under jsdom.
  let originalOffsetHeight: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        if (this.getAttribute("data-testid") === VIRTUAL_LIST_TESTID) {
          return VIRTUAL_LIST_MAX_HEIGHT_PX;
        }
        if (this.hasAttribute("data-index")) {
          return ROOT_ROW_HEIGHT_PX;
        }
        return 0;
      },
    });
  });

  afterAll(() => {
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
  });

  it("renders a bounded number of session DOM nodes for a 500-session date group", () => {
    const chats = Array.from({ length: 500 }, (_, i) => makeChat(i));

    renderHarness({
      groupedChatsByDate: { Today: chats },
      sortedDateKeys: ["Today"],
      expandedKeys: ["Today"],
    });

    // The virtualized viewport mounted instead of the plain `<List>`.
    expect(screen.getByTestId(VIRTUAL_LIST_TESTID)).toBeInTheDocument();

    // Only a small window around the visible viewport (480px / 36px rows
    // ≈ 13 rows, plus overscan) is ever mounted — nowhere near all 500.
    const renderedItems = screen.getAllByTestId("chat-item");
    expect(renderedItems.length).toBeGreaterThan(0);
    expect(renderedItems.length).toBeLessThan(100);

    // The first sessions are visible (top of the list, no scroll needed)...
    expect(screen.getByText("Session 0")).toBeInTheDocument();
    // ...but a session far down the list is not yet mounted.
    expect(screen.queryByText("Session 499")).toBeNull();
  });

  it("reveals sessions further down the list as the virtualized viewport scrolls", () => {
    const chats = Array.from({ length: 500 }, (_, i) => makeChat(i));

    renderHarness({
      groupedChatsByDate: { Today: chats },
      sortedDateKeys: ["Today"],
      expandedKeys: ["Today"],
    });

    const scrollContainer = screen.getByTestId(VIRTUAL_LIST_TESTID);
    expect(screen.queryByText("Session 499")).toBeNull();

    fireEvent.scroll(scrollContainer, {
      target: { scrollTop: 495 * ROOT_ROW_HEIGHT_PX },
    });

    expect(screen.getByText("Session 499")).toBeInTheDocument();
    // The far-scrolled-away start of the list is no longer mounted.
    expect(screen.queryByText("Session 0")).toBeNull();
  });

  it("falls back to the plain (non-virtualized) list once a filter drops the count below the threshold", () => {
    const chats = Array.from({ length: 500 }, (_, i) => makeChat(i));

    const { rerender } = render(
      <AntdApp>
        <DateGroupsHarness
          groupedChatsByDate={{ Today: chats }}
          sortedDateKeys={["Today"]}
          expandedKeys={["Today"]}
        />
      </AntdApp>,
    );

    expect(screen.getByTestId(VIRTUAL_LIST_TESTID)).toBeInTheDocument();

    // Simulate a search/status filter narrowing the date group down to a
    // handful of matches, the way useChatSidebarState's filteredRootSessions
    // would feed a much smaller `groupedChatsByDate` back into this
    // component.
    const filtered = [makeChat(0, { title: "Billing investigation" })];

    rerender(
      <AntdApp>
        <DateGroupsHarness
          groupedChatsByDate={{ Today: filtered }}
          sortedDateKeys={["Today"]}
          expandedKeys={["Today"]}
          hasActiveFilters
        />
      </AntdApp>,
    );

    expect(screen.queryByTestId(VIRTUAL_LIST_TESTID)).toBeNull();
    expect(screen.getByText("Billing investigation")).toBeInTheDocument();
    expect(screen.getAllByTestId("chat-item")).toHaveLength(1);
  });

  it("keeps a specific match visible and DOM bounded when a filtered list is still above the virtualization threshold", () => {
    // One above the threshold so the virtualized path stays engaged even
    // after filtering.
    const filteredCount = VIRTUALIZE_THRESHOLD + 30;
    const chats = Array.from({ length: filteredCount }, (_, i) =>
      i === 0 ? makeChat(i, { title: "Needle session" }) : makeChat(i),
    );

    renderHarness({
      groupedChatsByDate: { Today: chats },
      sortedDateKeys: ["Today"],
      expandedKeys: ["Today"],
      hasActiveFilters: true,
    });

    expect(screen.getByTestId(VIRTUAL_LIST_TESTID)).toBeInTheDocument();
    // Placed at index 0, so it's within the initial visible window without
    // needing to scroll.
    expect(screen.getByText("Needle session")).toBeInTheDocument();
    expect(screen.getAllByTestId("chat-item").length).toBeLessThan(filteredCount);
  });
});
