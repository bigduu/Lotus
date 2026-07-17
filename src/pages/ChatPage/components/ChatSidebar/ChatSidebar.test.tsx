import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { App as AntdApp } from "antd";

import { ChatSidebar } from "../ChatSidebar";
import { useAppStore } from "@shared/store/appStore";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import { useSettingsViewStore } from "@shared/store/settingsViewStore";
import { APP_VERSION } from "@shared/constants/appVersion";

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    Grid: {
      ...actual.Grid,
      useBreakpoint: () => ({ xs: true, sm: true, md: true, lg: true, xl: false, xxl: false }),
    },
  };
});

vi.mock("../SystemPromptSelector", () => ({
  default: () => null,
}));

describe("ChatSidebar", () => {
  beforeEach(() => {
    useUILayoutStore.setState((state) => ({
      ...state,
      sidebar: {
        ...state.sidebar,
        collapsed: false,
      },
      tree: { type: "leaf", id: "lt" },
      activeLeafId: "lt",
      leafSessionIds: { lt: "root-billing" },
      splitSizesPx: {},
    }));

    useAppStore.setState((state) => ({
      ...state,
      chats: [
        {
          id: "root-billing",
          title: "Billing investigation",
          kind: "root",
          createdAt: 1710000000000,
          messages: [],
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "You are helpful.",
            lastUsedEnhancedPrompt: null,
          },
          currentInteraction: null,
          updatedAt: new Date("2025-03-01T12:00:00Z").toISOString(),
        },
        {
          id: "root-platform",
          title: "Platform roadmap",
          kind: "root",
          createdAt: 1710100000000,
          messages: [],
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "You are helpful.",
            lastUsedEnhancedPrompt: null,
          },
          currentInteraction: null,
          updatedAt: new Date("2025-03-02T12:00:00Z").toISOString(),
        },
        {
          id: "child-billing-fix",
          title: "Billing child fix",
          kind: "child",
          parentSessionId: "root-billing",
          rootSessionId: "root-billing",
          createdAt: 1710001000000,
          messages: [],
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "You are helpful.",
            lastUsedEnhancedPrompt: null,
          },
          currentInteraction: null,
          updatedAt: new Date("2025-03-01T13:00:00Z").toISOString(),
        },
      ],
      currentSessionId: "root-billing",
      systemPrompts: [
        {
          id: "general_assistant",
          name: "General Assistant",
          content: "You are helpful.",
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isDefault: true,
        },
      ],
      lastSelectedPromptId: "general_assistant",
    }));
  });

  it("filters root sessions by search query", async () => {
    // Put "Platform roadmap" in the same date group as the selected
    // "root-billing" session so it is genuinely visible *before* filtering.
    // Otherwise this assertion could pass purely because its (non-selected)
    // date group starts out collapsed, without the filter logic doing
    // anything at all (see #61).
    useAppStore.setState((state) => ({
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === "root-platform" ? { ...chat, createdAt: 1710000500000 } : chat,
      ),
    }));

    render(
      <AntdApp>
        <ChatSidebar />
      </AntdApp>,
    );

    // Sanity check: both sessions are visible pre-filter, proving they share
    // an expanded date group.
    expect(await screen.findByText("Billing investigation")).toBeInTheDocument();
    expect(screen.getByText("Platform roadmap")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("Search sessions");
    fireEvent.change(searchInput, { target: { value: "billing" } });

    await waitFor(() => {
      expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      expect(screen.queryByText("Platform roadmap")).toBeNull();
    });
  });

  it("auto-expands a collapsed, non-selected date group to reveal a search match (#61)", async () => {
    // "Platform roadmap" is left in its own date group (createdAt is ~a day
    // after the selected "root-billing" session), which starts collapsed
    // since it isn't the selected session's group.
    render(
      <AntdApp>
        <ChatSidebar />
      </AntdApp>,
    );

    await screen.findByText("Billing investigation");
    // Pre-condition: the non-selected group is collapsed, so the match is
    // not yet visible.
    expect(screen.queryByText("Platform roadmap")).toBeNull();

    const searchInput = screen.getByPlaceholderText("Search sessions");
    fireEvent.change(searchInput, { target: { value: "platform" } });

    await waitFor(() => {
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
    });
  });

  it("restores the prior (collapsed) expansion state once the search is cleared", async () => {
    render(
      <AntdApp>
        <ChatSidebar />
      </AntdApp>,
    );

    await screen.findByText("Billing investigation");
    expect(screen.queryByText("Platform roadmap")).toBeNull();

    const searchInput = screen.getByPlaceholderText<HTMLInputElement>("Search sessions");
    fireEvent.change(searchInput, { target: { value: "platform" } });

    await waitFor(() => {
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
    });

    fireEvent.change(searchInput, { target: { value: "" } });

    await waitFor(() => {
      expect(searchInput.value).toBe("");
      // The group was collapsed before the search started and was never
      // manually opened by the user, so it goes back to collapsed instead
      // of permanently staying expanded because of the search.
      expect(screen.queryByText("Platform roadmap")).toBeNull();
    });
  });

  it("respects a manual collapse made mid-search until the query changes", async () => {
    render(
      <AntdApp>
        <ChatSidebar />
      </AntdApp>,
    );

    await screen.findByText("Billing investigation");

    const searchInput = screen.getByPlaceholderText<HTMLInputElement>("Search sessions");
    fireEvent.change(searchInput, { target: { value: "roadmap" } });

    await waitFor(() => {
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
    });

    // Manually collapse the auto-expanded group that contains the match.
    // Exactly one date group renders while this filter is active (it holds
    // the single "Platform roadmap" match), so its header is the sole
    // group-toggle button whose accessible name ends in the "(1)" count.
    const groupHeader = screen.getByRole("button", { name: /\(1\)$/ });
    fireEvent.click(groupHeader);

    await waitFor(() => {
      expect(screen.queryByText("Platform roadmap")).toBeNull();
    });

    // Unrelated re-renders (e.g. a store update) should not re-force the
    // group back open while the same query is still active.
    act(() => {
      useAppStore.setState((state) => ({ ...state }));
    });
    expect(screen.queryByText("Platform roadmap")).toBeNull();

    // Changing the query re-derives the auto-expand set, overriding the
    // manual collapse.
    fireEvent.change(searchInput, { target: { value: "roadmap " } });
    await waitFor(() => {
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
    });
  });

  it("shows matching child sessions when child filter is active", async () => {
    render(
      <AntdApp>
        <ChatSidebar />
      </AntdApp>,
    );

    const childFilter = document.querySelector<HTMLElement>(
      '.ant-segmented-item-label[title="Child"]',
    );
    expect(childFilter).not.toBeNull();
    fireEvent.click(childFilter as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      expect(screen.getByText("Billing child fix")).toBeInTheDocument();
      expect(screen.queryByText("Platform roadmap")).toBeNull();
    });
  });

  describe("status filter date-group expansion (#67)", () => {
    const clickStatusFilter = (title: "All" | "Pinned" | "Running" | "Child") => {
      const option = document.querySelector<HTMLElement>(
        `.ant-segmented-item-label[title="${title}"]`,
      );
      expect(option).not.toBeNull();
      fireEvent.click(option as HTMLElement);
    };

    beforeEach(() => {
      // "Platform roadmap" is pinned but left in its own (non-selected)
      // date bucket by createdAt; pinning routes it into the "Pinned" date
      // group, which starts collapsed since it isn't the selected session's
      // group. This mirrors the #61 search fixture, but for the status
      // filter (pinned/running/child) instead of a search query.
      useAppStore.setState((state) => ({
        ...state,
        chats: state.chats.map((chat) =>
          chat.id === "root-platform" ? { ...chat, pinned: true } : chat,
        ),
      }));
    });

    it("auto-expands a collapsed, non-selected date group to reveal a status-filter match", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");
      // Pre-condition: the "Pinned" group is collapsed, so the match is not
      // yet visible.
      expect(screen.queryByText("Platform roadmap")).toBeNull();

      clickStatusFilter("Pinned");

      await waitFor(() => {
        expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
      });
    });

    it("restores the prior (collapsed) expansion state once the status filter is cleared", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");
      expect(screen.queryByText("Platform roadmap")).toBeNull();

      clickStatusFilter("Pinned");
      await waitFor(() => {
        expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
      });

      clickStatusFilter("All");

      await waitFor(() => {
        // The group was collapsed before filtering started and was never
        // manually opened by the user, so it goes back to collapsed instead
        // of permanently staying expanded because of the filter.
        expect(screen.queryByText("Platform roadmap")).toBeNull();
      });
    });

    it("respects a manual collapse made mid status-filter until the filter changes", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");

      clickStatusFilter("Pinned");
      await waitFor(() => {
        expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
      });

      // Manually collapse the auto-expanded group that contains the match.
      // Exactly one date group renders while this filter is active (it
      // holds the single pinned "Platform roadmap" match), so its header is
      // the sole group-toggle button whose accessible name ends in "(1)".
      const groupHeader = screen.getByRole("button", { name: /\(1\)$/ });
      fireEvent.click(groupHeader);

      await waitFor(() => {
        expect(screen.queryByText("Platform roadmap")).toBeNull();
      });

      // Unrelated re-renders (e.g. a store update) should not re-force the
      // group back open while the same status filter is still active.
      act(() => {
        useAppStore.setState((state) => ({ ...state }));
      });
      expect(screen.queryByText("Platform roadmap")).toBeNull();

      // Changing the filter (away and back) re-derives the auto-expand set,
      // overriding the manual collapse.
      clickStatusFilter("All");
      clickStatusFilter("Pinned");

      await waitFor(() => {
        expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
      });
    });

    it("auto-expands for a combined search + status filter match in a collapsed group", async () => {
      // Give "root-platform" a child that only matches once BOTH the search
      // query and the "Child" status filter are applied together, so this
      // covers the combined-filter path rather than just one predicate.
      useAppStore.setState((state) => ({
        ...state,
        chats: [
          ...state.chats,
          {
            id: "child-platform-review",
            title: "Platform review notes",
            kind: "child",
            parentSessionId: "root-platform",
            rootSessionId: "root-platform",
            createdAt: 1710100500000,
            messages: [],
            config: {
              systemPromptId: "general_assistant",
              baseSystemPrompt: "You are helpful.",
              lastUsedEnhancedPrompt: null,
            },
            currentInteraction: null,
            updatedAt: new Date("2025-03-02T13:00:00Z").toISOString(),
          },
        ],
      }));

      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");
      expect(screen.queryByText("Platform review notes")).toBeNull();

      const searchInput = screen.getByPlaceholderText("Search sessions");
      fireEvent.change(searchInput, { target: { value: "review" } });
      clickStatusFilter("Child");

      await waitFor(() => {
        expect(screen.getByText("Platform review notes")).toBeInTheDocument();
        // "Billing investigation" doesn't match the "review" search term.
        expect(screen.queryByText("Billing investigation")).toBeNull();
      });
    });
  });

  describe("search input debouncing", () => {
    beforeEach(() => {
      // The sidebar only auto-expands the *selected* session's date group by
      // default (other date groups start collapsed until clicked open), so
      // put "Platform roadmap" in the same calendar-day bucket as the
      // selected "root-billing" session. Otherwise it would never render
      // regardless of the search query, which would make these debounce
      // assertions meaningless.
      useAppStore.setState((state) => ({
        ...state,
        chats: state.chats.map((chat) =>
          chat.id === "root-platform" ? { ...chat, createdAt: 1710003600000 } : chat,
        ),
      }));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("echoes the typed value immediately but defers re-filtering until the debounce elapses", async () => {
      vi.useFakeTimers();

      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      const searchInput = screen.getByPlaceholderText<HTMLInputElement>("Search sessions");

      act(() => {
        fireEvent.change(searchInput, { target: { value: "billing" } });
      });

      // The input itself is a controlled field — the keystroke echoes right away.
      expect(searchInput.value).toBe("billing");
      // But the list has not re-filtered yet: both sessions are still present.
      expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();

      // Just under the debounce window: still unfiltered.
      act(() => {
        vi.advanceTimersByTime(199);
      });
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();

      // Crossing the debounce window applies the filter.
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      expect(screen.queryByText("Platform roadmap")).toBeNull();
    });

    it("does not re-filter on every keystroke while typing quickly", async () => {
      vi.useFakeTimers();

      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      const searchInput = screen.getByPlaceholderText<HTMLInputElement>("Search sessions");

      for (const partial of ["b", "bi", "bil", "billi", "billing"]) {
        act(() => {
          fireEvent.change(searchInput, { target: { value: partial } });
          // Each keystroke arrives faster than the debounce window, so the
          // pending timer keeps getting reset instead of firing.
          vi.advanceTimersByTime(50);
        });
      }

      expect(searchInput.value).toBe("billing");
      // Still unfiltered — the debounce never got a quiet 200ms window.
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      expect(screen.queryByText("Platform roadmap")).toBeNull();
    });

    it("resets the filtered list promptly when the search is cleared, with no stale-query flash", async () => {
      vi.useFakeTimers();

      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      const searchInput = screen.getByPlaceholderText<HTMLInputElement>("Search sessions");

      act(() => {
        fireEvent.change(searchInput, { target: { value: "billing" } });
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText("Platform roadmap")).toBeNull();

      // Rapid type-then-clear: change to a new query and clear it again before
      // the debounce for the intermediate query has a chance to fire.
      act(() => {
        fireEvent.change(searchInput, { target: { value: "platform" } });
        vi.advanceTimersByTime(50);
        fireEvent.change(searchInput, { target: { value: "" } });
      });

      // Clearing bypasses the debounce entirely — the full list is back
      // without waiting out the debounce window, and no stale "platform"
      // filter is ever applied once the pending timer would have fired.
      expect(searchInput.value).toBe("");
      expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
    });
  });

  it("shows the running app version in the sidebar footer", async () => {
    render(
      <AntdApp>
        <ChatSidebar />
      </AntdApp>,
    );

    // Assert the footer renders the running version (whatever it is — `0.0.0`
    // placeholder locally / in CI, real date version at publish). The "must be
    // a real version" check is the publish refuse-0.0.0 guard's job.
    expect(await screen.findByTestId("app-version-badge")).toHaveTextContent(`v${APP_VERSION}`);
  });

  it("exposes a footer entry that deep-links into the Schedules settings tab (#99)", async () => {
    // Baseline: settings closed.
    useSettingsViewStore.setState({ isOpen: false, activeTabKey: "provider" });

    render(
      <AntdApp>
        <ChatSidebar />
      </AntdApp>,
    );

    const schedulesButton = await screen.findByTestId("open-schedules");
    fireEvent.click(schedulesButton);

    // Clicking the footer entry opens Settings straight on the Schedules tab,
    // rather than the default provider tab — making the otherwise-buried
    // feature reachable in one click.
    const state = useSettingsViewStore.getState();
    expect(state.isOpen).toBe(true);
    expect(state.activeTabKey).toBe("schedules");
  });
});
