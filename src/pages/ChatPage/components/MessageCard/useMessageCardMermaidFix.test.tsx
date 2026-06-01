import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPatchSessionMessage,
  mockCompletionsCreate,
  mockStoreState,
  mockGetState,
  mockLoadChatHistory,
} = vi.hoisted(() => {
  const state: any = {
    currentSessionId: null as string | null,
    chats: [] as any[],
    updateSession: vi.fn(),
    loadChatHistory: vi.fn(async () => undefined),
  };

  return {
    mockPatchSessionMessage: vi.fn(),
    mockCompletionsCreate: vi.fn(),
    mockStoreState: state,
    mockGetState: vi.fn(() => state),
    mockLoadChatHistory: state.loadChatHistory,
  };
});

vi.mock("../../hooks/useActiveModel", () => ({
  useFastModel: () => "gpt-5",
}));

vi.mock("../../services/openaiClient", () => ({
  getOpenAIClient: () => ({
    chat: {
      completions: {
        create: mockCompletionsCreate,
      },
    },
  }),
}));

vi.mock("@services/chat/AgentService", () => ({
  agentClient: {
    patchSessionMessage: mockPatchSessionMessage,
  },
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: Object.assign(() => mockStoreState, {
    getState: mockGetState,
  }),
}));

import { useMessageCardMermaidFix } from "./useMessageCardMermaidFix";

const createChatWithAssistantMessage = (content: string) => ({
  id: "session-1",
  title: "Session",
  createdAt: Date.now(),
  messages: [
    {
      id: "assistant-1",
      role: "assistant",
      type: "text",
      content,
      createdAt: new Date().toISOString(),
    },
  ],
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
});

