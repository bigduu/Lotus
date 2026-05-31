import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { App as AntApp, Button, Radio, Space, Typography, theme } from "antd";
import { EditOutlined, UpOutlined, DownOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { agentApiClient } from "../../services/api";
import { selectIsBusy, selectPendingQuestion, useAppStore } from "../../pages/ChatPage/store";
import { useActiveModelRef } from "../../pages/ChatPage/hooks/useActiveModelRef";
import { readPersistedInputReasoningEffort } from "../../pages/ChatPage/store/slices/inputStateSlice";
import { useProviderStore } from "../../pages/ChatPage/store/slices/providerSlice";
import type { ReasoningEffort } from "@services/chat/AgentService";
import {
  resolveEffectiveReasoningEffort,
  resolveProviderDefaultReasoningEffort,
} from "../../pages/ChatPage/utils/reasoningEffort";
import { CHAT_PENDING_QUESTION_RESOLVED_EVENT } from "../../pages/ChatPage/components/ChatView/events";
import { buildPendingQuestionIdentity } from "../../pages/ChatPage/utils/pendingQuestionIdentity";
import styles from "./QuestionDialog.module.css";

const { Text } = Typography;
const { useToken } = theme;

export interface PendingQuestion {
  has_pending_question: boolean;
  question?: string;
  options?: string[];
  allow_custom?: boolean;
  tool_call_id?: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export const formatPendingQuestionText = (raw?: string): string => {
  const normalized = (raw || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) return "";
  if (normalized.includes("\n")) return normalized;

  // Auto-break common inline list patterns so long conclusion_with_options prompts stay readable.
  return normalized
    .replace(/\s+(?=\d+[).]\s)/g, "\n")
    .replace(/\s+(?=[一二三四五六七八九十]+[、.]\s)/g, "\n")
    .replace(/\s+(?=[-*•]\s)/g, "\n");
};

interface QuestionDialogProps {
  sessionId: string;
  onResponseSubmitted?: () => void;
  onQuestionAppeared?: () => void;
}

interface RespondSubmitResult {
  auto_resume_status?: string;
  run_id?: string;
}

function debugQuestionDialog(event: string, payload: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem("lotus_debug_respond") !== "1") return;
  console.warn(`[QuestionDialog] ${event}`, payload);
}

