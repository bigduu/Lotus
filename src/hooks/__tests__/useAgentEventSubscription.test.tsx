import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAgentEventSubscription } from "../useAgentEventSubscription";
import { AgentClient } from "../../services/chat/AgentService";
import { streamingMessageBus } from "../../pages/ChatPage/utils/streamingMessageBus";
import {
  clearAssistantStreamingState,
  getAssistantStreamingState,
} from "../../pages/ChatPage/streaming/assistantStreamingAtoms";
import {
  clearChildPreviewStatesForParent,
  getChildPreviewState,
} from "../../pages/ChatPage/streaming/childPreviewAtoms";
import {
  clearToolStreamingState,
  getToolStreamingState,
} from "../../pages/ChatPage/streaming/toolStreamingAtoms";

const { mockAntdMessage } = vi.hoisted(() => ({
  mockAntdMessage: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    loading: vi.fn(),
    open: vi.fn(),
    destroy: vi.fn(),
  },
}));

vi.mock("antd", () => ({
  App: {
    useApp: () => ({ message: mockAntdMessage }),
  },
}));

// Type for mock selectors
type MockSelector = (state: any) => any;

// Mock dependencies - all variables must be inside the factory function
vi.mock("../../pages/ChatPage/store", () => {
  const mockStore = Object.assign(vi.fn(), {
    getState: vi.fn(),
    subscribe: vi.fn(() => vi.fn()),
    setState: vi.fn(),
    destroy: vi.fn(),
  });
  const selectShouldObserve = (sessionId: string | null) => (state: any) => {
    const entry = state.executionBySession?.[sessionId!];
    if (!entry) {
      return false;
    }
    const phase = entry.phase;
    if (phase === "idle" || phase === "completed" || phase === "error" || phase === "cancelled") {
      return false;
    }
    return phase !== "waiting_user_answer";
  };
  const selectGeneration = (sessionId: string | null) => (state: any) => {
    return state.executionBySession?.[sessionId!]?.generation ?? 0;
  };
  const selectChildren = (sessionId: string | null) => (state: any) => {
    return state.executionBySession?.[sessionId!]?.children?.byId ?? {};
  };
  return { useAppStore: mockStore, selectShouldObserve, selectGeneration, selectChildren };
});

vi.mock("../../pages/ChatPage/store/slices/executionStateSlice", () => ({
  isBusyPhase: (phase: string | undefined) =>
    phase !== undefined &&
    phase !== "idle" &&
    phase !== "completed" &&
    phase !== "error" &&
    phase !== "cancelled",
}));

vi.mock("../../services/chat/AgentService", () => {
  // SSE subscriptions are long-lived; default to a never-resolving promise so the hook
  // doesn't interpret the stream as "ended" and attempt to reconnect in tests.
  const mockSubscribeToEvents = vi.fn().mockImplementation(() => new Promise<void>(() => {}));
  return {
    AgentClient: class MockAgentClient {
      subscribeToEvents = mockSubscribeToEvents;
    },
  };
});

const createBusyExecutionEntry = (overrides: Partial<any> = {}) => ({
  sessionId: "session-1",
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
  ...overrides,
});

// Mock state factory
const createMockState = (overrides: Partial<any> = {}) => ({
  chats: [
    {
      id: "session-1",
      messages: [],
    },
  ],
  executionBySession: {},
  addMessage: vi.fn(),
  applyAgentEvent: vi.fn(),
  markStreamStarted: vi.fn(),
  updateTokenUsage: vi.fn(),
  setTruncationInfo: vi.fn(),
  updateSession: vi.fn(),
  updateMessage: vi.fn(),
  setTaskList: vi.fn(),
  loadTaskList: vi.fn(),
  updateTaskListDelta: vi.fn(),
  setEvaluationState: vi.fn(),
  clearEvaluationState: vi.fn(),
  applyChildProgress: vi.fn(),
  clearChildProgress: vi.fn(),
  persistSessionTitle: vi.fn().mockResolvedValue(undefined),
  refreshChats: vi.fn().mockResolvedValue(undefined),
  refreshChatsNow: vi.fn().mockResolvedValue(undefined),
  loadChatHistory: vi.fn(),
  setPendingQuestion: vi.fn(),
  clearPendingQuestion: vi.fn(),
  applyServerTitle: vi.fn(),
  applyServerPinned: vi.fn(),
  ...overrides,
});

