import { describe, expect, it, vi } from "vitest";
import type { Message } from "@shared/types/chat";
import {
  detectMessageType,
  parsePlanMessage,
  parseQuestionMessage,
  getMessageText,
} from "../messageCardParsing";

// Mock console.error to reduce test noise
global.console = {
  ...console,
  error: vi.fn(),
};

describe("messageCardParsing", () => {
  describe("detectMessageType", () => {
    it("returns explicit messageType when provided", () => {
      const message: Message = {
        role: "user",
        type: "text",
        content: "test",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message, "plan")).toBe("plan");
      expect(detectMessageType(message, "question")).toBe("question");
      expect(detectMessageType(message, "tool_call")).toBe("tool_call");
      expect(detectMessageType(message, "tool_result")).toBe("tool_result");
      expect(detectMessageType(message, "text")).toBe("text");
    });

    it("returns message_type from message when valid", () => {
      const message: any = {
        role: "assistant",
        type: "text",
        content: "test",
        timestamp: "2024-01-01T00:00:00Z",
        message_type: "plan",
      };

      expect(detectMessageType(message)).toBe("plan");
    });

    it("ignores invalid message_type", () => {
      const message: any = {
        role: "assistant",
        type: "text",
        content: "test",
        timestamp: "2024-01-01T00:00:00Z",
        message_type: "invalid",
      };

      expect(detectMessageType(message)).toBe("text");
    });

    it("detects plan message from JSON with code block", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: 'Here is a plan:\n```json\n{"goal": "Test", "steps": [{"action": "step1"}]}\n```',
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("plan");
    });

    it("detects plan message from JSON without code block", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: 'Here is a plan: {"goal": "Test", "steps": [{"action": "step1"}]}',
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("plan");
    });

    it("detects question message from JSON with code block", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: 'Here is a question:\n```json\n{"type": "question", "question": "Test?"}\n```',
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("question");
    });

    it("detects question message from JSON without code block", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: 'Question: {"type": "question", "question": "Test?"}',
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("question");
    });

    it("returns text for non-assistant messages", () => {
      const message: Message = {
        role: "user",
        type: "text",
        content: "test",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("text");
    });

    it("returns text for non-text type assistant messages", () => {
      const message: Message = {
        role: "assistant",
        type: "tool_call",
        content: "",
        toolCalls: [],
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("text");
    });

    it("returns text when JSON parsing fails", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: "```json\n{invalid json}\n```",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("text");
    });

    it("returns text when JSON is not plan or question", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: '{"other": "data"}',
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("text");
    });

    it("returns text when content is not string", () => {
      const message: any = {
        role: "assistant",
        type: "text",
        content: null,
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("text");
    });

    it("returns text for plan missing steps array", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: '{"goal": "Test", "steps": "not-array"}',
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("text");
    });

    it("handles empty content", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: "",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("text");
    });

    it("handles unclosed code block", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: '```json\n{"goal": "Test", "steps": []}',
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("text");
    });

    it("handles unclosed braces", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: '{"goal": "Test"',
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(detectMessageType(message)).toBe("text");
    });
  });

  describe("parsePlanMessage", () => {
    it("returns null for non-plan message type", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: "test",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parsePlanMessage(message, "text")).toBeNull();
    });

    it("returns null for non-assistant role", () => {
      const message: Message = {
        role: "user",
        type: "text",
        content: "test",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parsePlanMessage(message, "plan")).toBeNull();
    });

    it("returns null for non-text type", () => {
      const message: Message = {
        role: "assistant",
        type: "tool_call",
        content: "",
        toolCalls: [],
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parsePlanMessage(message, "plan")).toBeNull();
    });

    it("parses plan with all fields", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: JSON.stringify({
          goal: "Test goal",
          steps: [
            {
              step_number: 1,
              action: "Action 1",
              reason: "Reason 1",
              tools_needed: ["tool1"],
              estimated_time: "5 mins",
            },
          ],
          estimated_total_time: "10 mins",
          risks: ["Risk 1"],
          prerequisites: ["Prereq 1"],
        }),
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = parsePlanMessage(message, "plan");
      expect(result).not.toBeNull();
      expect(result?.goal).toBe("Test goal");
      expect(result?.steps).toHaveLength(1);
      expect(result?.steps[0].step_number).toBe(1);
      expect(result?.steps[0].action).toBe("Action 1");
      expect(result?.steps[0].reason).toBe("Reason 1");
      expect(result?.steps[0].tools_needed).toEqual(["tool1"]);
      expect(result?.steps[0].estimated_time).toBe("5 mins");
      expect(result?.estimated_total_time).toBe("10 mins");
      expect(result?.risks).toEqual(["Risk 1"]);
      expect(result?.prerequisites).toEqual(["Prereq 1"]);
    });

    it("handles alternative field names", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: JSON.stringify({
          goal: "Test goal",
          steps: [
            {
              stepNumber: 2,
              action: "Action 2",
              rationale: "Rationale 2",
              tools: ["tool2"],
              estimatedTime: "10 mins",
            },
          ],
          estimatedTotalTime: "20 mins",
        }),
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = parsePlanMessage(message, "plan");
      expect(result).not.toBeNull();
      expect(result?.steps[0].step_number).toBe(2);
      expect(result?.steps[0].reason).toBe("Rationale 2");
      expect(result?.steps[0].tools_needed).toEqual(["tool2"]);
      expect(result?.steps[0].estimated_time).toBe("10 mins");
      expect(result?.estimated_total_time).toBe("20 mins");
    });

    it("provides defaults for missing fields", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: JSON.stringify({
          goal: "Test goal",
          steps: [{}],
        }),
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = parsePlanMessage(message, "plan");
      expect(result).not.toBeNull();
      expect(result?.steps[0].step_number).toBe(0);
      expect(result?.steps[0].action).toBe("");
      expect(result?.steps[0].reason).toBe("");
      expect(result?.steps[0].tools_needed).toEqual([]);
      expect(result?.steps[0].estimated_time).toBe("");
      expect(result?.estimated_total_time).toBe("");
      expect(result?.risks).toEqual([]);
      expect(result?.prerequisites).toEqual([]);
    });

    it("returns null when JSON parsing fails", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: "{invalid json}",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parsePlanMessage(message, "plan")).toBeNull();
    });

    it("returns null when goal is missing", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: JSON.stringify({
          steps: [{ action: "Action" }],
        }),
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parsePlanMessage(message, "plan")).toBeNull();
    });

    it("returns null when steps is missing", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: JSON.stringify({
          goal: "Test",
        }),
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parsePlanMessage(message, "plan")).toBeNull();
    });

    it("parses plan from code block", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content:
          "Here's the plan:\n```json\n" +
          JSON.stringify({
            goal: "Test",
            steps: [{ action: "Step 1" }],
          }) +
          "\n```",
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = parsePlanMessage(message, "plan");
      expect(result).not.toBeNull();
      expect(result?.goal).toBe("Test");
    });

    it("handles null content", () => {
      const message: any = {
        role: "assistant",
        type: "text",
        content: null,
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parsePlanMessage(message, "plan")).toBeNull();
    });

    it("handles undefined content", () => {
      const message: any = {
        role: "assistant",
        type: "text",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parsePlanMessage(message, "plan")).toBeNull();
    });
  });

  describe("parseQuestionMessage", () => {
    it("returns null for non-question message type", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: "test",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parseQuestionMessage(message, "text")).toBeNull();
    });

    it("returns null for non-assistant role", () => {
      const message: Message = {
        role: "user",
        type: "text",
        content: "test",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parseQuestionMessage(message, "question")).toBeNull();
    });

    it("returns null for non-text type", () => {
      const message: Message = {
        role: "assistant",
        type: "tool_call",
        content: "",
        toolCalls: [],
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parseQuestionMessage(message, "question")).toBeNull();
    });

    it("parses question with all fields", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: JSON.stringify({
          type: "question",
          question: "What should we do?",
          context: "Some context",
          severity: "critical",
          options: ["Option 1", "Option 2"],
          default: "Option 1",
          allow_custom: true,
        }),
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = parseQuestionMessage(message, "question");
      expect(result).not.toBeNull();
      expect(result?.type).toBe("question");
      expect(result?.question).toBe("What should we do?");
      expect(result?.context).toBe("Some context");
      expect(result?.severity).toBe("critical");
      expect(result?.options).toEqual(["Option 1", "Option 2"]);
      expect(result?.default).toBe("Option 1");
      expect(result?.allow_custom).toBe(true);
    });

    it("provides defaults for missing fields", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: JSON.stringify({
          type: "question",
          question: "Test?",
        }),
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = parseQuestionMessage(message, "question");
      expect(result).not.toBeNull();
      expect(result?.context).toBe("");
      expect(result?.severity).toBe("minor");
      expect(result?.options).toEqual([]);
      expect(result?.default).toBeUndefined();
      expect(result?.allow_custom).toBe(false);
    });

    it("returns null when type is not 'question'", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: JSON.stringify({
          type: "other",
          question: "Test?",
        }),
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parseQuestionMessage(message, "question")).toBeNull();
    });

    it("returns null when question field is missing", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: JSON.stringify({
          type: "question",
        }),
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parseQuestionMessage(message, "question")).toBeNull();
    });

    it("returns null when JSON parsing fails", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: "{invalid json}",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parseQuestionMessage(message, "question")).toBeNull();
    });

    it("parses question from code block", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content:
          "Question:\n```json\n" +
          JSON.stringify({
            type: "question",
            question: "Test?",
          }) +
          "\n```",
        timestamp: "2024-01-01T00:00:00Z",
      };

      const result = parseQuestionMessage(message, "question");
      expect(result).not.toBeNull();
      expect(result?.question).toBe("Test?");
    });

    it("handles null content", () => {
      const message: any = {
        role: "assistant",
        type: "text",
        content: null,
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parseQuestionMessage(message, "question")).toBeNull();
    });

    it("handles undefined content", () => {
      const message: any = {
        role: "assistant",
        type: "text",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(parseQuestionMessage(message, "question")).toBeNull();
    });
  });

  describe("getMessageText", () => {
    it("extracts text from system message", () => {
      const message: Message = {
        role: "system",
        type: "text",
        content: "System message",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("System message");
    });

    it("extracts text from user message", () => {
      const message: Message = {
        role: "user",
        type: "text",
        content: "User message",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("User message");
    });

    it("returns empty string for file_reference user message", () => {
      const message: any = {
        role: "user",
        type: "file_reference",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("");
    });

    it("extracts text from assistant text message", () => {
      const message: Message = {
        role: "assistant",
        type: "text",
        content: "Assistant message",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("Assistant message");
    });

    it("formats tool_result message", () => {
      const message: Message = {
        role: "assistant",
        type: "tool_result",
        content: "",
        toolName: "testTool",
        result: {
          toolCallId: "123",
          result: "Tool executed successfully",
        },
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("Tool testTool Result: Tool executed successfully");
    });

    it("formats conclusion tool results as regular assistant markdown text", () => {
      const message: Message = {
        role: "assistant",
        type: "tool_result",
        content: "",
        toolName: "conclusion",
        result: {
          toolCallId: "123",
          result: JSON.stringify({
            type: "conclusion",
            title: "Conclusion",
            conclusion: "Ready to ship",
            key_points: ["Tests passed"],
            next_steps: ["Release"],
            confidence: "high",
          }),
        },
        timestamp: "2024-01-01T00:00:00Z",
      };

      const text = getMessageText(message);
      expect(text).toContain("## Conclusion");
      expect(text).toContain("Ready to ship");
      expect(text).toContain("**Key points**");
      expect(text).toContain("**Next steps**");
    });

    it("formats tool_call message with single tool", () => {
      const message: Message = {
        role: "assistant",
        type: "tool_call",
        content: "",
        toolCalls: [
          {
            toolCallId: "123",
            toolName: "tool1",
            arguments: {},
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("Requesting to call tool1");
    });

    it("formats tool_call message with multiple tools", () => {
      const message: Message = {
        role: "assistant",
        type: "tool_call",
        content: "",
        toolCalls: [
          {
            toolCallId: "123",
            toolName: "tool1",
            arguments: {},
          },
          {
            toolCallId: "456",
            toolName: "tool2",
            arguments: {},
          },
        ],
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("Requesting to call tool1, tool2");
    });

    it("extracts text from workflow_result message", () => {
      const message: any = {
        role: "assistant",
        type: "workflow_result",
        content: "Workflow completed",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("Workflow completed");
    });

    it("returns empty string for unknown message type", () => {
      const message: any = {
        role: "unknown",
        type: "text",
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("");
    });

    it("handles non-string content for system message", () => {
      const message: any = {
        role: "system",
        type: "text",
        content: { text: "nested" },
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("");
    });

    it("handles non-string content for user message", () => {
      const message: any = {
        role: "user",
        type: "text",
        content: { text: "nested" },
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("");
    });

    it("handles non-string content for assistant message", () => {
      const message: any = {
        role: "assistant",
        type: "text",
        content: { text: "nested" },
        timestamp: "2024-01-01T00:00:00Z",
      };

      expect(getMessageText(message)).toBe("");
    });
  });
});
