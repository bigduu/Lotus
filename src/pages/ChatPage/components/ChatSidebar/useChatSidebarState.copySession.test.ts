import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionSummary } from "@services/chat/AgentService";
import { useAppStore } from "@shared/store/appStore";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import { useChatSidebarState } from "./useChatSidebarState";

const { mockCopySession, mockMessage, mockOpenSession } = vi.hoisted(() => ({
  mockCopySession: vi.fn(),
  mockOpenSession: vi.fn(),
  mockMessage: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => vi.fn()),
  },
}));

vi.mock("@shared/utils/openSession", () => ({
  openSession: mockOpenSession,
}));

vi.mock("antd", async () => {
  const actual = await vi.importActual<typeof import("antd")>("antd");
  return {
    ...actual,
    App: Object.assign(actual.App, {
      useApp: () => ({
        message: mockMessage,
        notification: actual.notification,
        modal: actual.Modal,
      }),
    }),
  };
});

const copiedSummary = (): SessionSummary =>
  ({
    id: "copied-session",
    kind: "root",
    title: "Copied session",
    title_version: 1,
    pinned: false,
    parent_session_id: null,
    root_session_id: "copied-session",
    spawn_depth: 0,
    model: "gpt-test",
    created_at: "2026-08-14T00:00:00.000Z",
    updated_at: "2026-08-14T00:00:00.000Z",
    last_activity_at: "2026-08-14T00:00:00.000Z",
    message_count: 2,
    has_attachments: false,
    is_running: false,
  }) as SessionSummary;

describe("useChatSidebarState — copy session (#153)", () => {
  beforeEach(() => {
    mockCopySession.mockReset();
    mockOpenSession.mockReset();
    mockMessage.success.mockReset();
    mockMessage.error.mockReset();
    mockMessage.warning.mockReset();
    mockMessage.info.mockReset();
    mockMessage.loading.mockReset();
    mockMessage.loading.mockReturnValue(vi.fn());

    useUILayoutStore.setState((state) => ({
      ...state,
      sidebar: { ...state.sidebar, collapsed: false },
      tree: { type: "leaf", id: "lt" },
      activeLeafId: "lt",
      leafSessionIds: { lt: "source-session" },
      splitSizesPx: {},
    }));

    useAppStore.setState((state) => ({
      ...state,
      chats: [
        {
          id: "source-session",
          title: "Source session",
          kind: "root",
          createdAt: Date.now(),
          messages: [],
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "You are helpful.",
            lastUsedEnhancedPrompt: null,
          },
        },
      ],
      currentSessionId: "source-session",
      copySession: mockCopySession,
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

  it("uses a synchronous per-source lock so same-frame duplicate triggers issue one copy", async () => {
    let resolveCopy: (summary: SessionSummary) => void = () => {};
    mockCopySession.mockImplementation(
      () =>
        new Promise<SessionSummary>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    const { result } = renderHook(() => useChatSidebarState());

    act(() => {
      void result.current.handleCopySession("source-session");
      void result.current.handleCopySession("source-session");
    });

    expect(mockCopySession).toHaveBeenCalledTimes(1);
    expect(result.current.copyingSessionIds.has("source-session")).toBe(true);

    await act(async () => {
      resolveCopy(copiedSummary());
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(result.current.copyingSessionIds.has("source-session")).toBe(false);
    });
  });

  it("opens the committed copy with history hydration and shows success feedback", async () => {
    mockCopySession.mockResolvedValue(copiedSummary());
    const { result } = renderHook(() => useChatSidebarState());

    await act(async () => {
      await result.current.handleCopySession("source-session");
    });

    expect(mockOpenSession).toHaveBeenCalledWith("copied-session", {
      forceLoadHistory: true,
    });
    expect(mockMessage.success).toHaveBeenCalledWith("Session copied");
    expect(mockMessage.error).not.toHaveBeenCalled();
  });

  it("does not open on failure, reports it, and releases the lock for a retry", async () => {
    mockCopySession
      .mockRejectedValueOnce(new Error("copy transaction failed"))
      .mockResolvedValueOnce(copiedSummary());
    const { result } = renderHook(() => useChatSidebarState());

    await act(async () => {
      await result.current.handleCopySession("source-session");
    });

    expect(mockOpenSession).not.toHaveBeenCalled();
    expect(mockMessage.error).toHaveBeenCalledWith("copy transaction failed");
    expect(result.current.copyingSessionIds.has("source-session")).toBe(false);

    await act(async () => {
      await result.current.handleCopySession("source-session");
    });

    expect(mockCopySession).toHaveBeenCalledTimes(2);
    expect(mockOpenSession).toHaveBeenCalledWith("copied-session", {
      forceLoadHistory: true,
    });
    expect(mockMessage.success).toHaveBeenCalledWith("Session copied");
  });
});
