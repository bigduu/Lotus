import type {
  AssistantToolCallMessage,
  AssistantToolResultMessage,
  AssistantTaskListMessage,
  Message,
  ToolExecutionResult,
  UserFileReferenceMessage,
  WorkflowResultMessage,
} from "./chatMessages";

export const isToolExecutionResult = (obj: unknown): obj is ToolExecutionResult => {
  if (!obj || typeof obj !== "object") return false;
  const rec = obj as Record<string, unknown>;
  return typeof rec.result === "string" && typeof rec.display_preference === "string";
};

export const isAssistantToolResultMessage = (
  message: Message,
): message is AssistantToolResultMessage => {
  return message.role === "assistant" && "type" in message && message.type === "tool_result";
};

export const isAssistantToolCallMessage = (
  message: Message,
): message is AssistantToolCallMessage => {
  return message.role === "assistant" && "type" in message && message.type === "tool_call";
};

export const isWorkflowResultMessage = (message: Message): message is WorkflowResultMessage => {
  return message.role === "assistant" && "type" in message && message.type === "workflow_result";
};

export const isUserFileReferenceMessage = (
  message: Message,
): message is UserFileReferenceMessage => {
  return message.role === "user" && "type" in message && message.type === "file_reference";
};

export const isTaskListMessage = (message: Message): message is AssistantTaskListMessage => {
  return message.role === "assistant" && "type" in message && message.type === "task_list";
};
