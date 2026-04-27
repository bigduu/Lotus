import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { App as AntApp, Button, Radio, Space, Typography, theme } from "antd";
import { EditOutlined, UpOutlined, DownOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { agentApiClient } from "../../services/api";
import { useAppStore } from "../../pages/ChatPage/store";
import { useActiveModelRef } from "../../pages/ChatPage/hooks/useActiveModelRef";
import { readPersistedInputReasoningEffort } from "../../pages/ChatPage/store/slices/inputStateSlice";
import { useProviderStore } from "../../pages/ChatPage/store/slices/providerSlice";
import type { ReasoningEffort } from "../../pages/ChatPage/services/AgentService";
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
}

export const QuestionDialog: React.FC<QuestionDialogProps> = ({
  sessionId,
  onResponseSubmitted,
  onQuestionAppeared,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const { message } = AntApp.useApp();
  const [polledQuestion, setPolledQuestion] = useState<PendingQuestion | null>(null);
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
  const onQuestionAppearedRef = useRef(onQuestionAppeared);
  onQuestionAppearedRef.current = onQuestionAppeared;

  // Track document visibility for background tab detection
  const [isDocumentVisible, setIsDocumentVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden,
  );

  const setSessionProcessing = useAppStore((state) => state.setSessionProcessing);
  const setPendingQuestionRespond = useAppStore((state) => state.setPendingQuestionRespond);
  const clearPendingQuestionRespondForSession = useAppStore(
    (state) => state.clearPendingQuestionRespondForSession,
  );
  const clearPendingQuestionForSession = useAppStore(
    (state) => state.clearPendingQuestionForSession,
  );
  const currentChat = useAppStore(
    (state) => state.chats.find((chat) => chat.id === sessionId) || null,
  );
  const eventPendingQuestion = useAppStore((state) =>
    sessionId ? state.pendingQuestionsBySession[sessionId] : null,
  );

  // Use event-driven data if available, otherwise fall back to polled data
  const pendingQuestion = useMemo<PendingQuestion | null>(() => {
    if (eventPendingQuestion) {
      return {
        has_pending_question: true,
        question: eventPendingQuestion.question,
        options: eventPendingQuestion.options,
        allow_custom: eventPendingQuestion.allowCustom,
        tool_call_id: eventPendingQuestion.toolCallId ?? undefined,
      };
    }
    return polledQuestion;
  }, [eventPendingQuestion, polledQuestion]);

  const activeModelRef = useActiveModelRef(currentChat?.config?.model_ref);

  // Resolve reasoning effort (same priority as InputContainer)
  const inputState = useAppStore((state) =>
    sessionId ? state.inputStates?.[sessionId] : undefined,
  );
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const providerConfig = useProviderStore((state) => state.providerConfig);
  const providerDefaultReasoningEffort = useMemo<ReasoningEffort | undefined>(
    () => providerConfig.providers[currentProvider]?.reasoning_effort,
    [providerConfig, currentProvider],
  );
  const persistedReasoningEffort = useMemo<ReasoningEffort | undefined>(
    () => (sessionId ? readPersistedInputReasoningEffort(sessionId) : undefined),
    [sessionId],
  );
  const reasoningEffort: ReasoningEffort =
    currentChat?.config?.reasoningEffort ??
    inputState?.reasoningEffort ??
    persistedReasoningEffort ??
    providerDefaultReasoningEffort ??
    "medium";

  const isSessionProcessing = useAppStore((state) =>
    sessionId ? state.isSessionProcessing(sessionId) : false,
  );
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const isCurrentSession = currentSessionId === sessionId;

  // Fetch pending question
  const fetchPendingQuestion = useCallback(async () => {
    try {
      const data = await agentApiClient.get<PendingQuestion>(`respond/${sessionId}/pending`);
      if (data.has_pending_question) {
        setPolledQuestion((previous) => {
          const nextIdentity = buildPendingQuestionIdentity({
            sessionId,
            question: data.question,
            options: data.options,
            allowCustom: data.allow_custom,
            toolCallId: data.tool_call_id,
          });
          const previousIdentity = previous?.has_pending_question
            ? buildPendingQuestionIdentity({
                sessionId,
                question: previous.question,
                options: previous.options,
                allowCustom: previous.allow_custom,
                toolCallId: previous.tool_call_id,
              })
            : null;

          return previousIdentity === nextIdentity ? (previous ?? data) : data;
        });
        emptyCountRef.current = 0;
        backoffLevelRef.current = 0;
      } else {
        setPolledQuestion(null);
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
      // Handle 404 - no pending question for this session
      if (err instanceof Error && err.message.includes("404")) {
        setPolledQuestion(null);
        lastQuestionIdentityRef.current = null;
        emptyCountRef.current += 1;
        return;
      }

      // A failed poll (for example CORS/access-control or a transient network error)
      // should not leave an old question/respond mode stuck in the UI. The next
      // successful poll will re-open the dialog if the backend still has a pending question.
      setPolledQuestion(null);
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
      setIsLoading(false);
    }
  }, [sessionId]);

  // Reset polling when session changes
  useEffect(() => {
    emptyCountRef.current = 0;
    backoffLevelRef.current = 0;
    lastQuestionIdentityRef.current = null;
    setIsLoading(true);
    setSelectedOption(null);
    setCollapsed(false);
  }, [sessionId]);

  // Listen for document visibility changes
  useEffect(() => {
    if (typeof document === "undefined") return;

    const onVisibilityChange = () => {
      setIsDocumentVisible(!document.hidden);
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // When a new question appears, reset selection and activate respond mode
  // so that ANY user input (even without selecting "Other") goes through
  // the respond API instead of being sent as a brand-new message.
  useEffect(() => {
    if (pendingQuestion?.has_pending_question) {
      const nextIdentity = buildPendingQuestionIdentity({
        sessionId,
        question: pendingQuestion?.question,
        options: pendingQuestion?.options,
        allowCustom: pendingQuestion?.allow_custom,
        toolCallId: pendingQuestion?.tool_call_id,
      });
      const isSameQuestion = lastQuestionIdentityRef.current === nextIdentity;

      setPendingQuestionRespond({
        sessionId,
        question: pendingQuestion?.question || "",
        options: pendingQuestion?.options || [],
        allowCustom: pendingQuestion?.allow_custom ?? true,
        toolCallId: pendingQuestion?.tool_call_id ?? null,
      });

      if (!isSameQuestion) {
        setSelectedOption(null);
        setCollapsed(false);
        onQuestionAppearedRef.current?.();
      }

      lastQuestionIdentityRef.current = nextIdentity;
    } else {
      lastQuestionIdentityRef.current = null;
      clearPendingQuestionRespondForSession(sessionId);
    }
  }, [
    pendingQuestion?.allow_custom,
    pendingQuestion?.has_pending_question,
    pendingQuestion?.options,
    pendingQuestion?.question,
    pendingQuestion?.tool_call_id,
    sessionId,
    setPendingQuestionRespond,
    clearPendingQuestionRespondForSession,
  ]);

  // Adaptive polling with backoff based on session state and visibility
  const getPendingPollDelayMs = useCallback((): number | null => {
    // If SSE has already delivered the question, no need to keep polling for it.
    // We rely on CHAT_PENDING_QUESTION_RESOLVED_EVENT or the next polling
    // cycle (after the event is cleared) to detect resolution.
    if (eventPendingQuestion) return null;

    // If we have a pending question, check relatively frequently
    // to detect when it gets resolved
    if (pendingQuestion?.has_pending_question) {
      return isDocumentVisible ? 5000 : 15000;
    }

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
  }, [eventPendingQuestion, pendingQuestion?.has_pending_question, isSessionProcessing, isCurrentSession, isDocumentVisible]);

  // Timeout-based adaptive polling (replaces fixed interval)
  useEffect(() => {
    // If SSE already delivered the question, skip polling entirely.
    // The resolved event or the next store state change will re-enable
    // polling when the question is cleared.
    if (eventPendingQuestion) {
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
  }, [eventPendingQuestion, fetchPendingQuestion, getPendingPollDelayMs, isSubmitting]);

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

      setPolledQuestion(null);
      setSelectedOption(null);
      emptyCountRef.current = 0;
      clearPendingQuestionForSession(sessionId);
      clearPendingQuestionRespondForSession(sessionId);
    };

    window.addEventListener(CHAT_PENDING_QUESTION_RESOLVED_EVENT, onResolved as EventListener);
    return () => {
      window.removeEventListener(CHAT_PENDING_QUESTION_RESOLVED_EVENT, onResolved as EventListener);
    };
  }, [sessionId, clearPendingQuestionRespondForSession, clearPendingQuestionForSession]);

  // Update selected option. Respond mode stays active for the entire
  // duration of the pending question (set in the effect above), so we
  // no longer toggle it per-option.
  const handleOptionChange = useCallback((value: string) => {
    setSelectedOption(value);
  }, []);

  // Clean up respond mode when question disappears or component unmounts
  useEffect(() => {
    return () => {
      clearPendingQuestionRespondForSession(sessionId);
    };
  }, [clearPendingQuestionRespondForSession, sessionId]);

  // Submit response (for predefined options only; custom is handled by InputContainer)
  const handleSubmit = async () => {
    if (!selectedOption || selectedOption === "custom") {
      message.warning(t("components.questionDialog.selectOptionWarning"));
      return;
    }

    setIsSubmitting(true);

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

      message.success(t("components.questionDialog.responseSubmitted"));
      setPolledQuestion(null);
      setSelectedOption(null);
      emptyCountRef.current = 0;
      clearPendingQuestionForSession(sessionId);
      clearPendingQuestionRespondForSession(sessionId);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(CHAT_PENDING_QUESTION_RESOLVED_EVENT, {
            detail: { sessionId },
          }),
        );
      }

      const resumeStatus = submitResult?.auto_resume_status;
      if (["started", "already_running"].includes(resumeStatus || "")) {
        if (sessionId) {
          setSessionProcessing(sessionId, true);
        }
      } else if (resumeStatus === "error") {
        console.error("[QuestionDialog] Failed to auto-resume agent execution");
      }

      // Notify parent (optional)
      onResponseSubmitted?.();
    } catch (err) {
      console.error("Failed to submit response:", err);
      message.error(
        err instanceof Error ? err.message : t("components.questionDialog.submitFailed"),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading || !pendingQuestion?.has_pending_question) {
    return null;
  }

  const { question, options, allow_custom } = pendingQuestion;
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

              {allow_custom && (
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

export default QuestionDialog;
