/**
 * Main useChatManager hook - Orchestrator
 *
 * This hook composes all sub-hooks to provide a unified interface
 * for chat management. It follows the composition pattern to keep
 * each hook focused on a single responsibility.
 */

import { useChatState } from "./useChatState";
import { useChatTitleGeneration } from "./useChatTitleGeneration";
import { useChatOperations } from "./useChatOperations";
import { useMessageStreaming } from "./useMessageStreaming";
import { useChatHistory } from "./useChatHistory";

/**
 * Unified hook for managing all chat-related state and interactions.
 * This hook is the single source of truth for chat management in the UI.
 *
 * Uses Agent Server endpoints (localhost:9562).
 */
export const useChatManager = () => {
  const state = useChatState();
  const titleGeneration = useChatTitleGeneration(state);
  const operations = useChatOperations(state);
  const streaming = useMessageStreaming({
    sessionId: state.currentSessionId,
    addMessage: state.addMessage,
    updateSession: state.updateSession,
  });
  const history = useChatHistory(state, {
    onRetry: streaming.sendMessage,
  });

  // Compose and return the complete interface
  return {
    // State from useChatState
    chats: state.chats,
    currentSessionId: state.currentSessionId,
    currentChat: state.currentChat,
    pinnedChats: state.pinnedChats,
    unpinnedChats: state.unpinnedChats,
    chatCount: state.chatCount,

    // State from useChatHistory
    currentMessages: history.currentMessages,

    // State from useMessageStreaming
    agentAvailable: streaming.agentAvailable,

    // State from useChatTitleGeneration
    titleGenerationState: titleGeneration.titleGenerationState,
    autoGenerateTitles: titleGeneration.autoGenerateTitles,
    isUpdatingAutoTitlePreference: titleGeneration.isUpdatingAutoTitlePreference,

    // Actions from useChatState
    addMessage: state.addMessage,
    deleteMessage: state.deleteMessage,
    selectSession: state.selectSession,
    deleteSession: state.deleteSession,
    deleteSessions: state.deleteSessions,
    pinSession: state.pinSession,
    unpinSession: state.unpinSession,
    updateSession: state.updateSession,
    loadChats: state.loadChats,

    // Actions from useChatTitleGeneration
    generateChatTitle: titleGeneration.generateChatTitle,
    setAutoGenerateTitlesPreference: titleGeneration.setAutoGenerateTitlesPreference,

    // Actions from useChatOperations
    createNewChat: operations.createNewChat,
    createChatWithSystemPrompt: operations.createChatWithSystemPrompt,
    toggleChatPin: operations.toggleChatPin,
    updateChatTitle: operations.updateChatTitle,
    deleteEmptyChats: operations.deleteEmptyChats,
    deleteAllUnpinnedChats: operations.deleteAllUnpinnedChats,
    deleteAllChats: operations.deleteAllChats,

    // Actions from useChatHistory
    retryLastMessage: history.retryLastMessage,

    // Actions from useMessageStreaming
    sendMessage: streaming.sendMessage,
    cancelMessage: streaming.cancel,
  };
};

// Re-export types
export type { UseChatState } from "./types";
export type { UseChatOperations } from "./useChatOperations";
export type { UseMessageStreaming } from "./useMessageStreaming";
export type { UseChatTitleGeneration } from "./useChatTitleGeneration";
export type { UseChatHistory } from "./useChatHistory";