describe("useMessageCardMermaidFix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreState.currentSessionId = null;
    mockStoreState.chats = [];
    mockStoreState.updateSession = vi.fn();
    mockStoreState.loadChatHistory = mockLoadChatHistory;
    mockStoreState.loadChatHistory.mockResolvedValue(undefined);
    mockGetState.mockImplementation(() => mockStoreState);
  });

  it("persists fixed mermaid content and updates local session messages", async () => {
    mockStoreState.currentSessionId = "session-1";
    mockStoreState.chats = [
      createChatWithAssistantMessage(
        ["before", "```mermaid", "graph TD", "A -->", "```", "after"].join("\n"),
      ),
    ];
    mockCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "graph TD\nA --> B" } }],
    });
    mockPatchSessionMessage.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useMessageCardMermaidFix("assistant-1"));

    await result.current("graph TD\nA -->", "Parse error");

    expect(mockCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5",
        temperature: 0,
      }),
    );

    expect(mockPatchSessionMessage).toHaveBeenCalledWith("session-1", "assistant-1", {
      content: expect.stringContaining("A --> B"),
    });

    expect(mockStoreState.updateSession).toHaveBeenCalledTimes(1);
    const [sessionId, payload] = mockStoreState.updateSession.mock.calls[0];
    expect(sessionId).toBe("session-1");
    const updatedMessage = payload.messages.find((message: any) => message.id === "assistant-1");
    expect(updatedMessage.content).toContain("```mermaid\ngraph TD\nA --> B\n```");
  });

  it("throws when there is no active chat", async () => {
    const { result } = renderHook(() => useMessageCardMermaidFix("assistant-1"));

    await expect(result.current("graph TD\nA -->")).rejects.toThrow("No active chat available");
    expect(mockPatchSessionMessage).not.toHaveBeenCalled();
  });

  it("throws when the target message is not assistant text", async () => {
    mockStoreState.currentSessionId = "session-1";
    mockStoreState.chats = [
      {
        ...createChatWithAssistantMessage("irrelevant"),
        messages: [
          {
            id: "assistant-1",
            role: "user",
            content: "hello",
            createdAt: new Date().toISOString(),
          },
        ],
      },
    ];

    const { result } = renderHook(() => useMessageCardMermaidFix("assistant-1"));

    await expect(result.current("graph TD\nA -->")).rejects.toThrow(
      "Mermaid fix is only available for assistant text messages",
    );
    expect(mockPatchSessionMessage).not.toHaveBeenCalled();
  });

  it("falls back to replacing the first mermaid block when exact match fails", async () => {
    mockStoreState.currentSessionId = "session-1";
    mockStoreState.chats = [createChatWithAssistantMessage("```mermaid\ngraph TD\nX --> Y\n```")];
    mockCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "graph TD\nX --> Z" } }],
    });
    mockPatchSessionMessage.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useMessageCardMermaidFix("assistant-1"));

    await result.current("graph TD\nA -->", "Parse error");

    expect(mockPatchSessionMessage).toHaveBeenCalledWith("session-1", "assistant-1", {
      content: "```mermaid\ngraph TD\nX --> Z\n```",
    });
    expect(mockStoreState.updateSession).toHaveBeenCalledTimes(1);
  });

  it("falls back to replacing the first mermaid block when the stored block has been polluted", async () => {
    mockStoreState.currentSessionId = "session-1";
    mockStoreState.chats = [
      createChatWithAssistantMessage(
        "```mermaid\ngraph TD\nA[Start] --> B[Done]``Now I'm wondering if this should be simplified\n```",
      ),
    ];
    mockCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "graph TD\nA[Start] --> B[Done]" } }],
    });
    mockPatchSessionMessage.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useMessageCardMermaidFix("assistant-1"));

    await result.current("graph TD\nA[Start] --> B[Done]", "Parse error on line 6");

    expect(mockPatchSessionMessage).toHaveBeenCalledWith("session-1", "assistant-1", {
      content: "```mermaid\ngraph TD\nA[Start] --> B[Done]\n```",
    });
    expect(mockStoreState.updateSession).toHaveBeenCalledTimes(1);
  });

  it("uses explicit session id when provided", async () => {
    mockStoreState.currentSessionId = "session-2";
    mockStoreState.chats = [
      createChatWithAssistantMessage("```mermaid\ngraph TD\nA -->\n```"),
      {
        ...createChatWithAssistantMessage("other"),
        id: "session-2",
      },
    ];
    mockCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "graph TD\nA --> B" } }],
    });
    mockPatchSessionMessage.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useMessageCardMermaidFix("assistant-1", "session-1"));

    await result.current("graph TD\nA -->", "Parse error");

    expect(mockPatchSessionMessage).toHaveBeenCalledWith(
      "session-1",
      "assistant-1",
      expect.objectContaining({
        content: expect.stringContaining("A --> B"),
      }),
    );
  });

  it("maps derived text id to backend message id", async () => {
    mockStoreState.currentSessionId = "session-1";
    mockStoreState.chats = [
      {
        ...createChatWithAssistantMessage("irrelevant"),
        messages: [
          {
            id: "assistant-1_text",
            role: "assistant",
            type: "text",
            content: "```mermaid\ngraph TD\nA -->\n```",
            createdAt: new Date().toISOString(),
            metadata: {
              backendMessageId: "assistant-1",
            },
          },
          {
            id: "assistant-1",
            role: "assistant",
            type: "tool_call",
            toolCalls: [],
            createdAt: new Date().toISOString(),
          },
        ],
      },
    ];
    mockCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "graph TD\nA --> B" } }],
    });
    mockPatchSessionMessage.mockResolvedValueOnce(undefined);

    const { result } = renderHook(() => useMessageCardMermaidFix("assistant-1_text"));

    await result.current("graph TD\nA -->", "Parse error");

    expect(mockPatchSessionMessage).toHaveBeenCalledWith(
      "session-1",
      "assistant-1",
      expect.objectContaining({
        content: expect.stringContaining("A --> B"),
      }),
    );
  });

  it("reloads history and retries patch when backend message id changes", async () => {
    mockStoreState.currentSessionId = "session-1";
    mockStoreState.chats = [
      {
        ...createChatWithAssistantMessage("```mermaid\ngraph TD\nA -->\n```"),
        messages: [
          {
            id: "assistant-local",
            role: "assistant",
            type: "text",
            content: "```mermaid\ngraph TD\nA -->\n```",
            createdAt: new Date().toISOString(),
          },
        ],
      },
    ];
    mockCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "graph TD\nA --> B" } }],
    });
    mockPatchSessionMessage
      .mockRejectedValueOnce(new Error("Message not found"))
      .mockResolvedValueOnce(undefined);
    mockStoreState.loadChatHistory.mockImplementationOnce(async () => {
      mockStoreState.chats = [
        {
          ...createChatWithAssistantMessage("irrelevant"),
          messages: [
            {
              id: "assistant-persisted",
              role: "assistant",
              type: "text",
              content: "```mermaid\ngraph TD\nA -->\n```",
              createdAt: new Date().toISOString(),
            },
          ],
        },
      ];
    });

    const { result } = renderHook(() => useMessageCardMermaidFix("assistant-local"));

    await result.current("graph TD\nA -->", "Parse error");

    expect(mockStoreState.loadChatHistory).toHaveBeenCalledWith("session-1", {
      mode: "replace",
      retries: 2,
      retryDelayMs: 150,
      waitForAssistant: true,
    });
    expect(mockPatchSessionMessage).toHaveBeenNthCalledWith(
      2,
      "session-1",
      "assistant-persisted",
      expect.objectContaining({
        content: expect.stringContaining("A --> B"),
      }),
    );
  });
});
