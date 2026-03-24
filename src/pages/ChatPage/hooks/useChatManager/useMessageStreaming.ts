import { useCallback, useEffect, useRef } from "react";
import { App as AntApp } from "antd";
import { useTranslation } from "react-i18next";
import { AgentClient, type ReasoningEffort } from "../../services/AgentService";
import type { ChatItem, Message, UserMessage } from "../../types/chat";
import type { ImageFile } from "../../utils/imageUtils";
import { streamingMessageBus } from "../../utils/streamingMessageBus";
import { useAppStore } from "../../store";
import { getSystemPromptEnhancementText } from "@shared/utils/systemPromptEnhancement";
import { useActiveModel } from "../useActiveModel";
import { useProviderStore } from "../../store/slices/providerSlice";
import type { MessageRetryMode } from "../../components/MessageInput/types";

export interface UseMessageStreaming {
  sendMessage: (
    content: string,
    images?: ImageFile[],
    reasoningEffort?: ReasoningEffort,
    selectedSkillIds?: string[],
  ) => Promise<void>;
  retryLastTurn: (
    reasoningEffort?: ReasoningEffort,
    mode?: MessageRetryMode,
  ) => Promise<void>;
  cancel: () => void;
  agentAvailable: boolean | null;
}

interface UseMessageStreamingDeps {
  sessionId: string | null;
  addMessage: (sessionId: string, message: Message) => Promise<void>;
  setSessionProcessing: (sessionId: string, isProcessing: boolean) => void;
  updateSession: (sessionId: string, updates: Partial<ChatItem>) => void;
}

/**
 * Unified chat streaming hook
 *
 * Agent-only flow using the local agent endpoints (localhost:9562).
 */
