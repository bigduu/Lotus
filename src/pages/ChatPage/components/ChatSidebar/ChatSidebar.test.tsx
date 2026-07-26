import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { App as AntdApp } from "antd";

import { ChatSidebar } from "../ChatSidebar";
import { useAppStore } from "@shared/store/appStore";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import { useSettingsViewStore } from "@shared/store/settingsViewStore";
import { APP_VERSION } from "@shared/constants/appVersion";
import { getDateGroupKey, NO_WORKSPACE_GROUP_KEY } from "../../utils/chatUtils";

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
    localStorage.removeItem("lotus.sidebar.workspace.expanded.v1");
    localStorage.removeItem("lotus.sidebar.project.expanded.v1");
    useUILayoutStore.setState((state) => ({
      ...state,
      sidebar: {
        ...state.sidebar,
        collapsed: false,
        // Reset explicitly (not just spread from whatever the shared store
        // currently holds) — the grouping-mode toggle (#95) really mutates
        // this persisted store, so without an explicit reset here a prior
        // test's toggle click would leak into later tests' initial state.
        groupingMode: "date",
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
          // A descendant spawned by another child still belongs under the
          // canonical root, rather than disappearing beneath its direct parent.
          parentSessionId: "intermediate-child",
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
    const platformDate = getDateGroupKey(new Date(1710100000000));
    localStorage.setItem(
      "lotus.sidebar.workspace-date.collapsed.v1",
      JSON.stringify([`${encodeURIComponent(NO_WORKSPACE_GROUP_KEY)}::${platformDate}`]),
    );
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
    // Workspace/date buckets default open; filtering must keep the matching
    // nested date visible rather than depending on the former date-only state.
    expect(screen.getByText("Platform roadmap")).toBeInTheDocument();

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
    expect(screen.getByText("Platform roadmap")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText<HTMLInputElement>("Search sessions");
    fireEvent.change(searchInput, { target: { value: "platform" } });

    await waitFor(() => {
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
    });

    fireEvent.change(searchInput, { target: { value: "" } });

    await waitFor(() => {
      expect(searchInput.value).toBe("");
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
    });
  });

  it("keeps the matching workspace and date expanded while the search changes", async () => {
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

    // Active filters own visibility, including across unrelated store
    // updates, so matching workspace and date buckets remain expanded.
    act(() => {
      useAppStore.setState((state) => ({ ...state }));
    });
    expect(screen.getByText("Platform roadmap")).toBeInTheDocument();

    // Changing the query re-derives the auto-expand set without hiding the
    // still-matching session.
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
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();

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
      expect(screen.getByText("Platform roadmap")).toBeInTheDocument();

      clickStatusFilter("Pinned");
      await waitFor(() => {
        expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
      });

      clickStatusFilter("All");

      await waitFor(() => {
        expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
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
      const groupHeader = document.querySelector<HTMLElement>(".chat-sidebar-date-group-header");
      expect(groupHeader).not.toBeNull();
      fireEvent.click(groupHeader as HTMLElement);

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

  describe("scroll to active session (#93)", () => {
    let originalScrollIntoView: unknown;

    beforeEach(() => {
      originalScrollIntoView = (HTMLElement.prototype as unknown as Record<string, unknown>)
        .scrollIntoView;
      HTMLElement.prototype.scrollIntoView = vi.fn();
    });

    afterEach(() => {
      (HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView =
        originalScrollIntoView;
    });

    it("scrolls the active session's row into view on mount", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");
      await waitFor(() => {
        expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
      });
    });

    it("scrolls again when the active session changes, but not on an unrelated store update", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");
      await waitFor(() => {
        expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
      });
      const callsAfterMount = (HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>)
        .mock.calls.length;

      // Put "Platform roadmap" in the same (already-expanded) date group so
      // switching to it doesn't also exercise the "expand a new group" path.
      act(() => {
        useAppStore.setState((state) => ({
          ...state,
          chats: state.chats.map((chat) =>
            chat.id === "root-platform" ? { ...chat, createdAt: 1710000500000 } : chat,
          ),
        }));
      });
      await screen.findByText("Platform roadmap");

      // Unrelated store tick — must not itself trigger another scroll.
      act(() => {
        useAppStore.setState((state) => ({ ...state }));
      });
      expect(
        (HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length,
      ).toBe(callsAfterMount);

      // An actual active-session change scrolls again.
      act(() => {
        useAppStore.setState((state) => ({ ...state, currentSessionId: "root-platform" }));
      });
      await waitFor(() => {
        expect(
          (HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length,
        ).toBeGreaterThan(callsAfterMount);
      });
    });

    it("does not scroll when the active session is filtered out of view", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");
      await waitFor(() => {
        expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
      });
      (HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

      // Search for something that excludes the currently active session —
      // "root-billing" ("Billing investigation") itself does not match.
      const searchInput = screen.getByPlaceholderText<HTMLInputElement>("Search sessions");
      fireEvent.change(searchInput, { target: { value: "roadmap" } });

      await waitFor(() => {
        expect(screen.queryByText("Billing investigation")).toBeNull();
      });
      expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    });
  });

  describe("live per-item status indicator (#94)", () => {
    it("shows no status dot for sessions with no execution activity", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");
      expect(screen.queryByTestId("chat-item-status")).toBeNull();
    });

    it("reflects a running session with a status dot, and clears it once execution finishes", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");

      act(() => {
        useAppStore.setState((state) => ({
          ...state,
          executionBySession: {
            ...state.executionBySession,
            "root-billing": {
              sessionId: "root-billing",
              phase: "streaming",
              confidence: "live",
              activeReasons: [],
              generation: 1,
              backendRunId: null,
              stream: { hasTokens: true, tokenCount: 3, activeToolCalls: [], lastStatusHint: null },
              backend: {
                isRunning: true,
                lastRunStatus: null,
                lastRunError: null,
                syncedAt: null,
                hasPendingQuestion: null,
                runningChildCount: null,
              },
              interaction: {
                pendingQuestion: null,
                respondMode: null,
                pendingChildApprovals: [],
                resolvedChildApprovalRequestIds: [],
              },
              children: { byId: {}, runningCount: 0 },
              timestamps: {
                optimisticAt: null,
                confirmedAt: null,
                firstTokenAt: null,
                terminalAt: null,
                settlingStartedAt: null,
                settledAt: null,
              },
              error: null,
            },
          },
        }));
      });

      await waitFor(() => {
        expect(screen.getByTestId("chat-item-status")).toHaveClass("is-running");
      });

      act(() => {
        useAppStore.setState((state) => ({
          ...state,
          executionBySession: {
            ...state.executionBySession,
            "root-billing": {
              ...state.executionBySession["root-billing"],
              phase: "idle",
              stream: {
                hasTokens: false,
                tokenCount: 0,
                activeToolCalls: [],
                lastStatusHint: null,
              },
              backend: { ...state.executionBySession["root-billing"].backend, isRunning: false },
            },
          },
        }));
      });

      await waitFor(() => {
        expect(screen.queryByTestId("chat-item-status")).toBeNull();
      });
    });
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

  describe("project grouping mode (#134)", () => {
    const makeProject = (id: string, name: string) => ({
      id,
      name,
      description: null,
      status: "active" as const,
      revision: 1,
      resource_revision: 1,
      workspace_count: 1,
      created_at: "2025-03-01T00:00:00Z",
      updated_at: "2025-03-01T00:00:00Z",
      schema_version: 1,
      workspace_bindings: [],
      legacy_project_keys: [],
    });

    // "root-billing" -> zenith project, "root-platform" -> bamboo project,
    // and a third, project-less session so the "Unassigned" trailing bucket
    // has something in it.
    beforeEach(() => {
      useAppStore.setState((state) => ({
        ...state,
        projects: {
          "proj-zenith": makeProject("proj-zenith", "zenith"),
          "proj-bamboo": makeProject("proj-bamboo", "bamboo"),
        },
        chats: [
          ...state.chats.map((chat) => {
            if (chat.id === "root-billing") {
              return { ...chat, config: { ...chat.config, projectId: "proj-zenith" } };
            }
            if (chat.id === "root-platform") {
              return { ...chat, config: { ...chat.config, projectId: "proj-bamboo" } };
            }
            return chat;
          }),
          {
            id: "root-loose",
            title: "Loose session",
            kind: "root",
            createdAt: 1710050000000,
            messages: [],
            config: {
              systemPromptId: "general_assistant",
              baseSystemPrompt: "You are helpful.",
              lastUsedEnhancedPrompt: null,
            },
            currentInteraction: null,
            updatedAt: new Date("2025-03-01T15:00:00Z").toISOString(),
          },
        ],
      }));
    });

    it("uses the fixed project-first hierarchy by default", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");
      await waitFor(() => expect(useUILayoutStore.getState().sidebar.groupingMode).toBe("project"));
      expect(screen.getByText(/^zenith/)).toBeInTheDocument();
      expect(screen.getByText(/^bamboo/)).toBeInTheDocument();
    });

    it("uses the root project and expands the hierarchy for a selected child", async () => {
      useAppStore.setState({ currentSessionId: "child-billing-fix" });
      useUILayoutStore.setState((state) => ({
        ...state,
        leafSessionIds: { lt: "child-billing-fix" },
      }));

      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      expect(await screen.findByText("Billing investigation")).toBeInTheDocument();
      expect(screen.getByText("Billing child fix")).toBeInTheDocument();
      expect(screen.getByText(/^zenith/)).toBeInTheDocument();
    });

    it("buckets same-project sessions together and persists outer expansion", async () => {
      const first = render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");

      await waitFor(() => {
        expect(useUILayoutStore.getState().sidebar.groupingMode).toBe("project");
      });

      // The selected session's ("root-billing", zenith) group auto-expands.
      expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      // A different project's group is not the selected session's group,
      // so it starts collapsed.
      expect(screen.queryByText("Platform roadmap")).toBeNull();

      // Expanding the "bamboo" group header reveals its own session,
      // proving it was bucketed separately from "zenith".
      fireEvent.click(screen.getByText(/bamboo/));
      await waitFor(() => {
        expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
      });
      await waitFor(() =>
        expect(localStorage.getItem("lotus.sidebar.project.expanded.v1")).toContain("proj-bamboo"),
      );

      first.unmount();
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );
      expect(await screen.findByText("Platform roadmap")).toBeInTheDocument();
    });

    it("routes sessions with no projectId into a trailing 'Unassigned' bucket", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");
      await waitFor(() => {
        expect(useUILayoutStore.getState().sidebar.groupingMode).toBe("project");
      });

      expect(screen.queryByText("Loose session")).toBeNull();

      fireEvent.click(screen.getByText(/Unassigned/));
      await waitFor(() => {
        expect(screen.getByText("Loose session")).toBeInTheDocument();
      });
    });

    it("keeps search filtering working in project mode, auto-expanding the matching group", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");
      await waitFor(() => {
        expect(useUILayoutStore.getState().sidebar.groupingMode).toBe("project");
      });

      const searchInput = screen.getByPlaceholderText("Search sessions");
      fireEvent.change(searchInput, { target: { value: "roadmap" } });

      await waitFor(() => {
        expect(screen.getByText("Platform roadmap")).toBeInTheDocument();
        expect(screen.queryByText("Billing investigation")).toBeNull();
      });
    });

    it("still reflects a live per-item run status in project mode (#104)", async () => {
      render(
        <AntdApp>
          <ChatSidebar />
        </AntdApp>,
      );

      await screen.findByText("Billing investigation");
      await waitFor(() => {
        expect(screen.getByText("Billing investigation")).toBeInTheDocument();
      });

      act(() => {
        useAppStore.setState((state) => ({
          ...state,
          executionBySession: {
            ...state.executionBySession,
            "root-billing": {
              sessionId: "root-billing",
              phase: "streaming",
              confidence: "live",
              activeReasons: [],
              generation: 1,
              backendRunId: null,
              stream: { hasTokens: true, tokenCount: 3, activeToolCalls: [], lastStatusHint: null },
              backend: {
                isRunning: true,
                lastRunStatus: null,
                lastRunError: null,
                syncedAt: null,
                hasPendingQuestion: null,
                runningChildCount: null,
              },
              interaction: {
                pendingQuestion: null,
                respondMode: null,
                pendingChildApprovals: [],
                resolvedChildApprovalRequestIds: [],
              },
              children: { byId: {}, runningCount: 0 },
              timestamps: {
                optimisticAt: null,
                confirmedAt: null,
                firstTokenAt: null,
                terminalAt: null,
                settlingStartedAt: null,
                settledAt: null,
              },
              error: null,
            },
          },
        }));
      });

      await waitFor(() => {
        expect(screen.getByTestId("chat-item-status")).toHaveClass("is-running");
      });
    });

    describe("virtualization (#85)", () => {
      // jsdom performs no real layout, so every element's `offsetHeight` is
      // 0 by default; `@tanstack/react-virtual` reads it to size its
      // viewport and would otherwise render nothing at all. Mirrors the
      // stub in ChatSidebarDateGroups.virtualization.test.tsx, scoped to
      // just this test so it doesn't affect the (unvirtualized) fixtures
      // used by the rest of this file.
      const VIRTUAL_LIST_TESTID = "chat-sidebar-virtual-root-list";
      const ROOT_ROW_HEIGHT_PX = 36;
      const VIRTUAL_LIST_MAX_HEIGHT_PX = 480;
      let originalOffsetHeight: PropertyDescriptor | undefined;

      beforeEach(() => {
        originalOffsetHeight = Object.getOwnPropertyDescriptor(
          HTMLElement.prototype,
          "offsetHeight",
        );
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

      afterEach(() => {
        if (originalOffsetHeight) {
          Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
        }
      });

      it("virtualizes a single project's group once it exceeds the threshold", async () => {
        const bigProjectChats = Array.from({ length: 60 }, (_, i) => ({
          id: `root-zenith-${i}`,
          title: `Zenith session ${i}`,
          kind: "root" as const,
          createdAt: 1710000000000 + i,
          messages: [],
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "You are helpful.",
            lastUsedEnhancedPrompt: null,
            projectId: "proj-zenith",
          },
          currentInteraction: null,
          updatedAt: new Date("2025-03-01T12:00:00Z").toISOString(),
        }));

        useAppStore.setState((state) => ({
          ...state,
          chats: [...state.chats, ...bigProjectChats],
          // Sessions within a project group sort newest-`createdAt` first
          // (see groupChatsByProject) — "root-zenith-59" has the highest
          // createdAt of the batch, so it lands at index 0 and is visible
          // in the virtualizer's initial (unscrolled) viewport.
          currentSessionId: "root-zenith-59",
        }));

        render(
          <AntdApp>
            <ChatSidebar />
          </AntdApp>,
        );

        await screen.findByPlaceholderText("Search sessions");

        await waitFor(() => {
          expect(screen.getByTestId(VIRTUAL_LIST_TESTID)).toBeInTheDocument();
        });
        // The virtualized viewport mounted instead of a plain <List> that
        // would otherwise put all 60+ rows in the DOM at once.
        expect(screen.getByText("Zenith session 59")).toBeInTheDocument();
        expect(screen.getAllByTestId("chat-item").length).toBeLessThan(61);
      });
    });
  });
});
