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

const getToolSessionEntries = (
  entries: RenderableEntry[],
): Extract<RenderableEntry, { type: "tool_session" }>[] =>
  entries.filter(
    (entry): entry is Extract<RenderableEntry, { type: "tool_session" }> =>
      "type" in entry && entry.type === "tool_session",
  );

describe("useChatViewMessages tool session keys", () => {
  it("generates unique tool_session ids for multiple calls in one tool_call message", () => {
    const chat = buildChat();
    const messages: Message[] = [
      buildToolCallMessage("assistant-call", "2026-03-24T00:00:00.000Z", ["call-1", "call-2"]),
    ];

    const { result } = renderHook(() => useChatViewMessages(chat, messages));
    const toolEntries = getToolSessionEntries(result.current.renderableMessages);
    const entryIds = toolEntries.map((entry) => entry.id);

    expect(toolEntries).toHaveLength(2);
    expect(new Set(entryIds).size).toBe(2);
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

    expect(toolEntries).toHaveLength(2);
    expect(toolEntries[0].tools[0].resultMessageId).toBe("result-1");
    expect(toolEntries[1].tools[0].resultMessageId).toBe("result-2");
  });

  it("renders conclusion tool call/result as regular message entries (not tool session)", () => {
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
    ).toEqual(["assistant-call:tool-call:0:c-1", "result-1"]);
  });
});
