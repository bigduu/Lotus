import { describe, expect, it } from "vitest";
import {
  isToolExecutionResult,
  isAssistantToolResultMessage,
  isAssistantToolCallMessage,
  isWorkflowResultMessage,
  isUserFileReferenceMessage,
  isTaskListMessage,
} from "../chatGuards";
import type {
  Message,
  AssistantToolResultMessage,
  AssistantToolCallMessage,
  WorkflowResultMessage,
  UserFileReferenceMessage,
  AssistantTaskListMessage,
  ToolExecutionResult,
} from "../chatMessages";

describe("chatGuards", () => {
  describe("isToolExecutionResult", () => {
    it("should return true for valid ToolExecutionResult", () => {
      const obj: ToolExecutionResult = {
        tool_name: "test_tool",
        result: "success",
        display_preference: "Default",
      };
      expect(isToolExecutionResult(obj)).toBe(true);
    });

    it("should return true for Collapsible display_preference", () => {
      const obj = {
        result: "output",
        display_preference: "Collapsible",
      };
      expect(isToolExecutionResult(obj)).toBe(true);
    });

    it("should return true for Hidden display_preference", () => {
      const obj = {
        result: "hidden",
        display_preference: "Hidden",
      };
      expect(isToolExecutionResult(obj)).toBe(true);
    });

    it("should return false when result is not a string", () => {
      const obj = {
        result: 123,
        display_preference: "Default",
      };
      expect(isToolExecutionResult(obj)).toBe(false);
    });

    it("should return false when display_preference is not a string", () => {
      const obj = {
        result: "test",
        display_preference: 123,
      };
      expect(isToolExecutionResult(obj)).toBe(false);
    });

    it("should return false when result is missing", () => {
      const obj = {
        display_preference: "Default",
      };
      expect(isToolExecutionResult(obj)).toBe(false);
    });

    it("should return false when display_preference is missing", () => {
      const obj = {
        result: "test",
      };
      expect(isToolExecutionResult(obj)).toBe(false);
    });

    it("should return false for null", () => {
      expect(isToolExecutionResult(null)).toBeFalsy();
    });

    it("should return false for undefined", () => {
      expect(isToolExecutionResult(undefined)).toBeFalsy();
    });

    it("should return false for empty object", () => {
      expect(isToolExecutionResult({})).toBe(false);
    });

    it("should return true with additional properties", () => {
      const obj = {
        result: "test",
        display_preference: "Default",
        extra: "property",
      };
      expect(isToolExecutionResult(obj)).toBe(true);
    });
  });

  describe("isAssistantToolResultMessage", () => {
    it("should return true for valid AssistantToolResultMessage", () => {
      const message: AssistantToolResultMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "tool_result",
        toolName: "test_tool",
        toolCallId: "call-1",
        result: {
          tool_name: "test_tool",
          result: "success",
          display_preference: "Default",
        },
        isError: false,
      };
      expect(isAssistantToolResultMessage(message)).toBe(true);
    });

    it("should return false for assistant message without type", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "text",
        content: "text message",
      };
      expect(isAssistantToolResultMessage(message)).toBe(false);
    });

    it("should return false for user message", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "user",
        content: "user message",
      };
      expect(isAssistantToolResultMessage(message)).toBe(false);
    });

    it("should return false for tool_call type", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "tool_call",
        toolCalls: [],
      };
      expect(isAssistantToolResultMessage(message)).toBe(false);
    });

    it("should return false for system message", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "system",
        content: "system message",
      };
      expect(isAssistantToolResultMessage(message)).toBe(false);
    });

    it("should return true for error result", () => {
      const message: AssistantToolResultMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "tool_result",
        toolName: "failing_tool",
        toolCallId: "call-1",
        result: {
          tool_name: "failing_tool",
          result: "error",
          display_preference: "Default",
        },
        isError: true,
      };
      expect(isAssistantToolResultMessage(message)).toBe(true);
    });
  });

  describe("isAssistantToolCallMessage", () => {
    it("should return true for valid AssistantToolCallMessage", () => {
      const message: AssistantToolCallMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "tool_call",
        toolCalls: [
          {
            toolCallId: "call-1",
            toolName: "test_tool",
            parameters: { arg1: "value1" },
          },
        ],
      };
      expect(isAssistantToolCallMessage(message)).toBe(true);
    });

    it("should return true for message with empty toolCalls", () => {
      const message: AssistantToolCallMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "tool_call",
        toolCalls: [],
      };
      expect(isAssistantToolCallMessage(message)).toBe(true);
    });

    it("should return false for assistant text message", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "text",
        content: "text",
      };
      expect(isAssistantToolCallMessage(message)).toBe(false);
    });

    it("should return false for tool_result type", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "tool_result",
        toolName: "test",
        toolCallId: "call-1",
        result: {
          tool_name: "test",
          result: "ok",
          display_preference: "Default",
        },
        isError: false,
      };
      expect(isAssistantToolCallMessage(message)).toBe(false);
    });

    it("should return true for message with streamingOutput", () => {
      const message: AssistantToolCallMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "tool_call",
        toolCalls: [
          {
            toolCallId: "call-1",
            toolName: "test",
            parameters: {},
            streamingOutput: "partial output",
          },
        ],
      };
      expect(isAssistantToolCallMessage(message)).toBe(true);
    });
  });

  describe("isWorkflowResultMessage", () => {
    it("should return true for valid WorkflowResultMessage", () => {
      const message: WorkflowResultMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "workflow_result",
        workflowName: "deploy",
        content: "deployed successfully",
      };
      expect(isWorkflowResultMessage(message)).toBe(true);
    });

    it("should return true with status", () => {
      const message: WorkflowResultMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "workflow_result",
        workflowName: "test",
        status: "success",
        content: "done",
      };
      expect(isWorkflowResultMessage(message)).toBe(true);
    });

    it("should return true with parameters", () => {
      const message: WorkflowResultMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "workflow_result",
        workflowName: "test",
        parameters: { key: "value" },
        content: "executed",
      };
      expect(isWorkflowResultMessage(message)).toBe(true);
    });

    it("should return false for assistant text message", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "text",
        content: "text",
      };
      expect(isWorkflowResultMessage(message)).toBe(false);
    });

    it("should return false for tool_call type", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "tool_call",
        toolCalls: [],
      };
      expect(isWorkflowResultMessage(message)).toBe(false);
    });
  });

  describe("isUserFileReferenceMessage", () => {
    it("should return true for valid UserFileReferenceMessage", () => {
      const message: UserFileReferenceMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "user",
        type: "file_reference",
        paths: ["/path/to/file.txt"],
        displayText: "file.txt",
      };
      expect(isUserFileReferenceMessage(message)).toBe(true);
    });

    it("should return true for message with multiple paths", () => {
      const message: UserFileReferenceMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "user",
        type: "file_reference",
        paths: ["/file1.txt", "/file2.txt"],
        displayText: "2 files",
      };
      expect(isUserFileReferenceMessage(message)).toBe(true);
    });

    it("should return true for empty paths array", () => {
      const message: UserFileReferenceMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "user",
        type: "file_reference",
        paths: [],
        displayText: "no files",
      };
      expect(isUserFileReferenceMessage(message)).toBe(true);
    });

    it("should return false for regular user message", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "user",
        content: "user text",
      };
      expect(isUserFileReferenceMessage(message)).toBe(false);
    });

    it("should return false for assistant message", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "text",
        content: "assistant text",
      };
      expect(isUserFileReferenceMessage(message)).toBe(false);
    });
  });

  describe("isTaskListMessage", () => {
    it("should return true for valid AssistantTaskListMessage", () => {
      const message: AssistantTaskListMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "task_list",
        taskList: {
          items: [
            {
              id: "1",
              content: "Task 1",
              status: "pending",
            },
          ],
        },
      };
      expect(isTaskListMessage(message)).toBe(true);
    });

    it("should return true for message with empty items", () => {
      const message: AssistantTaskListMessage = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "task_list",
        taskList: {
          items: [],
        },
      };
      expect(isTaskListMessage(message)).toBe(true);
    });

    it("should return false for assistant text message", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "text",
        content: "text",
      };
      expect(isTaskListMessage(message)).toBe(false);
    });

    it("should return false for tool_call type", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "tool_call",
        toolCalls: [],
      };
      expect(isTaskListMessage(message)).toBe(false);
    });

    it("should return false for workflow_result type", () => {
      const message: Message = {
        id: "1",
        createdAt: "2024-01-01",
        role: "assistant",
        type: "workflow_result",
        workflowName: "test",
        content: "done",
      };
      expect(isTaskListMessage(message)).toBe(false);
    });
  });
});
