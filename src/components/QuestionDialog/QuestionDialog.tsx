import React, { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Button,
  Radio,
  Space,
  Typography,
  message,
  theme,
} from "antd";
import { EditOutlined, UpOutlined, DownOutlined } from "@ant-design/icons";
import { agentApiClient } from "../../services/api";
import { useAppStore } from "../../pages/ChatPage/store";
import { readPersistedInputReasoningEffort } from "../../pages/ChatPage/store/slices/inputStateSlice";
import { useActiveModel } from "../../pages/ChatPage/hooks/useActiveModel";
import { useProviderStore } from "../../pages/ChatPage/store/slices/providerSlice";
import type { ReasoningEffort } from "../../pages/ChatPage/services/AgentService";
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

export const formatPendingQuestionText = (raw?: string): string => {
  const normalized = (raw || "")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!normalized) return "";
  if (normalized.includes("\n")) return normalized;

  // Auto-break common inline list patterns so long ask_user prompts stay readable.
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
  const { token } = useToken();
  const [pendingQuestion, setPendingQuestion] =
    useState<PendingQuestion | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  // NOTE: We intentionally avoid permanently stopping polling. The agent may ask
  // questions later in the session; stopping polling would prevent the dialog
  // from ever appearing.
  const emptyCountRef = useRef(0);
  const onQuestionAppearedRef = useRef(onQuestionAppeared);
  onQuestionAppearedRef.current = onQuestionAppeared;

  const setSessionProcessing = useAppStore(
    (state) => state.setSessionProcessing,
  );
  const setPendingQuestionRespond = useAppStore(
    (state) => state.setPendingQuestionRespond,
  );
  const activeModel = useActiveModel();

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
      const data = await agentApiClient.get<PendingQuestion>(
        `respond/${sessionId}/pending`,
      );
      if (data.has_pending_question) {
        setPendingQuestion(data);
        emptyCountRef.current = 0;
      } else {
        setPendingQuestion(null);
        emptyCountRef.current += 1;
      }
    } catch (err) {
      // Handle 404 - no pending question for this session
      if (err instanceof Error && err.message.includes("404")) {
        setPendingQuestion(null);
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
    setIsLoading(true);
  }, [sessionId]);

  // When a new question appears, reset selection and activate respond mode
  // so that ANY user input (even without selecting "Other") goes through
  // the respond API instead of being sent as a brand-new message.
  useEffect(() => {
    if (pendingQuestion?.has_pending_question) {
      setSelectedOption(null);
      setPendingQuestionRespond({
        sessionId,
        question: pendingQuestion?.question || "",
      });
      setCollapsed(false);
      onQuestionAppearedRef.current?.();
    } else {
      setPendingQuestionRespond(null);
    }
  }, [pendingQuestion?.tool_call_id, sessionId, pendingQuestion?.question, setPendingQuestionRespond]);

  // Poll for pending question periodically
  // When the agent is actively running, poll faster so the dialog shows quickly.
  // Otherwise keep it light.
  const pollInterval =
    pendingQuestion?.has_pending_question || isSessionProcessing ? 3000 : 15000;

  useEffect(() => {
    fetchPendingQuestion();

    const interval = setInterval(() => {
      if (!isSubmitting) {
        fetchPendingQuestion();
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [fetchPendingQuestion, isSubmitting, pollInterval]);

  // Update selected option. Respond mode stays active for the entire
  // duration of the pending question (set in the effect above), so we
  // no longer toggle it per-option.
  const handleOptionChange = useCallback(
    (value: string) => {
      setSelectedOption(value);
    },
    [],
  );

  // Clean up respond mode when question disappears or component unmounts
  useEffect(() => {
    return () => {
      setPendingQuestionRespond(null);
    };
  }, [setPendingQuestionRespond]);

  // Submit response (for predefined options only; custom is handled by InputContainer)
  const handleSubmit = async () => {
    if (!selectedOption || selectedOption === "custom") {
      message.warning("Please select an option");
      return;
    }

    setIsSubmitting(true);

    try {
      const modelToUse = activeModel?.trim();
      const submitResult = await agentApiClient.post<RespondSubmitResult>(
        `respond/${sessionId}`,
        {
          response: selectedOption,
          model: modelToUse || undefined,
          reasoning_effort: reasoningEffort,
        },
      );

      message.success("Response submitted, AI will continue processing");
      setPendingQuestion(null);
      setSelectedOption(null);
      emptyCountRef.current = 0;

      const resumeStatus = submitResult?.auto_resume_status;
      if (["started", "already_running"].includes(resumeStatus || "")) {
        if (sessionId) {
          setSessionProcessing(sessionId, true);
        }
      } else if (
        resumeStatus === "invalid_model" ||
        resumeStatus === "not_requested"
      ) {
        message.error(
          "No model configured. Please select a default model in Provider Settings, then resume the agent.",
        );
      } else if (resumeStatus === "error") {
        console.error("[QuestionDialog] Failed to auto-resume agent execution");
      }

      // Notify parent (optional)
      onResponseSubmitted?.();
    } catch (err) {
      console.error("Failed to submit response:", err);
      message.error(err instanceof Error ? err.message : "Submission failed");
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
                <Radio
                  key={index}
                  value={option}
                  className={styles.optionItem}
                >
                  <Text style={{ color: token.colorText }}>{option}</Text>
                </Radio>
              ))}

              {allow_custom && (
                <Radio value="custom" className={styles.optionItem}>
                  <Space size={4}>
                    <EditOutlined />
                    <Text style={{ color: token.colorText }}>
                      Other (type below)
                    </Text>
                  </Space>
                </Radio>
              )}
            </Space>
          </Radio.Group>

          {selectedOption === "custom" && (
            <div className={styles.customHint}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                ↓ Type your answer in the input box below and press Enter
              </Text>
            </div>
          )}

          {/* Submit button inline */}
          {selectedOption && selectedOption !== "custom" && (
            <div className={styles.questionFooter}>
              <Button
                type="primary"
                size="small"
                onClick={handleSubmit}
                loading={isSubmitting}
              >
                Confirm
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default QuestionDialog;