export function useMessageStreaming(
  deps: UseMessageStreamingDeps,
): UseMessageStreaming {
  const { modal, message: appMessage } = AntApp.useApp();
  const { t } = useTranslation();
  const abortRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamingContentRef = useRef<string>("");
  const agentClientRef = useRef(new AgentClient());

  const agentAvailable = useAppStore((state) => state.agentAvailability);
  const setAgentAvailability = useAppStore(
    (state) => state.setAgentAvailability,
  );
  const checkAgentAvailability = useAppStore(
    (state) => state.checkAgentAvailability,
  );
  const startAgentHealthCheck = useAppStore(
    (state) => state.startAgentHealthCheck,
  );
  const activeModel = useActiveModel();
  const currentProvider = useProviderStore((state) => state.currentProvider);

  // Fetch chat internally based on sessionId
  const currentChat = useAppStore((state) =>
    deps.sessionId
      ? state.chats.find((chat) => chat.id === deps.sessionId) || null
      : null,
  );

  useEffect(() => {
    startAgentHealthCheck();
  }, [startAgentHealthCheck]);

  const cancel = useCallback(() => {
    // Abort local streaming
    abortRef.current?.abort();

    // Also tell backend to stop agent execution
    const sessionId = currentChat?.id;
    if (sessionId) {
      agentClientRef.current.stopGeneration(sessionId).catch((error) => {
        console.error(
          "[useMessageStreaming] Failed to stop generation:",
          error,
        );
      });
    }
  }, [currentChat?.id]);

  /**
   * Send message using Agent Server
   * Note: Event subscription is handled by useAgentEventSubscription hook in ChatView
   */
  const sendWithAgent = useCallback(
    async (
      content: string,
      sessionId: string,
      userMessage: UserMessage,
      reasoningEffort?: ReasoningEffort,
      selectedSkillIds?: string[],
    ) => {
      // Validate model is available (TypeScript type guard)
      if (!activeModel) {
        throw new Error(t("chat.model.noModelSelected"));
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const enhancePrompt =
          getSystemPromptEnhancementText(currentProvider).trim();
        // Normalize workspace path: remove trailing slashes, handle cross-platform
        const rawWorkspacePath = currentChat?.config?.workspacePath || "";
        const workspacePath = rawWorkspacePath
          .trim()
          .replace(/\/+$/, "") // Remove trailing slashes (Unix/Windows)
          .replace(/\\+$/, ""); // Remove trailing backslashes (Windows)

        // Step 1: Send message to Agent
        const response = await agentClientRef.current.sendMessage({
          message: content,
          session_id: sessionId,
          enhance_prompt: enhancePrompt || undefined,
          workspace_path: workspacePath || undefined,
          selected_skill_ids:
            selectedSkillIds && selectedSkillIds.length > 0
              ? selectedSkillIds
              : undefined,
          images: userMessage.images
            ?.filter((img) => Boolean(img.base64))
            .map((img) => ({
              base64: img.base64 as string,
              name: img.name,
              size: img.size,
              type: img.type,
            })),
          model: activeModel,
        });

        const { session_id } = response;
        if (session_id !== sessionId) {
          console.warn(
            `[useMessageStreaming] Backend returned unexpected session_id=${session_id} for sessionId=${sessionId}`,
          );
        }

        // Step 2: Activate processing/subscription before execute so early events
        // (tool_start/tool_token) are not missed.
        deps.setSessionProcessing(sessionId, true);
        // Yield once to let subscription effect bind before execution starts.
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Step 3: Trigger execution (idempotent)
        const executeResult = reasoningEffort
          ? await agentClientRef.current.execute(
              sessionId,
              activeModel,
              reasoningEffort,
            )
          : await agentClientRef.current.execute(sessionId, activeModel);
        console.log("[Agent] Execute status:", executeResult.status);

        // Keep/adjust processing state based on execute result.
        if (["started", "already_running"].includes(executeResult.status)) {
          // keep true
        } else if (executeResult.status === "completed") {
          // Session already completed, no need to process
          console.log("[Agent] Session already completed");
          deps.setSessionProcessing(sessionId, false);
        } else {
          // Error or other status
          console.error("[Agent] Execute failed:", executeResult.status);
          deps.setSessionProcessing(sessionId, false);
          throw new Error(`Execute failed: ${executeResult.status}`);
        }
      } catch (error) {
        throw error; // Re-throw to trigger fallback
      }
    },
    [deps, activeModel, currentChat, currentProvider],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      images?: ImageFile[],
      reasoningEffort?: ReasoningEffort,
      selectedSkillIds?: string[],
    ) => {
      if (!currentChat) {
        modal.info({
          title: t("chat.streaming.noActiveChatTitle"),
          content: t("chat.streaming.noActiveChatSendContent"),
        });
        return;
      }

      if (!deps.sessionId) {
        modal.info({
          title: t("chat.streaming.noChatIdTitle"),
          content: t("chat.streaming.noChatIdSendContent"),
        });
        return;
      }

      // Validate model is available
      if (!activeModel) {
        modal.error({
          title: t("chat.model.noModelSelected"),
          content: t("chat.model.selectModelBeforeSend"),
        });
        return;
      }

      let isAgentAvailable = agentAvailable;
      if (isAgentAvailable === null) {
        isAgentAvailable = await checkAgentAvailability();
      }

      if (!isAgentAvailable) {
        appMessage.error(t("chat.streaming.agentUnavailable"));
        return;
      }

      // Check if active model is loaded
      if (!activeModel) {
        appMessage.error(t("chat.streaming.modelConfigNotLoaded"));
        return;
      }

      const sessionId = deps.sessionId;
      const messageImages =
        images?.map((img) => ({
          id: img.id,
          base64: img.base64,
          name: img.name,
          size: img.size,
          type: img.type,
        })) || [];

      const userMessage: UserMessage = {
        role: "user",
        content,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        images: messageImages,
      };

      await deps.addMessage(sessionId, userMessage);

      try {
        console.log("[useChatStreaming] Using Agent Server");
        await sendWithAgent(
          content,
          sessionId,
          userMessage,
          reasoningEffort,
          selectedSkillIds,
        );
        // Note: Don't set processing false here - let useAgentEventSubscription handle it
      } catch (error) {
        if (streamingMessageIdRef.current) {
          streamingMessageBus.clear(sessionId, streamingMessageIdRef.current);
        }
        streamingMessageIdRef.current = null;
        streamingContentRef.current = "";

        if (error instanceof Error && error.name === "AbortError") {
          appMessage.info(t("chat.streaming.requestCancelled"));
        } else {
          console.error("[useChatStreaming] Failed to send message:", error);
          appMessage.error(t("chat.streaming.sendFailed"));
          setAgentAvailability(false);
        }
        deps.setSessionProcessing(sessionId, false); // Only set false on error
      } finally {
        abortRef.current = null;
        if (streamingMessageIdRef.current) {
          streamingMessageBus.clear(sessionId, streamingMessageIdRef.current);
        }
        streamingMessageIdRef.current = null;
        streamingContentRef.current = "";
        // Removed: deps.setSessionProcessing(sessionId, false) - useAgentEventSubscription handles this
      }
    },
    [
      agentAvailable,
      appMessage,
      checkAgentAvailability,
      deps,
      currentChat,
      modal,
      sendWithAgent,
      setAgentAvailability,
      activeModel,
    ],
  );

  const retryLastTurn = useCallback(
    async (
      reasoningEffort?: ReasoningEffort,
      mode: MessageRetryMode = "regenerate",
    ) => {
      if (!currentChat) {
        modal.info({
          title: t("chat.streaming.noActiveChatTitle"),
          content: t("chat.streaming.noActiveChatRetryContent"),
        });
        return;
      }

      if (!deps.sessionId) {
        modal.info({
          title: t("chat.streaming.noChatIdTitle"),
          content: t("chat.streaming.noChatIdRetryContent"),
        });
        return;
      }

      // Validate model is available
      if (!activeModel) {
        modal.error({
          title: t("chat.model.noModelSelected"),
          content: t("chat.model.selectModelBeforeRetry"),
        });
        return;
      }

      let isAgentAvailable = agentAvailable;
      if (isAgentAvailable === null) {
        isAgentAvailable = await checkAgentAvailability();
      }
      if (!isAgentAvailable) {
        appMessage.error(t("chat.streaming.agentUnavailable"));
        return;
      }

      const sessionId = deps.sessionId;

      // Clear any lingering local draft so we don't show stale streaming content.
      if (streamingMessageIdRef.current) {
        streamingMessageBus.clear(sessionId, streamingMessageIdRef.current);
      }
      streamingMessageIdRef.current = null;
      streamingContentRef.current = "";

      try {
        const truncateMode =
          mode === "error_retry" ? "error_retry" : "after_last_user";
        const truncateResult =
          await agentClientRef.current.truncateSessionMessages(sessionId, {
            mode: truncateMode,
          });

        if (
          mode === "regenerate" ||
          (truncateResult.messages_removed ?? 0) > 0
        ) {
          // Reconcile UI with persisted history so old assistant/tool tail disappears.
          await useAppStore
            .getState()
            .loadChatHistory(sessionId, { mode: "replace" });
        }

        // Activate event subscription (handled by useAgentEventSubscription).
        deps.setSessionProcessing(sessionId, true);

        // Re-run execution (idempotent).
        const executeResult = reasoningEffort
          ? await agentClientRef.current.execute(
              sessionId,
              activeModel,
              reasoningEffort,
            )
          : await agentClientRef.current.execute(sessionId, activeModel);
        if (["started", "already_running"].includes(executeResult.status)) {
          // Keep processing true.
          return;
        }
        if (executeResult.status === "completed") {
          // Nothing to do (e.g. no pending user message).
          deps.setSessionProcessing(sessionId, false);
          return;
        }

        deps.setSessionProcessing(sessionId, false);
        throw new Error(`Execute failed: ${executeResult.status}`);
      } catch (error) {
        console.error("[useMessageStreaming] Retry failed:", error);
        appMessage.error(t("chat.streaming.retryFailed"));
        deps.setSessionProcessing(sessionId, false);
      } finally {
        abortRef.current = null;
      }
    },
    [
      activeModel,
      agentAvailable,
      appMessage,
      checkAgentAvailability,
      currentChat,
      deps,
      modal,
      t,
    ],
  );

  return {
    sendMessage,
    retryLastTurn,
    cancel,
    agentAvailable,
  };
}
