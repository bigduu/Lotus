import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SessionWorkspaceShell } from "./SessionWorkspaceShell";

const mockStoreState: any = {
  currentSessionId: "session-1",
  chats: [
    {
      id: "session-1",
      kind: "root",
      title: "Session 1",
      messages: [
        { id: "m1", role: "assistant", createdAt: new Date().toISOString(), content: "hello" },
      ],
      messageCount: 1,
      isRunning: false,
      config: {},
    },
  ],
  loadTaskList: vi.fn().mockResolvedValue(undefined),
  taskLists: {},
  tokenUsages: {},
  truncationOccurred: {},
  segmentsRemoved: {},
};
let mockWorkflowRuns: any = {
  runs: [],
  status: "ready",
  cancellingRunIds: new Set(),
  cancelErrorRunIds: new Set(),
  refresh: vi.fn(),
  cancel: vi.fn(),
};

vi.mock("../../../features/workflows/useWorkflowRuns", () => ({
  useWorkflowRuns: () => mockWorkflowRuns,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, optionsOrDefault?: any, maybeDefault?: string) => {
      if (typeof optionsOrDefault === "string") return optionsOrDefault;
      if (typeof maybeDefault === "string") return maybeDefault;
      return key;
    },
  }),
}));

vi.mock("@shared/hooks/useMediaQuery", () => ({
  useIsMobile: () => false,
}));

vi.mock("@shared/store/experienceModeStore", () => ({
  useExperienceModeStore: (selector: (state: { isAdvanced: boolean }) => unknown) =>
    selector({ isAdvanced: true }),
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
  selectSessionById: (sessionId: string | null) => (state: typeof mockStoreState) =>
    sessionId ? state.chats.find((c: any) => c.id === sessionId) || null : null,
  selectIsBusy: (_sessionId: string | null) => (_state: typeof mockStoreState) => false,
  selectChildren: () => () => ({}),
}));

vi.mock("../conversation/ConversationPane", () => ({
  ConversationPane: () => (
    <div data-testid="conversation-pane">
      <div data-testid="chat-input-area" />
    </div>
  ),
}));

vi.mock("../inspector/SessionInspectorPane", () => ({
  SessionInspectorPane: () => <div data-testid="session-inspector-pane" />,
}));

vi.mock("@shared/components/ResizableSplit", () => ({
  ResizableSplit: ({ first, second }: { first: React.ReactNode; second: React.ReactNode }) => (
    <div data-testid="resizable-split">
      <div data-testid="resizable-split-first">{first}</div>
      <div data-testid="resizable-split-second">{second}</div>
    </div>
  ),
}));

vi.mock("@shared/store/uiLayoutStore", () => ({
  useUILayoutStore: (selector: (state: any) => unknown) =>
    selector({
      inspector: {
        widthPx: 360,
        minWidthPx: 280,
        maxWidthPx: 640,
      },
      setInspectorWidthPx: vi.fn(),
    }),
}));

describe("SessionWorkspaceShell", () => {
  beforeEach(() => {
    mockStoreState.loadTaskList.mockClear();
    mockStoreState.chats = [
      {
        id: "session-1",
        kind: "root",
        title: "Session 1",
        messages: [
          { id: "m1", role: "assistant", createdAt: new Date().toISOString(), content: "hello" },
        ],
        messageCount: 1,
        isRunning: false,
        config: {},
      },
    ];
    mockWorkflowRuns = {
      runs: [],
      status: "ready",
      cancellingRunIds: new Set(),
      cancelErrorRunIds: new Set(),
      refresh: vi.fn(),
      cancel: vi.fn(),
    };
  });

  it("keeps the conversation pane rendered in single-pane rail inspector mode", () => {
    render(
      <div style={{ width: 1200, height: 800 }}>
        <SessionWorkspaceShell
          sessionId="session-1"
          workspaceState={{
            isEmbedded: false,
            isMultiPane: false,
            inspectorMode: "rail",
            inspectorTogglePlacement: "meta-strip",
          }}
        />
      </div>,
    );

    expect(screen.getByTestId("resizable-split")).toBeInTheDocument();
    expect(screen.getByTestId("resizable-split-first")).toContainElement(
      screen.getByTestId("conversation-pane"),
    );
    expect(screen.getByTestId("chat-input-area")).toBeInTheDocument();
    expect(screen.getByTestId("session-inspector-pane")).toBeInTheDocument();
  });

  it("shows inspector when a session has goal config even without messages", () => {
    mockStoreState.chats = [
      {
        id: "session-1",
        kind: "root",
        title: "Session 1",
        messages: [],
        messageCount: 0,
        isRunning: false,
        config: {
          goldConfig: {
            enabled: true,
            evaluation_prompt: "Ship the goal migration",
          },
        },
      },
    ];

    render(
      <div style={{ width: 1200, height: 800 }}>
        <SessionWorkspaceShell
          sessionId="session-1"
          workspaceState={{
            isEmbedded: false,
            isMultiPane: false,
            inspectorMode: "rail",
            inspectorTogglePlacement: "meta-strip",
          }}
        />
      </div>,
    );

    expect(screen.getByTestId("session-inspector-pane")).toBeInTheDocument();
  });

  it("shows inspector when a session has an active Workflow even without messages", () => {
    mockStoreState.chats = [
      {
        id: "session-1",
        kind: "root",
        title: "Session 1",
        messages: [],
        messageCount: 0,
        isRunning: false,
        activeWorkflow: {
          id: "review",
          name: "Review",
          source: "project",
          revision: 12,
          kind: "instruction",
          invokedBy: "user",
          activatedAt: "2026-08-23T08:00:00Z",
          status: "active",
        },
        config: {},
      },
    ];

    render(
      <div style={{ width: 1200, height: 800 }}>
        <SessionWorkspaceShell
          sessionId="session-1"
          workspaceState={{
            isEmbedded: false,
            isMultiPane: false,
            inspectorMode: "rail",
            inspectorTogglePlacement: "meta-strip",
          }}
        />
      </div>,
    );

    expect(screen.getByTestId("session-inspector-pane")).toBeInTheDocument();
  });

  it("shows inspector when Bamboo reports a WorkflowRun even without messages", () => {
    mockStoreState.chats = [
      {
        id: "session-1",
        kind: "root",
        title: "Session 1",
        messages: [],
        messageCount: 0,
        isRunning: false,
        config: {},
      },
    ];
    mockWorkflowRuns = {
      ...mockWorkflowRuns,
      runs: [{ run_id: "run-1" }],
    };

    render(
      <div style={{ width: 1200, height: 800 }}>
        <SessionWorkspaceShell
          sessionId="session-1"
          workspaceState={{
            isEmbedded: false,
            isMultiPane: false,
            inspectorMode: "rail",
            inspectorTogglePlacement: "meta-strip",
          }}
        />
      </div>,
    );

    expect(screen.getByTestId("session-inspector-pane")).toBeInTheDocument();
  });
});
