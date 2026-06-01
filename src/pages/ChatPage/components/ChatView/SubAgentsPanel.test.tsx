import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearChildPreviewStatesForParent,
  setChildPreviewState,
} from "../../streaming/childPreviewAtoms";
import { SubAgentsPanel } from "./SubAgentsPanel";

const PARENT_SESSION_ID = "parent-session-1";
const COLLAPSE_STORAGE_KEY = `chat-session-sub-agents-collapsed:${PARENT_SESSION_ID}`;

const mockStoreState: any = {
  executionBySession: {},
  chats: [],
  loadChatHistory: vi.fn(),
  refreshChats: vi.fn(),
  markOptimisticStart: vi.fn(),
  markRetryStart: vi.fn(),
  markSettleTimeout: vi.fn(),
  pinSession: vi.fn(),
  unpinSession: vi.fn(),
  deleteSession: vi.fn(),
  applyChildProgress: vi.fn(),
  clearChildProgress: vi.fn(),
};

const { mockAgentClient, mockUseActiveModel, mockToolService } = vi.hoisted(() => ({
  mockAgentClient: {
    truncateSessionMessages: vi.fn(),
    execute: vi.fn(),
  },
  mockToolService: {
    executeTool: vi.fn(),
  },
  mockUseActiveModel: vi.fn<() => string | undefined>(() => "test-model"),
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
  selectChildren: (sessionId: string | null) => (state: typeof mockStoreState) => {
    const entry = state.executionBySession?.[sessionId ?? ""];
    return entry?.children?.byId ?? {};
  },
}));

vi.mock("@shared/utils/openSession", () => ({
  openSession: vi.fn(),
}));

vi.mock("@services/chat/AgentService", () => ({
  agentClient: mockAgentClient,
}));

vi.mock("../../../../services/tool/ToolService", () => ({
  toolService: mockToolService,
}));

vi.mock("../../hooks/useSubagentProfiles", () => ({
  useSubagentProfiles: () => ({ byId: new Map() }),
}));

vi.mock("../../hooks/useActiveModel", () => ({
  useActiveModel: () => mockUseActiveModel(),
}));

