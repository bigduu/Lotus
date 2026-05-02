import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useAgentEventSubscription } from "../useAgentEventSubscription";
import { AgentClient } from "../../services/chat/AgentService";
import { streamingMessageBus } from "../../pages/ChatPage/utils/streamingMessageBus";

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
  return { useAppStore: mockStore };
});

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

// Mock state factory
const createMockState = (overrides: Partial<any> = {}) => ({
  chats: [
    {
      id: "session-1",
      messages: [],
    },
  ],
  processingChats: new Set<string>(),
  addMessage: vi.fn(),
  setSessionProcessing: vi.fn(),
  updateTokenUsage: vi.fn(),
  setTruncationInfo: vi.fn(),
  updateSession: vi.fn(),
  updateMessage: vi.fn(),
  setTaskList: vi.fn(),
  loadTaskList: vi.fn(),
  updateTaskListDelta: vi.fn(),
  setEvaluationState: vi.fn(),
  clearEvaluationState: vi.fn(),
  upsertSubSessionProgress: vi.fn(),
  clearSubSessionProgress: vi.fn(),
  persistSessionTitle: vi.fn().mockResolvedValue(undefined),
  refreshChats: vi.fn().mockResolvedValue(undefined),
  refreshChatsNow: vi.fn().mockResolvedValue(undefined),
  loadChatHistory: vi.fn(),
  subSessionsByParent: {},
  setPendingQuestionForSession: vi.fn(),
  clearPendingQuestionForSession: vi.fn(),
  ...overrides,
});

