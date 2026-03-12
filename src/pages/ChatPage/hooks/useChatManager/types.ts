import type { ChatItem, Message, UserSystemPrompt } from "../../types/chat";

export interface UseChatState {
  chats: ChatItem[];
  currentSessionId: string | null;
  currentChat: ChatItem | null;
  isProcessing: boolean;
  baseMessages: Message[];
  pinnedChats: ChatItem[];
  unpinnedChats: ChatItem[];
  chatCount: number;
  addMessage: (sessionId: string, message: Message) => Promise<void>;
  deleteMessage: (sessionId: string, messageId: string) => void;
  selectSession: (sessionId: string | null) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteSessions: (sessionIds: string[]) => Promise<void>;
  pinSession: (sessionId: string) => void;
  unpinSession: (sessionId: string) => void;
  updateSession: (sessionId: string, updates: Partial<ChatItem>) => void;
  loadChats: () => Promise<void>;
  setSessionProcessing: (sessionId: string, isProcessing: boolean) => void;
}

export interface UseChatTitleGeneration {
  titleGenerationState: Record<
    string,
    { status: "idle" | "loading" | "error"; error?: string }
  >;
  autoGenerateTitles: boolean;
  isUpdatingAutoTitlePreference: boolean;
  generateChatTitle: (
    sessionId: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  setAutoGenerateTitlesPreference: (enabled: boolean) => Promise<void>;
  isDefaultTitle: (title: string | undefined | null) => boolean;
}

export interface UseChatOperations {
  createNewChat: (
    title?: string,
    options?: Partial<Omit<ChatItem, "id">>,
  ) => Promise<void>;
  createChatWithSystemPrompt: (prompt: UserSystemPrompt) => Promise<void>;
  toggleChatPin: (sessionId: string) => void;
  updateChatTitle: (sessionId: string, newTitle: string) => void;
  deleteEmptyChats: () => void;
  deleteAllUnpinnedChats: () => void;
}

export interface InteractionState {
  status: "idle" | "thinking" | "awaiting_approval";
  streamingMessageId?: string | null;
  streamingContent?: string | null;
}

export interface PendingAgentApproval {
  toolCallId: string;
  toolName: string;
  parameters: Record<string, unknown>;
}

export interface UseChatStateMachine {
  interactionState: InteractionState;
  currentMessages: Message[];
  pendingAgentApproval: PendingAgentApproval | null;
  send: (event: string, payload?: unknown) => void;
  setPendingAgentApproval: (approval: PendingAgentApproval | null) => void;
  retryLastMessage: () => Promise<void>;
}
