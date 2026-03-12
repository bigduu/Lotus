import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SubSessionsPanel } from "./SubSessionsPanel";

const PARENT_SESSION_ID = "parent-session-1";
const COLLAPSE_STORAGE_KEY = `chat-session-sub-sessions-collapsed:${PARENT_SESSION_ID}`;

const mockStoreState: any = {
  subSessionsByParent: {},
  chats: [],
  loadChatHistory: vi.fn(),
  pinSession: vi.fn(),
  unpinSession: vi.fn(),
};

vi.mock("../../store", () => ({
  useAppStore: (selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState),
}));

vi.mock("../../utils/openSession", () => ({
  openSession: vi.fn(),
}));

describe("SubSessionsPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    mockStoreState.loadChatHistory.mockReset();
    mockStoreState.pinSession.mockReset();
    mockStoreState.unpinSession.mockReset();
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
    expect(screen.getByTestId("sub-sessions-collapsed-hint")).toBeInTheDocument();
    expect(localStorage.getItem(COLLAPSE_STORAGE_KEY)).toBe("1");

    unmount();

    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.queryByTestId("sub-sessions-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("sub-sessions-toggle")).toHaveTextContent("Expand");
  });

  it("auto-collapses when child sessions exceed threshold and no preference is saved", () => {
    setChildrenCount(4);

    render(<SubSessionsPanel parentSessionId={PARENT_SESSION_ID} />);

    expect(screen.queryByTestId("sub-sessions-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("sub-sessions-toggle")).toHaveTextContent("Expand");
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
});
