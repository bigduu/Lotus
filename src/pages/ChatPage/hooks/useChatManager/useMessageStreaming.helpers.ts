import type {
  AgentClient,
  ExecuteClientSync,
  ExecuteResponse,
  ReasoningEffort,
} from "@services/chat/AgentService";
import type { ChatItem, Message } from "@shared/types/chat";
import type { ImageFile } from "../../utils/imageUtils";
import type { MessageRetryMode } from "../../components/MessageInput/types";

export interface UseMessageStreaming {
  sendMessage: (
    content: string,
    images?: ImageFile[],
    reasoningEffort?: ReasoningEffort,
    selectedSkillIds?: string[],
  ) => Promise<void>;
  retryLastTurn: (reasoningEffort?: ReasoningEffort, mode?: MessageRetryMode) => Promise<void>;
  cancel: () => void;
  agentAvailable: boolean | null;
}

export interface UseMessageStreamingDeps {
  sessionId: string | null;
  addMessage: (sessionId: string, message: Message) => Promise<void>;
  updateSession: (sessionId: string, updates: Partial<ChatItem>) => void;
}

export type PendingQuestionResponse = {
  has_pending_question: boolean;
  question?: string;
  options?: string[];
  allow_custom?: boolean;
  tool_call_id?: string;
};

/**
 * Invoke the agent execute endpoint, passing the reasoning effort only when one
 * is provided. Centralizes the repeated `reasoningEffort ? execute(...) :
 * execute(...)` branch used by send/retry/recover flows.
 */
export const executeWithOptionalReasoning = (
  client: AgentClient,
  sessionId: string,
  reasoningEffort: ReasoningEffort | undefined,
  clientSync: ExecuteClientSync,
  modelRef: { provider: string; model: string } | undefined,
): Promise<ExecuteResponse> =>
  reasoningEffort
    ? client.execute(sessionId, undefined, reasoningEffort, clientSync, modelRef)
    : client.execute(sessionId, undefined, undefined, clientSync, modelRef);
