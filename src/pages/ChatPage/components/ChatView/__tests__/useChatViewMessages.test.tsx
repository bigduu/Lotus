import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useChatViewMessages, type RenderableEntry } from "../useChatViewMessages";
import type {
  AssistantToolCallMessage,
  AssistantToolResultMessage,
  ChatItem,
  Message,
} from "../../../types/chat";

const buildChat = (): ChatItem => ({
  id: "session-1",
  title: "Session",
  createdAt: Date.now(),
  messages: [],
  config: {
    systemPromptId: "default",
    baseSystemPrompt: "",
    lastUsedEnhancedPrompt: null,
  },
  currentInteraction: null,
});

const buildToolCallMessage = (
  id: string,
  createdAt: string,
  toolCallIds: string[],
): AssistantToolCallMessage => ({
  id,
  createdAt,
  role: "assistant",
  type: "tool_call",
  toolCalls: toolCallIds.map((toolCallId, index) => ({
    toolCallId,
    toolName: `tool-${index + 1}`,
    parameters: {},
    streamingOutput: "",
  })),
});

const buildNamedToolCallMessage = (
  id: string,
  createdAt: string,
  toolCalls: Array<{ toolCallId: string; toolName: string }>,
): AssistantToolCallMessage => ({
  id,
  createdAt,
  role: "assistant",
  type: "tool_call",
  toolCalls: toolCalls.map((toolCall) => ({
    toolCallId: toolCall.toolCallId,
    toolName: toolCall.toolName,
    parameters: {},
    streamingOutput: "",
  })),
});

const buildToolResultMessage = (
  id: string,
  createdAt: string,
  toolCallId: string,
  result: string,
  toolName = "tool",
): AssistantToolResultMessage => ({
  id,
  createdAt,
  role: "assistant",
  type: "tool_result",
  toolName,
  toolCallId,
  isError: false,
  result: {
    tool_name: toolName,
    result,
    display_preference: "Default",
  },
});

const buildTextMessage = (id: string, createdAt: string, content: string): Message =>
  ({
    id,
    createdAt,
    role: "assistant",
    type: "text",
    content,
  }) as Message;

const getToolSessionEntries = (
  entries: RenderableEntry[],
): Extract<RenderableEntry, { type: "tool_session" }>[] =>
  entries.filter(
    (entry): entry is Extract<RenderableEntry, { type: "tool_session" }> =>
      "type" in entry && entry.type === "tool_session",
  );

