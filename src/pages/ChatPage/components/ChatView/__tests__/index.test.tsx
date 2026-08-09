import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatView } from "../index";

const { mockStoreState } = vi.hoisted(() => ({
  mockStoreState: {
    currentSessionId: "session-current",
    chats: [
      {
        id: "session-current",
        kind: "root",
        title: "Current session",
        messages: [
          {
            id: "message-1",
            role: "assistant",
            content: "Hello",
            createdAt: "2026-08-09T00:00:00.000Z",
          },
        ],
        config: {},
      },
      {
        id: "session-explicit",
        kind: "root",
        title: "Explicit session",
        messages: [],
        config: {},
      },
    ],
    loadTaskList: vi.fn().mockResolvedValue(undefined),
    taskLists: {},
  },
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
  selectSessionById: (sessionId: string | null) => (state: typeof mockStoreState) =>
    sessionId ? (state.chats.find((chat) => chat.id === sessionId) ?? null) : null,
  selectIsBusy: () => () => false,
  selectChildren: () => () => ({}),
}));

vi.mock("@shared/store/experienceModeStore", () => ({
  useExperienceModeStore: (selector: (state: { isAdvanced: boolean }) => unknown) =>
    selector({ isAdvanced: true }),
}));

vi.mock("@shared/store/uiLayoutStore", () => ({
  useUILayoutStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      inspector: { widthPx: 360, minWidthPx: 280, maxWidthPx: 640 },
      setInspectorWidthPx: vi.fn(),
    }),
}));

vi.mock("@shared/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
}));

vi.mock("../../../conversation/ConversationPane", () => ({
  ConversationPane: ({
    sessionId,
    embedded,
    paneCount,
    workspaceState,
  }: {
    sessionId: string | null;
    embedded: boolean;
    paneCount: number;
    workspaceState: { isMultiPane: boolean; inspectorMode: string };
  }) => (
    <div
      data-testid="conversation-pane"
      data-session-id={sessionId ?? "none"}
      data-embedded={String(embedded)}
      data-pane-count={String(paneCount)}
      data-multi-pane={String(workspaceState.isMultiPane)}
      data-inspector-mode={workspaceState.inspectorMode}
    />
  ),
}));

vi.mock("../../../inspector/SessionInspectorPane", () => ({
  SessionInspectorPane: () => <div data-testid="session-inspector-pane" />,
}));

vi.mock("@shared/components/ResizableSplit", () => ({
  ResizableSplit: ({ first, second }: { first: React.ReactNode; second: React.ReactNode }) => (
    <div data-testid="resizable-split">
      {first}
      {second}
    </div>
  ),
}));

describe("ChatView current workspace contract", () => {
  it("renders an explicit split-pane session through the real workspace shell", () => {
    render(
      <ChatView
        sessionId="session-explicit"
        embedded
        paneCount={2}
        workspaceState={{
          isEmbedded: true,
          leafCount: 2,
          isMultiPane: true,
          isMobileViewport: false,
          inspectorMode: "drawer",
          inspectorTogglePlacement: "pane_header",
        }}
      />,
    );

    const shell = document.querySelector("[data-session-workspace-shell]");
    const conversation = screen.getByTestId("conversation-pane");

    expect(shell).toHaveAttribute("data-multi-pane", "true");
    expect(shell).toHaveAttribute("data-inspector-mode", "drawer");
    expect(shell).toHaveAttribute("data-inspector-toggle-placement", "pane_header");
    expect(conversation).toHaveAttribute("data-session-id", "session-explicit");
    expect(conversation).toHaveAttribute("data-embedded", "true");
    expect(conversation).toHaveAttribute("data-pane-count", "2");
    expect(conversation).toHaveAttribute("data-multi-pane", "true");
  });

  it("falls back to the globally selected session with single-pane defaults", () => {
    render(<ChatView />);

    const conversation = screen.getByTestId("conversation-pane");
    expect(conversation).toHaveAttribute("data-session-id", "session-current");
    expect(conversation).toHaveAttribute("data-embedded", "false");
    expect(conversation).toHaveAttribute("data-pane-count", "1");
    expect(conversation).toHaveAttribute("data-multi-pane", "false");
    expect(conversation).toHaveAttribute("data-inspector-mode", "rail");
    expect(screen.getByTestId("resizable-split")).toBeInTheDocument();
    expect(screen.getByTestId("session-inspector-pane")).toBeInTheDocument();
  });
});
