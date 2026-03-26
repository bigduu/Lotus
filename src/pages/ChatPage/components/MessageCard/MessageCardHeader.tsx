import React from "react";
import { Flex, Typography } from "antd";
import { useThemeStore } from "@shared/store/themeStore";

const { Text } = Typography;

interface MessageCardHeaderProps {
  role: "user" | "assistant" | "system" | "tool";
  formattedTimestamp?: string | null;
  token: any;
}

const MessageCardHeader: React.FC<MessageCardHeaderProps> = ({
  role,
  formattedTimestamp,
  token,
}) => {
  const isDark = useThemeStore((s) => s.themeMode) === "dark";
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
              ? "linear-gradient(135deg, #0d9488 0%, #0891b2 100%)"
              : isAssistant
                ? "linear-gradient(135deg, #059669 0%, #06b6d4 100%)"
                : "linear-gradient(135deg, rgba(148,163,184,0.9) 0%, rgba(100,116,139,0.92) 100%)",
            color: "white",
            boxShadow: isUser
              ? "0 6px 16px rgba(13, 148, 136, 0.28)"
              : isAssistant
                ? "0 6px 16px rgba(13, 148, 136, 0.22)"
                : "0 4px 12px rgba(100, 116, 139, 0.18)",
            border: "1px solid rgba(255, 255, 255, 0.18)",
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
            background: isDark
              ? "rgba(30, 41, 59, 0.92)"
              : "rgba(224, 231, 255, 0.9)",
            border: isDark
              ? "1px solid rgba(148,163,184,0.18)"
              : "1px solid rgba(148,163,184,0.22)",
          }}
        >
          {formattedTimestamp}
        </Text>
      )}
    </Flex>
  );
};

export default MessageCardHeader;
