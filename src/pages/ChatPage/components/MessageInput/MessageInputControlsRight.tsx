import type { GlobalToken } from "antd/es/theme/interface";
import React from "react";
import { Dropdown, Flex } from "antd";
import { Button } from "@/components/ui/button";
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
  isStreaming,
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
  const retryDisabled = isStreaming || disabled || !onRetry;
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
            variant="ghost"
            icon={<SyncOutlined spin={isStreaming} />}
            disabled={retryDisabled}
            title={t("chat.actions.retryOptions")}
            aria-label={t("chat.actions.retryOptions")}
            size="sm"
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
        data-testid={isStreaming ? "cancel-button" : "send-button"}
        icon={isStreaming ? <StopOutlined /> : <ArrowUpOutlined />}
        onClick={isStreaming ? onCancel : onSubmit}
        loading={isStreaming && !onCancel}
        disabled={isStreaming ? !onCancel || disabled : canSend || disabled || isOverCharLimit}
        size="sm"
        className={
          isStreaming ? "message-input-send-button" : "message-input-send-button lotus-primary-cta"
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
          background: isStreaming
            ? undefined
            : "linear-gradient(135deg, var(--lotus-primary) 0%, var(--lotus-accent-secondary) 100%)",
          border: isStreaming ? undefined : "none",
          boxShadow: isStreaming ? undefined : "var(--lotus-send-btn-shadow)",
          transition: "all 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
          transform: "scale(1)",
        }}
        title={isStreaming ? t("chat.actions.cancelRequest") : resolvedSubmitLabel}
        aria-label={isStreaming ? t("chat.actions.cancelRequest") : resolvedSubmitLabel}
        variant="destructive" />
    </Flex>
  );
};

export default MessageInputControlsRight;