const QuestionDialogComponent: React.FC<QuestionDialogProps> = ({
  sessionId,
  onResponseSubmitted,
  onQuestionAppeared,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const { message } = AntApp.useApp();
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  // NOTE: We intentionally avoid permanently stopping polling. The agent may ask
  // questions later in the session; stopping polling would prevent the dialog
  // from ever appearing.
  const emptyCountRef = useRef(0);
  const backoffLevelRef = useRef(0); // 0=fast, 1=medium, 2=slow
  const lastQuestionIdentityRef = useRef<string | null>(null);
  const dismissedQuestionIdentityRef = useRef<string | null>(null);
  const pollInvalidationRef = useRef(0);
  const onQuestionAppearedRef = useRef(onQuestionAppeared);
  onQuestionAppearedRef.current = onQuestionAppeared;

  const invalidatePendingPollResponses = useCallback(() => {
    pollInvalidationRef.current += 1;
    debugQuestionDialog("poll:invalidate", {
      sessionId,
      nextInvalidation: pollInvalidationRef.current,
    });
  }, [sessionId]);

  // Track document visibility for background tab detection
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden,
  );

  const {
    markRespondStart,
    markSettleTimeout,
    applyExecutionStarted,
    setPendingQuestion,
    clearPendingQuestion,
    sessionModelRef,
    sessionReasoningEffort,
    inputReasoningEffort,
    isCurrentSession,
  } = useAppStore(
    useShallow((state) => {
      const chat = sessionId ? (state.chats.find((item) => item.id === sessionId) ?? null) : null;
      return {
        markRespondStart: state.markRespondStart,
        markSettleTimeout: state.markSettleTimeout,
        applyExecutionStarted: state.applyExecutionStarted,
        setPendingQuestion: state.setPendingQuestion,
        clearPendingQuestion: state.clearPendingQuestion,
        sessionModelRef: chat?.config?.model_ref ?? null,
        sessionReasoningEffort: chat?.config?.reasoningEffort ?? null,
        inputReasoningEffort: sessionId
          ? (state.inputStates?.[sessionId]?.reasoningEffort ?? null)
          : null,
        isCurrentSession: state.currentSessionId === sessionId,
      };
    }),
  );
  const storePendingQuestion = useAppStore(selectPendingQuestion(sessionId));

  const activeModelRef = useActiveModelRef(sessionModelRef);

  // Resolve reasoning effort (same priority as InputContainer)
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const providerConfig = useProviderStore((state) => state.providerConfig);
  const providerInstances = useProviderStore((state) => state.providerInstances);
  const providerDefaultReasoningEffort = useMemo<ReasoningEffort | undefined>(
    () =>
      resolveProviderDefaultReasoningEffort(
        providerConfig,
        activeModelRef,
        sessionModelRef?.provider ?? currentProvider,
        providerInstances,
      ),
    [activeModelRef, sessionModelRef?.provider, providerConfig, currentProvider, providerInstances],
  );
  const persistedReasoningEffort = useMemo<ReasoningEffort | undefined>(
    () => (sessionId ? readPersistedInputReasoningEffort(sessionId) : undefined),
    [sessionId],
  );
  const reasoningEffort: ReasoningEffort = resolveEffectiveReasoningEffort({
    sessionEffort: sessionReasoningEffort,
    inputEffort: inputReasoningEffort,
    persistedEffort: persistedReasoningEffort,
    providerDefault: providerDefaultReasoningEffort,
  });

  const getExecutionDebugSnapshot = useCallback(() => {
    const entry = useAppStore.getState().executionBySession?.[sessionId];
    if (!entry) {
      return null;
    }
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

  // selectIsBusy = any active execution; used to speed up polling while agent is running
  const isSessionProcessing = useAppStore(selectIsBusy(sessionId));

  // Fetch pending question
  const fetchPendingQuestion = useCallback(async () => {
    const requestInvalidation = pollInvalidationRef.current;
    try {
      const data = await agentApiClient.get<PendingQuestion>(`respond/${sessionId}/pending`);
      if (requestInvalidation !== pollInvalidationRef.current) {
        return;
      }
      if (data.has_pending_question) {
        const payload = {
          question: data.question ?? "",
          options: data.options ?? [],
          allowCustom: data.allow_custom ?? true,
          toolCallId: data.tool_call_id ?? null,
        };
        const identity = buildPendingQuestionIdentity({ sessionId, ...payload });
        if (dismissedQuestionIdentityRef.current === identity) {
          emptyCountRef.current = 0;
          backoffLevelRef.current = 0;
          return;
        }
        dismissedQuestionIdentityRef.current = null;
        setPendingQuestion(sessionId, payload);
        emptyCountRef.current = 0;
        backoffLevelRef.current = 0;
      } else {
        dismissedQuestionIdentityRef.current = null;
        clearPendingQuestion(sessionId);
        lastQuestionIdentityRef.current = null;
        emptyCountRef.current += 1;
        // Update backoff level based on consecutive empty responses
        if (emptyCountRef.current >= 6) {
          backoffLevelRef.current = 2;
        } else if (emptyCountRef.current >= 2) {
          backoffLevelRef.current = 1;
        }
      }
    } catch (err) {
      if (requestInvalidation !== pollInvalidationRef.current) {
        return;
      }
      // Handle 404 - no pending question for this session
      if (err instanceof Error && err.message.includes("404")) {
        dismissedQuestionIdentityRef.current = null;
        clearPendingQuestion(sessionId);
        lastQuestionIdentityRef.current = null;
        emptyCountRef.current += 1;
        return;
      }

      // A failed poll (for example CORS/access-control or a transient network error)
      // should not leave an old question/respond mode stuck in the UI. The next
      // successful poll will re-open the dialog if the backend still has a pending question.
      dismissedQuestionIdentityRef.current = null;
      clearPendingQuestion(sessionId);
      lastQuestionIdentityRef.current = null;
      emptyCountRef.current += 1;
      // Update backoff on error too (treat as empty response)
      if (emptyCountRef.current >= 6) {
        backoffLevelRef.current = 2;
      } else if (emptyCountRef.current >= 2) {
        backoffLevelRef.current = 1;
      }
      console.error("Failed to fetch pending question:", err);
    } finally {
      if (requestInvalidation !== pollInvalidationRef.current) {
        return;
      }
      setIsLoading(false);
    }
  }, [sessionId, setPendingQuestion, clearPendingQuestion]);

  // Reset local polling/backoff UI when session changes.
  useEffect(() => {
    invalidatePendingPollResponses();
    emptyCountRef.current = 0;
    backoffLevelRef.current = 0;
    lastQuestionIdentityRef.current = null;
    dismissedQuestionIdentityRef.current = null;
    setIsLoading(true);
    setSelectedOption(null);
    setCollapsed(false);
  }, [sessionId, invalidatePendingPollResponses]);

  // Listen for document visibility changes
  useEffect(() => {
    if (typeof document === "undefined") return;

    const onVisibilityChange = () => {
      setIsDocumentVisible(!document.hidden);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // When a new question appears in the execution store, reset local UI state.
  useEffect(() => {
    if (storePendingQuestion) {
      const nextIdentity = buildPendingQuestionIdentity({
        sessionId,
        question: storePendingQuestion.question,
        options: storePendingQuestion.options,
        allowCustom: storePendingQuestion.allowCustom,
        toolCallId: storePendingQuestion.toolCallId,
      });
      const isSameQuestion = lastQuestionIdentityRef.current === nextIdentity;

      if (!isSameQuestion) {
        setSelectedOption(null);
        setCollapsed(false);
        onQuestionAppearedRef.current?.();
      }

      lastQuestionIdentityRef.current = nextIdentity;
      if (
        dismissedQuestionIdentityRef.current !== null &&
        dismissedQuestionIdentityRef.current !== nextIdentity
      ) {
        dismissedQuestionIdentityRef.current = null;
      }
    } else {
      lastQuestionIdentityRef.current = null;
    }
  }, [
    sessionId,
    storePendingQuestion,
    storePendingQuestion?.allowCustom,
    storePendingQuestion?.options,
    storePendingQuestion?.question,
    storePendingQuestion?.toolCallId,
  ]);

  // Adaptive polling with backoff based on session state and visibility
  const getPendingPollDelayMs = useCallback((): number | null => {
    // If the execution store already has the question, no need to keep polling for it.
    // We rely on CHAT_PENDING_QUESTION_RESOLVED_EVENT or the next polling
    // cycle (after the store is cleared) to detect resolution.
    if (storePendingQuestion) return null;

    // If session is actively processing, poll faster
    if (isSessionProcessing) {
      // Only poll processing sessions if they're current or visible
      if (!isCurrentSession) return null;
      return isDocumentVisible ? 5000 : 15000;
    }

    // Idle session: only poll current session, with adaptive backoff
    if (!isCurrentSession) return null;
    if (!isDocumentVisible) return null;

    const level = backoffLevelRef.current;
    if (level === 0) return 30000; // First few empty responses: 30s
    if (level === 1) return 60000; // After more empties: 60s
    return 120000; // Sustained idle: 2 minutes
  }, [storePendingQuestion, isSessionProcessing, isCurrentSession, isDocumentVisible]);

  // Timeout-based adaptive polling (replaces fixed interval)
  useEffect(() => {
    // If the execution store already has the question, skip polling entirely.
    // The resolved event or the next store state change will re-enable
    // polling when the question is cleared.
    if (storePendingQuestion) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled || isSubmitting) return;

      await fetchPendingQuestion();
      if (cancelled) return;

      const delay = getPendingPollDelayMs();
      if (delay === null) return;

      timeoutId = setTimeout(tick, delay);
    };

    // Initial fetch on mount
    void tick();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [storePendingQuestion, fetchPendingQuestion, getPendingPollDelayMs, isSubmitting]);

  // Let sibling panes hide the same session's question immediately after a successful respond
  // (without waiting for next polling cycle).
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onResolved = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string | null }>;
      const targetSessionId = customEvent.detail?.sessionId ?? null;
      if (!targetSessionId || targetSessionId !== sessionId) {
        return;
      }

      debugQuestionDialog("resolved:event", {
        sessionId,
        targetSessionId,
        executionBefore: getExecutionDebugSnapshot(),
      });
      invalidatePendingPollResponses();
      setSelectedOption(null);
      lastQuestionIdentityRef.current = null;
      emptyCountRef.current = 0;
    };

    window.addEventListener(CHAT_PENDING_QUESTION_RESOLVED_EVENT, onResolved as EventListener);
    return () => {
      window.removeEventListener(CHAT_PENDING_QUESTION_RESOLVED_EVENT, onResolved as EventListener);
    };
  }, [sessionId, invalidatePendingPollResponses, getExecutionDebugSnapshot]);

  // Update selected option. Respond mode stays active for the entire
  // duration of the pending question (set in the effect above), so we
  // no longer toggle it per-option.
  const handleOptionChange = useCallback((value: string) => {
    setSelectedOption(value);
  }, []);

  // Submit response (for predefined options only; custom is handled by InputContainer)
  const handleSubmit = async () => {
    if (!selectedOption || selectedOption === "custom") {
      message.warning(t("components.questionDialog.selectOptionWarning"));
      return;
    }

    setIsSubmitting(true);

    debugQuestionDialog("submit:start", {
      sessionId,
      selectedOption,
      pendingQuestionToolCallId: storePendingQuestion?.toolCallId ?? null,
      executionBefore: getExecutionDebugSnapshot(),
    });

    // Invalidate older in-flight /pending polls so a late response cannot
    // re-show the just-submitted question.
    invalidatePendingPollResponses();

    // Set processing state immediately so the UI shows feedback while the
    // outbound respond request is still in-flight. This mirrors the send-path
    // and InputContainer respond-path fixes.
    // CRITICAL: This increases generation and returns the new generation value.
    const newGeneration = markRespondStart(sessionId, storePendingQuestion?.toolCallId ?? null);
    debugQuestionDialog("submit:afterMarkRespondStart", {
      sessionId,
      newGeneration,
      executionAfterMarkRespondStart: getExecutionDebugSnapshot(),
    });
    // Yield so React can flush the processing-state render before we block
    // the microtask queue with network I/O.
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      const modelRefPayload: Record<string, unknown> = {};
      if (useProviderStore.getState().isProviderModelRefEnabled() && activeModelRef) {
        modelRefPayload.model_ref = activeModelRef;
        modelRefPayload.provider = activeModelRef.provider;
      }

      const submitResult = await agentApiClient.post<RespondSubmitResult>(`respond/${sessionId}`, {
        response: selectedOption,
        reasoning_effort: reasoningEffort,
        ...modelRefPayload,
      });
      debugQuestionDialog("submit:response", {
        sessionId,
        submitResult,
        executionAfterResponse: getExecutionDebugSnapshot(),
      });

      message.success(t("components.questionDialog.responseSubmitted"));
      dismissedQuestionIdentityRef.current = storePendingQuestion
        ? buildPendingQuestionIdentity({
            sessionId,
            question: storePendingQuestion.question,
            options: storePendingQuestion.options,
            allowCustom: storePendingQuestion.allowCustom,
            toolCallId: storePendingQuestion.toolCallId,
          })
        : null;
      setSelectedOption(null);
      emptyCountRef.current = 0;
      clearPendingQuestion(sessionId);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(CHAT_PENDING_QUESTION_RESOLVED_EVENT, {
            detail: { sessionId },
          }),
        );
      }

      // Processing was already set to true before the POST. If the server
      // started/resumed execution, immediately advance the phase to running
      // so the UI shows feedback without waiting for the SSE event (which may
      // be delayed by network jitter or reconnect backoff).
      const resumeStatus = submitResult?.auto_resume_status;
      const runId = submitResult?.run_id;
      debugQuestionDialog("submit:resumeDecision", {
        sessionId,
        resumeStatus,
        runId: runId ?? null,
        newGeneration,
        executionBeforeResumeDecision: getExecutionDebugSnapshot(),
      });
      if (resumeStatus === "started" || resumeStatus === "already_running") {
        // Use the newGeneration returned by markRespondStart to ensure SSE events
        // will match. This is critical because markRespondStart increased generation,
        // and all subsequent SSE events must use the matching generation.
        applyExecutionStarted(sessionId, runId ?? "", newGeneration);
        debugQuestionDialog("submit:afterApplyExecutionStarted", {
          sessionId,
          resumeStatus,
          runId: runId ?? null,
          newGeneration,
          executionAfterApplyExecutionStarted: getExecutionDebugSnapshot(),
        });
      } else if (resumeStatus === "error" || !resumeStatus) {
        console.error("[QuestionDialog] Failed to auto-resume agent execution");
        markSettleTimeout(sessionId);
      }

      // Notify parent (optional)
      onResponseSubmitted?.();
    } catch (err) {
      console.error("Failed to submit response:", err);
      message.error(
        err instanceof Error ? err.message : t("components.questionDialog.submitFailed"),
      );
      // Clear processing on error to avoid stuck spinner.
      markSettleTimeout(sessionId);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || !storePendingQuestion) {
    return null;
  }

  const { question, options, allowCustom } = storePendingQuestion;
  const formattedQuestion = formatPendingQuestionText(question);

  return (
    <div
      className={styles.questionCard}
      style={{
        background: token.colorBgContainer,
        borderColor: token.colorBorderSecondary,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      {/* Header row: icon + question text + collapse toggle */}
      <div
        className={styles.questionHeader}
        data-collapsed={collapsed ? "true" : "false"}
        onClick={() => setCollapsed((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setCollapsed((prev) => !prev);
        }}
      >
        <span className={styles.headerLeft}>
          <span className={styles.questionIcon}>🤔</span>
          <Text
            strong
            className={styles.questionText}
            style={{ color: token.colorPrimary, whiteSpace: "pre-wrap" }}
            title={collapsed ? formattedQuestion : undefined}
          >
            {formattedQuestion}
          </Text>
        </span>
        <Button
          type="text"
          size="small"
          icon={collapsed ? <DownOutlined /> : <UpOutlined />}
          className={styles.collapseBtn}
          tabIndex={-1}
        />
      </div>

      {/* Collapsible body */}
      {!collapsed && (
        <div className={styles.questionBody}>
          <Radio.Group
            className={styles.optionsGroup}
            value={selectedOption}
            onChange={(e) => handleOptionChange(e.target.value)}
          >
            <Space direction="vertical" size={4} style={{ width: "100%" }}>
              {options?.map((option, index) => (
                <Radio key={index} value={option} className={styles.optionItem}>
                  <Text style={{ color: token.colorText }}>{option}</Text>
                </Radio>
              ))}

              {allowCustom && (
                <Radio value="custom" className={styles.optionItem}>
                  <Space size={4}>
                    <EditOutlined />
                    <Text style={{ color: token.colorText }}>
                      {t("components.questionDialog.otherTypeBelow")}
                    </Text>
                  </Space>
                </Radio>
              )}
            </Space>
          </Radio.Group>

          {selectedOption === "custom" && (
            <div className={styles.customHint}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {t("components.questionDialog.customAnswerTip")}
              </Text>
            </div>
          )}

          {/* Submit button inline */}
          {selectedOption && selectedOption !== "custom" && (
            <div className={styles.questionFooter}>
              <Button type="primary" size="small" onClick={handleSubmit} loading={isSubmitting}>
                {t("components.questionDialog.confirm")}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

QuestionDialogComponent.displayName = "QuestionDialog";

export const QuestionDialog = React.memo(QuestionDialogComponent);
QuestionDialog.displayName = "QuestionDialog";

export default QuestionDialog;