describe("useChatViewMessages tool session keys", () => {
  it("merges multiple tool calls from one message into a single tool_session entry", () => {
    const chat = buildChat();
    const messages: Message[] = [
      buildToolCallMessage("assistant-call", "2026-03-24T00:00:00.000Z", ["call-1", "call-2"]),
    ];

    const { result } = renderHook(() => useChatViewMessages(chat, messages));
    const toolEntries = getToolSessionEntries(result.current.renderableMessages);

    // Both calls should be merged into a single tool_session entry
    expect(toolEntries).toHaveLength(1);
    expect(toolEntries[0].tools).toHaveLength(2);
  });

  it("pairs results in order when toolCallId is reused before results arrive", () => {
    const chat = buildChat();
    const messages: Message[] = [
      buildToolCallMessage("assistant-call-1", "2026-03-24T00:00:00.000Z", ["dup"]),
      buildToolCallMessage("assistant-call-2", "2026-03-24T00:00:01.000Z", ["dup"]),
      buildToolResultMessage("result-1", "2026-03-24T00:00:02.000Z", "dup", "first"),
      buildToolResultMessage("result-2", "2026-03-24T00:00:03.000Z", "dup", "second"),
    ];

    const { result } = renderHook(() => useChatViewMessages(chat, messages));
    const toolEntries = getToolSessionEntries(result.current.renderableMessages);

    // Adjacent tool calls should be merged into one entry
    expect(toolEntries).toHaveLength(1);
    expect(toolEntries[0].tools).toHaveLength(2);
    expect(toolEntries[0].tools[0].resultMessageId).toBe("result-1");
    expect(toolEntries[0].tools[1].resultMessageId).toBe("result-2");
  });

  it("renders conclusion as result message only (no empty tool_call card)", () => {
    const chat = buildChat();
    const messages: Message[] = [
      buildNamedToolCallMessage("assistant-call", "2026-03-24T00:00:00.000Z", [
        { toolCallId: "c-1", toolName: "conclusion" },
      ]),
      buildToolResultMessage(
        "result-1",
        "2026-03-24T00:00:01.000Z",
        "c-1",
        JSON.stringify({
          type: "conclusion",
          conclusion: "Done",
        }),
        "conclusion",
      ),
    ];

    const { result } = renderHook(() => useChatViewMessages(chat, messages));
    const renderable = result.current.renderableMessages;
    const toolEntries = getToolSessionEntries(renderable);

    expect(toolEntries).toHaveLength(0);
    expect(
      renderable.filter((entry) => !("type" in entry)).map((entry) => entry.message.id),
    ).toEqual(["result-1"]);
  });

  it("keeps conclusion_with_options as regular message entries so interactive cards can render", () => {
    const chat = buildChat();
    const callId = "ask-1";
    const toolCallMessage = buildNamedToolCallMessage(
      "assistant-call",
      "2026-03-24T00:00:00.000Z",
      [{ toolCallId: callId, toolName: "conclusion_with_options" }],
    );
    const toolResultMessage = buildToolResultMessage(
      "result-ask",
      "2026-03-24T00:00:01.000Z",
      callId,
      JSON.stringify({
        status: "awaiting_user_input",
        question: "Any other requests before I finish?",
        options: ["OK", "Need changes"],
        allow_custom: true,
        conclusion: {
          summary: "Everything is done.",
          mermaid: {
            graph: "graph TD\nA[Done]-->B[Confirm]",
          },
        },
      }),
      "conclusion_with_options",
    );

    const { result } = renderHook(() =>
      useChatViewMessages(chat, [toolCallMessage, toolResultMessage]),
    );
    const renderable = result.current.renderableMessages;
    const toolEntries = getToolSessionEntries(renderable);
    const messageEntries = renderable.filter((entry) => !("type" in entry));

    expect(toolEntries).toHaveLength(0);
    expect(messageEntries.map((entry) => entry.message.type)).toEqual(["tool_call", "tool_result"]);
    expect(messageEntries[0].message.id).toContain(callId);
    expect(messageEntries[1].message.id).toBe("result-ask");
  });

  describe("adjacent tool call merging", () => {
    it("merges 3 consecutive tool_call messages into 1 tool_session entry with 3 tools", () => {
      const chat = buildChat();
      const messages: Message[] = [
        buildToolCallMessage("assistant-call-1", "2026-03-24T00:00:00.000Z", ["call-1"]),
        buildToolCallMessage("assistant-call-2", "2026-03-24T00:00:01.000Z", ["call-2"]),
        buildToolCallMessage("assistant-call-3", "2026-03-24T00:00:02.000Z", ["call-3"]),
      ];

      const { result } = renderHook(() => useChatViewMessages(chat, messages));
      const toolEntries = getToolSessionEntries(result.current.renderableMessages);

      expect(toolEntries).toHaveLength(1);
      expect(toolEntries[0].tools).toHaveLength(3);
    });

    it("splits into 2 tool_sessions when an assistant text message interrupts", () => {
      const chat = buildChat();
      const messages: Message[] = [
        buildToolCallMessage("assistant-call-1", "2026-03-24T00:00:00.000Z", ["call-1"]),
        buildTextMessage("text-msg", "2026-03-24T00:00:01.000Z", "thinking..."),
        buildToolCallMessage("assistant-call-2", "2026-03-24T00:00:02.000Z", ["call-2"]),
      ];

      const { result } = renderHook(() => useChatViewMessages(chat, messages));
      const toolEntries = getToolSessionEntries(result.current.renderableMessages);

      expect(toolEntries).toHaveLength(2);
      expect(toolEntries[0].tools).toHaveLength(1);
      expect(toolEntries[1].tools).toHaveLength(1);
    });

    it("merges calls from the same tool_call message into one session", () => {
      const chat = buildChat();
      const messages: Message[] = [
        buildToolCallMessage("assistant-call", "2026-03-24T00:00:00.000Z", [
          "call-a",
          "call-b",
          "call-c",
        ]),
      ];

      const { result } = renderHook(() => useChatViewMessages(chat, messages));
      const toolEntries = getToolSessionEntries(result.current.renderableMessages);

      expect(toolEntries).toHaveLength(1);
      expect(toolEntries[0].tools).toHaveLength(3);
    });

    it("merges calls from consecutive tool_call messages even with different message ids", () => {
      const chat = buildChat();
      const messages: Message[] = [
        buildToolCallMessage("msg-1", "2026-03-24T00:00:00.000Z", ["call-1"]),
        buildToolCallMessage("msg-2", "2026-03-24T00:00:01.000Z", ["call-2"]),
        buildToolCallMessage("msg-3", "2026-03-24T00:00:02.000Z", ["call-3"]),
        buildToolResultMessage("result-1", "2026-03-24T00:00:03.000Z", "call-1", "done-1"),
        buildToolResultMessage("result-2", "2026-03-24T00:00:04.000Z", "call-2", "done-2"),
        buildToolResultMessage("result-3", "2026-03-24T00:00:05.000Z", "call-3", "done-3"),
      ];

      const { result } = renderHook(() => useChatViewMessages(chat, messages));
      const toolEntries = getToolSessionEntries(result.current.renderableMessages);

      expect(toolEntries).toHaveLength(1);
      expect(toolEntries[0].tools).toHaveLength(3);
      // All results should be paired
      expect(toolEntries[0].tools[0].result?.result?.result).toBe("done-1");
      expect(toolEntries[0].tools[1].result?.result?.result).toBe("done-2");
      expect(toolEntries[0].tools[2].result?.result?.result).toBe("done-3");
    });

    it("conclusion_with_options passthrough interrupts merging", () => {
      const chat = buildChat();
      const messages: Message[] = [
        buildToolCallMessage("assistant-call-1", "2026-03-24T00:00:00.000Z", ["call-1"]),
        buildNamedToolCallMessage("assistant-call-2", "2026-03-24T00:00:01.000Z", [
          { toolCallId: "ask-1", toolName: "conclusion_with_options" },
        ]),
        buildToolCallMessage("assistant-call-3", "2026-03-24T00:00:02.000Z", ["call-3"]),
      ];

      const { result } = renderHook(() => useChatViewMessages(chat, messages));
      const toolEntries = getToolSessionEntries(result.current.renderableMessages);

      // call-1 and call-3 are separated by the passthrough conclusion_with_options
      expect(toolEntries).toHaveLength(2);
      expect(toolEntries[0].tools).toHaveLength(1);
      expect(toolEntries[1].tools).toHaveLength(1);
    });
  });
});
