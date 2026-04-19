import type { GlobalToken } from "antd/es/theme/interface";
import React from "react";
import { Flex } from "@/components/ui/flex";
import { Typography } from "@/components/ui/typography";
const { Text } = Typography;

interface MessageCardHeaderProps {
  role: "user" | "assistant" | "system" | "tool";
  formattedTimestamp?: string | null;
  token: GlobalToken;
}

const MessageCardHeader: React.FC<MessageCardHeaderProps> = ({
  role,
  formattedTimestamp,
  token,
}) => {
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  const label = isUser ? "You" : isAssistant ? "Bodhi" : role;
  const avatarText = isUser ? "Y" : isAssistant ? "B" : role.slice(0, 1).toUpperCase();

  return (
    <Flex
      align="center"
      justify="space-between"
      gap={token.marginXS}
      style={{ marginBottom: token.marginXS }}
    >
      <Flex align="center" gap={10}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.3px",
            background: isUser
              ? "var(--lotus-avatar-user-bg)"
              : isAssistant
                ? "var(--lotus-avatar-assistant-bg)"
                : "var(--lotus-avatar-system-bg)",
            color: "white",
            boxShadow: isUser
              ? "var(--lotus-avatar-user-shadow)"
              : isAssistant
                ? "var(--lotus-avatar-assistant-shadow)"
                : "var(--lotus-avatar-system-shadow)",
            border: "var(--lotus-avatar-border)",
          }}
        >
          {avatarText}
        </div>

        <Flex vertical gap={0}>
          <Text
            strong
            style={{
              fontSize: 13,
              color: isUser ? "var(--lotus-primary)" : token.colorText,
              letterSpacing: "0.2px",
              lineHeight: 1.1,
            }}
          >
            {label}
          </Text>
          <Text
            type="secondary"
            style={{
              fontSize: 11,
              lineHeight: 1.1,
            }}
          >
            {isUser ? "Prompt" : isAssistant ? "Assistant" : "System"}
          </Text>
        </Flex>
      </Flex>

      {formattedTimestamp && (
        <Text
          type="secondary"
          style={{
            fontSize: 11,
            whiteSpace: "nowrap",
            opacity: 0.92,
            padding: "4px 8px",
            borderRadius: 999,
            background: "var(--lotus-timestamp-bg)",
            border: "1px solid var(--lotus-timestamp-border)",
          }}
        >
          {formattedTimestamp}
        </Text>
      )}
    </Flex>
  );
};

export default MessageCardHeader;
