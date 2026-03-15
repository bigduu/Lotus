import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubSessionsPanel } from "./SubSessionsPanel";

const PARENT_SESSION_ID = "parent-session-1";
const COLLAPSE_STORAGE_KEY = `chat-session-sub-sessions-collapsed:${PARENT_SESSION_ID}`;

const mockStoreState: any = {
  subSessionsByParent: {},
  chats: [],
  loadChatHistory: vi.fn(),
  refreshChats: vi.fn(),
  setSessionProcessing: vi.fn(),
  pinSession: vi.fn(),
  unpinSession: vi.fn(),
  deleteSession: vi.fn(),
  upsertSubSessionProgress: vi.fn(),
  clearSubSessionProgress: vi.fn(),
};

const { mockAgentClient, mockUseActiveModel } = vi.hoisted(() => ({
  mockAgentClient: {
    truncateSessionMessages: vi.fn(),
    execute: vi.fn(),
  },
  mockUseActiveModel: vi.fn<() => string | undefined>(() => "test-model"),
}));

vi.mock("../../store", () => ({
  useAppStore: (selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
}));

vi.mock("../../utils/openSession", () => ({
  openSession: vi.fn(),
}));

vi.mock("../../services/AgentService", () => ({
  agentClient: mockAgentClient,
}));

vi.mock("../../hooks/useActiveModel", () => ({
  useActiveModel: () => mockUseActiveModel(),
}));

describe("SubSessionsPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStoreState.loadChatHistory.mockReset();
    mockStoreState.refreshChats.mockReset();
    mockStoreState.setSessionProcessing.mockReset();
    mockStoreState.pinSession.mockReset();
    mockStoreState.unpinSession.mockReset();
    mockStoreState.deleteSession.mockReset();
    mockStoreState.upsertSubSessionProgress.mockReset();
    mockStoreState.clearSubSessionProgress.mockReset();
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
    mockUseActiveModel.mockReset();
    mockUseActiveModel.mockReturnValue("test-model");

    mockStoreState.subSessionsByParent = {
      [PARENT_SESSION_ID]: {
        "child-session-1": {
          title: "Child Session 1",
          status: "running",
          outputPreview: "Working...",
        },
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
    const progressEntries = Array.from({ length: count }).map((_, i) => {
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

    mockStoreState.subSessionsByParent = {
      [PARENT_SESSION_ID]: Object.fromEntries(progressEntries),
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
    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByTestId("sub-sessions-panel")).toBeInTheDocument();
    expect(screen.getByTestId("sub-sessions-list")).toBeInTheDocument();
    expect(screen.getByTestId("sub-sessions-toggle")).toHaveTextContent(
      "Collapse",
    );
  });

  it("applies max height and vertical scroll to expanded list", () => {
    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByTestId("sub-sessions-list")).toHaveStyle({
      maxHeight: "420px",
      overflowY: "auto",
    });
  });

  it("can collapse and restore collapsed state from localStorage", () => {
    const { unmount } = render(
      <SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />,
    );

    fireEvent.click(screen.getByTestId("sub-sessions-toggle"));

    expect(screen.queryByTestId("sub-sessions-list")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("sub-sessions-collapsed-hint"),
    ).toBeInTheDocument();
    expect(localStorage.getItem(COLLAPSE_STORAGE_KEY)).toBe("1");

    unmount();

    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.queryByTestId("sub-sessions-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("sub-sessions-toggle")).toHaveTextContent(
      "Expand",
    );
  });

  it("auto-collapses when child sessions exceed threshold and no preference is saved", () => {
    setChildrenCount(4);

    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.queryByTestId("sub-sessions-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("sub-sessions-toggle")).toHaveTextContent(
      "Expand",
    );
  });

  it("respects persisted expanded preference even when child sessions exceed threshold", () => {
    setChildrenCount(4);
    localStorage.setItem(COLLAPSE_STORAGE_KEY, "0");

    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByTestId("sub-sessions-list")).toBeInTheDocument();
    expect(screen.getByTestId("sub-sessions-toggle")).toHaveTextContent(
      "Collapse",
    );
  });

  it("renders nothing when no child sessions exist", () => {
    mockStoreState.subSessionsByParent = {};
    mockStoreState.chats = [];

    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.queryByTestId("sub-sessions-panel")).not.toBeInTheDocument();
  });

  it("falls back to running status from persisted child session when progress entry is missing", () => {
    mockStoreState.subSessionsByParent = {};
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

    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByText(/Status:\s*running/i)).toBeInTheDocument();
  });

  it("falls back to persisted terminal status when progress entry is missing", () => {
    mockStoreState.subSessionsByParent = {};
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

    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByText(/Status:\s*completed/i)).toBeInTheDocument();
  });

  it("normalizes already_running into running", () => {
    mockStoreState.subSessionsByParent = {
      [PARENT_SESSION_ID]: {
        "child-session-2": {
          title: "Child Session 2",
          status: "already_running",
        },
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

    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByText(/Status:\s*running/i)).toBeInTheDocument();
  });

  it("shows pending instead of unknown when no runtime hints are available", () => {
    mockStoreState.subSessionsByParent = {};
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

    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.getByText(/Status:\s*pending/i)).toBeInTheDocument();
  });

  it("retries existing child session in place", async () => {
    mockStoreState.subSessionsByParent = {
      [PARENT_SESSION_ID]: {
        "child-session-1": {
          title: "Child Session 1",
          status: "pending",
        },
      },
    };
    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    fireEvent.click(screen.getByTestId("sub-session-retry-child-session-1"));

    await waitFor(() => {
      expect(mockAgentClient.truncateSessionMessages).toHaveBeenCalledWith(
        "child-session-1",
        { mode: "after_last_user" },
      );
    });
    expect(mockAgentClient.execute).toHaveBeenCalledWith(
      "child-session-1",
      "test-model",
    );
    expect(mockStoreState.setSessionProcessing).toHaveBeenCalledWith(
      "child-session-1",
      true,
    );
    expect(mockStoreState.setSessionProcessing).toHaveBeenCalledWith(
      "child-session-1",
      false,
    );
  });

  it("deletes existing child session", async () => {
    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    fireEvent.click(screen.getByTestId("sub-session-delete-child-session-1"));

    await waitFor(() => {
      expect(mockStoreState.deleteSession).toHaveBeenCalledWith(
        "child-session-1",
      );
    });
    expect(mockStoreState.clearSubSessionProgress).toHaveBeenCalledWith(
      PARENT_SESSION_ID,
      "child-session-1",
    );
  });

  it("marks retry as error when no active model is configured", async () => {
    mockStoreState.subSessionsByParent = {
      [PARENT_SESSION_ID]: {
        "child-session-1": {
          title: "Child Session 1",
          status: "pending",
        },
      },
    };
    mockUseActiveModel.mockReturnValue(undefined);
    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    fireEvent.click(screen.getByTestId("sub-session-retry-child-session-1"));

    await waitFor(() => {
      expect(mockStoreState.upsertSubSessionProgress).toHaveBeenCalledWith(
        PARENT_SESSION_ID,
        "child-session-1",
        expect.objectContaining({
          status: "error",
        }),
      );
    });
    expect(mockAgentClient.truncateSessionMessages).not.toHaveBeenCalled();
    expect(mockAgentClient.execute).not.toHaveBeenCalled();
  });
});
