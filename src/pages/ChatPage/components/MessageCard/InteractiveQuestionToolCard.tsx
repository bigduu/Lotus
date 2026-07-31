import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Descriptions, Flex, Space, Tag, Typography } from "antd";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import type { Components } from "react-markdown";
import type { PluggableList } from "unified";

import { buildPendingQuestionIdentity } from "../../utils/pendingQuestionIdentity";
import {
  CHAT_PENDING_QUESTION_RESOLVED_EVENT,
  type ChatPendingQuestionResolvedEventDetail,
} from "../ChatView/events";
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
  const [resourceExpanded, setResourceExpanded] = useState(false);

  const questionIdentity = useMemo(
    () =>
      buildPendingQuestionIdentity({
        sessionId,
        question,
        options,
        allowCustom,
        toolCallId,
        requestId: permissionRequest?.requestId,
      }),
    [sessionId, question, options, allowCustom, toolCallId, permissionRequest?.requestId],
  );
  const resolvedExternally = resolvedQuestionIdentity === questionIdentity;
  const permissionReason = useMemo(() => {
    if (!permissionRequest) return null;
    if (permissionRequest.explanation) return permissionRequest.explanation;
    const reasonCode = permissionRequest.reasonCode;
    const rule =
      permissionRequest.matchedRule?.name ||
      permissionRequest.matchedRule?.id ||
      t("components.questionDialog.permissionReasonCodes.configuredRule");
    switch (reasonCode) {
      case "configured_always_ask":
        return t(
          permissionRequest.bypassRequested
            ? "components.questionDialog.permissionReasonCodes.configuredAlwaysAskBypass"
            : "components.questionDialog.permissionReasonCodes.configuredAlwaysAsk",
          { rule },
        );
      case "hard_dangerous":
        return t(
          permissionRequest.bypassRequested
            ? "components.questionDialog.permissionReasonCodes.hardDangerousBypass"
            : "components.questionDialog.permissionReasonCodes.hardDangerous",
        );
      case "platform_hard_deny":
        return t("components.questionDialog.permissionReasonCodes.platformHardDeny");
      case "explicit_deny":
        return t("components.questionDialog.permissionReasonCodes.explicitDeny", { rule });
      case "mode_denied":
        return t("components.questionDialog.permissionReasonCodes.modeDenied");
      case "risk_threshold":
        return t("components.questionDialog.permissionReasonCodes.riskThreshold");
      default:
        return reasonCode
          ? t("components.questionDialog.permissionReason", { reason: reasonCode })
          : null;
    }
  }, [permissionRequest, t]);
  const resource = permissionRequest?.resource ?? "";
  const resourceTruncated = resource.length > 180;
  const displayedResource =
    resourceTruncated && !resourceExpanded ? `${resource.slice(0, 180)}…` : resource;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const onResolved = (event: Event) => {
      const customEvent = event as CustomEvent<ChatPendingQuestionResolvedEventDetail>;
      const targetSessionId = customEvent.detail?.sessionId ?? null;
      if (!sessionId || targetSessionId !== sessionId) {
        return;
      }
      const resolvedRequestId = customEvent.detail?.requestId ?? null;
      if (resolvedRequestId && resolvedRequestId !== (permissionRequest?.requestId ?? null)) {
        return;
      }
      setResolvedQuestionIdentity(questionIdentity);
    };

    window.addEventListener(CHAT_PENDING_QUESTION_RESOLVED_EVENT, onResolved as EventListener);
    return () => {
      window.removeEventListener(CHAT_PENDING_QUESTION_RESOLVED_EVENT, onResolved as EventListener);
    };
  }, [sessionId, questionIdentity, permissionRequest?.requestId]);

  useEffect(() => {
    setResourceExpanded(false);
  }, [permissionRequest?.requestId, permissionRequest?.resource]);

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
          {permissionReason ? (
            <Alert
              type={
                permissionRequest.risk === "high" || permissionRequest.risk === "critical"
                  ? "warning"
                  : "info"
              }
              showIcon
              message={permissionReason}
            />
          ) : null}
          <Descriptions size="small" column={1} bordered>
            {permissionRequest.childSessionId || permissionRequest.sessionId ? (
              <Descriptions.Item label={t("components.questionDialog.permissionRequester")}>
                <Space size="small" wrap>
                  <Text code>
                    {permissionRequest.childSessionId || permissionRequest.sessionId}
                  </Text>
                  {permissionRequest.childSessionId ? (
                    <Tag>{t("components.questionDialog.childExecutor")}</Tag>
                  ) : null}
                </Space>
              </Descriptions.Item>
            ) : null}
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
                <Space direction="vertical" size={0} style={{ maxWidth: "100%" }}>
                  <Text code style={{ overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
                    {displayedResource}
                  </Text>
                  {resourceTruncated ? (
                    <Button
                      type="link"
                      size="small"
                      style={{ alignSelf: "flex-start", paddingInline: 0 }}
                      onClick={() => setResourceExpanded((expanded) => !expanded)}
                    >
                      {resourceExpanded
                        ? t("components.questionDialog.collapseResource")
                        : t("components.questionDialog.expandResource")}
                    </Button>
                  ) : null}
                </Space>
              </Descriptions.Item>
            ) : null}
            {permissionRequest.risk ? (
              <Descriptions.Item label={t("components.questionDialog.permissionRisk")}>
                <Tag
                  color={
                    permissionRequest.risk === "high" || permissionRequest.risk === "critical"
                      ? "error"
                      : permissionRequest.risk === "medium"
                        ? "warning"
                        : "default"
                  }
                >
                  {permissionRequest.risk}
                </Tag>
              </Descriptions.Item>
            ) : null}
            {permissionRequest.requestedMode ? (
              <Descriptions.Item label={t("components.questionDialog.requestedMode")}>
                <Tag>{permissionRequest.requestedMode}</Tag>
              </Descriptions.Item>
            ) : null}
            {permissionRequest.effectiveMode ? (
              <Descriptions.Item label={t("components.questionDialog.effectiveMode")}>
                <Space size="small" wrap>
                  <Tag>{permissionRequest.effectiveMode}</Tag>
                  {permissionRequest.bypassRequested
                    ? t("components.questionDialog.bypassStillAsked")
                    : permissionRequest.autoApproveRequested
                      ? t("components.questionDialog.autoStillAsked")
                      : null}
                </Space>
              </Descriptions.Item>
            ) : null}
            {permissionRequest.matchedRule?.name || permissionRequest.matchedRule?.id ? (
              <Descriptions.Item label={t("components.questionDialog.matchedRule")}>
                <Space size="small" wrap>
                  <Text code>
                    {permissionRequest.matchedRule.name || permissionRequest.matchedRule.id}
                  </Text>
                  {permissionRequest.matchedRule.source ? (
                    <Tag>{permissionRequest.matchedRule.source}</Tag>
                  ) : null}
                </Space>
              </Descriptions.Item>
            ) : null}
          </Descriptions>
          {permissionRequest.suggestedMatchers.length > 0 ? (
            <Space direction="vertical" size={2} style={{ width: "100%", minWidth: 0 }}>
              <Text type="secondary">{t("components.questionDialog.suggestedMatchers")}:</Text>
              <Flex gap={4} wrap="wrap" style={{ minWidth: 0 }}>
                {permissionRequest.suggestedMatchers.map((matcher) => (
                  <Tag
                    key={matcher.id}
                    style={{
                      maxWidth: "100%",
                      whiteSpace: "normal",
                      overflowWrap: "anywhere",
                    }}
                  >
                    {matcher.kind}: {matcher.value}
                  </Tag>
                ))}
              </Flex>
            </Space>
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