describe("useAgentEventSubscription", () => {
  let mockSubscribeToEvents: ReturnType<typeof vi.fn>;
  let mockSetSessionProcessing: ReturnType<typeof vi.fn>;
  let mockAddMessage: ReturnType<typeof vi.fn>;
  let mockState: any;
  let mockStore: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    streamingMessageBus.clear("session-1", "streaming-session-1");
    streamingMessageBus.clear("session-1", "streaming-reasoning-session-1");
    streamingMessageBus.clear("session-1", "streaming-status-session-1");

    mockSetSessionProcessing = vi.fn();
    mockAddMessage = vi.fn();

    mockState = createMockState({
      addMessage: mockAddMessage,
      setSessionProcessing: mockSetSessionProcessing,
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

  it("should not subscribe when processingChats is empty", () => {
    renderHook(() => useAgentEventSubscription());

    expect(mockSubscribeToEvents).not.toHaveBeenCalled();
  });

  it("should subscribe when chat is processing and session exists", async () => {
    mockState.processingChats = new Set(["session-1"]); // Session is processing
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

  it("should unsubscribe when isProcessing becomes false", async () => {
    mockState.processingChats = new Set(["session-1"]); // Session is processing
    mockStore.getState.mockReturnValue(mockState);
    mockSubscribeToEvents.mockResolvedValue(undefined);

    const { rerender } = renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    // Change back to not processing
    mockState.processingChats = new Set();
    mockStore.getState.mockReturnValue(mockState);
    rerender();

    // Should abort the subscription
    // (Hard to test directly without access to abort controller)
  });

  it("should handle subscription errors and reset state", async () => {
    mockState.processingChats = new Set(["session-1"]);
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      mockState.processingChats = new Set();
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

      // Should reset processing state on error
      expect(mockSetSessionProcessing).toHaveBeenCalledWith("session-1", false);
    });

    consoleSpy.mockRestore();
  });

  it("recovers missing task list baseline before applying task progress deltas", async () => {
    let taskProgressHandler: ((delta: any) => void) | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      taskProgressHandler = handlers.onTaskListItemProgress;
    });

    mockState.processingChats = new Set(["session-1"]);
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
    let subSessionStartedHandler:
      | ((parentSessionId: string, childSessionId: string, title?: string) => void)
      | undefined;
    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      subSessionStartedHandler = handlers.onSubSessionStarted;
    });

    mockState.processingChats = new Set(["session-1"]);
    mockState.refreshChatsNow = vi.fn().mockResolvedValue(undefined);
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    act(() => {
      subSessionStartedHandler?.("session-1", "child-1", "Child task");
    });

    await waitFor(() => {
      expect(mockState.refreshChatsNow).toHaveBeenCalledTimes(1);
      expect(mockSetSessionProcessing).toHaveBeenCalledWith("session-1", true);
      expect(mockState.upsertSubSessionProgress).toHaveBeenCalledWith(
        "session-1",
        "child-1",
        expect.objectContaining({ title: "Child task", status: "pending" }),
      );
    });
  });

  it("waits for settle check before clearing processing after the last child completes", async () => {
    let completeHandler: (() => void) | undefined;
    let subSessionStartedHandler:
      | ((parentSessionId: string, childSessionId: string, title?: string) => void)
      | undefined;
    let subSessionCompletedHandler:
      | ((parentSessionId: string, childSessionId: string, status: string, error?: string) => void)
      | undefined;

    mockSubscribeToEvents.mockImplementation(async (_sessionId: string, handlers: any) => {
      completeHandler = handlers.onComplete;
      subSessionStartedHandler = handlers.onSubSessionStarted;
      subSessionCompletedHandler = handlers.onSubSessionCompleted;
    });

    mockState.processingChats = new Set(["session-1"]);
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      mockState.chats = [{ id: "session-1", messages: [], isRunning: false }];
      mockState.processingChats = new Set();
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
      subSessionStartedHandler?.("session-1", "child-1", "Child task");
    });

    await act(async () => {
      completeHandler?.();
    });

    expect(mockSetSessionProcessing).not.toHaveBeenCalledWith("session-1", false);

    act(() => {
      subSessionCompletedHandler?.("session-1", "child-1", "completed", undefined);
    });

    expect(mockSetSessionProcessing).not.toHaveBeenCalledWith("session-1", false);

    await new Promise((r) => setTimeout(r, 350));

    await waitFor(() => {
      expect(mockState.refreshChatsNow).toHaveBeenCalled();
      expect(mockSetSessionProcessing).toHaveBeenCalledWith("session-1", false);
    });
  });

  it("clears stale processing after completion when refresh shows not running", async () => {
    let completeHandler: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      completeHandler = handlers.onComplete;
      return new Promise<void>(() => {});
    });

    mockState.processingChats = new Set(["session-1"]);
    mockState.chats = [{ id: "session-1", messages: [], isRunning: false }];
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      // Simulate the current store behavior where refresh updates chat.isRunning,
      // but a stale processingChats bit may still linger until the hook clears it.
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
      expect(mockSetSessionProcessing).toHaveBeenCalledWith("session-1", false);
    });
  });

  it("should handle onComplete and save message", async () => {
    let completeHandler: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      completeHandler = handlers.onComplete;
      return new Promise<void>(() => {});
    });

    mockState.processingChats = new Set(["session-1"]);
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      mockState.processingChats = new Set();
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
      expect(mockSetSessionProcessing).toHaveBeenCalledWith("session-1", false);
      expect(mockState.loadChatHistory).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({
          mode: "monotonic",
          waitForAssistant: true,
        }),
      );
    });
  });

  it("clears processing when completion history sync fails", async () => {
    let completeHandler: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      completeHandler = handlers.onComplete;
      return new Promise<void>(() => {});
    });

    const historyError = new Error("Fetch API cannot load due to access control checks");
    mockState.loadChatHistory = vi.fn().mockRejectedValue(historyError);
    mockState.processingChats = new Set(["session-1"]);
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      mockState.processingChats = new Set();
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
      expect(mockSetSessionProcessing).toHaveBeenCalledWith("session-1", false);
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

    mockState.processingChats = new Set(["session-1"]);
    mockState.refreshChatsNow = vi.fn().mockImplementation(async () => {
      mockState.processingChats = new Set();
      mockStore.getState.mockReturnValue(mockState);
    });
    mockSetSessionProcessing.mockImplementation((sessionId: string, isProcessing: boolean) => {
      if (!isProcessing) {
        mockState.processingChats.delete(sessionId);
      }
    });
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    let initialCalls = 0;
    await waitFor(() => {
      expect(mockSetSessionProcessing).toHaveBeenCalledWith("session-1", false);
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

    mockState.processingChats = new Set(["session-1"]);
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

    mockState.processingChats = new Set(["session-1"]);
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
    mockState.processingChats = new Set(["session-1"]);
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

    mockState.processingChats = new Set(["session-1"]);
    mockState.refreshChatsNow = vi.fn().mockResolvedValue(undefined);
    mockState.loadChatHistory = vi.fn().mockImplementation(async () => {
      // Keep processing=true to simulate a very fast resumed run arriving before
      // old completion cleanup has fully converged.
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
    mockState.processingChats = new Set(["session-1"]);
    mockStore.getState.mockReturnValue(mockState);
    rerender();

    await waitFor(() => {
      expect(mockSubscribeToEvents.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("should reconnect on unexpected AbortError without clearing processing state", async () => {
    mockState.processingChats = new Set(["session-1"]);
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

    expect(mockSetSessionProcessing).not.toHaveBeenCalledWith("session-1", false);
  });

  it("should handle token streaming", async () => {
    let tokenHandler: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      tokenHandler = handlers.onToken;
      return new Promise<void>(() => {});
    });

    mockState.processingChats = new Set(["session-1"]);
    mockStore.getState.mockReturnValue(mockState);

    renderHook(() => useAgentEventSubscription());

    await waitFor(() => {
      expect(mockSubscribeToEvents).toHaveBeenCalled();
    });

    // Simulate token events
    act(() => {
      if (tokenHandler) {
        tokenHandler("Hello ");
        tokenHandler("World");
      }
    });

    // Should stream tokens (verified via streamingMessageBus, not mocked here)
  });

  it("should append tool_token output to the matching tool_call card", async () => {
    let capturedHandlers: any;
    mockSubscribeToEvents.mockImplementation((_sessionId: string, handlers: any) => {
      capturedHandlers = handlers;
      return new Promise<void>(() => {});
    });

    const updateMessage = vi.fn((_sessionId: string, messageId: string, patch: any) => {
      // Simulate store mutation so subsequent onToolToken calls can append.
      const msg = mockState.chats[0].messages.find((m: any) => m.id === messageId);
      if (!msg) return;
      if (patch?.toolCalls) {
        msg.toolCalls = patch.toolCalls;
      }
    });
    let toolCallMessageId: string | undefined;
    const addMessage = vi.fn((_sessionId: string, msg: any) => {
      // Simulate store mutation so onToolToken can find the message.
      toolCallMessageId = msg?.id;
      mockState.chats[0].messages.push(msg);
    });

    mockState = createMockState({
      addMessage,
      updateMessage,
      setSessionProcessing: mockSetSessionProcessing,
    });

    mockState.processingChats = new Set(["session-1"]);
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
      expect(updateMessage).toHaveBeenCalled();

      const toolMsg = mockState.chats[0].messages.find((m: any) => m.id === toolCallMessageId);
      expect(toolMsg?.toolCalls?.[0]?.streamingOutput).toBe("hello world");
    });
  });

  it("should cleanup subscription on unmount", async () => {
    mockState.processingChats = new Set(["session-1"]);
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

    mockState.processingChats = new Set(["session-1"]);
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

    mockState.processingChats = new Set(["session-1"]);
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

    mockState.processingChats = new Set(["session-1"]);
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
});
