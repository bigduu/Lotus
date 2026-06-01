export type ModelOption = { value: string; label: string };

export type ModelCachePayload = {
  timestamp: number;
  options: ModelOption[];
};

export type RespondExecutionDebugSnapshot = {
  phase: string;
  generation: number;
  backendRunId: string | null;
  backendIsRunning: boolean;
  hasPendingQuestion: boolean;
  pendingQuestionToolCallId: string | null;
  tokenCount: number;
  hasTokens: boolean;
  activeReasons: string[];
};

export type ChatSendMessageEventDetail = {
  content: string;
  sessionId?: string | null;
  handled?: boolean;
  resolve?: () => void;
  reject?: (error: unknown) => void;
};

export type ChatReferenceTextEventDetail = {
  text: string;
  sessionId?: string | null;
  handled?: boolean;
};

export type WorkflowDraft = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  type?: "workflow" | "skill" | "mcp" | "goal"; // Add command type
  displayName?: string; // Add display name for better prompts
  // For non-workflow commands (skill/mcp), keep additional identifiers.
  // `name` is the token shown in the input (e.g. "read_file"), while `mcpAlias`
  // can be the fully-qualified MCP tool name (e.g. "mcp__filesystem__read_file").
  mcpAlias?: string;
  mcpServerId?: string;
  mcpServerName?: string;
  mcpOriginalName?: string;
};
