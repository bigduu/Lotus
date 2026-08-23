import { debugLog } from "@shared/utils/debugFlags";
import { useCallback, useEffect, useRef } from "react";
import { App as AntApp } from "antd";
import { useTranslation } from "react-i18next";
import {
  AgentClient,
  type ExecuteClientSync,
  type ExecuteResponse,
  type ReasoningEffort,
} from "@services/chat/AgentService";
import type { ChatItem, UserMessage } from "@shared/types/chat";
import type { ImageFile } from "../../utils/imageUtils";
import { streamingMessageBus } from "../../utils/streamingMessageBus";
import { useAppStore, selectPendingQuestion, selectGeneration } from "@shared/store/appStore";
import { getSystemPromptEnhancementText } from "@shared/utils/systemPromptEnhancement";
import { isCopilotConclusionWithOptionsEnhancementEnabled } from "@shared/utils/copilotConclusionWithOptionsEnhancementUtils";
import {
  formatCompletionPolicyViolationMessage,
  isCompletionPolicyViolationError,
} from "@shared/utils/completionPolicyViolation";
import { useActiveModel } from "../useActiveModel";
import { useActiveModelRef } from "../useActiveModelRef";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import type { MessageRetryMode } from "../../components/MessageInput/types";
import {
  normalizePermissionRequest,
  supportedPermissionDecisionIds,
} from "@shared/permissions/permissionContract";
import {
  executeWithOptionalReasoning,
  type PendingQuestionResponse,
  type UseMessageStreaming,
  type UseMessageStreamingDeps,
} from "./useMessageStreaming.helpers";
import { toWorkflowSelectionError, type WorkflowSelection } from "../../../../features/workflows";

export type { UseMessageStreaming } from "./useMessageStreaming.helpers";

/**
 * Unified chat streaming hook
 *
 * Agent-only flow using the local agent endpoints (localhost:9562).
 */
