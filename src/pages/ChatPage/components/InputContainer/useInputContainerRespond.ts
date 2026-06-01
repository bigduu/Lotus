import { useCallback } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import type { TFunction } from "i18next";
import { selectPendingQuestion, useAppStore } from "@shared/store/appStore";
import { agentApiClient } from "../../../../services/api";
import { CHAT_PENDING_QUESTION_RESOLVED_EVENT } from "../ChatView/events";
import type { ReasoningEffort } from "@services/chat/AgentService";
import type { ProviderModelRef } from "@shared/types/providerModelRef";
import { debugRespondFlow } from "./debug";
import type { RespondExecutionDebugSnapshot } from "./types";

interface UseInputContainerRespondProps {
  sessionId: string | null;
  reasoningEffort: ReasoningEffort;
  activeModelRef: ProviderModelRef | null;
  isFlagOn: () => boolean;
  messageApi: MessageInstance;
  setContent: (newContent: string) => void;
  pendingQuestionToolCallId: string | null;
  t: TFunction;
}

export const useInputContainerRespond = ({
  sessionId,
  reasoningEffort,
  activeModelRef,
  isFlagOn,
  messageApi,
  setContent,
  pendingQuestionToolCallId,
  t,
}: UseInputContainerRespondProps) => {
  const markRespondStart = useAppStore((state) => state.markRespondStart);
  const markSettleTimeout = useAppStore((state) => state.markSettleTimeout);
  const applyExecutionStarted = useAppStore((state) => state.applyExecutionStarted);
  const clearPendingQuestion = useAppStore((state) => state.clearPendingQuestion);

  const getRespondExecutionDebugSnapshot = useCallback((): RespondExecutionDebugSnapshot | null => {
    if (!sessionId) return null;
    const entry = useAppStore.getState().executionBySession?.[sessionId];
    if (!entry) return null;
    return {
      phase: entry.phase,
      generation: entry.generation,
      backendRunId: entry.backendRunId ?? null,
      backendIsRunning: entry.backend.isRunning,
      hasPendingQuestion: entry.interaction.pendingQuestion != null,
      pendingQuestionToolCallId: entry.interaction.pendingQuestion?.toolCallId ?? null,
      tokenCount: entry.stream.tokenCount,
      hasTokens: entry.stream.hasTokens,
      activeReasons: entry.activeReasons,
    };
  }, [sessionId]);

  const shouldUseRespondModeForSession = useCallback((targetSessionId?: string | null): boolean => {
    if (!targetSessionId) {
      return false;
    }
    const latestPendingQuestion = selectPendingQuestion(targetSessionId)(useAppStore.getState());
    return Boolean(latestPendingQuestion);
  }, []);

  const handleRespondSubmit = useCallback(
    async (responseText: string) => {
      const trimmed = responseText.trim();
      if (!trimmed || !sessionId) return;

      const latestPendingQuestion = selectPendingQuestion(sessionId)(useAppStore.getState());
      const currentRespondPayload = latestPendingQuestion;
      if (
        currentRespondPayload &&
        !currentRespondPayload.allowCustom &&
        currentRespondPayload.options.length > 0 &&
        !currentRespondPayload.options.includes(trimmed)
      ) {
        messageApi.warning(t("components.questionDialog.selectOptionWarning"));
        return;
      }

      debugRespondFlow("input.respond:start", {
        sessionId,
        trimmedLength: trimmed.length,
        pendingQuestionToolCallId: pendingQuestionToolCallId ?? null,
        executionBefore: getRespondExecutionDebugSnapshot(),
      });

      // Set processing state immediately so the UI shows feedback while the
      // outbound respond request is still in-flight.  This mirrors the send-path
      // fix that sets processing before the network call.
      // CRITICAL: This increases generation and returns the new generation value.
      const newGeneration = markRespondStart(sessionId, pendingQuestionToolCallId ?? null);
      debugRespondFlow("input.respond:afterMarkRespondStart", {
        sessionId,
        newGeneration,
        executionAfterMarkRespondStart: getRespondExecutionDebugSnapshot(),
      });
      // Yield so React can flush the processing-state render before we block
      // the microtask queue with network I/O.
      await new Promise((resolve) => setTimeout(resolve, 0));

      try {
        const respondPayload: Record<string, unknown> = {
          response: trimmed,
          reasoning_effort: reasoningEffort,
        };
        if (isFlagOn() && activeModelRef) {
          respondPayload.model_ref = activeModelRef;
          respondPayload.provider = activeModelRef.provider;
        }

        const result = await agentApiClient.post<{
          auto_resume_status?: string;
          run_id?: string;
        }>(`respond/${sessionId}`, respondPayload);
        debugRespondFlow("input.respond:response", {
          sessionId,
          result,
          executionAfterResponse: getRespondExecutionDebugSnapshot(),
        });

        messageApi.success(t("components.questionDialog.responseSubmittedContinue"));
        setContent("");
        clearPendingQuestion(sessionId);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(CHAT_PENDING_QUESTION_RESOLVED_EVENT, {
              detail: { sessionId },
            }),
          );
        }

        // Processing was already set to true before the POST.  If the server
        // started/resumed execution, immediately advance the phase to running
        // so the UI shows feedback without waiting for the SSE event (which may
        // be delayed by network jitter or reconnect backoff).
        const resumeStatus = result?.auto_resume_status;
        const runId = result?.run_id;
        debugRespondFlow("input.respond:resumeDecision", {
          sessionId,
          resumeStatus,
          runId: runId ?? null,
          newGeneration,
          executionBeforeResumeDecision: getRespondExecutionDebugSnapshot(),
        });
        if (resumeStatus === "started" || resumeStatus === "already_running") {
          // Use the newGeneration returned by markRespondStart to ensure SSE events
          // will match. This is critical because markRespondStart increased generation,
          // and all subsequent SSE events must use the matching generation.
          applyExecutionStarted(sessionId, runId ?? "", newGeneration);
          debugRespondFlow("input.respond:afterApplyExecutionStarted", {
            sessionId,
            resumeStatus,
            runId: runId ?? null,
            newGeneration,
            executionAfterApplyExecutionStarted: getRespondExecutionDebugSnapshot(),
          });
        } else if (resumeStatus === "error" || !resumeStatus) {
          console.error("[InputContainer] Failed to auto-resume agent execution");
          markSettleTimeout(sessionId);
        }
      } catch (err) {
        console.error("[InputContainer] Failed to submit respond:", err);
        messageApi.error(
          err instanceof Error ? err.message : t("components.questionDialog.submitFailed"),
        );
        // Clear processing on error to avoid stuck spinner.
        markSettleTimeout(sessionId);
      }
    },
    [
      sessionId,
      reasoningEffort,
      activeModelRef,
      isFlagOn,
      messageApi,
      setContent,
      clearPendingQuestion,
      markRespondStart,
      markSettleTimeout,
      applyExecutionStarted,
      getRespondExecutionDebugSnapshot,
      pendingQuestionToolCallId,
      t,
    ],
  );

  return { handleRespondSubmit, shouldUseRespondModeForSession };
};
