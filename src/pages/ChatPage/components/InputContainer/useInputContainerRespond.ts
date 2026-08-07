import { useCallback, useRef } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import type { TFunction } from "i18next";
import { selectPendingQuestion, useAppStore } from "@shared/store/appStore";
import { agentApiClient, apiClient } from "@services/api";
import { isApiError, isNoPendingQuestionError } from "@services/api/errors";
import { CHAT_PENDING_QUESTION_RESOLVED_EVENT } from "../ChatView/events";
import type { ReasoningEffort } from "@services/chat/AgentService";
import type { ProviderModelRef } from "@shared/types/providerModelRef";
import { debugRespondFlow } from "./debug";
import type { RespondExecutionDebugSnapshot } from "./types";
import {
  buildPermissionDecisionSubmission,
  type PermissionDecisionSubmission,
  type PermissionDecisionSubmissionOptions,
  type PermissionRequestContract,
} from "@shared/permissions/permissionContract";

interface UseInputContainerRespondProps {
  sessionId: string | null;
  reasoningEffort: ReasoningEffort;
  activeModelRef: ProviderModelRef | null;
  isFlagOn: () => boolean;
  messageApi: MessageInstance;
  setContent: (newContent: string) => void;
  pendingQuestionToolCallId: string | null;
  permissionRequest?: PermissionRequestContract;
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
  permissionRequest,
  t,
}: UseInputContainerRespondProps) => {
  const markRespondStart = useAppStore((state) => state.markRespondStart);
  const markSettleTimeout = useAppStore((state) => state.markSettleTimeout);
  const applyExecutionStarted = useAppStore((state) => state.applyExecutionStarted);
  const setPendingQuestion = useAppStore((state) => state.setPendingQuestion);
  const clearPendingQuestion = useAppStore((state) => state.clearPendingQuestion);
  const inFlightRespondKeyRef = useRef<string | null>(null);
  const lastResolvedPermissionKeyRef = useRef<string | null>(null);

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
    async (responseText: string, permissionOptions: PermissionDecisionSubmissionOptions = {}) => {
      const trimmed = responseText.trim();
      if (!trimmed || !sessionId) return false;

      const latestPendingQuestion = selectPendingQuestion(sessionId)(useAppStore.getState());
      if (
        permissionRequest?.requestId &&
        latestPendingQuestion &&
        latestPendingQuestion.permissionRequest?.requestId !== permissionRequest.requestId
      ) {
        // A durable confirmation modal can outlive the request that opened it.
        // Never apply that stale choice to the next FIFO permission prompt.
        messageApi.warning(t("components.questionDialog.requestChanged"));
        return false;
      }
      const pendingSnapshot = latestPendingQuestion
        ? {
            question: latestPendingQuestion.question,
            options: [...latestPendingQuestion.options],
            allowCustom: latestPendingQuestion.allowCustom,
            toolCallId: latestPendingQuestion.toolCallId,
            permissionRequest: latestPendingQuestion.permissionRequest,
          }
        : null;
      const currentRespondPayload = latestPendingQuestion;
      if (
        currentRespondPayload &&
        !currentRespondPayload.allowCustom &&
        currentRespondPayload.options.length > 0 &&
        !currentRespondPayload.options.includes(trimmed)
      ) {
        messageApi.warning(t("components.questionDialog.selectOptionWarning"));
        return false;
      }

      const activePermissionRequest = latestPendingQuestion?.permissionRequest ?? permissionRequest;
      let permissionSubmission: PermissionDecisionSubmission | null = null;
      if (activePermissionRequest?.requestId) {
        try {
          permissionSubmission = buildPermissionDecisionSubmission(
            activePermissionRequest,
            trimmed,
            permissionOptions,
          );
        } catch (error) {
          const reason = error instanceof Error ? error.message.toLowerCase() : "";
          const message = reason.includes("matcher")
            ? t("components.questionDialog.matcherRequired")
            : reason.includes("policy revision")
              ? t("components.questionDialog.policyRevisionRequired")
              : reason.includes("workspace identity")
                ? t("components.questionDialog.workspaceRequired")
                : reason.includes("confirmation")
                  ? t("components.questionDialog.globalConfirmationRequired")
                  : t("components.questionDialog.decisionNotAllowed");
          messageApi.error(message);
          return false;
        }
      }

      const permissionSessionId = activePermissionRequest?.sessionId || sessionId;
      const respondKey = activePermissionRequest?.requestId
        ? `${permissionSessionId}:${activePermissionRequest.requestId}`
        : `${sessionId}:${pendingQuestionToolCallId ?? "respond"}`;
      if (
        inFlightRespondKeyRef.current != null ||
        (activePermissionRequest?.requestId && lastResolvedPermissionKeyRef.current === respondKey)
      ) {
        return false;
      }
      inFlightRespondKeyRef.current = respondKey;

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
        type ResumeResult = {
          auto_resume_status?: string;
          run_id?: string;
        };
        type PermissionDecisionResult = {
          success: boolean;
          replayed: boolean;
          resume?: { accepted?: boolean };
        };
        let result: ResumeResult | PermissionDecisionResult;
        if (permissionSubmission) {
          result = await agentApiClient.post<PermissionDecisionResult>(
            `sessions/${encodeURIComponent(permissionSessionId)}/permission-decisions`,
            permissionSubmission,
            { retryable: true } as RequestInit,
          );
          if (!result.success) {
            throw new Error(t("components.questionDialog.submitFailed"));
          }
        } else {
          const respondPayload: Record<string, unknown> = {
            response: trimmed,
            reasoning_effort: reasoningEffort,
          };
          if (isFlagOn() && activeModelRef) {
            respondPayload.model_ref = activeModelRef;
            respondPayload.provider = activeModelRef.provider;
          }
          result = await agentApiClient.post<ResumeResult>(`respond/${sessionId}`, respondPayload);
        }
        debugRespondFlow("input.respond:response", {
          sessionId,
          result,
          executionAfterResponse: getRespondExecutionDebugSnapshot(),
        });

        if (activePermissionRequest?.requestId) {
          lastResolvedPermissionKeyRef.current = respondKey;
        }
        messageApi.success(t("components.questionDialog.responseSubmittedContinue"));
        setContent("");
        clearPendingQuestion(sessionId);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(CHAT_PENDING_QUESTION_RESOLVED_EVENT, {
              detail: {
                sessionId,
                requestId: activePermissionRequest?.requestId,
              },
            }),
          );
        }

        // Processing was already set to true before the POST.  If the server
        // started/resumed execution, immediately advance the phase to running
        // so the UI shows feedback without waiting for the SSE event (which may
        // be delayed by network jitter or reconnect backoff).
        const typedResult = permissionSubmission ? (result as PermissionDecisionResult) : undefined;
        const legacyResult = permissionSubmission ? undefined : (result as ResumeResult);
        const resumeStatus = legacyResult?.auto_resume_status;
        const runId = legacyResult?.run_id;
        debugRespondFlow("input.respond:resumeDecision", {
          sessionId,
          resumeStatus,
          runId: runId ?? null,
          newGeneration,
          executionBeforeResumeDecision: getRespondExecutionDebugSnapshot(),
        });
        if (typedResult) {
          if (typedResult.resume?.accepted) {
            // The typed endpoint has already recorded the idempotent receipt and
            // accepted the resume. It intentionally does not expose a run id, so
            // use the same optimistic transition as the legacy response path and
            // let the live stream supply the authoritative run identity.
            applyExecutionStarted(sessionId, "", newGeneration);
          } else {
            // Nothing new was resumed for an already-resolved replay. Reconcile
            // through the normal settle/snapshot path instead of reporting an
            // artificial auto-resume failure.
            markSettleTimeout(sessionId);
          }
        } else if (resumeStatus === "started" || resumeStatus === "already_running") {
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
        return true;
      } catch (err) {
        if (!permissionSubmission && isNoPendingQuestionError(err)) {
          setContent("");
          clearPendingQuestion(sessionId);
          if (typeof window !== "undefined") {
            window.dispatchEvent(
              new CustomEvent(CHAT_PENDING_QUESTION_RESOLVED_EVENT, {
                detail: {
                  sessionId,
                  requestId: activePermissionRequest?.requestId,
                },
              }),
            );
          }
          markSettleTimeout(sessionId);
          return true;
        }
        console.error("[InputContainer] Failed to submit respond:", err);
        let restoredSnapshot = pendingSnapshot;
        if (restoredSnapshot?.permissionRequest && isApiError(err) && err.status === 409) {
          try {
            const currentPolicy = await apiClient.get<{ revision?: number }>(
              "/bamboo/permission/policy",
            );
            if (
              typeof currentPolicy.revision === "number" &&
              Number.isSafeInteger(currentPolicy.revision)
            ) {
              restoredSnapshot = {
                ...restoredSnapshot,
                permissionRequest: {
                  ...restoredSnapshot.permissionRequest,
                  policyRevision: currentPolicy.revision,
                },
              };
            }
          } catch (refreshError) {
            console.warn(
              "[InputContainer] Failed to refresh permission policy revision:",
              refreshError,
            );
          }
        }
        const transientFailure =
          !isApiError(err) ||
          err.status === 409 ||
          err.status === 408 ||
          err.status === 429 ||
          err.status >= 500;
        if (transientFailure && restoredSnapshot) {
          setPendingQuestion(sessionId, restoredSnapshot);
        }
        messageApi.error(
          isApiError(err) && err.status === 409
            ? t("components.questionDialog.policyRevisionChanged")
            : err instanceof Error
              ? err.message
              : t("components.questionDialog.submitFailed"),
        );
        // Clear processing on error to avoid stuck spinner.
        markSettleTimeout(sessionId);
        return false;
      } finally {
        if (inFlightRespondKeyRef.current === respondKey) {
          inFlightRespondKeyRef.current = null;
        }
      }
    },
    [
      sessionId,
      reasoningEffort,
      activeModelRef,
      isFlagOn,
      messageApi,
      setContent,
      setPendingQuestion,
      clearPendingQuestion,
      markRespondStart,
      markSettleTimeout,
      applyExecutionStarted,
      getRespondExecutionDebugSnapshot,
      pendingQuestionToolCallId,
      permissionRequest,
      t,
    ],
  );

  return { handleRespondSubmit, shouldUseRespondModeForSession };
};