export function useMessageStreaming(deps: UseMessageStreamingDeps): UseMessageStreaming {
  const { sessionId: depsSessionId, addMessage, updateSession } = deps;
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
  const markOptimisticStart = useAppStore((state) => state.markOptimisticStart);
  const markRetryStart = useAppStore((state) => state.markRetryStart);
  const markSettleTimeout = useAppStore((state) => state.markSettleTimeout);
  const resetSession = useAppStore((state) => state.resetSession);
  const applyExecutionStarted = useAppStore((state) => state.applyExecutionStarted);
  const activeModel = useActiveModel(depsSessionId);
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const getProviderType = useProviderStore((state) => state.getProviderType);
  const resolvedProviderType = getProviderType(currentProvider);

  // Fetch chat internally based on sessionId
  const currentChat = useAppStore((state) =>
    depsSessionId ? state.chats.find((chat) => chat.id === depsSessionId) || null : null,
  );
  const activeModelRef = useActiveModelRef(currentChat?.config?.model_ref);

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
    const state = useAppStore.getState();
    const chats = Array.isArray(state.chats) ? state.chats : [];
    const chat = chats.find((item) => item.id === sessionId);
    const pendingQuestion = selectPendingQuestion(sessionId)(state);
    const pendingForSession = pendingQuestion
      ? {
          sessionId,
          question: pendingQuestion.question,
          options: pendingQuestion.options,
          allowCustom: pendingQuestion.allowCustom,
          toolCallId: pendingQuestion.toolCallId,
        }
      : null;
    const syncCursor = chat?.config?.syncCursor;
    const hasPendingQuestion =
      Boolean(pendingForSession) || Boolean(syncCursor?.hasPendingQuestion);
    const pendingQuestionToolCallId =
      pendingForSession?.toolCallId ?? syncCursor?.pendingQuestionToolCallId ?? null;

    const clientSync = {
      client_message_count: syncCursor?.messageCount ?? chat?.messageCount ?? 0,
      client_last_message_id: syncCursor?.lastMessageId ?? null,
      client_has_pending_question: hasPendingQuestion,
      client_pending_question_tool_call_id: pendingQuestionToolCallId,
    };

    debugLog("[Streaming]", "buildClientSync", {
      sessionId,
      generation: selectGeneration(sessionId)(state),
      syncCursor: syncCursor ?? null,
      messageCount: chat?.messageCount ?? null,
      respondMode: pendingForSession
        ? {
            toolCallId: pendingForSession.toolCallId ?? null,
            question: pendingForSession.question,
          }
        : null,
      clientSync,
    });

    return clientSync;
  }, []);

  const applyExecuteSyncSnapshot = useCallback(
    (sessionId: string, executeResult: ExecuteResponse) => {
      const sync = executeResult.sync;
      if (!sync) return;
      const storeState = useAppStore.getState() as Partial<{ chats: ChatItem[] }>;
      const chats = Array.isArray(storeState.chats) ? storeState.chats : [];
      const chat = chats.find((item) => item.id === sessionId);
      if (!chat) return;

      debugLog("[Streaming]", "applyExecuteSyncSnapshot", {
        sessionId,
        generation: selectGeneration(sessionId)(useAppStore.getState()),
        runId: executeResult.run_id ?? null,
        sync,
      });

      updateSession(sessionId, {
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
    [updateSession],
  );

  // Delegates to AgentClient.getPendingQuestion, which returns `null` (rather
  // than throwing, or masquerading as `{ has_pending_question: false }`) on a
  // transport failure. Callers below MUST treat `null` as "unknown" and never
  // clear an existing pending question or re-execute on it (#37).
  const getPendingQuestion = useCallback(
    (sessionId: string): Promise<PendingQuestionResponse | null> =>
      agentClientRef.current.getPendingQuestion(sessionId),
    [],
  );

  const recoverAfterNeedSync = useCallback(
    async (
      sessionId: string,
      executeSync: ExecuteResponse["sync"],
      reasoningEffort?: ReasoningEffort,
    ): Promise<ExecuteResponse | null> => {
      debugLog("[Streaming]", "recoverAfterNeedSync.start", {
        sessionId,
        generation: selectGeneration(sessionId)(useAppStore.getState()),
        executeSync,
        reasoningEffort: reasoningEffort ?? null,
      });
      markSettleTimeout(sessionId);
      await useAppStore.getState().loadChatHistory(sessionId, { mode: "replace" });

      const pending = await getPendingQuestion(sessionId);
      const setPendingQuestion = useAppStore.getState().setPendingQuestion;
      const clearPendingQuestion = useAppStore.getState().clearPendingQuestion;

      if (pending === null) {
        // Transport failure — we genuinely don't know whether a
        // clarification is pending. Do NOT clear any existing
        // pending-question UI and do NOT proceed to re-execute the agent
        // (that would race a real clarification the user hasn't answered
        // yet). Surface a connectivity hint and stop this recovery attempt;
        // the caller settles the timeout the same way as a "not recovered"
        // result.
        debugLog("[Streaming]", "recoverAfterNeedSync.pendingUnavailable", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
        });
        appMessage.error(t("chat.streaming.agentUnavailable"));
        return null;
      }

      if (pending.has_pending_question) {
        const typedPermission = normalizePermissionRequest(pending);
        debugLog("[Streaming]", "recoverAfterNeedSync.pendingQuestion", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
          pending,
        });
        setPendingQuestion(sessionId, {
          question: pending.question || "",
          options: typedPermission
            ? supportedPermissionDecisionIds(typedPermission)
            : pending.options || [],
          allowCustom: typedPermission ? false : (pending.allow_custom ?? true),
          toolCallId: pending.tool_call_id ?? null,
          permissionRequest: typedPermission ?? undefined,
        });

        const chat = useAppStore.getState().chats.find((item) => item.id === sessionId);
        if (chat) {
          updateSession(sessionId, {
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

      clearPendingQuestion(sessionId);

      const hasPendingUserMessage = executeSync?.has_pending_user_message ?? false;
      if (!hasPendingUserMessage) {
        debugLog("[Streaming]", "recoverAfterNeedSync.noPendingUserMessage", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
          executeSync,
        });
        return null;
      }

      debugLog("[Streaming]", "recoverAfterNeedSync.retryExecute", {
        sessionId,
        generation: selectGeneration(sessionId)(useAppStore.getState()),
        executeSync,
      });
      markOptimisticStart(sessionId);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const retryResult = await executeWithOptionalReasoning(
        agentClientRef.current,
        sessionId,
        reasoningEffort,
        buildClientSync(sessionId),
        activeModelRef ?? undefined,
      );
      debugLog("[Streaming]", "recoverAfterNeedSync.retryExecute.result", {
        sessionId,
        generation: selectGeneration(sessionId)(useAppStore.getState()),
        status: retryResult.status,
        runId: retryResult.run_id ?? null,
        sync: retryResult.sync ?? null,
      });
      applyExecuteSyncSnapshot(sessionId, retryResult);
      return retryResult;
    },
    [
      activeModelRef,
      appMessage,
      applyExecuteSyncSnapshot,
      buildClientSync,
      getPendingQuestion,
      markOptimisticStart,
      markSettleTimeout,
      t,
      updateSession,
    ],
  );

  const handleExecuteResult = useCallback(
    async (
      sessionId: string,
      executeResult: ExecuteResponse,
      reasoningEffort?: ReasoningEffort,
    ) => {
      let resolvedExecuteResult = executeResult;
      debugLog("[Streaming]", "handleExecuteResult.start", {
        sessionId,
        generation: selectGeneration(sessionId)(useAppStore.getState()),
        status: resolvedExecuteResult.status,
        runId: resolvedExecuteResult.run_id ?? null,
        sync: resolvedExecuteResult.sync ?? null,
      });
      applyExecuteSyncSnapshot(sessionId, resolvedExecuteResult);

      const maxSyncRecoveries = 2;
      let syncRecoveries = 0;
      while (resolvedExecuteResult.sync?.need_sync && syncRecoveries < maxSyncRecoveries) {
        debugLog("[Streaming]", "handleExecuteResult.needSync", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
          syncRecoveries,
          sync: resolvedExecuteResult.sync,
        });
        const recovered = await recoverAfterNeedSync(
          sessionId,
          resolvedExecuteResult.sync,
          reasoningEffort,
        );
        syncRecoveries += 1;
        if (!recovered) {
          markSettleTimeout(sessionId);
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
        markSettleTimeout(sessionId);
        return;
      }

      if (["started", "already_running"].includes(resolvedExecuteResult.status)) {
        if (resolvedExecuteResult.run_id) {
          const generation = selectGeneration(sessionId)(useAppStore.getState());
          applyExecutionStarted(sessionId, resolvedExecuteResult.run_id, generation);
        }
        return;
      }
      if (resolvedExecuteResult.status === "completed") {
        debugLog("[Streaming]", "[Agent] Session already completed");
        markSettleTimeout(sessionId);
        return;
      }

      console.error("[Agent] Execute failed:", resolvedExecuteResult.status);
      markSettleTimeout(sessionId);
      throw new Error(`Execute failed: ${resolvedExecuteResult.status}`);
    },
    [applyExecuteSyncSnapshot, recoverAfterNeedSync, markSettleTimeout, applyExecutionStarted],
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
      workflowSelection?: WorkflowSelection,
    ) => {
      // Validate model is available (TypeScript type guard)
      if (!activeModel) {
        throw new Error(t("chat.model.noModelSelected"));
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const enhancePrompt = getSystemPromptEnhancementText(resolvedProviderType).trim();
        const copilotConclusionWithOptionsEnhancementEnabled =
          resolvedProviderType === "copilot" && isCopilotConclusionWithOptionsEnhancementEnabled();
        const persistedWorkspacePath = currentChat?.config?.workspacePath?.trim() || null;

        debugLog("[Streaming]", "sendWithAgent.start", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
          userMessageId: userMessage.id,
          contentLength: content.length,
          imageCount: userMessage.images?.length ?? 0,
          reasoningEffort: reasoningEffort ?? null,
          selectedSkillCount: selectedSkillIds?.length ?? 0,
          workflowSelection: workflowSelection
            ? {
                id: workflowSelection.id,
                source: workflowSelection.source,
                revision: workflowSelection.revision,
                argumentKeys: Object.keys(workflowSelection.args).sort(),
              }
            : null,
          workspacePath: persistedWorkspacePath,
          activeModel,
          activeModelRef: activeModelRef ?? null,
        });

        // Step 1: Send message to Agent. The session was already created
        // through POST /sessions, and Workspace changes are persisted
        // separately through the CAS-backed PATCH /sessions/{id} endpoint.
        // Replaying the current workspace here would make Bamboo interpret an
        // ordinary turn as an explicit switch and reject legacy/unregistered
        // persisted workspaces with 409.
        const response = await agentClientRef.current.sendMessage({
          message: content,
          session_id: sessionId,
          enhance_prompt: enhancePrompt || undefined,
          copilot_conclusion_with_options_enhancement_enabled:
            copilotConclusionWithOptionsEnhancementEnabled,
          // Carried for the backend's consistency check (409
          // `session_project_reassignment_required` on mismatch). Omitted
          // when unknown — Bamboo treats a missing field as "no opinion",
          // never as an unassign instruction.
          project_id: currentChat?.config?.projectId ?? undefined,
          selected_skill_ids:
            selectedSkillIds && selectedSkillIds.length > 0 ? selectedSkillIds : undefined,
          workflow_selection: workflowSelection,
          images: userMessage.images
            ?.filter((img) => Boolean(img.base64))
            .map((img) => ({
              base64: img.base64 as string,
              name: img.name,
              size: img.size,
              type: img.type,
            })),
          model: activeModel,
          ...(activeModelRef
            ? { model_ref: activeModelRef, provider: activeModelRef.provider }
            : {}),
        });

        debugLog("[Streaming]", "sendWithAgent.chatResponse", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
          response,
        });

        const { session_id } = response;
        if (session_id !== sessionId) {
          console.warn(
            `[useMessageStreaming] Backend returned unexpected session_id=${session_id} for sessionId=${sessionId}`,
          );
        }

        if (workflowSelection) {
          // Bamboo validates the immutable Workflow identity before it accepts
          // the chat. Stage the optimistic message only after that boundary so
          // a typed 409/422 cannot switch layouts and remount the composer,
          // which would discard the Workflow draft, arguments, references and
          // attachments the user needs for recovery.
          await addMessage(sessionId, userMessage);
          markOptimisticStart(sessionId);
          await new Promise((resolve) => setTimeout(resolve, 0));
          await useAppStore.getState().refreshSessionDetail(sessionId, { force: true });
        }

        // ---- Goal command handling ----
        // When the backend signals a /goal control command, update local goldConfig
        // and decide whether to proceed with execute.
        if (response.goal_command) {
          const gc = response.goal_command;
          debugLog("[Streaming]", "sendWithAgent.goalCommand", {
            sessionId,
            action: gc.action,
            shouldExecute: gc.should_execute,
            hasGoldConfig: gc.gold_config != null,
          });

          // Update local session config immediately from response.
          if (gc.gold_config !== undefined) {
            const currentChat = useAppStore.getState().chats.find((c) => c.id === sessionId);
            if (currentChat?.config) {
              useAppStore.getState().updateSession(sessionId, {
                config: {
                  ...currentChat.config,
                  goldConfig: gc.gold_config ?? null,
                },
              });
            }
          }

          if (!gc.should_execute) {
            // Control-only command (status/off/clear/on): no runner is started
            // server-side, so there is nothing to observe. Tear down the
            // optimistically-started execution state authoritatively instead of
            // relying on markSettleTimeout, which only nudges starting/settling →
            // idle and loses the race against the premature one-shot `Complete`
            // delivered to the optimistic SSE subscription (which would otherwise
            // resurrect `settling` → busy → resubscribe, leaving the UI stuck in a
            // "processing" loop). resetSession drops the execution entry, which the
            // subscription effect treats as "no longer busy" and cleans up the SSE.
            resetSession(sessionId);
            await useAppStore.getState().loadChatHistory(sessionId, { mode: "replace" });
            await useAppStore.getState().refreshChatsNow();
            return;
          }

          // /goal <prompt> with should_execute=true: load history first so
          // the optimistic /goal message is replaced by the server state,
          // then proceed to execute (which will pick up the hidden resume).
          await useAppStore.getState().loadChatHistory(sessionId, { mode: "replace" });
        }

        // Refresh from persisted history once so execute uses a server-confirmed cursor
        debugLog("[Streaming]", "sendWithAgent.loadHistory.beforeExecute", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
        });
        // We delay or skip full history replacement here because the optimistic message
        // might not be completely propagated through DB triggers/read consistency paths.
        // The event bus will handle sync state organically as agent outputs arrive.
        // await useAppStore.getState().loadChatHistory(sessionId, { mode: "replace" });

        // Step 2: Trigger execution. The optimistic start has already been
        // emitted: immediately by the caller for ordinary messages, or above
        // after Bamboo accepted a typed Workflow selection.
        const executeResult = await executeWithOptionalReasoning(
          agentClientRef.current,
          sessionId,
          reasoningEffort,
          buildClientSync(sessionId),
          activeModelRef ?? undefined,
        );
        debugLog("[Streaming]", "sendWithAgent.executeResponse", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
          status: executeResult.status,
          runId: executeResult.run_id ?? null,
          sync: executeResult.sync ?? null,
        });
        await handleExecuteResult(sessionId, executeResult, reasoningEffort);
      } catch (error) {
        debugLog("[Streaming]", "sendWithAgent.error", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
          error,
        });
        throw error;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      activeModel,
      activeModelRef,
      addMessage,
      buildClientSync,
      currentChat,
      currentProvider,
      resolvedProviderType,
      depsSessionId,
      handleExecuteResult,
      markOptimisticStart,
      resetSession,
      t,
    ],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      images?: ImageFile[],
      reasoningEffort?: ReasoningEffort,
      selectedSkillIds?: string[],
      workflowSelection?: WorkflowSelection,
    ) => {
      if (!currentChat) {
        modal.info({
          title: t("chat.streaming.noActiveChatTitle"),
          content: t("chat.streaming.noActiveChatSendContent"),
        });
        return;
      }

      if (!depsSessionId) {
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

      const sessionId = depsSessionId;
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

      debugLog("[Streaming]", "sendMessage.localAdd.before", {
        sessionId,
        generation: selectGeneration(sessionId)(useAppStore.getState()),
        userMessageId: userMessage.id,
        contentLength: content.length,
        imageCount: messageImages.length,
        reasoningEffort: reasoningEffort ?? null,
        selectedSkillCount: selectedSkillIds?.length ?? 0,
        workflowSelectionId: workflowSelection?.id ?? null,
      });
      if (!workflowSelection) {
        await addMessage(sessionId, userMessage);
        debugLog("[Streaming]", "sendMessage.localAdd.after", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
          userMessageId: userMessage.id,
        });

        // Ordinary messages have no typed pre-execution validation boundary,
        // so keep their existing immediate optimistic feedback.
        markOptimisticStart(sessionId);
        debugLog("[Streaming]", "sendMessage.markOptimisticStart", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
        });
        // Yield so React can flush the processing-state render before we block
        // the microtask queue with network I/O.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      try {
        debugLog("[Streaming]", "[useChatStreaming] Using Agent Server");
        await sendWithAgent(
          content,
          sessionId,
          userMessage,
          reasoningEffort,
          selectedSkillIds,
          workflowSelection,
        );
        debugLog("[Streaming]", "sendMessage.completed", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
          userMessageId: userMessage.id,
        });
      } catch (error) {
        const workflowError = workflowSelection ? toWorkflowSelectionError(error) : null;
        if (streamingMessageIdRef.current) {
          streamingMessageBus.clear(sessionId, streamingMessageIdRef.current);
        }
        streamingMessageIdRef.current = null;
        streamingContentRef.current = "";

        if (workflowError) {
          const latestChat = useAppStore
            .getState()
            .chats.find((candidate) => candidate.id === sessionId);
          if (latestChat) {
            updateSession(sessionId, {
              messages: latestChat.messages.filter((message) => message.id !== userMessage.id),
            });
          }
          // Bamboo rejected the chat before execute, so no backend run exists.
          // Clear the optimistic execution state immediately and keep the
          // composer available for refresh/reselection.
          resetSession(sessionId);
        } else if (error instanceof Error && error.name === "AbortError") {
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
        debugLog("[Streaming]", "sendMessage.error", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
          error,
        });
        if (!workflowError) markSettleTimeout(sessionId);
        if (workflowError) throw workflowError;
      } finally {
        debugLog("[Streaming]", "sendMessage.finally", {
          sessionId,
          generation: selectGeneration(sessionId)(useAppStore.getState()),
          streamingMessageId: streamingMessageIdRef.current,
        });
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
      depsSessionId,
      addMessage,
      modal,
      sendWithAgent,
      setAgentAvailability,
      activeModel,
      t,
      markOptimisticStart,
      markSettleTimeout,
      resetSession,
      updateSession,
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

      if (!depsSessionId) {
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

      const sessionId = depsSessionId;

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

        markRetryStart(sessionId);

        const executeResult = await executeWithOptionalReasoning(
          agentClientRef.current,
          sessionId,
          reasoningEffort,
          buildClientSync(sessionId),
          activeModelRef ?? undefined,
        );
        await handleExecuteResult(sessionId, executeResult, reasoningEffort);
      } catch (error) {
        console.error("[useMessageStreaming] Retry failed:", error);
        const rawErrorMessage = error instanceof Error ? error.message : String(error ?? "");
        if (isCompletionPolicyViolationError(rawErrorMessage)) {
          appMessage.error(formatCompletionPolicyViolationMessage(rawErrorMessage));
        } else {
          appMessage.error(t("chat.streaming.retryFailed"));
        }
        markSettleTimeout(sessionId);
      } finally {
        abortRef.current = null;
      }
    },
    [
      activeModel,
      activeModelRef,
      agentAvailable,
      appMessage,
      buildClientSync,
      checkAgentAvailability,
      currentChat,
      depsSessionId,
      handleExecuteResult,
      modal,
      t,
      markRetryStart,
      markSettleTimeout,
    ],
  );

  return {
    sendMessage,
    retryLastTurn,
    cancel,
    agentAvailable,
  };
}
