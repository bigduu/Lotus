import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { useChatSidebarState } from "./useChatSidebarState";
import { useAppStore } from "@shared/store/appStore";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";

// #16 — title regeneration used to swallow errors behind a bare
// `console.error`, and `titleGenerationState` was hardcoded to `{}` so
// `isGeneratingTitle` was always false (the menu spinner never showed).
// These tests exercise `useChatSidebarState` directly (the layer the bug
// actually lived in) rather than driving AntD's Dropdown/menu DOM, whose
// close-on-select portal/motion timing is unrelated to the fix and makes
// jsdom assertions on menu-item attributes flaky/misleading.

const { mockRegenerateSessionTitle, mockListSessions, mockMessage } = vi.hoisted(() => ({
  mockRegenerateSessionTitle: vi.fn(),
  mockListSessions: vi.fn(),
  mockMessage: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(() => vi.fn()),
  },
}));

vi.mock("@services/chat/AgentService", async () => {
  const actual = await vi.importActual<typeof import("@services/chat/AgentService")>(
    "@services/chat/AgentService",
  );
  return {
    ...actual,
    AgentClient: {
      getInstance: () => ({
        regenerateSessionTitle: mockRegenerateSessionTitle,
        listSessions: mockListSessions,
      }),
    },
  };
});

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

describe("useChatSidebarState — title regeneration feedback (#16)", () => {
  beforeEach(() => {
    mockRegenerateSessionTitle.mockReset();
    mockListSessions.mockReset();
    mockListSessions.mockResolvedValue({ sessions: [] });
    mockMessage.success.mockReset();
    mockMessage.error.mockReset();
    mockMessage.info.mockReset();
    mockMessage.warning.mockReset();
    mockMessage.loading.mockReset();
    mockMessage.loading.mockReturnValue(vi.fn());

    useUILayoutStore.setState((state) => ({
      ...state,
      sidebar: { ...state.sidebar, collapsed: false },
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
          createdAt: Date.now(),
          messages: [],
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "You are helpful.",
            lastUsedEnhancedPrompt: null,
          },
          currentInteraction: null,
          updatedAt: new Date().toISOString(),
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

  it("starts in idle (no stale loading state) and reports loading immediately on trigger", async () => {
    const { result } = renderHook(() => useChatSidebarState());
    expect(result.current.titleGenerationState["root-billing"]).toBeUndefined();

    let resolveRegenerate: () => void = () => {};
    mockRegenerateSessionTitle.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRegenerate = resolve;
        }),
    );

    act(() => {
      void result.current.handleGenerateTitle("root-billing");
    });

    expect(result.current.titleGenerationState["root-billing"]).toEqual({ status: "loading" });
    expect(mockMessage.loading).toHaveBeenCalledTimes(1);

    // Let the in-flight call settle (inside act) so it doesn't leak into other tests.
    await act(async () => {
      resolveRegenerate();
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("guards a concurrent duplicate trigger while a regeneration is in flight", async () => {
    let resolveRegenerate: () => void = () => {};
    mockRegenerateSessionTitle.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRegenerate = resolve;
        }),
    );

    const { result } = renderHook(() => useChatSidebarState());

    act(() => {
      void result.current.handleGenerateTitle("root-billing");
    });
    expect(mockRegenerateSessionTitle).toHaveBeenCalledTimes(1);

    // A second trigger on the same session while it's in flight must be a no-op.
    act(() => {
      void result.current.handleGenerateTitle("root-billing");
    });
    expect(mockRegenerateSessionTitle).toHaveBeenCalledTimes(1);

    resolveRegenerate();
    await waitFor(() => {
      expect(result.current.titleGenerationState["root-billing"]?.status).toBe("idle");
    });
  });

  it("shows a success toast and returns to idle once regeneration completes", async () => {
    mockRegenerateSessionTitle.mockResolvedValue(undefined);

    const { result } = renderHook(() => useChatSidebarState());

    await act(async () => {
      await result.current.handleGenerateTitle("root-billing");
    });

    expect(mockMessage.success).toHaveBeenCalledTimes(1);
    expect(mockMessage.error).not.toHaveBeenCalled();
    expect(result.current.titleGenerationState["root-billing"]).toEqual({ status: "idle" });
  });

  it("shows an error toast with the failure reason and keeps error state on the row", async () => {
    mockRegenerateSessionTitle.mockRejectedValue(new Error("backend unreachable"));

    const { result } = renderHook(() => useChatSidebarState());

    await act(async () => {
      await result.current.handleGenerateTitle("root-billing");
    });

    expect(mockMessage.error).toHaveBeenCalledWith("backend unreachable");
    expect(mockMessage.success).not.toHaveBeenCalled();
    expect(result.current.titleGenerationState["root-billing"]).toEqual({
      status: "error",
      error: "backend unreachable",
    });

    // A retry after a failure must not be blocked by the guard (only "loading" blocks).
    mockRegenerateSessionTitle.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.handleGenerateTitle("root-billing");
    });
    expect(mockRegenerateSessionTitle).toHaveBeenCalledTimes(2);
    expect(result.current.titleGenerationState["root-billing"]).toEqual({ status: "idle" });
  });

  it("falls back to a generic error message when the failure has no message", async () => {
    mockRegenerateSessionTitle.mockRejectedValue(new Error());

    const { result } = renderHook(() => useChatSidebarState());

    await act(async () => {
      await result.current.handleGenerateTitle("root-billing");
    });

    expect(mockMessage.error).toHaveBeenCalledWith("Failed to generate title");
  });
});
