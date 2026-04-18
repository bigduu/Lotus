import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Radio, Space, Typography, message, theme } from "antd";
import { Button } from "@/components/ui/button";
import { EditOutlined, UpOutlined, DownOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { agentApiClient } from "../../services/api";
import { useAppStore } from "../../pages/ChatPage/store";
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
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  // NOTE: We intentionally avoid permanently stopping polling. The agent may ask
  // questions later in the session; stopping polling would prevent the dialog
  // from ever appearing.
  const emptyCountRef = useRef(0);
  const lastQuestionIdentityRef = useRef<string | null>(null);
  const onQuestionAppearedRef = useRef(onQuestionAppeared);
  onQuestionAppearedRef.current = onQuestionAppeared;

  const setSessionProcessing = useAppStore((state) => state.setSessionProcessing);
  const setPendingQuestionRespond = useAppStore((state) => state.setPendingQuestionRespond);
  const clearPendingQuestionRespondForSession = useAppStore(
    (state) => state.clearPendingQuestionRespondForSession,
  );
  const currentChat = useAppStore(
    (state) => state.chats.find((chat) => chat.id === sessionId) || null,
  );

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

  // Fetch pending question
  const fetchPendingQuestion = useCallback(async () => {
    try {
      const data = await agentApiClient.get<PendingQuestion>(`respond/${sessionId}/pending`);
      if (data.has_pending_question) {
        setPendingQuestion((previous) => {
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
      } else {
        setPendingQuestion(null);
        lastQuestionIdentityRef.current = null;
        emptyCountRef.current += 1;
      }
    } catch (err) {
      // Handle 404 - no pending question for this session
      if (err instanceof Error && err.message.includes("404")) {
        setPendingQuestion(null);
        lastQuestionIdentityRef.current = null;
        emptyCountRef.current += 1;
        return;
      }
      console.error("Failed to fetch pending question:", err);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId]);

  // Reset polling when session changes
  useEffect(() => {
    emptyCountRef.current = 0;
    lastQuestionIdentityRef.current = null;
    setIsLoading(true);
    setSelectedOption(null);
    setCollapsed(false);
  }, [sessionId]);

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

  // Poll for pending question periodically
  // When the agent is actively running, poll faster so the dialog shows quickly.
  // Otherwise keep it light.
  const pollInterval = pendingQuestion?.has_pending_question || isSessionProcessing ? 3000 : 15000;

  useEffect(() => {
    fetchPendingQuestion();

    const interval = setInterval(() => {
      if (!isSubmitting) {
        fetchPendingQuestion();
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [fetchPendingQuestion, isSubmitting, pollInterval]);

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

      setPendingQuestion(null);
      setSelectedOption(null);
      emptyCountRef.current = 0;
      clearPendingQuestionRespondForSession(sessionId);
    };

    window.addEventListener(CHAT_PENDING_QUESTION_RESOLVED_EVENT, onResolved as EventListener);
    return () => {
      window.removeEventListener(CHAT_PENDING_QUESTION_RESOLVED_EVENT, onResolved as EventListener);
    };
  }, [sessionId, clearPendingQuestionRespondForSession]);

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
      const submitResult = await agentApiClient.post<RespondSubmitResult>(`respond/${sessionId}`, {
        response: selectedOption,
        reasoning_effort: reasoningEffort,
      });

      message.success(t("components.questionDialog.responseSubmitted"));
      setPendingQuestion(null);
      setSelectedOption(null);
      emptyCountRef.current = 0;
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
          variant="ghost"
          size="sm"
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
              <Button variant="default" size="sm" onClick={handleSubmit} loading={isSubmitting}>
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
