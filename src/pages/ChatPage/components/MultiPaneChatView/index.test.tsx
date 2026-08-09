import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatItem } from "@shared/types/chat";
import { useAppStore } from "@shared/store/appStore";
import { getLeafIdsFromTree, useUILayoutStore } from "@shared/store/uiLayoutStore";
import { CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT } from "../ChatView/events";
import { MultiPaneChatView } from "./index";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { index?: number }) =>
      ({
        "chat.multiPane.selectSessionHint": "Select a session",
        "chat.multiPane.splitHorizontal": "Split horizontally",
        "chat.multiPane.splitVertical": "Split vertically",
        "chat.multiPane.selectMessagesToExport": "Select messages to export",
        "chat.multiPane.closePane": "Close pane",
        "chat.workspace.openInspector": "Open inspector",
      })[key] ?? (key === "chat.multiPane.paneLabel" ? `Pane ${String(options?.index)}` : key),
  }),
}));

vi.mock("@shared/hooks/useMediaQuery", () => ({
  useMediaQuery: () => false,
}));

vi.mock("@shared/hooks/useSessionCreateRecovery", () => ({
  useSessionCreateRecovery: () => vi.fn(),
}));

vi.mock("@shared/components/ResizableSplit", () => ({
  ResizableSplit: ({ first, second }: { first: React.ReactNode; second: React.ReactNode }) => (
    <div data-testid="multi-pane-split">
      <div>{first}</div>
      <div>{second}</div>
    </div>
  ),
}));

vi.mock("../ChatView", () => ({
  ChatView: ({
    sessionId,
    embedded,
    paneCount,
    workspaceState,
  }: {
    sessionId: string;
    embedded: boolean;
    paneCount: number;
    workspaceState: { isMultiPane: boolean; inspectorTogglePlacement: string };
  }) => (
    <div
      data-testid={`pane-chat-${sessionId}`}
      data-embedded={String(embedded)}
      data-pane-count={String(paneCount)}
      data-multi-pane={String(workspaceState.isMultiPane)}
      data-inspector-placement={workspaceState.inspectorTogglePlacement}
    />
  ),
}));

vi.mock("../HomeDashboard", () => ({
  HomeDashboard: () => <div data-testid="pane-home-dashboard" />,
}));

const SESSION: ChatItem = {
  id: "session-1",
  kind: "root",
  title: "Coverage work",
  createdAt: Date.parse("2026-08-09T00:00:00.000Z"),
  messages: [],
  config: {
    systemPromptId: "general_assistant",
    baseSystemPrompt: "You are helpful.",
    lastUsedEnhancedPrompt: null,
  },
};

const mockSelectSession = vi.fn();

function resetSinglePane(sessionId: string | null = SESSION.id) {
  useUILayoutStore.setState({
    tree: { type: "leaf", id: "pane-a" },
    activeLeafId: "pane-a",
    leafSessionIds: { "pane-a": sessionId },
    splitSizesPx: {},
  });
  useAppStore.setState((state) => ({
    ...state,
    chats: [SESSION],
    currentSessionId: sessionId,
    selectSession: mockSelectSession,
    systemPrompts: [],
    lastSelectedPromptId: "general_assistant",
  }));
}

const renderView = () =>
  render(
    <AntdApp>
      <MultiPaneChatView />
    </AntdApp>,
  );

describe("MultiPaneChatView", () => {
  beforeEach(() => {
    localStorage.clear();
    mockSelectSession.mockReset();
    resetSinglePane();
  });

  it("renders the bound session and dispatches batch-export selection for that pane", () => {
    const onBatchExport = vi.fn();
    window.addEventListener(CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT, onBatchExport);
    renderView();

    expect(screen.getByText("Coverage work")).toBeInTheDocument();
    const chat = screen.getByTestId("pane-chat-session-1");
    expect(chat).toHaveAttribute("data-embedded", "true");
    expect(chat).toHaveAttribute("data-pane-count", "1");
    expect(chat).toHaveAttribute("data-multi-pane", "false");
    expect(chat).toHaveAttribute("data-inspector-placement", "meta_strip");

    fireEvent.click(screen.getByRole("button", { name: "Select messages to export" }));
    expect(onBatchExport).toHaveBeenCalledTimes(1);
    expect((onBatchExport.mock.calls[0][0] as CustomEvent).detail).toEqual({
      sessionId: "session-1",
    });

    window.removeEventListener(CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT, onBatchExport);
  });

  it("splits the active leaf and gives the new pane a session picker", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Split horizontally" }));

    await waitFor(() => {
      expect(getLeafIdsFromTree(useUILayoutStore.getState().tree)).toHaveLength(2);
      expect(screen.getByTestId("multi-pane-split")).toBeInTheDocument();
      expect(screen.getByTestId("pane-chat-session-1")).toHaveAttribute("data-pane-count", "2");
      expect(screen.getByTestId("pane-chat-session-1")).toHaveAttribute(
        "data-inspector-placement",
        "pane_header",
      );
      expect(screen.getByTestId("pane-home-dashboard")).toBeInTheDocument();
    });

    const nextState = useUILayoutStore.getState();
    expect(nextState.leafSessionIds[nextState.activeLeafId]).toBeNull();
  });

  it("clears the session binding instead of removing the final pane", async () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: "Close pane" }));

    await waitFor(() => {
      expect(useUILayoutStore.getState().tree).toEqual({ type: "leaf", id: "pane-a" });
      expect(useUILayoutStore.getState().leafSessionIds).toEqual({ "pane-a": null });
      expect(mockSelectSession).toHaveBeenCalledWith(null);
      expect(screen.getByTestId("pane-home-dashboard")).toBeInTheDocument();
    });
  });
});
