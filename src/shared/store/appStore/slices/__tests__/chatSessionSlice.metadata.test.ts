/**
 * Tests for tool lifecycle metadata propagation through mapHistoryMessagesToUi.
 *
 * When a session is reloaded, the backend tool-result messages carry `metadata`
 * (elapsed_ms, is_mutating, auto_approved, tool_name, success).
 * This metadata must be propagated from the tool-result message to the
 * corresponding tool_call UI message so ToolCallCard can display badges.
 */
import { describe, expect, it } from "vitest";
import { mapHistoryMessagesToUi } from "../chatSessionSlice";
import type {
  AssistantToolCallMessage,
  AssistantToolResultMessage,
} from "@shared/types/chatMessages";

// ── Helpers ────────────────────────────────────────────────────────────

const ts = "2025-01-01T00:00:00Z";

function makeAssistantToolCallMsg(id: string, toolCallId: string, toolName: string) {
  return {
    id,
    role: "assistant" as const,
    content: "",
    tool_calls: [
      {
        id: toolCallId,
        type: "function",
        function: { name: toolName, arguments: '{"file_path":"test.rs"}' },
      },
    ],
    created_at: ts,
  };
}

function makeToolResultMsg(
  id: string,
  toolCallId: string,
  content: string,
  metadata?: Record<string, unknown>,
) {
  return {
    id,
    role: "tool" as const,
    content,
    tool_call_id: toolCallId,
    tool_success: true,
    metadata,
    created_at: ts,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("mapHistoryMessagesToUi — metadata propagation", () => {
  it("propagates metadata from tool result to tool_call message", () => {
    const history = [
      { id: "u1", role: "user" as const, content: "read the file", created_at: ts },
      makeAssistantToolCallMsg("a1", "call-1", "Read"),
      makeToolResultMsg("t1", "call-1", '{"content":"file data"}', {
        elapsed_ms: 150,
        is_mutating: false,
        auto_approved: true,
        tool_name: "Read",
        success: true,
      }),
    ];

    const messages = mapHistoryMessagesToUi("session-1", history);

    // Find the tool_call message
    const toolCallMsg = messages.find(
      (m) => m.role === "assistant" && "type" in m && m.type === "tool_call",
    ) as AssistantToolCallMessage | undefined;

    expect(toolCallMsg).toBeDefined();
    expect(toolCallMsg!.metadata).toBeDefined();
    expect(toolCallMsg!.metadata!.elapsed_ms).toBe(150);
    expect(toolCallMsg!.metadata!.is_mutating).toBe(false);
  });

  it("does not add metadata when tool result has no metadata", () => {
    const history = [
      { id: "u1", role: "user" as const, content: "hi", created_at: ts },
      makeAssistantToolCallMsg("a1", "call-1", "Read"),
      makeToolResultMsg("t1", "call-1", "result content"),
    ];

    const messages = mapHistoryMessagesToUi("session-2", history);

    const toolCallMsg = messages.find(
      (m) => m.role === "assistant" && "type" in m && m.type === "tool_call",
    ) as AssistantToolCallMessage | undefined;

    expect(toolCallMsg).toBeDefined();
    // metadata should be undefined or not present
    expect(toolCallMsg!.metadata).toBeUndefined();
  });

  it("propagates metadata for mutating tool (Bash)", () => {
    const history = [
      { id: "u1", role: "user" as const, content: "run tests", created_at: ts },
      makeAssistantToolCallMsg("a1", "call-1", "Bash"),
      makeToolResultMsg("t1", "call-1", "exit_code: 0", {
        elapsed_ms: 5200,
        is_mutating: true,
        auto_approved: false,
        tool_name: "Bash",
        success: true,
      }),
    ];

    const messages = mapHistoryMessagesToUi("session-3", history);

    const toolCallMsg = messages.find(
      (m) => m.role === "assistant" && "type" in m && m.type === "tool_call",
    ) as AssistantToolCallMessage | undefined;

    expect(toolCallMsg).toBeDefined();
    expect(toolCallMsg!.metadata).toBeDefined();
    expect(toolCallMsg!.metadata!.elapsed_ms).toBe(5200);
    expect(toolCallMsg!.metadata!.is_mutating).toBe(true);
  });

  it("handles multiple tool calls with different metadata", () => {
    const history = [
      { id: "u1", role: "user" as const, content: "check file and run tests", created_at: ts },
      // First assistant turn: Read
      makeAssistantToolCallMsg("a1", "call-1", "Read"),
      makeToolResultMsg("t1", "call-1", "file content", {
        elapsed_ms: 50,
        is_mutating: false,
        tool_name: "Read",
        success: true,
      }),
      // Second assistant turn: Bash
      makeAssistantToolCallMsg("a2", "call-2", "Bash"),
      makeToolResultMsg("t2", "call-2", "test pass", {
        elapsed_ms: 3000,
        is_mutating: true,
        tool_name: "Bash",
        success: true,
      }),
    ];

    const messages = mapHistoryMessagesToUi("session-4", history);

    const toolCallMsgs = messages.filter(
      (m) => m.role === "assistant" && "type" in m && m.type === "tool_call",
    ) as AssistantToolCallMessage[];

    expect(toolCallMsgs).toHaveLength(2);

    // First tool call (Read) should have its own metadata
    expect(toolCallMsgs[0].metadata?.elapsed_ms).toBe(50);
    expect(toolCallMsgs[0].metadata?.is_mutating).toBe(false);

    // Second tool call (Bash) should have its own metadata
    expect(toolCallMsgs[1].metadata?.elapsed_ms).toBe(3000);
    expect(toolCallMsgs[1].metadata?.is_mutating).toBe(true);
  });

  it("tool_result messages remain in output as AssistantToolResultMessage", () => {
    const history = [
      { id: "u1", role: "user" as const, content: "read file", created_at: ts },
      makeAssistantToolCallMsg("a1", "call-1", "Read"),
      makeToolResultMsg("t1", "call-1", '{"content":"data"}', {
        elapsed_ms: 80,
        is_mutating: false,
      }),
    ];

    const messages = mapHistoryMessagesToUi("session-5", history);

    const toolResultMsg = messages.find(
      (m) => m.role === "assistant" && "type" in m && m.type === "tool_result",
    ) as AssistantToolResultMessage | undefined;

    expect(toolResultMsg).toBeDefined();
    expect(toolResultMsg!.toolCallId).toBe("call-1");
    expect(toolResultMsg!.toolName).toBe("Read");
  });

  it("handles old session data without metadata field gracefully", () => {
    // Simulates old session where backend never wrote metadata
    const history = [
      { id: "u1", role: "user" as const, content: "hi", created_at: ts },
      {
        id: "a1",
        role: "assistant" as const,
        content: "",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "Read", arguments: '{"file_path":"x.ts"}' },
          },
        ],
        created_at: ts,
      },
      {
        id: "t1",
        role: "tool" as const,
        content: "file content",
        tool_call_id: "call-1",
        tool_success: true,
        // No metadata field at all
        created_at: ts,
      },
    ];

    const messages = mapHistoryMessagesToUi("session-old", history);

    const toolCallMsg = messages.find(
      (m) => m.role === "assistant" && "type" in m && m.type === "tool_call",
    ) as AssistantToolCallMessage | undefined;

    expect(toolCallMsg).toBeDefined();
    expect(toolCallMsg!.metadata).toBeUndefined();
  });

  it("propagates metadata when tool result comes before tool_call in history (edge case)", () => {
    // The pre-build map handles out-of-order: tool result messages are scanned
    // first before constructing tool_call messages. Even if all tool results are
    // at the end, the map-based approach picks them up.
    const history = [
      { id: "u1", role: "user" as const, content: "do stuff", created_at: ts },
      // Tool result appears before the assistant message (unusual but possible)
      makeToolResultMsg("t1", "call-1", "result", {
        elapsed_ms: 99,
        is_mutating: false,
      }),
      makeAssistantToolCallMsg("a1", "call-1", "Read"),
    ];

    const messages = mapHistoryMessagesToUi("session-edge", history);

    const toolCallMsg = messages.find(
      (m) => m.role === "assistant" && "type" in m && m.type === "tool_call",
    ) as AssistantToolCallMessage | undefined;

    // The metadata map is built from ALL messages before the main loop,
    // so it should be available regardless of order.
    expect(toolCallMsg).toBeDefined();
    expect(toolCallMsg!.metadata?.elapsed_ms).toBe(99);
  });
});
