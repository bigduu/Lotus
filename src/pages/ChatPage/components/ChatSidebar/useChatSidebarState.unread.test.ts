import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveVisibleSessionIds,
  selectSidebarChatSummaries,
  useChatSidebarState,
} from "./useChatSidebarState";
import { useAppStore } from "@shared/store/appStore";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import {
  useSessionReadStateStore,
  type SessionReadMarker,
} from "@shared/store/sessionReadStateStore";

const { mockListProjects } = vi.hoisted(() => ({ mockListProjects: vi.fn() }));
vi.mock("@services/project", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@services/project")>();
  return {
    ...actual,
    projectService: { ...actual.projectService, listProjects: mockListProjects },
  };
});

const chat = (id: string, messageCount: number) => ({
  id,
  title: id,
  kind: "root" as const,
  createdAt: Date.parse("2026-08-14T01:00:00.000Z"),
  messages: [],
  config: {
    systemPromptId: "general",
    baseSystemPrompt: "helpful",
    lastUsedEnhancedPrompt: null,
    projectId: "project-1",
  },
  currentInteraction: null,
  lastActivityAt: `2026-08-14T01:00:0${messageCount}.000Z`,
  updatedAt: `2026-08-14T01:00:0${messageCount}.000Z`,
  messageCount,
});

const readMarker = (messageCount: number): SessionReadMarker => ({
  activityAt: Date.parse(`2026-08-14T01:00:0${messageCount}.000Z`),
  activityRevision: "000000",
  messageCount,
  hasMessageCount: true,
});

const setVisibility = (visibilityState: "visible" | "hidden") => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: visibilityState,
  });
  document.dispatchEvent(new Event("visibilitychange"));
};

describe("resolveVisibleSessionIds", () => {
  it("uses all mapped panes and ignores a transient unrelated current id", () => {
    expect(resolveVisibleSessionIds({ a: "session-a", b: "session-b" }, "list-first")).toEqual(
      new Set(["session-a", "session-b"]),
    );
  });

  it("falls back to current only when every pane is empty", () => {
    expect(resolveVisibleSessionIds({ a: null, b: null }, "current")).toEqual(new Set(["current"]));
  });
});

describe("selectSidebarChatSummaries", () => {
  it("preserves the projection when only streamed message-array content changes", () => {
    const firstChat = chat("session-a", 1);
    const first = selectSidebarChatSummaries({ chats: [firstChat] });
    const second = selectSidebarChatSummaries({
      chats: [
        {
          ...firstChat,
          messages: [{ id: "stream-token", role: "assistant" as const, content: "partial" }],
        },
      ],
    });

    expect(second).toBe(first);
  });
});

describe("useChatSidebarState unread lifecycle (#129)", () => {
  beforeEach(() => {
    localStorage.clear();
    setVisibility("visible");
    mockListProjects.mockResolvedValue({ projects: [] });
    useUILayoutStore.setState((state) => ({
      ...state,
      sidebar: { ...state.sidebar, collapsed: false },
      tree: {
        type: "split",
        id: "root",
        layout: "horizontal",
        children: [
          { type: "leaf", id: "a" },
          { type: "leaf", id: "b" },
        ],
      },
      activeLeafId: "a",
      leafSessionIds: { a: "session-a", b: "session-b" },
    }));
    useAppStore.setState((state) => ({
      ...state,
      chats: [chat("session-a", 1), chat("session-b", 1), chat("background", 1)],
      currentSessionId: "session-a",
      projects: {},
    }));
    useSessionReadStateStore.setState({
      v: 2,
      initialized: true,
      feedResetThrough: 0,
      markers: {
        "session-a": readMarker(0),
        "session-b": readMarker(0),
        background: readMarker(0),
      },
    });
  });

  it("suppresses indicators for visible panes without baselining their unloaded content", async () => {
    const { result } = renderHook(() => useChatSidebarState());
    expect(useSessionReadStateStore.getState().markers["session-a"].messageCount).toBe(0);
    expect(useSessionReadStateStore.getState().markers["session-b"].messageCount).toBe(0);
    expect(
      result.current.activeGroupedChats["project-1"].find((c) => c.id === "session-a")?.unread,
    ).toBe(false);
    expect(
      result.current.activeGroupedChats["project-1"].find((c) => c.id === "session-b")?.unread,
    ).toBe(false);
    expect(
      result.current.activeGroupedChats["project-1"].find((c) => c.id === "background")?.unread,
    ).toBe(true);
  });

  it("does not clear or suppress activity received while the document is hidden", async () => {
    const { result } = renderHook(() => useChatSidebarState());

    act(() => setVisibility("hidden"));
    act(() => {
      useAppStore.setState((state) => ({
        chats: state.chats.map((item) => (item.id === "session-a" ? chat("session-a", 2) : item)),
      }));
    });

    await waitFor(() =>
      expect(
        result.current.activeGroupedChats["project-1"].find((c) => c.id === "session-a")?.unread,
      ).toBe(true),
    );
    expect(useSessionReadStateStore.getState().markers["session-a"].messageCount).toBe(0);

    act(() => setVisibility("visible"));
    await waitFor(() =>
      expect(
        result.current.activeGroupedChats["project-1"].find((c) => c.id === "session-a")?.unread,
      ).toBe(false),
    );
    expect(useSessionReadStateStore.getState().markers["session-a"].messageCount).toBe(0);
  });

  it("does not acknowledge a visible dirty latch before history is rendered", async () => {
    const { result } = renderHook(() => useChatSidebarState());

    act(() => useSessionReadStateStore.getState().markUnreadFromFeed("session-a", 80));
    expect(useSessionReadStateStore.getState().markers["session-a"].readContentThrough ?? 0).toBe(
      0,
    );

    act(() => {
      useUILayoutStore.setState((state) => ({
        ...state,
        leafSessionIds: { a: null, b: "session-b" },
      }));
    });
    await waitFor(() =>
      expect(
        result.current.activeGroupedChats["project-1"].find((c) => c.id === "session-a")?.unread,
      ).toBe(true),
    );
  });

  it("keeps all rows read before authoritative initialization", async () => {
    act(() => {
      useSessionReadStateStore.setState({
        v: 2,
        initialized: false,
        markers: {},
        feedResetThrough: 0,
      });
      useUILayoutStore.setState((state) => ({ ...state, leafSessionIds: { a: null, b: null } }));
      useAppStore.setState({ currentSessionId: null });
    });

    const { result } = renderHook(() => useChatSidebarState());
    expect(result.current.activeGroupedChats["project-1"].every((item) => !item.unread)).toBe(true);
    await waitFor(() => expect(mockListProjects).toHaveBeenCalled());
  });
});
