import { debugLog } from "@shared/utils/debugFlags";
import { useCallback, useEffect, useRef } from "react";
import { App as AntApp } from "antd";
import { useTranslation } from "react-i18next";
import { agentApiClient } from "@services/api";
import {
  AgentClient,
  type ExecuteClientSync,
  type ExecuteResponse,
  type ReasoningEffort,
} from "../../services/AgentService";
import type { ChatItem, Message, UserMessage } from "../../types/chat";
import type { ImageFile } from "../../utils/imageUtils";
import { streamingMessageBus } from "../../utils/streamingMessageBus";
import { useAppStore } from "../../store";
import { getSystemPromptEnhancementText } from "@shared/utils/systemPromptEnhancement";
import { isCopilotConclusionWithOptionsEnhancementEnabled } from "@shared/utils/copilotConclusionWithOptionsEnhancementUtils";
import { formatCompletionPolicyViolationMessage, isCompletionPolicyViolationError } from "@shared/utils/completionPolicyViolation";
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
  retryLastTurn: (reasoningEffort?: ReasoningEffort, mode?: MessageRetryMode) => Promise<void>;
  cancel: () => void;
  agentAvailable: boolean | null;
}

interface UseMessageStreamingDeps {
  sessionId: string | null;
  addMessage: (sessionId: string, message: Message) => Promise<void>;
  setSessionProcessing: (sessionId: string, isProcessing: boolean) => void;
  updateSession: (sessionId: string, updates: Partial<ChatItem>) => void;
}

type PendingQuestionResponse = {
  has_pending_question: boolean;
  question?: string;
  options?: string[];
  allow_custom?: boolean;
  tool_call_id?: string;
};

/**
 * Unified chat streaming hook
 *
 * Agent-only flow using the local agent endpoints (localhost:9562).
 */
export function useMessageStreaming(deps: UseMessageStreamingDeps): UseMessageStreaming {
  const { modal, message: appMessage } = AntApp.useApp();
  const { t } = useTranslation();
  const abortRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const streamingContentRef = useRef<string>("");
  const agentClientRef = useRef(new AgentClient());

  const agentAvailable = useAppStore((state) => state.agentAvailability);
  const setAgentAvailability = useAppStore((state) => state.setAgentAvailability);
  const checkAgentAvailability = useAppStore((state) => state.checkAgentAvailability);
  const startAgentHealthCheck = useAppStore((state) => state.startAgentHealthCheck);
  const activeModel = useActiveModel(deps.sessionId);
  const currentProvider = useProviderStore((state) => state.currentProvider);

  // Fetch chat internally based on sessionId
  const currentChat = useAppStore((state) =>
    deps.sessionId ? state.chats.find((chat) => chat.id === deps.sessionId) || null : null,
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
        console.error("[useMessageStreaming] Failed to stop generation:", error);
      });
    }
  }, [currentChat?.id]);

