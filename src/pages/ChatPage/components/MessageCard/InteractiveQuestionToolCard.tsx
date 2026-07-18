import React, { useEffect, useMemo, useState } from "react";
import { Alert, Descriptions, Space, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import type { Components } from "react-markdown";
import type { PluggableList } from "unified";

import { buildPendingQuestionIdentity } from "../../utils/pendingQuestionIdentity";
import { CHAT_PENDING_QUESTION_RESOLVED_EVENT } from "../ChatView/events";
import type { PermissionRequestContract } from "@shared/permissions/permissionContract";

const { Text } = Typography;

type InteractiveQuestionToolCardProps = {
  sessionId: string | null;
  question: string;
  options: string[];
  allowCustom: boolean;
  permissionRequest?: PermissionRequestContract;
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
  permissionRequest,
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

      {permissionRequest ? (
        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          {permissionRequest.explanation || permissionRequest.reasonCode ? (
            <Alert
              type={permissionRequest.risk === "high" ? "warning" : "info"}
              showIcon
              message={
                permissionRequest.explanation ||
                t("components.questionDialog.permissionReason", {
                  reason: permissionRequest.reasonCode,
                })
              }
            />
          ) : null}
          <Descriptions size="small" column={1} bordered>
            {permissionRequest.tool ? (
              <Descriptions.Item label={t("components.questionDialog.permissionTool")}>
                <Text code>{permissionRequest.tool}</Text>
              </Descriptions.Item>
            ) : null}
            {permissionRequest.action ? (
              <Descriptions.Item label={t("components.questionDialog.permissionAction")}>
                {permissionRequest.action}
              </Descriptions.Item>
            ) : null}
            {permissionRequest.resource ? (
              <Descriptions.Item label={t("components.questionDialog.permissionResource")}>
                <Text code ellipsis={{ tooltip: permissionRequest.resource }}>
                  {permissionRequest.resource}
                </Text>
              </Descriptions.Item>
            ) : null}
            {permissionRequest.effectiveMode ? (
              <Descriptions.Item label={t("components.questionDialog.effectiveMode")}>
                <Tag>{permissionRequest.effectiveMode}</Tag>
                {permissionRequest.bypassRequested
                  ? t("components.questionDialog.bypassStillAsked")
                  : null}
              </Descriptions.Item>
            ) : null}
            {permissionRequest.matchedRule?.name ? (
              <Descriptions.Item label={t("components.questionDialog.matchedRule")}>
                <Text code>{permissionRequest.matchedRule.name}</Text>
              </Descriptions.Item>
            ) : null}
          </Descriptions>
          {permissionRequest.suggestedMatchers.length > 0 ? (
            <Text type="secondary">
              {t("components.questionDialog.suggestedMatchers")}:{" "}
              {permissionRequest.suggestedMatchers.map((matcher) => (
                <Tag key={matcher.id}>
                  {matcher.kind}: {matcher.value}
                </Tag>
              ))}
            </Text>
          ) : null}
        </Space>
      ) : null}

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
