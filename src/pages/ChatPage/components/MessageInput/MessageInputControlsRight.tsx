import type { GlobalToken } from "antd/es/theme/interface";
import React from "react";
import { Button, Dropdown, Flex } from "antd";
import {
  ArrowUpOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  StopOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { ImageFile } from "../../utils/imageUtils";
import type { MessageRetryMode } from "./types";

interface MessageInputControlsRightProps {
  allowRetry: boolean;
  hasMessages: boolean;
  isStreaming: boolean;
  isInputLocked: boolean;
  canCancel?: boolean;
  disabled: boolean;
  onRetry?: (mode: MessageRetryMode) => void;
  onCancel?: () => void;
  onSubmit: () => void;
  value: string;
  images: ImageFile[];
  isOverCharLimit: boolean;
  token: GlobalToken;
  statusIndicator?: React.ReactNode;
  submitButtonLabel?: string;
}

const MessageInputControlsRight: React.FC<MessageInputControlsRightProps> = ({
  allowRetry,
  hasMessages,
  isInputLocked,
  canCancel,
  disabled,
  onRetry,
  onCancel,
  onSubmit,
  value,
  images,
  isOverCharLimit,
  token,
  statusIndicator,
  submitButtonLabel,
}) => {
  const { t } = useTranslation();
  const canSend = !value.trim() && images.length === 0;
  const effectiveCanCancel = canCancel ?? isInputLocked;
  const shouldShowBusyFeedback = isInputLocked;
  const retryDisabled = isInputLocked || disabled || !onRetry;
  const resolvedSubmitLabel = submitButtonLabel ?? t("chat.actions.sendMessage");

  return (
    <Flex
      align="center"
      style={{
        flex: "0 0 auto",
        gap: token.marginXS,
      }}
    >
      {statusIndicator ? <span style={{ flex: "0 0 auto" }}>{statusIndicator}</span> : null}

      {allowRetry && hasMessages && (
        <Dropdown
          trigger={["click"]}
          menu={{
            items: [
              {
                key: "regenerate",
                label: t("chat.actions.regenerate"),
                icon: <ReloadOutlined />,
              },
              {
                key: "error_retry",
                label: t("chat.actions.retryFailed"),
                icon: <ExclamationCircleOutlined />,
              },
            ],
            onClick: ({ key }) => onRetry?.(key as MessageRetryMode),
          }}
          disabled={retryDisabled}
        >
          <Button
            data-testid="regenerate-button"
            type="text"
            icon={<SyncOutlined spin={shouldShowBusyFeedback} />}
            disabled={retryDisabled}
            title={t("chat.actions.retryOptions")}
            aria-label={t("chat.actions.retryOptions")}
            size="small"
            className="lotus-secondary-button"
            style={{
              minWidth: 38,
              padding: "0 8px",
              height: 38,
              width: 38,
              borderRadius: 19,
              color: token.colorTextSecondary,
            }}
          />
        </Dropdown>
      )}

      <Button
        data-testid={effectiveCanCancel ? "cancel-button" : "send-button"}
        type="primary"
        icon={effectiveCanCancel ? <StopOutlined /> : <ArrowUpOutlined />}
        onClick={effectiveCanCancel ? onCancel : onSubmit}
        // effectiveCanCancel && !onCancel means the session is busy but no
        // cancel path is wired for this state (#169) — show an explained
        // disabled button instead of an infinite spinner.
        loading={false}
        disabled={
          effectiveCanCancel
            ? !onCancel || disabled
            : isInputLocked || canSend || disabled || isOverCharLimit
        }
        size="small"
        danger={effectiveCanCancel}
        className={
          effectiveCanCancel
            ? "message-input-send-button"
            : "message-input-send-button lotus-primary-cta"
        }
        style={{
          minWidth: 50,
          padding: 0,
          height: 50,
          width: 50,
          borderRadius: 25,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: effectiveCanCancel
            ? undefined
            : "linear-gradient(135deg, var(--lotus-primary) 0%, var(--lotus-accent-secondary) 100%)",
          border: effectiveCanCancel ? undefined : "none",
          boxShadow: effectiveCanCancel ? undefined : "var(--lotus-send-btn-shadow)",
          transition: "all 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
          transform: "scale(1)",
        }}
        title={
          effectiveCanCancel
            ? onCancel
              ? t("chat.actions.cancelRequest")
              : t("chat.actions.cancelUnavailable", "Cannot cancel in the current state")
            : resolvedSubmitLabel
        }
        aria-label={
          effectiveCanCancel
            ? onCancel
              ? t("chat.actions.cancelRequest")
              : t("chat.actions.cancelUnavailable", "Cannot cancel in the current state")
            : resolvedSubmitLabel
        }
      />
    </Flex>
  );
};

export default MessageInputControlsRight;
