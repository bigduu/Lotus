import { describe, expect, it } from "vitest";

import { estimateChatEntrySize, getVirtualizationWeight } from "../ChatMessagesList";
import type { RenderableEntry } from "../useChatViewMessages";
import type { ToolSessionItem } from "../../ToolSessionCard";
import type { AssistantToolCallMessage } from "@shared/types/chat";

const buildToolCallMessage = (id: string, toolCallIds: string[]): AssistantToolCallMessage => ({
  id,
  createdAt: "2026-05-10T00:00:00.000Z",
  role: "assistant",
  type: "tool_call",
  toolCalls: toolCallIds.map((toolCallId, index) => ({
    toolCallId,
    toolName: `tool-${index + 1}`,
    parameters: {},
    streamingOutput: "",
  })),
});

const buildToolSessionItem = (suffix: string): ToolSessionItem => ({
  call: buildToolCallMessage(`assistant-call-${suffix}`, [`call-${suffix}`]),
  callMessageId: `assistant-call-${suffix}`,
});

describe("ChatMessagesList virtualization helpers", () => {
  it("estimates larger height for the last expanded tool session than a compression divider", () => {
    const entries: RenderableEntry[] = [
      {
        type: "compression_divider",
        id: "compression-1",
        createdAt: "2026-05-10T00:00:00.000Z",
        label: "12 messages archived",
      },
      {
        type: "tool_session",
        id: "tool-session-1",
        sessionId: "session-1",
        tools: [buildToolSessionItem("1"), buildToolSessionItem("2"), buildToolSessionItem("3")],
        createdAt: "2026-05-10T00:01:00.000Z",
      },
    ];

    expect(estimateChatEntrySize(entries, 1)).toBeGreaterThan(estimateChatEntrySize(entries, 0));
    expect(estimateChatEntrySize(entries, 1)).toBeGreaterThan(250);
  });

  it("treats a few heavy tool sessions as virtualization-worthy even when entry count is low", () => {
    const entries: RenderableEntry[] = [
      {
        type: "tool_session",
        id: "tool-session-1",
        sessionId: "session-1",
        tools: Array.from({ length: 6 }, (_, index) => buildToolSessionItem(`1-${index}`)),
        createdAt: "2026-05-10T00:00:00.000Z",
      },
      {
        type: "tool_session",
        id: "tool-session-2",
        sessionId: "session-1",
        tools: Array.from({ length: 6 }, (_, index) => buildToolSessionItem(`2-${index}`)),
        createdAt: "2026-05-10T00:01:00.000Z",
      },
      {
        type: "tool_session",
        id: "tool-session-3",
        sessionId: "session-1",
        tools: Array.from({ length: 6 }, (_, index) => buildToolSessionItem(`3-${index}`)),
        createdAt: "2026-05-10T00:02:00.000Z",
      },
    ];

    expect(entries).toHaveLength(3);
    expect(getVirtualizationWeight(entries)).toBeGreaterThan(24);
  });
});
