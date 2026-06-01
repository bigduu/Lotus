import type { GlobalToken } from "antd/es/theme/interface";
import React, { useMemo } from "react";
import { Avatar, Flex } from "antd";

import type { ChatItem } from "@shared/types/chat";

type ChatSidebarCollapsedMenuProps = {
  chats: ChatItem[];
  currentSessionId: string | null;
  onSelectChat: (sessionId: string) => void;
  screens: { xs?: boolean };
  token: GlobalToken;
};

export const ChatSidebarCollapsedMenu: React.FC<ChatSidebarCollapsedMenuProps> = ({
  chats,
  currentSessionId,
  onSelectChat,
  screens,
  token,
}) => {
  const items = useMemo(() => chats, [chats]);

  return (
    <Flex vertical gap={8} style={{ width: "100%" }}>
      {items.map((chat) => {
        const isSelected = chat.id === currentSessionId;

        return (
          <button
            key={chat.id}
            type="button"
            onClick={() => onSelectChat(chat.id)}
            title={chat.title}
            aria-label={chat.title}
            style={{
              border: "none",
              background: "transparent",
              width: 44,
              height: 44,
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto",
              cursor: "pointer",
              borderRadius: 999,
            }}
          >
            <Avatar
              size={screens.xs ? 30 : 34}
              style={{
                backgroundColor: isSelected ? token.colorPrimary : token.colorFillTertiary,
                color: isSelected ? token.colorTextLightSolid : token.colorTextSecondary,
              }}
            >
              {chat.title.charAt(0)}
            </Avatar>
          </button>
        );
      })}
    </Flex>
  );
};
