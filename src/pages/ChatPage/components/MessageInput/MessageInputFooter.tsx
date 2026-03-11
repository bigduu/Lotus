import React from "react";
import { Flex, Space, Spin, Typography } from "antd";

const { Text } = Typography;

interface MessageInputFooterProps {
  charCount: number;
  maxCharCount?: number;
  isOverCharLimit: boolean;
  isNearCharLimit: boolean;
  isProcessingAttachments: boolean;
  token: any;
}

const MessageInputFooter: React.FC<MessageInputFooterProps> = ({
  charCount,
  maxCharCount,
  isOverCharLimit,
  isNearCharLimit,
  isProcessingAttachments,
  token,
}) => {
  const hasCharLimit =
    typeof maxCharCount === "number" &&
    Number.isFinite(maxCharCount) &&
    maxCharCount > 0;

  // Avoid always reserving vertical space for the footer. Show only when it's useful.
  if (!isProcessingAttachments && !isNearCharLimit && !isOverCharLimit) {
    return null;
  }

  return (
    <>
      {hasCharLimit && (
        <Flex justify="flex-end" style={{ marginTop: token.marginXXS }}>
          <Text
            type={
              isOverCharLimit
                ? "danger"
                : isNearCharLimit
                  ? "warning"
                  : "secondary"
            }
            style={{ fontSize: token.fontSizeSM }}
          >
            {charCount.toLocaleString()} / {maxCharCount.toLocaleString()}
          </Text>
        </Flex>
      )}

      {isProcessingAttachments && (
        <Space size="small" style={{ marginTop: token.marginXS }}>
          <Spin size="small" />
          <Text type="secondary">Processing files…</Text>
        </Space>
      )}
    </>
  );
};

export default MessageInputFooter;