describe("useAgentEventSubscription", () => {
  let mockSubscribeToEvents: ReturnType<typeof vi.fn>;
  let mockAddMessage: ReturnType<typeof vi.fn>;
  let mockState: any;
  let mockStore: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    Object.values(mockAntdMessage).forEach((mockFn) => mockFn.mockReset());

    streamingMessageBus.clear("session-1", "streaming-session-1");
    streamingMessageBus.clear("session-1", "streaming-reasoning-session-1");
    streamingMessageBus.clear("session-1", "streaming-status-session-1");
    clearAssistantStreamingState("session-1");
    clearChildPreviewStatesForParent("session-1");
    clearToolStreamingState("session-1", "call_1");
    clearToolStreamingState("session-1", "call-1");
    clearToolStreamingState("session-1", "c1");

    mockAddMessage = vi.fn();

    mockState = createMockState({
      addMessage: mockAddMessage,
    });

    // Import the mocked modules to get the mocks
    const storeModule = await import("../../pages/ChatPage/store");
    mockStore = storeModule.useAppStore;

    // Set up mock implementations
    mockStore.mockImplementation((selector: MockSelector) => selector(mockState));
    mockStore.getState.mockReturnValue(mockState);

    // Get the subscribeToEvents mock from the AgentClient instance
    const client = new AgentClient();
    mockSubscribeToEvents = client.subscribeToEvents as ReturnType<typeof vi.fn>;
    mockSubscribeToEvents.mockImplementation(() => new Promise<void>(() => {}));
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("should not subscribe when no sessions are busy", () => {
    renderHook(() => useAgentEventSubscription());

    expect(mockSubscribeToEvents).not.toHaveBeenCalled();
  });

  it("should subscribe when chat is processing and session exists", async () => {
    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);
    mockSubscribeToEvents.mockImplementation(() => new Promise<void>(() => {}));

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({
          onToken: expect.any(Function),
          onComplete: expect.any(Function),
          onError: expect.any(Function),
        }),
        expect.any(AbortController),
      );
    });
  });

  it("should unsubscribe when session becomes idle", async () => {
    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);
    mockSubscribeToEvents.mockResolvedValue(undefined);

    const { rerender } = renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    // Change back to idle
    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);
    rerender();

    // Should abort the subscription
    // (Hard to test directly without access to abort controller)
  });

  it("should handle subscription errors and reset state", async () => {
    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      mockState.executionBySession = {
        "session-1": {
          sessionId: "session-1",
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
      mockStore.getState.mockReturnValue(mockState);
    });
    mockStore.getState.mockReturnValue(mockState);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockSubscribeToEvents.mockRejectedValue(new Error("Connection failed"));

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith(
        "[useAgentEventSubscription] Subscription error:",
        expect.any(Error),
      );

      // Should emit error event to execution state
      expect(mockState.applyAgentEvent).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({ type: "error" }),
        expect.any(Number),
      );
    });

    consoleSpy.mockRestore();
  });

  it("shows task-list completion toast only once for replayed completion events", async () => {
    let taskCompletedHandler:
      | ((
          sessionId: string,
          totalRounds: number,
          totalToolCalls: number,
          completedAt?: string,
        ) => void)
      | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      taskCompletedHandler = handlers.onTaskListCompleted;
    });

    mockState.executionBySession = {
      "session-1": createBusyExecutionEntry(),
    };
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      taskCompletedHandler?.("session-1", 3, 8, "2026-05-07T07:00:00.000Z");
      taskCompletedHandler?.("session-1", 3, 8, "2026-05-07T07:00:00.000Z");
    });

    expect(mockAntdMessage.success).toHaveBeenCalledTimes(1);
    expect(mockAntdMessage.success).toHaveBeenCalledWith(
      "All tasks completed! Total rounds: 3, Tool calls: 8",
      3,
    );
  });

  it("maps token budget updates with thinking and cache metrics into store state", async () => {
    let tokenBudgetUpdatedHandler: ((usage: any) => void) | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      tokenBudgetUpdatedHandler = handlers.onTokenBudgetUpdated;
    });

    mockState.executionBySession = {
      "session-1": createBusyExecutionEntry(),
    };
    mockState.chats = [
      {
        id: "session-1",
        messages: [],
        config: {
          systemPromptId: "general_assistant",
          baseSystemPrompt: "Base prompt",
          lastUsedEnhancedPrompt: null,
        },
      },
    ];
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      tokenBudgetUpdatedHandler?.({
        system_tokens: 100,
        summary_tokens: 50,
        window_tokens: 600,
        total_tokens: 750,
        max_context_tokens: 1000,
        budget_limit: 800,
        truncation_occurred: true,
        segments_removed: 2,
        prompt_cached_tool_outputs: 3,
        prompt_cached_tool_tokens_saved: 400,
        thinking_tokens: 120,
        cache_read_input_tokens: 90,
      });
    });

    expect(mockState.updateTokenUsage).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        systemTokens: 100,
        summaryTokens: 50,
        windowTokens: 600,
        totalTokens: 750,
        maxContextTokens: 1000,
        budgetLimit: 800,
        promptCachedToolOutputs: 3,
        promptCachedToolTokensSaved: 400,
        thinkingTokens: 120,
        cacheReadInputTokens: 90,
      }),
    );
    expect(mockState.setTruncationInfo).toHaveBeenCalledWith("session-1", true, 2);
    expect(mockState.updateSession).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        config: expect.objectContaining({
          tokenUsage: expect.objectContaining({
            promptCachedToolTokensSaved: 400,
            thinkingTokens: 120,
            cacheReadInputTokens: 90,
          }),
          truncationOccurred: true,
          segmentsRemoved: 2,
        }),
      }),
    );
  });

  it("suppresses task-list completion toast while waiting for QuestionDialog response", async () => {
    let taskCompletedHandler:
      | ((
          sessionId: string,
          totalRounds: number,
          totalToolCalls: number,
          completedAt?: string,
        ) => void)
      | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      taskCompletedHandler = handlers.onTaskListCompleted;
    });

    mockState.executionBySession = {
      "session-1": createBusyExecutionEntry({
        phase: "waiting_user_answer",
        interaction: {
          pendingQuestion: {
            question: "Continue?",
            options: ["Yes", "No"],
            allowCustom: true,
            toolCallId: "ask-1",
            receivedAt: "2026-05-07T07:00:00.000Z",
          },
          respondMode: {
            sessionId: "session-1",
            question: "Continue?",
            options: ["Yes", "No"],
            allowCustom: true,
            toolCallId: "ask-1",
          },
          pendingApproval: null,
        },
      }),
    };
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    expect(mockSubscribeToEvents).not.toHaveBeenCalled();

    act(() => {
      taskCompletedHandler?.("session-1", 3, 8, "2026-05-07T07:00:00.000Z");
    });

    expect(mockAntdMessage.success).not.toHaveBeenCalled();
  });

  it("recovers missing task list baseline before applying task progress deltas", async () => {
    let taskProgressHandler: ((delta: any) => void) | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      taskProgressHandler = handlers.onTaskListItemProgress;
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockState.taskLists = {};
    mockState.loadTaskList = vi.fn().mockResolvedValue({
      session_id: "session-1",
      title: "Recovered Task List",
      items: [],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    await act(async () => {
      taskProgressHandler?.({
        session_id: "session-1",
        item_id: "task-1",
        status: "in_progress",
        tool_calls_count: 1,
        version: 2,
      });
    });

    await waitFor(() => {
      expect(mockState.loadTaskList).toHaveBeenCalledWith("session-1");
    });
    expect(mockState.updateTaskListDelta).not.toHaveBeenCalled();
  });

  it("uses high-priority refresh when a child session starts", async () => {
    let subAgentStartedHandler:
      | ((parentSessionId: string, childSessionId: string, title?: string) => void)
      | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      subAgentStartedHandler = handlers.onSubAgentStarted;
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockState.refreshChatsNow = vi.fn().mockResolvedValue(undefined);
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      subAgentStartedHandler?.("session-1", "child-1", "Child task");
    });

    await waitFor(() => {
      expect(mockState.refreshChatsNow).toHaveBeenCalledTimes(1);
      expect(mockState.applyChildProgress).toHaveBeenCalledWith(
        "session-1",
        "child-1",
        expect.objectContaining({ title: "Child task", status: "pending" }),
      );
    });
  });

  it("marks child running and writes roundCount on nested runner_progress", async () => {
    let subAgentEventHandler:
      | ((parentSessionId: string, childSessionId: string, evt: any) => void)
      | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      subAgentEventHandler = handlers.onSubAgentEvent;
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
        children: { byId: { "child-1": { status: "pending" } }, runningCount: 0 },
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      subAgentEventHandler?.("session-1", "child-1", {
        type: "runner_progress",
        session_id: "child-1",
        round_count: 0,
      });
    });

    expect(mockState.applyChildProgress).toHaveBeenCalledWith(
      "session-1",
      "child-1",
      expect.objectContaining({ status: "running", roundCount: 0 }),
    );
    const lastCall = mockState.applyChildProgress.mock.calls.at(-1);
    expect(typeof lastCall?.[2]?.lastEventAt).toBe("string");
  });

  it("deduplicates nested runner_progress when roundCount does not change", async () => {
    let subAgentEventHandler:
      | ((parentSessionId: string, childSessionId: string, evt: any) => void)
      | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      subAgentEventHandler = handlers.onSubAgentEvent;
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
        children: { byId: { "child-1": { status: "running", roundCount: 0 } }, runningCount: 1 },
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      subAgentEventHandler?.("session-1", "child-1", {
        type: "runner_progress",
        session_id: "child-1",
        round_count: 0,
      });
      subAgentEventHandler?.("session-1", "child-1", {
        type: "runner_progress",
        session_id: "child-1",
        round_count: 0,
      });
    });

    expect(mockState.applyChildProgress).toHaveBeenCalledTimes(1);
  });

  it("throttles nested sub-agent heartbeat updates", async () => {
    let subAgentHeartbeatHandler:
      | ((parentSessionId: string, childSessionId: string, ts: string) => void)
      | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      subAgentHeartbeatHandler = handlers.onSubAgentHeartbeat;
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
        children: { byId: { "child-1": { status: "running" } }, runningCount: 1 },
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      subAgentHeartbeatHandler?.("session-1", "child-1", "2026-05-12T00:00:00.000Z");
      subAgentHeartbeatHandler?.("session-1", "child-1", "2026-05-12T00:00:00.500Z");
      subAgentHeartbeatHandler?.("session-1", "child-1", "2026-05-12T00:00:01.000Z");
    });

    expect(mockState.applyChildProgress).toHaveBeenCalledTimes(1);
  });

  it("flushes buffered child token preview before child completion", async () => {
    let subAgentEventHandler:
      | ((parentSessionId: string, childSessionId: string, evt: any) => void)
      | undefined;
    let subAgentCompletedHandler:
      | ((parentSessionId: string, childSessionId: string, status: string, error?: string) => void)
      | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      subAgentEventHandler = handlers.onSubAgentEvent;
      subAgentCompletedHandler = handlers.onSubAgentCompleted;
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
          byId: { "child-1": { status: "running", outputPreview: "" } },
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      subAgentEventHandler?.("session-1", "child-1", {
        type: "token",
        content: "hello ",
      });
      subAgentEventHandler?.("session-1", "child-1", {
        type: "token",
        content: "world",
      });
      expect(getChildPreviewState("session-1", "child-1").outputPreview).toBe("hello world");
      subAgentCompletedHandler?.("session-1", "child-1", "completed");
    });

    expect(mockState.applyChildProgress).toHaveBeenCalledWith(
      "session-1",
      "child-1",
      expect.objectContaining({ outputPreview: "hello world", status: "running" }),
    );
    expect(getChildPreviewState("session-1", "child-1").outputPreview).toBe("");
    expect(mockState.applyChildProgress).toHaveBeenCalledWith(
      "session-1",
      "child-1",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("ignores nested runner_progress when child is in a terminal state", async () => {
    let subAgentEventHandler:
      | ((parentSessionId: string, childSessionId: string, evt: any) => void)
      | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      subAgentEventHandler = handlers.onSubAgentEvent;
    });

    for (const terminal of ["completed", "error", "cancelled", "failed"]) {
      mockState.applyChildProgress.mockClear();
      mockState.executionBySession = {
        "session-1": {
          sessionId: "session-1",
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
          children: { byId: { "child-1": { status: terminal } }, runningCount: 0 },
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
      mockStore.getState.mockReturnValue(mockState);

      const { unmount } = renderHook(() => useAgentEventSubscription());

      await waitFor(() => {
        expect(mockSubscribeToEvents).toHaveBeenCalled();
      });

      act(() => {
        subAgentEventHandler?.("session-1", "child-1", {
          type: "runner_progress",
          session_id: "child-1",
          round_count: 1,
        });
      });

      expect(mockState.applyChildProgress).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("ignores nested token events when child is in a terminal state", async () => {
    let subAgentEventHandler:
      | ((parentSessionId: string, childSessionId: string, evt: any) => void)
      | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      subAgentEventHandler = handlers.onSubAgentEvent;
    });

    for (const terminal of ["completed", "error", "cancelled", "failed"]) {
      mockState.applyChildProgress.mockClear();
      mockState.executionBySession = {
        "session-1": {
          sessionId: "session-1",
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
          children: { byId: { "child-1": { status: terminal } }, runningCount: 0 },
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
      mockStore.getState.mockReturnValue(mockState);

      const { unmount } = renderHook(() => useAgentEventSubscription());

      await waitFor(() => {
        expect(mockSubscribeToEvents).toHaveBeenCalled();
      });

      act(() => {
        subAgentEventHandler?.("session-1", "child-1", {
          type: "token",
          content: "late tail event",
        });
      });

      expect(mockState.applyChildProgress).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("preserves existing roundCount when runner_progress is missing round_count", async () => {
    let subAgentEventHandler:
      | ((parentSessionId: string, childSessionId: string, evt: any) => void)
      | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      subAgentEventHandler = handlers.onSubAgentEvent;
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
          byId: { "child-1": { status: "running", roundCount: 3 } },
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      subAgentEventHandler?.("session-1", "child-1", {
        type: "runner_progress",
        session_id: "child-1",
      });
    });

    expect(mockState.applyChildProgress).toHaveBeenCalledWith(
      "session-1",
      "child-1",
      expect.objectContaining({ status: "running", roundCount: 3 }),
    );
  });

  it("waits for settle check before clearing processing after the last child completes", async () => {
    let completeHandler: (() => void) | undefined;
    let subAgentStartedHandler:
      | ((parentSessionId: string, childSessionId: string, title?: string) => void)
      | undefined;
    let subAgentCompletedHandler:
      | ((parentSessionId: string, childSessionId: string, status: string, error?: string) => void)
      | undefined;

    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      completeHandler = handlers.onComplete;
      subAgentStartedHandler = handlers.onSubAgentStarted;
      subAgentCompletedHandler = handlers.onSubAgentCompleted;
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      mockState.chats = [{ id: "session-1", messages: [], isRunning: false }];
      mockState.executionBySession = {
        "session-1": {
          sessionId: "session-1",
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
      mockStore.getState.mockReturnValue(mockState);
    });
    mockState.loadChatHistory = vi.fn().mockResolvedValue(undefined);
    mockState.chats = [{ id: "session-1", messages: [], isRunning: false }];
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      subAgentStartedHandler?.("session-1", "child-1", "Child task");
    });

    await act(async () => {
      completeHandler?.();
    });

    // applyAgentEvent with complete should have been called immediately
    expect(mockState.applyAgentEvent).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ type: "complete" }),
      expect.any(Number),
    );

    act(() => {
      subAgentCompletedHandler?.("session-1", "child-1", "completed", undefined);
    });

    await new Promise((r) => setTimeout(r, 350));

    await waitFor(() => {
      expect(mockState.refreshChatsNow).toHaveBeenCalled();
    });
  });

  it("clears stale processing after completion when refresh shows not running", async () => {
    let completeHandler: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      completeHandler = handlers.onComplete;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockState.chats = [{ id: "session-1", messages: [], isRunning: false }];
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      mockState.chats = [{ id: "session-1", messages: [], isRunning: false }];
      mockStore.getState.mockReturnValue(mockState);
    });
    mockState.loadChatHistory = vi.fn().mockResolvedValue(undefined);
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    await act(async () => {
      completeHandler?.();
    });

    await new Promise((r) => setTimeout(r, 350));

    await waitFor(() => {
      expect(mockState.refreshChatsNow).toHaveBeenCalled();
      expect(mockState.applyAgentEvent).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({ type: "complete" }),
        expect.any(Number),
      );
    });
  });

  it("does not finalize a root clarification stream when onComplete follows need_clarification", async () => {
    let completeHandler: (() => void) | undefined;
    let needClarificationHandler: ((event: any) => void) | undefined;

    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      completeHandler = handlers.onComplete;
      needClarificationHandler = handlers.onNeedClarification;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": createBusyExecutionEntry({
        phase: "running",
        confidence: "live",
        generation: 1,
        interaction: {
          pendingQuestion: null,
          respondMode: null,
          pendingApproval: null,
        },
      }),
    };
    mockState.loadChatHistory = vi.fn().mockResolvedValue(undefined);
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      needClarificationHandler?.({
        type: "need_clarification",
        session_id: "session-1",
        question: "Need more info",
        options: ["A", "B"],
        allow_custom: true,
        tool_call_id: "call-clarify-1",
      });
    });

    await act(async () => {
      completeHandler?.();
    });

    expect(mockState.setPendingQuestion).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        question: "Need more info",
        toolCallId: "call-clarify-1",
      }),
    );
    expect(mockState.applyAgentEvent).not.toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ type: "complete" }),
      expect.any(Number),
    );
    expect(mockState.clearPendingQuestion).not.toHaveBeenCalled();
    expect(mockState.loadChatHistory).not.toHaveBeenCalled();
    expect(mockState.refreshChatsNow).not.toHaveBeenCalled();
  });

  it("handles cancelled terminal events", async () => {
    let cancelledHandler: ((message?: string) => Promise<void>) | undefined;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      cancelledHandler = handlers.onCancelled;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    await act(async () => {
      await cancelledHandler?.("Agent execution cancelled by user");
    });

    expect(mockState.applyAgentEvent).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ type: "cancelled", message: "Agent execution cancelled by user" }),
      expect.any(Number),
    );
  });

  it("should handle onComplete and save message", async () => {
    let completeHandler: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      completeHandler = handlers.onComplete;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      mockState.executionBySession = {
        "session-1": {
          sessionId: "session-1",
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
      mockStore.getState.mockReturnValue(mockState);
    });
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    // Simulate complete event
    await act(async () => {
      if (completeHandler) {
        await completeHandler();
      }
    });

    await waitFor(() => {
      expect(mockState.applyAgentEvent).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({ type: "complete" }),
        expect.any(Number),
      );
      expect(mockState.loadChatHistory).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({
          mode: "monotonic",
          waitForAssistant: true,
        }),
      );
    });
  });

  it("retries refreshing chats when completion settles but title is still a default placeholder", async () => {
    vi.useFakeTimers();

    let completeHandler: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      completeHandler = handlers.onComplete;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": createBusyExecutionEntry(),
    };
    mockState.chats = [
      {
        id: "session-1",
        title: "New session with Bodhi",
        titleVersion: 0,
        isRunning: true,
        messages: [],
      },
    ];

    let refreshCount = 0;
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      refreshCount += 1;
      mockState.executionBySession = {
        "session-1": createBusyExecutionEntry({
          phase: "idle",
          confidence: "optimistic",
          backend: {
            isRunning: false,
            lastRunStatus: null,
            lastRunError: null,
            syncedAt: null,
            hasPendingQuestion: null,
            runningChildCount: null,
          },
        }),
      };

      if (refreshCount === 1) {
        mockState.chats = [
          {
            id: "session-1",
            title: "New session with Bodhi",
            titleVersion: 0,
            isRunning: false,
            messages: [],
          },
        ];
      } else {
        mockState.chats = [
          {
            id: "session-1",
            title: "Real Generated Title",
            titleVersion: 1,
            isRunning: false,
            messages: [],
          },
        ];
      }

      mockStore.getState.mockReturnValue(mockState);
    });
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    expect(mockSubscribeToEvents).toHaveBeenCalled();

    await act(async () => {
      await completeHandler?.();
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockState.refreshChatsNow).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1200);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockState.refreshChatsNow).toHaveBeenCalledTimes(2);
  });

  it("clears processing when completion history sync fails", async () => {
    let completeHandler: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      completeHandler = handlers.onComplete;
      return new Promise<void>(() => {});
    });

    const historyError = new Error("Fetch API cannot load due to access control checks");
    mockState.loadChatHistory = vi.fn().mockRejectedValue(historyError);
    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      mockState.executionBySession = {
        "session-1": {
          sessionId: "session-1",
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
      mockStore.getState.mockReturnValue(mockState);
    });
    mockStore.getState.mockReturnValue(mockState);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    await act(async () => {
      completeHandler?.();
    });

    await waitFor(() => {
      expect(mockState.loadChatHistory).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({
          mode: "monotonic",
          waitForAssistant: true,
        }),
      );
      expect(mockState.applyAgentEvent).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({ type: "complete" }),
        expect.any(Number),
      );
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Completion finalization failed"),
      historyError,
    );

    warnSpy.mockRestore();
  });

  it("does not reconnect when a one-shot terminal complete stream closes", async () => {
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      handlers.onComplete?.();
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      mockState.executionBySession = {
        "session-1": {
          sessionId: "session-1",
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
      mockStore.getState.mockReturnValue(mockState);
    });
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    let initialCalls = 0;
    await waitFor(() => {
      expect(mockState.applyAgentEvent).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({ type: "complete" }),
        expect.any(Number),
      );
      initialCalls = mockSubscribeToEvents.mock.calls.length;
      expect(initialCalls).toBeGreaterThan(0);
    });

    await new Promise((r) => setTimeout(r, 350));

    expect(mockSubscribeToEvents.mock.calls.length).toBe(initialCalls);
  });

  it("shows a friendly completion policy violation message", async () => {
    let errorHandler: any;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      errorHandler = handlers.onError;
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    await act(async () => {
      await errorHandler(
        "completion policy violation: model repeatedly attempted to end the task without calling conclusion_with_options while copilot conclusion-with-options enhancement is enabled (attempts=3)",
      );
    });

    await waitFor(() => {
      expect(mockAddMessage).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({
          content: expect.stringContaining("Bamboo stopped this completion"),
          finishReason: "error",
        }),
      );
    });
  });

  it("should handle onError and show error message", async () => {
    let errorHandler: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      errorHandler = handlers.onError;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    // Simulate error event
    await act(async () => {
      if (errorHandler) {
        await errorHandler("Something went wrong");
      }
    });

    await waitFor(() => {
      // Verify that addMessage was called with error content
      expect(mockAddMessage).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({
          content: expect.stringContaining("Something went wrong"),
          finishReason: "error",
        }),
      );
    });
  });

  it("should not create duplicate subscriptions", async () => {
    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);
    mockSubscribeToEvents.mockImplementation(() => new Promise<void>(() => {}));

    const { rerender } = renderHook(() => useAgentEventSubscription());

    let initialCalls = 0;
    await waitFor(() => {
      initialCalls = mockSubscribeToEvents.mock.calls.length;
      expect(initialCalls).toBeGreaterThan(0);
    });

    // Rerender should not create new subscription
    rerender();

    await waitFor(() => {
      expect(mockSubscribeToEvents.mock.calls.length).toBe(initialCalls);
    });
  });

  it("restarts a stale ended subscription when the same session resumes processing", async () => {
    let completeHandler: (() => void) | undefined;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      completeHandler = handlers.onComplete;
      return Promise.resolve();
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockState.refreshChatsNow = vi.fn().mockResolvedValue(undefined);
    mockState.loadChatHistory = vi.fn().mockImplementation(async () => {
      mockStore.getState.mockReturnValue(mockState);
    });
    mockStore.getState.mockReturnValue(mockState);

    const { rerender } = renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      completeHandler?.();
      await Promise.resolve();
    });

    // Same session remains marked processing, representing an immediate resumed run.
    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
        phase: "running",
        confidence: "live",
        activeReasons: [],
        generation: 2,
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
    mockStore.getState.mockReturnValue(mockState);
    rerender();

    await waitFor(() => {
      expect(mockSubscribeToEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("should reconnect on unexpected AbortError without clearing processing state", async () => {
    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);

    const abortErr = Object.assign(new Error("stream aborted"), {
      name: "AbortError",
    });
    mockSubscribeToEvents
      .mockRejectedValueOnce(abortErr)
      .mockImplementation(() => new Promise<void>(() => {}));

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalledTimes(1);
    });

    // Default backoff starts at 250ms; use a real-time sleep to avoid fake-timer + waitFor edge cases.
    await new Promise((r) => setTimeout(r, 350));

    await waitFor(() => {
      expect(mockSubscribeToEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("marks stream started once per generation while token text stays off execution state", async () => {
    let tokenHandler: any;
    let reasoningTokenHandler: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      tokenHandler = handlers.onToken;
      reasoningTokenHandler = handlers.onReasoningToken;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      tokenHandler?.("Hello ");
      tokenHandler?.("World");
      reasoningTokenHandler?.("because ");
      reasoningTokenHandler?.("reasons");
    });

    expect(mockState.markStreamStarted).toHaveBeenCalledTimes(1);
    expect(mockState.markStreamStarted).toHaveBeenCalledWith("session-1", 1);

    const liveAssistantState = getAssistantStreamingState("session-1");
    expect(liveAssistantState.content).toBe("Hello World");
    expect(liveAssistantState.reasoningContent).toBe("because reasons");

    expect(mockState.applyAgentEvent).not.toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ type: "token" }),
      expect.any(Number),
    );
    expect(mockState.applyAgentEvent).not.toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ type: "reasoning_token" }),
      expect.any(Number),
    );
  });

  it("should route tool_token output into Jotai live state instead of patching persisted tool_call cards", async () => {
    let capturedHandlers: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      capturedHandlers = handlers;
      return new Promise<void>(() => {});
    });

    const updateMessage = vi.fn();
    let toolCallMessageId: string | undefined;
    const addMessage = vi.fn((_sessionId: string, msg: any) => {
      toolCallMessageId = msg?.id;
      mockState.chats[0].messages.push(msg);
    });

    mockState = createMockState({
      addMessage,
      updateMessage,
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);
    mockStore.mockImplementation((selector: MockSelector) => selector(mockState));

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
      expect(capturedHandlers).toEqual(
        expect.objectContaining({
          onToolStart: expect.any(Function),
          onToolToken: expect.any(Function),
        }),
      );
    });

    act(() => {
      capturedHandlers.onToolStart?.("call_1", "claude_code", { project_path: "/tmp" });
    });

    act(() => {
      capturedHandlers.onToolToken?.("call_1", "hello");
      capturedHandlers.onToolToken?.("call_1", " world");
    });

    await waitFor(() => {
      expect(typeof toolCallMessageId).toBe("string");
      expect((toolCallMessageId ?? "").length).toBeGreaterThan(0);

      const liveState = getToolStreamingState("session-1", "call_1");
      expect(liveState.output).toBe("hello world");
      expect(liveState.status).toBe("running");

      const toolMsg = mockState.chats[0].messages.find((m: any) => m.id === toolCallMessageId);
      expect(toolMsg?.toolCalls?.[0]?.streamingOutput).toBe("");
      expect(updateMessage).not.toHaveBeenCalled();
    });
  });

  it("should cleanup subscription on unmount", async () => {
    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);
    mockSubscribeToEvents.mockImplementation(() => new Promise<void>(() => {}));

    const { unmount } = renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    // Unmount should cleanup (abort controller)
    unmount();

    // Cleanup is internal, hard to verify without access to abort controller
  });

  it("keeps context-compacting status during reasoning and clears it when answer tokens arrive", async () => {
    let capturedHandlers: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      capturedHandlers = handlers;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
      expect(capturedHandlers).toEqual(
        expect.objectContaining({
          onContextCompressionStatus: expect.any(Function),
          onReasoningToken: expect.any(Function),
          onToken: expect.any(Function),
        }),
      );
    });

    act(() => {
      capturedHandlers.onContextCompressionStatus?.("pre-turn", "started");
    });

    await waitFor(() => {
      expect(streamingMessageBus.getLatest("streaming-status-session-1")).toBe(
        "context_compacting",
      );
    });

    act(() => {
      capturedHandlers.onReasoningToken?.("Analyzing...");
    });

    await waitFor(() => {
      expect(streamingMessageBus.getLatest("streaming-status-session-1")).toBe(
        "context_compacting",
      );
    });

    act(() => {
      capturedHandlers.onToken?.("Done.");
    });

    await waitFor(() => {
      expect(streamingMessageBus.getLatest("streaming-status-session-1")).toBeNull();
    });
  });

  it("publishes memory status while memory_note tool is running", async () => {
    let capturedHandlers: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      capturedHandlers = handlers;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
      expect(capturedHandlers).toEqual(
        expect.objectContaining({
          onToolStart: expect.any(Function),
          onToolComplete: expect.any(Function),
        }),
      );
    });

    act(() => {
      capturedHandlers.onToolStart?.("call-memory", "memory_note", { action: "append" });
    });

    await waitFor(() => {
      expect(streamingMessageBus.getLatest("streaming-status-session-1")).toBe("memory_updating");
    });

    act(() => {
      capturedHandlers.onToolComplete?.("call-memory", {
        success: true,
        result: "ok",
        display_preference: "Default",
      });
    });

    await waitFor(() => {
      expect(streamingMessageBus.getLatest("streaming-status-session-1")).toBeNull();
    });
  });

  it("publishes memory status while session_note tool is running", async () => {
    let capturedHandlers: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      capturedHandlers = handlers;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
      expect(capturedHandlers).toEqual(
        expect.objectContaining({
          onToolLifecycle: expect.any(Function),
        }),
      );
    });

    act(() => {
      capturedHandlers.onToolStart?.("call-session-note", "session_note", { action: "append" });
    });

    await waitFor(() => {
      expect(streamingMessageBus.getLatest("streaming-status-session-1")).toBe("memory_updating");
    });

    act(() => {
      capturedHandlers.onToolLifecycle?.("call-session-note", "session_note", "finished", 12, true);
    });

    await waitFor(() => {
      expect(streamingMessageBus.getLatest("streaming-status-session-1")).toBeNull();
    });
  });

  // ===========================================================================
  // F1: live SSE metadata events route through the unified entry.
  // ===========================================================================

  it("routes live session_title_updated through applyServerTitle on the store", async () => {
    let capturedHandlers: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      capturedHandlers = handlers;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
      expect(capturedHandlers).toEqual(
        expect.objectContaining({
          onSessionTitleUpdated: expect.any(Function),
          onSessionPinnedUpdated: expect.any(Function),
        }),
      );
    });

    act(() => {
      capturedHandlers.onSessionTitleUpdated?.({
        type: "session_title_updated",
        session_id: "session-1",
        title: "Renamed via SSE",
        title_version: 7,
        source: "manual",
        updated_at: "2026-01-15T12:00:00.000Z",
      });
    });

    expect(mockState.applyServerTitle).toHaveBeenCalledWith("session-1", "Renamed via SSE", 7);
  });

  it("routes live session_pinned_updated through applyServerPinned on the store", async () => {
    let capturedHandlers: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      capturedHandlers = handlers;
      return new Promise<void>(() => {});
    });

    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
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
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      capturedHandlers.onSessionPinnedUpdated?.({
        type: "session_pinned_updated",
        session_id: "session-1",
        pinned: true,
        updated_at: "2026-01-15T13:00:00.000Z",
      });
    });

    expect(mockState.applyServerPinned).toHaveBeenCalledWith(
      "session-1",
      true,
      "2026-01-15T13:00:00.000Z",
    );
  });

  // ===========================================================================
  // REGRESSION: respond/resume must only resubscribe after waiting_user_answer returns to an observable phase
  // ===========================================================================

  it("subscribes again only after waiting_user_answer transitions back to starting (respond/resume regression)", async () => {
    // Simulate waiting_user_answer (busy phase) at generation 1
    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
        phase: "waiting_user_answer",
        confidence: "live",
        activeReasons: ["sse:need_clarification"],
        generation: 1,
        backendRunId: null,
        stream: { hasTokens: false, tokenCount: 0, activeToolCalls: [], lastStatusHint: null },
        backend: {
          isRunning: true,
          lastRunStatus: null,
          lastRunError: null,
          syncedAt: null,
          hasPendingQuestion: true,
          runningChildCount: null,
        },
        interaction: {
          pendingQuestion: {
            question: "What should I do?",
            options: ["Option A", "Option B"],
            allowCustom: true,
            toolCallId: null,
            receivedAt: "2026-01-15T12:00:00.000Z",
          },
          respondMode: null,
          pendingApproval: null,
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
    };
    mockStore.getState.mockReturnValue(mockState);
    mockSubscribeToEvents.mockImplementation(() => new Promise<void>(() => {}));

    const { rerender } = renderHook(() => useAgentEventSubscription());

    await new Promise((r) => setTimeout(r, 50));
    expect(mockSubscribeToEvents).toHaveBeenCalledTimes(0);

    // Simulate markRespondStart bumping generation to 2 while remaining busy
    // (phase transitions to "starting" which is also a busy phase).
    // This is the exact scenario from the bug: same session ID stays busy,
    // but generation changes. Without the fix, the coordinating effect would
    // NOT re-run because busySessionIds didn't change.
    mockState.executionBySession = {
      "session-1": {
        sessionId: "session-1",
        phase: "starting",
        confidence: "optimistic",
        activeReasons: ["optimistic:respond"],
        generation: 2,
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
          optimisticAt: "2026-01-15T12:01:00.000Z",
          confirmedAt: null,
          firstTokenAt: null,
          terminalAt: null,
          settlingStartedAt: null,
          settledAt: null,
        },
        error: null,
      },
    };
    mockStore.getState.mockReturnValue(mockState);

    // Rerender triggers the effect with the new state
    act(() => {
      rerender();
    });

    // The key assertion: because generation changed (1 → 2), the effect must
    // Once the session leaves waiting_user_answer and re-enters an observable phase,
    // the hook should establish the live stream for the resumed generation.
    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalledTimes(1);
    });

    expect(mockSubscribeToEvents).toHaveBeenNthCalledWith(
      1,
      "session-1",
      expect.anything(),
      expect.any(AbortController),
    );
  });

  it("resubscribes when the same generation transitions from starting to live running after an early terminal stream", async () => {
    let firstCall = true;
    mockState.executionBySession = {
      "session-1": createBusyExecutionEntry({
        phase: "starting",
        confidence: "optimistic",
        generation: 7,
        backendRunId: null,
        activeReasons: ["optimistic:respond"],
        timestamps: {
          optimisticAt: "2026-01-15T12:01:00.000Z",
          confirmedAt: null,
          firstTokenAt: null,
          terminalAt: null,
          settlingStartedAt: null,
          settledAt: null,
        },
      }),
    };
    mockStore.getState.mockReturnValue(mockState);
    mockSubscribeToEvents.mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        return;
      }
      return new Promise<void>(() => {});
    });

    const { rerender } = renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalledTimes(1);
    });

    // The initial optimistic `starting` subscription ended before the backend
    // actually resumed. Now applyExecutionStarted moves the SAME generation into
    // a truly live running state; coordination must resubscribe.
    mockState.executionBySession = {
      "session-1": createBusyExecutionEntry({
        phase: "running",
        confidence: "live",
        generation: 7,
        backendRunId: "run-7",
        activeReasons: ["optimistic:respond", "sse:execution_started"],
        timestamps: {
          optimisticAt: "2026-01-15T12:01:00.000Z",
          confirmedAt: "2026-01-15T12:01:01.000Z",
          firstTokenAt: null,
          terminalAt: null,
          settlingStartedAt: null,
          settledAt: null,
        },
      }),
    };
    mockStore.getState.mockReturnValue(mockState);

    act(() => {
      rerender();
    });

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalledTimes(2);
    });

    expect(mockSubscribeToEvents).toHaveBeenNthCalledWith(
      2,
      "session-1",
      expect.anything(),
      expect.any(AbortController),
    );
  });

  it("resubscribes when the same generation recovers from settling back to running", async () => {
    let firstCall = true;
    mockState.executionBySession = {
      "session-1": createBusyExecutionEntry({
        phase: "settling",
        confidence: "live",
        generation: 9,
        backendRunId: "run-stale",
        activeReasons: ["sse:complete"],
        timestamps: {
          optimisticAt: "2026-01-15T12:01:00.000Z",
          confirmedAt: "2026-01-15T12:01:01.000Z",
          firstTokenAt: null,
          terminalAt: "2026-01-15T12:01:02.000Z",
          settlingStartedAt: "2026-01-15T12:01:02.000Z",
          settledAt: null,
        },
      }),
    };
    mockStore.getState.mockReturnValue(mockState);
    mockSubscribeToEvents.mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        return;
      }
      return new Promise<void>(() => {});
    });

    const { rerender } = renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalledTimes(1);
    });

    mockState.executionBySession = {
      "session-1": createBusyExecutionEntry({
        phase: "running",
        confidence: "live",
        generation: 9,
        backendRunId: "run-recovered",
        activeReasons: ["sse:complete", "sse:execution_started"],
        timestamps: {
          optimisticAt: "2026-01-15T12:01:00.000Z",
          confirmedAt: "2026-01-15T12:01:03.000Z",
          firstTokenAt: null,
          terminalAt: null,
          settlingStartedAt: null,
          settledAt: null,
        },
      }),
    };
    mockStore.getState.mockReturnValue(mockState);

    act(() => {
      rerender();
    });

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalledTimes(2);
    });

    expect(mockSubscribeToEvents).toHaveBeenNthCalledWith(
      2,
      "session-1",
      expect.anything(),
      expect.any(AbortController),
    );
  });
});