describe("SubAgentsPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    clearChildPreviewStatesForParent(PARENT_SESSION_ID);
    mockStoreState.loadChatHistory.mockReset();
    mockStoreState.refreshChats.mockReset();
    mockStoreState.markOptimisticStart.mockReset();
    mockStoreState.markRetryStart.mockReset();
    mockStoreState.markSettleTimeout.mockReset();
    mockStoreState.pinSession.mockReset();
    mockStoreState.unpinSession.mockReset();
    mockStoreState.deleteSession.mockReset();
    mockStoreState.applyChildProgress.mockReset();
    mockStoreState.clearChildProgress.mockReset();
    mockStoreState.deleteSession.mockResolvedValue(undefined);

    mockAgentClient.truncateSessionMessages.mockReset();
    mockAgentClient.execute.mockReset();
    mockAgentClient.truncateSessionMessages.mockResolvedValue({
      success: true,
      session_id: "child-session-1",
      messages_removed: 1,
      message_count: 2,
    });
    mockAgentClient.execute.mockResolvedValue({
      session_id: "child-session-1",
      status: "completed",
      events_url: "/api/v1/events/child-session-1",
    });
    mockToolService.executeTool.mockReset();
    mockToolService.executeTool.mockResolvedValue({
      tool_name: "SubAgent",
      success: true,
      result: JSON.stringify({
        child_session_id: "child-session-1",
        status: "queued",
      }),
      display_preference: "Collapsible",
    });
    mockUseActiveModel.mockReset();
    mockUseActiveModel.mockReturnValue("test-model");

    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "running",
        confidence: "live",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: true,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
        children: {
          byId: {
            "child-session-1": {
              title: "Child Session 1",
              status: "running",
              outputPreview: "Working...",
            },
          },
          runningCount: 1,
        },
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
    };
    mockStoreState.chats = [
      {
        id: "child-session-1",
        kind: "child",
        parentSessionId: PARENT_SESSION_ID,
        title: "Child Session 1",
        updatedAt: "2026-03-12T00:00:00Z",
        pinned: false,
      },
    ];
  });

  const setChildrenCount = (count: number) => {
    const childEntries = Array.from({ length: count }).map((_, i) => {
      const id = `child-session-${i + 1}`;
      return [
        id,
        {
          title: `Child Session ${i + 1}`,
          status: "running",
          outputPreview: "Working...",
        },
      ] as const;
    });

    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "running",
        confidence: "live",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: true,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
        children: {
          byId: Object.fromEntries(childEntries),
          runningCount: count,
        },
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
    };
    mockStoreState.chats = Array.from({ length: count }).map((_, i) => ({
      id: `child-session-${i + 1}`,
      kind: "child",
      parentSessionId: PARENT_SESSION_ID,
      title: `Child Session ${i + 1}`,
      updatedAt: "2026-03-12T00:00:00Z",
      pinned: false,
    }));
  };

  it("renders expanded by default", () => {
    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByTestId("sub-agents-panel")).toBeInTheDocument();
    expect(screen.getByTestId("sub-agents-list")).toBeInTheDocument();
    expect(screen.getByTestId("sub-agents-toggle")).toHaveTextContent("Collapse");
  });

  it("applies max height and vertical scroll to expanded list", () => {
    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByTestId("sub-agents-list")).toHaveStyle({
      maxHeight: "600px",
      overflowY: "auto",
    });
  });

  it("can collapse and restore collapsed state from localStorage", () => {
    const { unmount } = render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    fireEvent.click(screen.getByTestId("sub-agents-toggle"));

    expect(screen.queryByTestId("sub-agents-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("sub-agents-collapsed-hint")).toBeInTheDocument();
    expect(localStorage.getItem(COLLAPSE_STORAGE_KEY)).toBe("1");

    unmount();

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.queryByTestId("sub-agents-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("sub-agents-toggle")).toHaveTextContent("Expand");
  });

  it("auto-collapses when child sessions exceed threshold and no preference is saved", () => {
    setChildrenCount(4);

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.queryByTestId("sub-agents-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("sub-agents-toggle")).toHaveTextContent("Expand");
  });

  it("respects persisted expanded preference even when child sessions exceed threshold", () => {
    setChildrenCount(4);
    localStorage.setItem(COLLAPSE_STORAGE_KEY, "0");

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByTestId("sub-agents-list")).toBeInTheDocument();
    expect(screen.getByTestId("sub-agents-toggle")).toHaveTextContent("Collapse");
  });

  it("prefers live child preview from Jotai over store fallback", () => {
    setChildPreviewState(PARENT_SESSION_ID, "child-session-1", "Live child output");

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByText("Live child output")).toBeInTheDocument();
    expect(screen.queryByText("Working...")).not.toBeInTheDocument();
  });

  it("renders nothing when no child sessions exist", () => {
    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "idle",
        confidence: "optimistic",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: false,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
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
    };
    mockStoreState.chats = [];

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.queryByTestId("sub-agents-panel")).not.toBeInTheDocument();
  });

  it("falls back to running status from persisted child session when progress entry is missing", () => {
    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "running_children",
        confidence: "live",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: true,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
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
    };
    mockStoreState.chats = [
      {
        id: "child-session-running",
        kind: "child",
        parentSessionId: PARENT_SESSION_ID,
        title: "Running Child",
        updatedAt: "2026-03-12T00:00:00Z",
        pinned: false,
        isRunning: true,
        messageCount: 2,
      },
    ];

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    // Status is shown as a Tag with just the status text
    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("renders 'round 1' for roundCount: 0", () => {
    mockStoreState.executionBySession[PARENT_SESSION_ID].children.byId["child-session-1"] = {
      title: "Child Session 1",
      status: "running",
      roundCount: 0,
    };

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByText(/round 1/)).toBeInTheDocument();
  });

  it("renders 'round 2' for roundCount: 1", () => {
    mockStoreState.executionBySession[PARENT_SESSION_ID].children.byId["child-session-1"] = {
      title: "Child Session 1",
      status: "running",
      roundCount: 1,
    };

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByText(/round 2/)).toBeInTheDocument();
  });

  it("omits the round hint when roundCount is undefined", () => {
    mockStoreState.executionBySession[PARENT_SESSION_ID].children.byId["child-session-1"] = {
      title: "Child Session 1",
      status: "running",
    };

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.queryByText(/round \d/)).not.toBeInTheDocument();
  });

  it("falls back to persisted terminal status when progress entry is missing", () => {
    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "completed",
        confidence: "summary",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: false,
          lastRunStatus: "completed",
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
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
    };
    mockStoreState.chats = [
      {
        id: "child-session-completed",
        kind: "child",
        parentSessionId: PARENT_SESSION_ID,
        title: "Completed Child",
        updatedAt: "2026-03-12T00:00:00Z",
        pinned: false,
        isRunning: false,
        messageCount: 10,
        lastRunStatus: "completed",
      },
    ];

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByText("completed")).toBeInTheDocument();
  });

  it("normalizes already_running into running", () => {
    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "running",
        confidence: "live",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: true,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
        children: {
          byId: {
            "child-session-2": {
              title: "Child Session 2",
              status: "already_running",
            },
          },
          runningCount: 1,
        },
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
    };
    mockStoreState.chats = [
      {
        id: "child-session-2",
        kind: "child",
        parentSessionId: PARENT_SESSION_ID,
        title: "Child Session 2",
        updatedAt: "2026-03-12T00:00:00Z",
        pinned: false,
      },
    ];

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByText("running")).toBeInTheDocument();
  });

  it("shows pending instead of unknown when no runtime hints are available", () => {
    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "idle",
        confidence: "optimistic",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: false,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
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
    };
    mockStoreState.chats = [
      {
        id: "child-session-3",
        kind: "child",
        parentSessionId: PARENT_SESSION_ID,
        title: "Child Session 3",
        updatedAt: "2026-03-12T00:00:00Z",
        pinned: false,
        isRunning: false,
        messageCount: 0,
      },
    ];

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("retries existing child session in place through SubAgent", async () => {
    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "running",
        confidence: "live",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: true,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
        children: {
          byId: {
            "child-session-1": {
              title: "Child Session 1",
              status: "pending",
            },
          },
          runningCount: 1,
        },
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
    };
    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    fireEvent.click(screen.getByTestId("sub-agent-retry-child-session-1"));
    await waitFor(() => {
      expect(screen.getByText("Regenerate response")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Regenerate response"));

    await waitFor(() => {
      expect(mockToolService.executeTool).toHaveBeenCalledWith({
        tool_name: "SubAgent",
        session_id: PARENT_SESSION_ID,
        parameters: [
          { name: "action", value: "run" },
          { name: "child_session_id", value: "child-session-1" },
          { name: "reset_to_last_user", value: "true" },
        ],
      });
    });
    expect(mockAgentClient.truncateSessionMessages).not.toHaveBeenCalled();
    expect(mockAgentClient.execute).not.toHaveBeenCalled();
    expect(mockStoreState.loadChatHistory).toHaveBeenCalledWith("child-session-1", {
      mode: "replace",
    });
    expect(mockStoreState.markRetryStart).toHaveBeenCalledWith("child-session-1");
    expect(mockStoreState.refreshChats).toHaveBeenCalled();
  });

  it("retries failed request through SubAgent without resetting to last user", async () => {
    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "running",
        confidence: "live",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: true,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
        children: {
          byId: {
            "child-session-1": {
              title: "Child Session 1",
              status: "error",
            },
          },
          runningCount: 1,
        },
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
    };
    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    fireEvent.click(screen.getByTestId("sub-agent-retry-child-session-1"));
    await waitFor(() => {
      expect(screen.getByText("Retry failed request")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Retry failed request"));

    await waitFor(() => {
      expect(mockToolService.executeTool).toHaveBeenCalledWith({
        tool_name: "SubAgent",
        session_id: PARENT_SESSION_ID,
        parameters: [
          { name: "action", value: "run" },
          { name: "child_session_id", value: "child-session-1" },
          { name: "reset_to_last_user", value: "false" },
        ],
      });
    });
    expect(mockAgentClient.truncateSessionMessages).not.toHaveBeenCalled();
    expect(mockAgentClient.execute).not.toHaveBeenCalled();
  });

  it("sends a follow-up message to an existing child session", async () => {
    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "running",
        confidence: "live",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: true,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
        children: {
          byId: {
            "child-session-1": {
              title: "Child Session 1",
              status: "pending",
            },
          },
          runningCount: 1,
        },
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
    };
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockReturnValue("Continue with the parser failure first.");

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    fireEvent.click(screen.getByTestId("sub-agent-continue-child-session-1"));

    await waitFor(() => {
      expect(mockToolService.executeTool).toHaveBeenCalledWith({
        tool_name: "SubAgent",
        session_id: PARENT_SESSION_ID,
        parameters: [
          { name: "action", value: "send_message" },
          { name: "child_session_id", value: "child-session-1" },
          {
            name: "message",
            value: "Continue with the parser failure first.",
          },
          { name: "auto_run", value: "true" },
        ],
      });
    });

    expect(mockStoreState.markOptimisticStart).toHaveBeenCalledWith("child-session-1");
    expect(mockStoreState.refreshChats).toHaveBeenCalled();

    promptSpy.mockRestore();
  });

  it("deletes existing child session through SubAgent", async () => {
    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    fireEvent.click(screen.getByTestId("sub-agent-delete-child-session-1"));

    await waitFor(() => {
      expect(mockToolService.executeTool).toHaveBeenCalledWith({
        tool_name: "SubAgent",
        session_id: PARENT_SESSION_ID,
        parameters: [
          { name: "action", value: "delete" },
          { name: "child_session_id", value: "child-session-1" },
        ],
      });
    });
    expect(mockStoreState.deleteSession).not.toHaveBeenCalled();
    expect(mockStoreState.clearChildProgress).toHaveBeenCalledWith(
      PARENT_SESSION_ID,
      "child-session-1",
    );
    expect(mockStoreState.refreshChats).toHaveBeenCalled();
  });

  it("prefers persisted child.title over stale progress title", () => {
    // Simulate: progress has a stale generic title, but child.title was
    // persisted to the backend (e.g. via persistSessionTitle).
    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "running",
        confidence: "live",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: true,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
        children: {
          byId: {
            "child-session-1": {
              title: "Stale Progress Title",
              status: "completed",
            },
          },
          runningCount: 1,
        },
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
    };
    mockStoreState.chats = [
      {
        id: "child-session-1",
        kind: "child",
        parentSessionId: PARENT_SESSION_ID,
        title: "Persisted Real Title",
        updatedAt: "2026-03-12T00:00:00Z",
        pinned: false,
      },
    ];

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    // The persisted title should be displayed, not the stale progress title.
    expect(screen.getByText("Persisted Real Title")).toBeInTheDocument();
    expect(screen.queryByText("Stale Progress Title")).not.toBeInTheDocument();
  });

  it("falls back to progress title when child.title is missing", () => {
    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "running",
        confidence: "live",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: true,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
        children: {
          byId: {
            "child-session-1": {
              title: "Progress Title",
              status: "running",
            },
          },
          runningCount: 1,
        },
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
    };
    // child session has no persisted title (empty string / undefined).
    mockStoreState.chats = [
      {
        id: "child-session-1",
        kind: "child",
        parentSessionId: PARENT_SESSION_ID,
        title: "",
        updatedAt: "2026-03-12T00:00:00Z",
        pinned: false,
      },
    ];

    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    // Falls back to progress title when persisted title is empty.
    expect(screen.getByText("Progress Title")).toBeInTheDocument();
  });

  it("retries child session through SubAgent even when no active provider model is configured", async () => {
    mockStoreState.executionBySession = {
      [PARENT_SESSION_ID]: {
        sessionId: PARENT_SESSION_ID,
        phase: "running",
        confidence: "live",
        activeReasons: [],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: true,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: null,
          runningChildCount: null,
        },
        interaction: { pendingQuestion: null, respondMode: null, pendingApproval: null },
        children: {
          byId: {
            "child-session-1": {
              title: "Child Session 1",
              status: "pending",
            },
          },
          runningCount: 1,
        },
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
    };
    mockUseActiveModel.mockReturnValue(undefined);
    render(<SubAgentsPanel parentSessionId={PARENT_SESSION_ID} />);

    fireEvent.click(screen.getByTestId("sub-agent-retry-child-session-1"));
    await waitFor(() => {
      expect(screen.getByText("Regenerate response")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Regenerate response"));

    await waitFor(() => {
      expect(mockToolService.executeTool).toHaveBeenCalledWith({
        tool_name: "SubAgent",
        session_id: PARENT_SESSION_ID,
        parameters: [
          { name: "action", value: "run" },
          { name: "child_session_id", value: "child-session-1" },
          { name: "reset_to_last_user", value: "true" },
        ],
      });
    });
    expect(mockAgentClient.truncateSessionMessages).not.toHaveBeenCalled();
    expect(mockAgentClient.execute).not.toHaveBeenCalled();
  });
});
