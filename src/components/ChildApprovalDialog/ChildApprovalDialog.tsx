import React, { useState } from "react";
import { App as AntApp, Button, Space, Typography, theme } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { agentClient } from "@services/chat/AgentService";
import { isApiError } from "@services/api/client";
import { selectPendingChildApproval, useAppStore } from "@shared/store/appStore";
import "../QuestionDialog/QuestionDialog.css";

// Reuse the QuestionDialog card styling (qd- namespaced) so the child-approval
// prompt matches the existing interactive-question presentation.
const styles = {
  questionCard: "qd-questionCard",
  questionHeader: "qd-questionHeader",
  headerLeft: "qd-headerLeft",
  questionIcon: "qd-questionIcon",
  questionText: "qd-questionText",
  questionBody: "qd-questionBody",
  questionFooter: "qd-questionFooter",
} as const;

const { Text } = Typography;
const { useToken } = theme;

interface ChildApprovalDialogProps {
  /** The parent session whose SSE stream carries the child's approval request. */
  sessionId: string;
}

const ChildApprovalDialogComponent: React.FC<ChildApprovalDialogProps> = ({ sessionId }) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const { message } = AntApp.useApp();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pending = useAppStore(selectPendingChildApproval(sessionId));
  const clearPendingChildApproval = useAppStore((state) => state.clearPendingChildApproval);

  if (!pending) {
    return null;
  }

  const { childSessionId, requestId, toolName, permission, resource } = pending;

  const respond = async (approved: boolean) => {
    setIsSubmitting(true);
    try {
      const result = await agentClient.respondToChildApproval(childSessionId, requestId, approved);
      if (result.delivered) {
        // Decision delivered to the live child — terminal, dismiss the prompt.
        clearPendingChildApproval(sessionId);
      } else {
        // Backend contract A: 200 + { delivered: false } means the child is no
        // longer waiting. Retrying won't help, so warn and clear.
        message.warning(t("components.approval.childGone"));
        clearPendingChildApproval(sessionId);
      }
    } catch (err) {
      console.error("Failed to respond to child approval:", err);
      if (isApiError(err) && err.status === 404) {
        // Backend contract B: a thrown 404 also means the child is gone.
        // Terminal — warn and clear (retry won't help).
        message.warning(t("components.approval.childGone"));
        clearPendingChildApproval(sessionId);
      } else {
        // Transient failure (network/5xx/etc): KEEP the prompt so the user can
        // retry. Do NOT clear, or the child stays blocked with no recourse.
        message.error(t("components.approval.deliverFailed"));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const detail = [
    toolName ? `${t("components.approval.toolName")}: ${toolName}` : null,
    permission ? `${t("components.approval.permission")}: ${permission}` : null,
    resource ? `${t("components.approval.target")}: ${resource}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={styles.questionCard}
      style={{
        background: token.colorBgContainer,
        borderColor: token.colorBorderSecondary,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <div className={styles.questionHeader}>
        <span className={styles.headerLeft}>
          <span className={styles.questionIcon}>🛡️</span>
          <Text
            strong
            className={styles.questionText}
            style={{ color: token.colorPrimary, whiteSpace: "pre-wrap" }}
          >
            {t("components.approval.childTitle")}
          </Text>
        </span>
      </div>

      <div className={styles.questionBody}>
        <Text style={{ color: token.colorText, whiteSpace: "pre-wrap" }}>
          {t("components.approval.childQuestion")}
        </Text>
        {detail && (
          <div style={{ marginTop: token.marginXXS }}>
            <Text type="secondary" style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
              {detail}
            </Text>
          </div>
        )}

        <div className={styles.questionFooter}>
          <Space size={8}>
            <Button
              type="primary"
              size="small"
              icon={<CheckOutlined />}
              onClick={() => void respond(true)}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              {t("components.approval.approve")}
            </Button>
            <Button
              danger
              size="small"
              icon={<CloseOutlined />}
              onClick={() => void respond(false)}
              loading={isSubmitting}
              disabled={isSubmitting}
            >
              {t("components.approval.deny")}
            </Button>
          </Space>
        </div>
      </div>
    </div>
  );
};

ChildApprovalDialogComponent.displayName = "ChildApprovalDialog";

export const ChildApprovalDialog = React.memo(ChildApprovalDialogComponent);
ChildApprovalDialog.displayName = "ChildApprovalDialog";

export default ChildApprovalDialog;
