import React, { useEffect, useMemo, useState } from "react";
import { Space, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import type { Components } from "react-markdown";
import type { PluggableList } from "unified";

import { buildPendingQuestionIdentity } from "../../utils/pendingQuestionIdentity";
import { CHAT_PENDING_QUESTION_RESOLVED_EVENT } from "../ChatView/events";

const { Text } = Typography;

type InteractiveQuestionToolCardProps = {
  sessionId: string | null;
  question: string;
  options: string[];
  allowCustom: boolean;
  toolCallId?: string | null;
  conclusionMarkdown?: string | null;
  markdownComponents: Components;
  markdownPlugins: PluggableList;
  rehypePlugins: PluggableList;
};

export const InteractiveQuestionToolCard: React.FC<InteractiveQuestionToolCardProps> = ({
  sessionId,
  question,
  options,
  allowCustom,
  toolCallId,
  conclusionMarkdown,
  markdownComponents,
  markdownPlugins,
  rehypePlugins,
}) => {
  const { t } = useTranslation();
  const [resolvedQuestionIdentity, setResolvedQuestionIdentity] = useState<string | null>(null);

  const questionIdentity = useMemo(
    () =>
      buildPendingQuestionIdentity({
        sessionId,
        question,
        options,
        allowCustom,
        toolCallId,
      }),
    [sessionId, question, options, allowCustom, toolCallId],
  );
  const resolvedExternally = resolvedQuestionIdentity === questionIdentity;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onResolved = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string | null }>;
      const targetSessionId = customEvent.detail?.sessionId ?? null;
      if (!sessionId || targetSessionId !== sessionId) {
        return;
      }
      setResolvedQuestionIdentity(questionIdentity);
    };

    window.addEventListener(CHAT_PENDING_QUESTION_RESOLVED_EVENT, onResolved as EventListener);
    return () => {
      window.removeEventListener(CHAT_PENDING_QUESTION_RESOLVED_EVENT, onResolved as EventListener);
    };
  }, [sessionId, questionIdentity]);

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      {conclusionMarkdown ? (
        <ReactMarkdown
          remarkPlugins={markdownPlugins}
          rehypePlugins={rehypePlugins}
          components={markdownComponents}
        >
          {conclusionMarkdown}
        </ReactMarkdown>
      ) : null}

      <div>
        <Text strong>{t("components.questionDialog.questionLabel", "Question")}</Text>
        <div style={{ marginTop: 8 }}>
          <ReactMarkdown
            remarkPlugins={markdownPlugins}
            rehypePlugins={rehypePlugins}
            components={markdownComponents}
          >
            {question}
          </ReactMarkdown>
        </div>
      </div>

      {resolvedExternally ? (
        <Text type="secondary">
          {t(
            "components.questionDialog.responseSubmittedContinue",
            "Response submitted. Continuing...",
          )}
        </Text>
      ) : (
        <Text type="secondary">
          {allowCustom
            ? t(
                "components.questionDialog.responseInInputHint",
                "Use the options or input box below to respond.",
              )
            : t(
                "components.questionDialog.responseByOptionHint",
                "Please respond using the options below the input box.",
              )}
        </Text>
      )}
    </Space>
  );
};

export default InteractiveQuestionToolCard;
