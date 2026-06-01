import type { ChatItem, Message, UserSystemPrompt } from "@shared/types/chat";
import type { DeleteMessageResult } from "../../store/slices/chatSessionSlice";

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
  deleteMessage: (sessionId: string, messageId: string) => Promise<DeleteMessageResult>;
  selectSession: (sessionId: string | null) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteSessions: (sessionIds: string[]) => Promise<void>;
  pinSession: (sessionId: string) => void;
  unpinSession: (sessionId: string) => void;
  updateSession: (sessionId: string, updates: Partial<ChatItem>) => void;
  loadChats: () => Promise<void>;
}

export interface UseChatOperations {
  createNewChat: (title?: string, options?: Partial<Omit<ChatItem, "id">>) => Promise<void>;
  createChatWithSystemPrompt: (prompt: UserSystemPrompt) => Promise<void>;
  toggleChatPin: (sessionId: string) => void;
  updateChatTitle: (sessionId: string, newTitle: string) => void;
  deleteEmptyChats: () => void;
  deleteAllUnpinnedChats: () => void;
}
