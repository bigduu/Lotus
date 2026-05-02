import { renderHook, act, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@shared/i18n";

const { mockAgentApiGet } = vi.hoisted(() => ({
  mockAgentApiGet: vi.fn(),
}));

const mockModalInfo = vi.fn();
const mockMessageApi = {
  warning: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

const mockAgentSendMessage = vi.fn();
const mockAgentExecute = vi.fn();
const mockAgentSubscribeToEvents = vi.fn();
const mockAgentHealthCheck = vi.fn();
const mockAgentTruncateSessionMessages = vi.fn();

const mockStoreState = {
  agentAvailability: null as boolean | null,
  startAgentHealthCheck: vi.fn(),
  checkAgentAvailability: vi.fn<() => Promise<boolean>>(),
  setAgentAvailability: vi.fn(),
  loadChatHistory: vi.fn(),
  setPendingQuestionRespond: vi.fn(),
  clearPendingQuestionRespondForSession: vi.fn(),
  pendingQuestionRespond: null as {
    sessionId: string;
    question: string;
    options: string[];
    allowCustom: boolean;
    toolCallId?: string | null;
  } | null,
  chats: [] as any[],
};

const mockActiveModel = "gpt-5";

vi.mock("../../hooks/useActiveModel", () => ({
  useActiveModel: () => mockActiveModel,
}));

vi.mock("antd", () => ({
  App: {
    useApp: () => ({
      modal: { info: mockModalInfo },
      message: mockMessageApi,
    }),
  },
}));

vi.mock("../../services/AgentService", () => ({
  AgentClient: class {
    sendMessage = mockAgentSendMessage;
    execute = mockAgentExecute;
    subscribeToEvents = mockAgentSubscribeToEvents;
    healthCheck = mockAgentHealthCheck;
    truncateSessionMessages = mockAgentTruncateSessionMessages;
  },
}));

vi.mock("@services/api", () => ({
  agentApiClient: {
    get: mockAgentApiGet,
  },
}));

vi.mock("../../utils/streamingMessageBus", () => ({
  streamingMessageBus: {
    publish: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../store", () => {
  const useAppStore = (selector: (state: typeof mockStoreState) => unknown) =>
    selector(mockStoreState);
  (
    useAppStore as typeof useAppStore & {
      getState: () => {
        loadChatHistory: typeof mockStoreState.loadChatHistory;
        chats: typeof mockStoreState.chats;
        pendingQuestionRespond: typeof mockStoreState.pendingQuestionRespond;
        setPendingQuestionRespond: typeof mockStoreState.setPendingQuestionRespond;
        clearPendingQuestionRespondForSession: typeof mockStoreState.clearPendingQuestionRespondForSession;
      };
    }
  ).getState = () => ({
    loadChatHistory: mockStoreState.loadChatHistory,
    chats: mockStoreState.chats,
    pendingQuestionRespond: mockStoreState.pendingQuestionRespond,
    setPendingQuestionRespond: mockStoreState.setPendingQuestionRespond,
    clearPendingQuestionRespondForSession: mockStoreState.clearPendingQuestionRespondForSession,
  });

  return { useAppStore };
});

import { useMessageStreaming } from "./useMessageStreaming";

describe("useMessageStreaming", () => {
  beforeEach(() => {
    mockModalInfo.mockReset();
    mockMessageApi.warning.mockReset();
    mockMessageApi.error.mockReset();
    mockMessageApi.info.mockReset();

    mockAgentSendMessage.mockReset();
    mockAgentExecute.mockReset();
    mockAgentSubscribeToEvents.mockReset();
    mockAgentHealthCheck.mockReset();
    mockAgentTruncateSessionMessages.mockReset();
    mockAgentApiGet.mockReset();

    mockStoreState.agentAvailability = null;
    mockStoreState.startAgentHealthCheck.mockReset();
    mockStoreState.checkAgentAvailability.mockReset();
    mockStoreState.setAgentAvailability.mockReset();
    mockStoreState.loadChatHistory.mockReset();
    mockStoreState.setPendingQuestionRespond.mockReset();
    mockStoreState.clearPendingQuestionRespondForSession.mockReset();
    mockStoreState.pendingQuestionRespond = null;
    mockStoreState.chats = [];
  });

  it("starts global health-check polling once on mount", async () => {
    const deps = {
      sessionId: null,
      addMessage: vi.fn(),
      setSessionProcessing: vi.fn(),
      updateSession: vi.fn(),
    };

    renderHook(() => useMessageStreaming(deps));

    await waitFor(() => {
      expect(mockStoreState.startAgentHealthCheck).toHaveBeenCalledTimes(1);
    });
  });

  it("verifies availability from store before sending when status is unknown", async () => {
    mockStoreState.checkAgentAvailability.mockResolvedValue(false);

    const mockChat = {
      id: "chat-1",
      title: "Test Chat",
      createdAt: Date.now(),
      messages: [],
      config: {
        systemPromptId: "general_assistant",
        baseSystemPrompt: "",
        lastUsedEnhancedPrompt: null,
      },
      currentInteraction: {
        machineState: "idle",
        streamingMessageId: null,
        streamingContent: null,
      },
    };

    mockStoreState.chats = [mockChat];

    const deps = {
      sessionId: "chat-1",
      addMessage: vi.fn(),
      setSessionProcessing: vi.fn(),
      updateSession: vi.fn(),
    };

    const { result } = renderHook(() => useMessageStreaming(deps));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockStoreState.checkAgentAvailability).toHaveBeenCalledTimes(1);
    expect(deps.addMessage).not.toHaveBeenCalled();
    expect(mockMessageApi.error).toHaveBeenCalledWith(i18n.t("chat.streaming.agentUnavailable"));
  });

  it("marks agent unavailable after non-abort request failures", async () => {
    mockStoreState.agentAvailability = true;
    mockAgentSendMessage.mockRejectedValueOnce(new Error("boom"));

    const mockChat = {
      id: "chat-1",
      title: "Test Chat",
      createdAt: Date.now(),
      messages: [],
      config: {
        systemPromptId: "general_assistant",
        baseSystemPrompt: "",
        lastUsedEnhancedPrompt: null,
      },
      currentInteraction: {
        machineState: "idle",
        streamingMessageId: null,
        streamingContent: null,
      },
    };

    mockStoreState.chats = [mockChat];

    const deps = {
      sessionId: "chat-1",
      addMessage: vi.fn(async () => undefined),
      setSessionProcessing: vi.fn(),
      updateSession: vi.fn(),
    };

    const { result } = renderHook(() => useMessageStreaming(deps));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockStoreState.setAgentAvailability).toHaveBeenCalledWith(false);
    expect(mockMessageApi.error).toHaveBeenCalledWith(i18n.t("chat.streaming.sendFailed"));
  });

  it("shows a friendly completion policy violation error instead of marking agent unavailable", async () => {
    mockStoreState.agentAvailability = true;
    mockAgentSendMessage.mockRejectedValueOnce(
      new Error(
        "completion policy violation: model repeatedly attempted to end the task without calling conclusion_with_options while copilot conclusion-with-options enhancement is enabled (attempts=3)",
      ),
    );

    const mockChat = {
      id: "chat-1",
      title: "Test Chat",
      createdAt: Date.now(),
      messages: [],
      config: {
        systemPromptId: "general_assistant",
        baseSystemPrompt: "",
        lastUsedEnhancedPrompt: null,
      },
      currentInteraction: {
        machineState: "idle",
        streamingMessageId: null,
        streamingContent: null,
      },
    };

    mockStoreState.chats = [mockChat];

    const deps = {
      sessionId: "chat-1",
      addMessage: vi.fn(async () => undefined),
      setSessionProcessing: vi.fn(),
      updateSession: vi.fn(),
    };

    const { result } = renderHook(() => useMessageStreaming(deps));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockMessageApi.error).toHaveBeenCalledWith(
      expect.stringContaining("Bamboo stopped this completion"),
    );
    expect(mockStoreState.setAgentAvailability).not.toHaveBeenCalledWith(false);
  });

  it("passes workspace_path to agent chat requests", async () => {
    mockStoreState.agentAvailability = true;
    mockAgentSendMessage.mockResolvedValue({
      session_id: "session-1",
      status: "started",
    });
    mockAgentExecute.mockResolvedValue({
      session_id: "session-1",
      status: "started",
      events_url: "/api/v1/events/session-1",
    });
    mockAgentSubscribeToEvents.mockResolvedValue(undefined);

    const mockChat = {
      id: "chat-1",
      title: "Test Chat",
      createdAt: Date.now(),
      messages: [],
      config: {
        systemPromptId: "general_assistant",
        baseSystemPrompt: "Base prompt",
        workspacePath: "/tmp/workspace",
        lastUsedEnhancedPrompt: null,
      },
      currentInteraction: {
        machineState: "idle",
        streamingMessageId: null,
        streamingContent: null,
      },
    };

    mockStoreState.chats = [mockChat];

    const deps = {
      sessionId: "chat-1",
      addMessage: vi.fn(async () => undefined),
      setSessionProcessing: vi.fn(),
      updateSession: vi.fn(),
    };

    const { result } = renderHook(() => useMessageStreaming(deps));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockAgentSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "hello",
        workspace_path: "/tmp/workspace",
      }),
    );
  });

  it("sets processing true before sendMessage network call so UI responds immediately", async () => {
    mockStoreState.agentAvailability = true;

    const order: string[] = [];
    mockAgentSendMessage.mockImplementationOnce(async () => {
      order.push("chat");
      return { session_id: "chat-1", status: "started" };
    });
    mockAgentExecute.mockImplementationOnce(async () => {
      order.push("execute");
      return {
        session_id: "chat-1",
        status: "started",
        events_url: "/api/v1/events/chat-1",
      };
    });

    const mockChat = {
      id: "chat-1",
      title: "Test Chat",
      createdAt: Date.now(),
      messages: [],
      config: {
        systemPromptId: "general_assistant",
        baseSystemPrompt: "",
        lastUsedEnhancedPrompt: null,
      },
      currentInteraction: {
        machineState: "idle",
        streamingMessageId: null,
        streamingContent: null,
      },
    };
    mockStoreState.chats = [mockChat];

    const deps = {
      sessionId: "chat-1",
      addMessage: vi.fn(async () => {
        order.push("addMessage");
        return undefined;
      }),
      setSessionProcessing: vi.fn((sessionId: string, isProcessing: boolean) => {
        order.push(`processing:${sessionId}:${String(isProcessing)}`);
      }),
      updateSession: vi.fn(),
    };

    const { result } = renderHook(() => useMessageStreaming(deps));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    // The key timing property: processing=true fires right after addMessage
    // but BEFORE the outbound sendMessage network call, so the UI spinner
    // appears immediately while the request is still in flight.
    // A second idempotent processing=true fires inside sendWithAgent before
    // execute, guarding other entry points.
    expect(order).toEqual([
      "addMessage",
      "processing:chat-1:true",
      "chat",
      "processing:chat-1:true",
      "execute",
    ]);
  });

  it("clears processing on send-path error even when processing was set early", async () => {
    mockStoreState.agentAvailability = true;
    mockAgentSendMessage.mockRejectedValueOnce(new Error("network failure"));

    const mockChat = {
      id: "chat-1",
      title: "Test Chat",
      createdAt: Date.now(),
      messages: [],
      config: {
        systemPromptId: "general_assistant",
        baseSystemPrompt: "",
        lastUsedEnhancedPrompt: null,
      },
      currentInteraction: {
        machineState: "idle",
        streamingMessageId: null,
        streamingContent: null,
      },
    };
    mockStoreState.chats = [mockChat];

    const deps = {
      sessionId: "chat-1",
      addMessage: vi.fn(async () => undefined),
      setSessionProcessing: vi.fn(),
      updateSession: vi.fn(),
    };

    const { result } = renderHook(() => useMessageStreaming(deps));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    // Processing was set to true early and must be cleared on error
    expect(deps.setSessionProcessing).toHaveBeenCalledWith("chat-1", true);
    expect(deps.setSessionProcessing).toHaveBeenLastCalledWith("chat-1", false);
  });

  it("does not reload history on error retry when server preserves full history", async () => {
    mockStoreState.agentAvailability = true;
    mockStoreState.chats = [
      {
        id: "chat-1",
        title: "Test Chat",
        createdAt: Date.now(),
        messages: [],
        config: {
          systemPromptId: "general_assistant",
          baseSystemPrompt: "",
          lastUsedEnhancedPrompt: null,
        },
        currentInteraction: {
          machineState: "idle",
          streamingMessageId: null,
          streamingContent: null,
        },
      },
    ];
    mockAgentTruncateSessionMessages.mockResolvedValueOnce({
      success: true,
      session_id: "chat-1",
      messages_removed: 0,
      message_count: 6,
    });
    mockAgentExecute.mockResolvedValueOnce({
      session_id: "chat-1",
      status: "started",
      events_url: "/api/v1/events/chat-1",
    });

    const deps = {
      sessionId: "chat-1",
      addMessage: vi.fn(async () => undefined),
      setSessionProcessing: vi.fn(),
      updateSession: vi.fn(),
    };

    const { result } = renderHook(() => useMessageStreaming(deps));

    await act(async () => {
      await result.current.retryLastTurn(undefined, "error_retry");
    });

    expect(mockAgentTruncateSessionMessages).toHaveBeenCalledWith("chat-1", {
      mode: "error_retry",
    });
    expect(mockStoreState.loadChatHistory).not.toHaveBeenCalled();
  });

  it("reloads history on error retry when server truncated dangling tool tail", async () => {
    mockStoreState.agentAvailability = true;
    mockStoreState.chats = [
      {
        id: "chat-1",
        title: "Test Chat",
        createdAt: Date.now(),
        messages: [],
        config: {
          systemPromptId: "general_assistant",
          baseSystemPrompt: "",
          lastUsedEnhancedPrompt: null,
        },
        currentInteraction: {
          machineState: "idle",
          streamingMessageId: null,
          streamingContent: null,
        },
      },
    ];
    mockAgentTruncateSessionMessages.mockResolvedValueOnce({
      success: true,
      session_id: "chat-1",
      messages_removed: 2,
      message_count: 4,
    });
    mockAgentExecute.mockResolvedValueOnce({
      session_id: "chat-1",
      status: "started",
      events_url: "/api/v1/events/chat-1",
    });

    const deps = {
      sessionId: "chat-1",
      addMessage: vi.fn(async () => undefined),
      setSessionProcessing: vi.fn(),
      updateSession: vi.fn(),
    };

    const { result } = renderHook(() => useMessageStreaming(deps));

    await act(async () => {
      await result.current.retryLastTurn(undefined, "error_retry");
    });

    expect(mockAgentTruncateSessionMessages).toHaveBeenCalledWith("chat-1", {
      mode: "error_retry",
    });
    expect(mockStoreState.loadChatHistory).toHaveBeenCalledWith("chat-1", {
      mode: "replace",
    });
  });

  it("recovers from two consecutive need_sync responses without hanging processing", async () => {
    mockStoreState.agentAvailability = true;
    mockStoreState.loadChatHistory.mockResolvedValue(undefined);
    mockAgentApiGet.mockResolvedValue({ has_pending_question: false });
    mockAgentSendMessage.mockResolvedValue({
      session_id: "chat-1",
      status: "started",
    });
    mockAgentExecute
      .mockResolvedValueOnce({
        session_id: "chat-1",
        status: "completed",
        events_url: "/api/v1/events/chat-1",
        sync: {
          need_sync: true,
          reason: "message_count_mismatch",
          server_message_count: 4,
          server_last_message_id: "msg-4",
          has_pending_question: false,
          pending_question_tool_call_id: null,
          has_pending_user_message: true,
        },
      })
      .mockResolvedValueOnce({
        session_id: "chat-1",
        status: "completed",
        events_url: "/api/v1/events/chat-1",
        sync: {
          need_sync: true,
          reason: "last_message_id_mismatch",
          server_message_count: 5,
          server_last_message_id: "msg-5",
          has_pending_question: false,
          pending_question_tool_call_id: null,
          has_pending_user_message: true,
        },
      })
      .mockResolvedValueOnce({
        session_id: "chat-1",
        status: "completed",
        events_url: "/api/v1/events/chat-1",
        sync: {
          need_sync: true,
          reason: "last_message_id_mismatch",
          server_message_count: 6,
          server_last_message_id: "msg-6",
          has_pending_question: false,
          pending_question_tool_call_id: null,
          has_pending_user_message: true,
        },
      });

    mockStoreState.chats = [
      {
        id: "chat-1",
        title: "Test Chat",
        createdAt: Date.now(),
        messageCount: 3,
        messages: [],
        config: {
          systemPromptId: "general_assistant",
          baseSystemPrompt: "",
          lastUsedEnhancedPrompt: null,
          syncCursor: {
            messageCount: 3,
            lastMessageId: "msg-3",
            hasPendingQuestion: false,
            pendingQuestionToolCallId: null,
          },
        },
        currentInteraction: {
          machineState: "idle",
          streamingMessageId: null,
          streamingContent: null,
        },
      },
    ];

    const deps = {
      sessionId: "chat-1",
      addMessage: vi.fn(async () => undefined),
      setSessionProcessing: vi.fn(),
      updateSession: vi.fn(),
    };

    const { result } = renderHook(() => useMessageStreaming(deps));

    await act(async () => {
      await result.current.sendMessage("hello");
    });

    expect(mockAgentExecute).toHaveBeenCalledTimes(3);
    expect(mockAgentApiGet).toHaveBeenCalledTimes(2);
    expect(mockStoreState.loadChatHistory).toHaveBeenCalledTimes(3);
    expect(deps.setSessionProcessing).toHaveBeenLastCalledWith("chat-1", false);
  });
});