const buildClientSync = useCallback((sessionId: string): ExecuteClientSync => {
    const storeState = useAppStore.getState() as Partial<{
      chats: ChatItem[];
      pendingQuestionRespond: {
        sessionId: string;
        toolCallId?: string | null;
      } | null;
    }>;
    const chats = Array.isArray(storeState.chats) ? storeState.chats : [];
    const chat = chats.find((item) => item.id === sessionId);
    const pendingRespond = storeState.pendingQuestionRespond;
    const pendingForSession = pendingRespond?.sessionId === sessionId ? pendingRespond : null;
    const syncCursor = chat?.config?.syncCursor;
    const hasPendingQuestion = Boolean(pendingForSession) || Boolean(syncCursor?.hasPendingQuestion);
    const pendingQuestionToolCallId =
      pendingForSession?.toolCallId ?? syncCursor?.pendingQuestionToolCallId ?? null;

    return {
      client_message_count: syncCursor?.messageCount ?? chat?.messageCount ?? 0,
      client_last_message_id: syncCursor?.lastMessageId ?? null,
      client_has_pending_question: hasPendingQuestion,
      client_pending_question_tool_call_id: pendingQuestionToolCallId,
    };
  }, []);

  const applyExecuteSyncSnapshot = useCallback(
    (sessionId: string, executeResult: ExecuteResponse) => {
      const sync = executeResult.sync;
      if (!sync) return;
      const storeState = useAppStore.getState() as Partial<{ chats: ChatItem[] }>;
      const chats = Array.isArray(storeState.chats) ? storeState.chats : [];
      const chat = chats.find((item) => item.id === sessionId);
      if (!chat) return;

      deps.updateSession(sessionId, {
        messageCount: sync.server_message_count,
        config: {
          ...(chat.config || {}),
          syncCursor: {
            messageCount: sync.server_message_count,
            lastMessageId: sync.server_last_message_id ?? null,
            hasPendingQuestion: sync.has_pending_question,
            pendingQuestionToolCallId: sync.pending_question_tool_call_id ?? null,
          },
        },
      });
    },
    [deps],
  );

  const getPendingQuestion = useCallback(async (sessionId: string): Promise<PendingQuestionResponse> => {
    try {
      return await agentApiClient.get<PendingQuestionResponse>(`respond/${sessionId}/pending`);
    } catch (error) {
      console.warn(`[useMessageStreaming] Failed to fetch pending question for ${sessionId}:`, error);
      return { has_pending_question: false };
    }
  }, []);

  const recoverAfterNeedSync = useCallback(
    async (
      sessionId: string,
      executeSync: ExecuteResponse["sync"],
      reasoningEffort?: ReasoningEffort,
    ): Promise<ExecuteResponse | null> => {
      deps.setSessionProcessing(sessionId, false);
      await useAppStore.getState().loadChatHistory(sessionId, { mode: "replace" });

      const pending = await getPendingQuestion(sessionId);
      const setPendingQuestionRespond = useAppStore.getState().setPendingQuestionRespond;
      const clearPendingQuestionRespondForSession =
        useAppStore.getState().clearPendingQuestionRespondForSession;

      if (pending.has_pending_question) {
        setPendingQuestionRespond({
          sessionId,
          question: pending.question || "",
          options: pending.options || [],
          allowCustom: pending.allow_custom ?? true,
          toolCallId: pending.tool_call_id ?? null,
        });

        const chat = useAppStore.getState().chats.find((item) => item.id === sessionId);
        if (chat) {
          deps.updateSession(sessionId, {
            config: {
              ...(chat.config || {}),
              syncCursor: {
                messageCount: chat.messageCount ?? chat.messages.length,
                lastMessageId: chat.config?.syncCursor?.lastMessageId ?? null,
                hasPendingQuestion: true,
                pendingQuestionToolCallId: pending.tool_call_id ?? null,
              },
            },
          });
        }
        return null;
      }

      clearPendingQuestionRespondForSession(sessionId);

      const hasPendingUserMessage = executeSync?.has_pending_user_message ?? false;
      if (!hasPendingUserMessage) {
        return null;
      }

      deps.setSessionProcessing(sessionId, true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const retryResult = reasoningEffort
        ? await agentClientRef.current.execute(sessionId, undefined, reasoningEffort, buildClientSync(sessionId))
        : await agentClientRef.current.execute(sessionId, undefined, undefined, buildClientSync(sessionId));
      applyExecuteSyncSnapshot(sessionId, retryResult);
      return retryResult;
    },
    [applyExecuteSyncSnapshot, buildClientSync, deps, getPendingQuestion],
  );

  const handleExecuteResult = useCallback(
    async (
      sessionId: string,
      executeResult: ExecuteResponse,
      reasoningEffort?: ReasoningEffort,
    ) => {
      let resolvedExecuteResult = executeResult;
      applyExecuteSyncSnapshot(sessionId, resolvedExecuteResult);

      const maxSyncRecoveries = 2;
      let syncRecoveries = 0;
      while (resolvedExecuteResult.sync?.need_sync && syncRecoveries < maxSyncRecoveries) {
        const recovered = await recoverAfterNeedSync(
          sessionId,
          resolvedExecuteResult.sync,
          reasoningEffort,
        );
        syncRecoveries += 1;
        if (!recovered) {
          deps.setSessionProcessing(sessionId, false);
          return;
        }
        resolvedExecuteResult = recovered;
        applyExecuteSyncSnapshot(sessionId, resolvedExecuteResult);
      }

      if (resolvedExecuteResult.sync?.need_sync) {
        console.warn(
          `[useMessageStreaming] Execute remains out-of-sync after ${maxSyncRecoveries} recovery attempt(s) for session ${sessionId}.`,
          resolvedExecuteResult.sync,
        );
        deps.setSessionProcessing(sessionId, false);
        return;
      }

      if (["started", "already_running"].includes(resolvedExecuteResult.status)) {
        return;
      }
      if (resolvedExecuteResult.status === "completed") {
        debugLog("[Streaming]", "[Agent] Session already completed");
        deps.setSessionProcessing(sessionId, false);
        return;
      }

      console.error("[Agent] Execute failed:", resolvedExecuteResult.status);
      deps.setSessionProcessing(sessionId, false);
      throw new Error(`Execute failed: ${resolvedExecuteResult.status}`);
    },
    [applyExecuteSyncSnapshot, deps, recoverAfterNeedSync],
  );

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
        const enhancePrompt = getSystemPromptEnhancementText(currentProvider).trim();
        const copilotConclusionWithOptionsEnhancementEnabled =
          (currentProvider ?? "").trim().toLowerCase() === "copilot" &&
          isCopilotConclusionWithOptionsEnhancementEnabled();
        // Normalize workspace path: remove trailing slashes, handle cross-platform
        const rawWorkspacePath = currentChat?.config?.workspacePath || "";
        const workspacePath = rawWorkspacePath
          .trim()
          .replace(/\/+$/, "")
          .replace(/\\+$/, "");

        // Step 1: Send message to Agent
        const response = await agentClientRef.current.sendMessage({
          message: content,
          session_id: sessionId,
          enhance_prompt: enhancePrompt || undefined,
          copilot_conclusion_with_options_enhancement_enabled: copilotConclusionWithOptionsEnhancementEnabled,
          workspace_path: workspacePath || undefined,
          selected_skill_ids:
            selectedSkillIds && selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
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

        // Refresh from persisted history once so execute uses a server-confirmed cursor
        await useAppStore.getState().loadChatHistory(sessionId, { mode: "replace" });

        // Step 2: Activate processing/subscription before execute so early events are not missed.
        deps.setSessionProcessing(sessionId, true);
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Step 3: Trigger execution (idempotent)
        const executeResult = reasoningEffort
          ? await agentClientRef.current.execute(sessionId, undefined, reasoningEffort, buildClientSync(sessionId))
          : await agentClientRef.current.execute(sessionId, undefined, undefined, buildClientSync(sessionId));
        debugLog("[Streaming]", "[Agent] Execute status:", executeResult.status);
        await handleExecuteResult(sessionId, executeResult, reasoningEffort);
      } catch (error) {
        throw error;
      }
    },
    [activeModel, buildClientSync, currentChat, currentProvider, deps, handleExecuteResult, t],
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
        debugLog("[Streaming]", "[useChatStreaming] Using Agent Server");
        await sendWithAgent(content, sessionId, userMessage, reasoningEffort, selectedSkillIds);
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
          const rawErrorMessage = error instanceof Error ? error.message : String(error ?? "");
          if (isCompletionPolicyViolationError(rawErrorMessage)) {
            appMessage.error(formatCompletionPolicyViolationMessage(rawErrorMessage));
          } else {
            appMessage.error(t("chat.streaming.sendFailed"));
            setAgentAvailability(false);
          }
        }
        deps.setSessionProcessing(sessionId, false);
      } finally {
        abortRef.current = null;
        if (streamingMessageIdRef.current) {
          streamingMessageBus.clear(sessionId, streamingMessageIdRef.current);
        }
        streamingMessageIdRef.current = null;
        streamingContentRef.current = "";
      }
    },
    [
      agentAvailable,
      appMessage,
      checkAgentAvailability,
      currentChat,
      deps,
      modal,
      sendWithAgent,
      setAgentAvailability,
      activeModel,
      t,
    ],
  );

  const retryLastTurn = useCallback(
    async (reasoningEffort?: ReasoningEffort, mode: MessageRetryMode = "regenerate") => {
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

      if (streamingMessageIdRef.current) {
        streamingMessageBus.clear(sessionId, streamingMessageIdRef.current);
      }
      streamingMessageIdRef.current = null;
      streamingContentRef.current = "";

      try {
        const truncateMode = mode === "error_retry" ? "error_retry" : "after_last_user";
        const truncateResult = await agentClientRef.current.truncateSessionMessages(sessionId, {
          mode: truncateMode,
        });

        if (mode === "regenerate" || (truncateResult.messages_removed ?? 0) > 0) {
          await useAppStore.getState().loadChatHistory(sessionId, { mode: "replace" });
        }

        deps.setSessionProcessing(sessionId, true);

        const executeResult = reasoningEffort
          ? await agentClientRef.current.execute(sessionId, undefined, reasoningEffort, buildClientSync(sessionId))
          : await agentClientRef.current.execute(sessionId, undefined, undefined, buildClientSync(sessionId));
        await handleExecuteResult(sessionId, executeResult, reasoningEffort);
      } catch (error) {
        console.error("[useMessageStreaming] Retry failed:", error);
        const rawErrorMessage = error instanceof Error ? error.message : String(error ?? "");
        if (isCompletionPolicyViolationError(rawErrorMessage)) {
          appMessage.error(formatCompletionPolicyViolationMessage(rawErrorMessage));
        } else {
          appMessage.error(t("chat.streaming.retryFailed"));
        }
        deps.setSessionProcessing(sessionId, false);
      } finally {
        abortRef.current = null;
      }
    },
    [
      activeModel,
      agentAvailable,
      appMessage,
      buildClientSync,
      checkAgentAvailability,
      currentChat,
      deps,
      handleExecuteResult,
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
