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
  disabled: boolean;
  onRetry?: (mode: MessageRetryMode) => void;
  onCancel?: () => void;
  onSubmit: () => void;
  value: string;
  images: ImageFile[];
  isOverCharLimit: boolean;
  token: any;
  statusIndicator?: React.ReactNode;
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
}) => {
  const { t } = useTranslation();
  const canSend = !value.trim() && images.length === 0;
  const retryDisabled = isStreaming || disabled || !onRetry;

  return (
    <Flex
      align="center"
      style={{
        flex: "0 0 auto",
        gap: token.marginXS,
      }}
    >
      {statusIndicator ? (
        <span style={{ flex: "0 0 auto" }}>{statusIndicator}</span>
      ) : null}

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
            icon={<SyncOutlined spin={isStreaming} />}
            disabled={retryDisabled}
            title={t("chat.actions.retryOptions")}
            size="small"
            style={{
              minWidth: 36,
              padding: "0 8px",
              height: 36,
              width: 36,
              borderRadius: 18,
              color: token.colorTextSecondary,
            }}
          />
        </Dropdown>
      )}

      <Button
        data-testid={isStreaming ? "cancel-button" : "send-button"}
        type="primary"
        icon={isStreaming ? <StopOutlined /> : <ArrowUpOutlined />}
        onClick={isStreaming ? onCancel : onSubmit}
        loading={isStreaming && !onCancel}
        disabled={
          isStreaming
            ? !onCancel || disabled
            : canSend || disabled || isOverCharLimit
        }
        size="small"
        danger={isStreaming}
        style={{
          minWidth: 48,
          padding: 0,
          height: 48,
          width: 48,
          borderRadius: 24,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        title={isStreaming ? t("chat.actions.cancelRequest") : t("chat.actions.sendMessage")}
      />
    </Flex>
  );
};

export default MessageInputControlsRight;
