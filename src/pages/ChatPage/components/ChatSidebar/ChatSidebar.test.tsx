import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { App as AntdApp } from "antd";

import { ChatSidebar } from "../ChatSidebar";
import { useAppStore } from "@shared/store/appStore";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
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
    render(
      <AntdApp>
        <ChatSidebar />
      </AntdApp>,
    );

    const searchInput = await screen.findByPlaceholderText("Search sessions");
    fireEvent.change(searchInput, { target: { value: "billing" } });

    await waitFor(() => {
      expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      expect(screen.queryByText("Platform roadmap")).toBeNull();
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
});
