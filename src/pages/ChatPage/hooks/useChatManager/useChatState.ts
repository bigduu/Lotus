import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { selectCurrentChat, useAppStore } from "../../store";
import type { ChatItem, Message } from "../../types/chat";

/**
 * Hook for chat state selection and derived state
 * Handles Zustand store connections and computed values
 */
export interface UseChatState {
  // State from store
  chats: ChatItem[];
  currentSessionId: string | null;
  currentChat: ChatItem | null;
  isProcessing: boolean;

  // Derived state
  baseMessages: Message[];
  pinnedChats: ChatItem[];
  unpinnedChats: ChatItem[];
  chatCount: number;

  // Store actions (re-exported for convenience)
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

export function useChatState(): UseChatState {
  const {
    chats,
    currentSessionId,
    currentChat,
    addMessage,
    selectSession,
    deleteSession,
    deleteSessions,
    deleteMessage,
    updateSession,
    pinSession,
    unpinSession,
    loadChats,
    processingChats,
    setSessionProcessing,
  } = useAppStore(
    useShallow((state) => ({
      chats: state.chats,
      currentSessionId: state.currentSessionId,
      currentChat: selectCurrentChat(state),
      addMessage: state.addMessage,
      selectSession: state.selectSession,
      deleteSession: state.deleteSession,
      deleteSessions: state.deleteSessions,
      deleteMessage: state.deleteMessage,
      updateSession: state.updateSession,
      pinSession: state.pinSession,
      unpinSession: state.unpinSession,
      loadChats: state.loadChats,
      processingChats: state.processingChats,
      setSessionProcessing: state.setSessionProcessing,
    })),
  );

  // Derived processing state for current chat
  const isProcessing = currentSessionId
    ? processingChats.has(currentSessionId)
    : false;

  // --- DERIVED STATE ---
  const baseMessages = useMemo(
    () => currentChat?.messages || [],
    [currentChat],
  );

  const pinnedChats = useMemo(
    () => chats.filter((chat) => chat.pinned),
    [chats],
  );

  const unpinnedChats = useMemo(
    () => chats.filter((chat) => !chat.pinned),
    [chats],
  );

  const chatCount = chats.length;

  return {
    // State
    chats,
    currentSessionId,
    currentChat,
    isProcessing,
    baseMessages,
    pinnedChats,
    unpinnedChats,
    chatCount,

    // Actions
    addMessage,
    deleteMessage,
    selectSession,
    deleteSession,
    deleteSessions,
    pinSession,
    unpinSession,
    updateSession,
    loadChats,
    setSessionProcessing,
  };
}
