import { debugLog } from "@shared/utils/debugFlags";
import { useCallback } from "react";
import { useAppStore } from "../../store";
import type { ChatItem, UserSystemPrompt } from "../../types/chat";
import type { UseChatState } from "./types";
import { AgentClient } from "../../services/AgentService";
import { useProviderStore } from "../../store/slices/providerSlice";

/**
 * Hook for chat CRUD operations
 * Handles creating, updating, and deleting chats
 */
export interface UseChatOperations {
  createNewChat: (title?: string, options?: Partial<Omit<ChatItem, "id">>) => Promise<void>;
  createChatWithSystemPrompt: (prompt: UserSystemPrompt) => Promise<void>;
  toggleChatPin: (sessionId: string) => void;
  updateChatTitle: (sessionId: string, newTitle: string) => void;
  deleteEmptyChats: () => Promise<void>;
  deleteAllUnpinnedChats: () => Promise<void>;
  deleteAllChats: () => Promise<void>;
}

export function useChatOperations(state: UseChatState): UseChatOperations {
  const addChat = useAppStore((state) => state.addChat);
  const lastSelectedPromptId = useAppStore((state) => state.lastSelectedPromptId);
  const systemPrompts = useAppStore((state) => state.systemPrompts);
  const agentClient = AgentClient.getInstance();

  const createNewChat = useCallback(
    async (title?: string, options?: Partial<Omit<ChatItem, "id">>) => {
      const selectedPrompt = systemPrompts.find((p) => p.id === lastSelectedPromptId);

      // Use actual prompt ID or undefined (no hardcoded defaults)
      const systemPromptId =
        selectedPrompt?.id ||
        (systemPrompts.length > 0
          ? systemPrompts.find((p) => p.id === "general_assistant")?.id || systemPrompts[0].id
          : "");

      const newChatData: Omit<ChatItem, "id"> = {
        title: title || "New Session",
        createdAt: Date.now(),
        messages: [],
        config: {
          systemPromptId,
          baseSystemPrompt:
            selectedPrompt?.content ||
            (systemPrompts.length > 0
              ? systemPrompts.find((p) => p.id === "general_assistant")?.content ||
                systemPrompts[0].content
              : ""),
          lastUsedEnhancedPrompt: null,
          ...(useProviderStore.getState().isProviderModelRefEnabled()
            ? { model_ref: useProviderStore.getState().selectedModelRef }
            : {}),
        },
        ...options,
      };
      await addChat(newChatData);
    },
    [addChat, lastSelectedPromptId, systemPrompts],
  );

  const createChatWithSystemPrompt = useCallback(
    async (prompt: UserSystemPrompt) => {
      debugLog(
        "[ChatOps]",
        "[useChatOperations] createChatWithSystemPrompt started with prompt:",
        prompt,
      );
      const newChatData: Omit<ChatItem, "id"> = {
        title: `New Session - ${prompt.name}`,
        createdAt: Date.now(),
        messages: [],
        config: {
          systemPromptId: prompt.id,
          baseSystemPrompt: prompt.content,
          lastUsedEnhancedPrompt: null,
        },
      };
      debugLog(
        "[ChatOps]",
        "[useChatOperations] Calling addChat with newChatData.config:",
        newChatData.config,
      );
      await addChat(newChatData);
    },
    [addChat],
  );

  const toggleChatPin = useCallback(
    (sessionId: string) => {
      const chat = state.chats.find((c) => c.id === sessionId);
      if (chat) {
        chat.pinned ? state.unpinSession(sessionId) : state.pinSession(sessionId);
      }
    },
    [state],
  );

  const updateChatTitle = useCallback(
    (sessionId: string, newTitle: string) => {
      state.updateSession(sessionId, { title: newTitle });
    },
    [state],
  );

  const deleteEmptyChats = useCallback(async () => {
    // Prefer backend cleanup so root/child protection rules are applied consistently.
    await agentClient.cleanupSessions("empty", true);
    await useAppStore.getState().loadChats();
  }, [agentClient]);

  const deleteAllUnpinnedChats = useCallback(async () => {
    await agentClient.cleanupSessions("all", true);
    await useAppStore.getState().loadChats();
  }, [agentClient]);

  const deleteAllChats = useCallback(async () => {
    await agentClient.cleanupSessions("all", false);
    await useAppStore.getState().loadChats();
  }, [agentClient]);

  return {
    createNewChat,
    createChatWithSystemPrompt,
    toggleChatPin,
    updateChatTitle,
    deleteEmptyChats,
    deleteAllUnpinnedChats,
    deleteAllChats,
  };
}
