import React from "react";
import { Button, Flex } from "antd";
import { PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

type ChatSidebarFooterProps = {
  collapsed: boolean;
  onNewChat: () => void;
  onOpenSettings: () => void;
  screens: { xs?: boolean };
  token: any;
};

export const ChatSidebarFooter: React.FC<ChatSidebarFooterProps> = ({
  collapsed,
  onNewChat,
  onOpenSettings,
  screens,
  token,
}) => {
  const { t } = useTranslation();
  const newChatLabel = t("chat.sidebar.newSession");
  const settingsLabel = t("settings.page.title");

  return (
    <Flex
      vertical
      gap={collapsed ? "small" : "middle"}
      style={{
        padding: collapsed ? 8 : 16,
        background: token.colorFillQuaternary,
        borderTop: "none",
      }}
    >
      <Button
        data-testid="new-chat"
        type="primary"
        icon={<PlusOutlined />}
        onClick={onNewChat}
        block={!collapsed}
        shape="default"
        size={collapsed ? "large" : screens.xs ? "small" : "middle"}
        title={newChatLabel}
        aria-label={newChatLabel}
        style={{
          ...(collapsed ? { width: "44px", height: "44px", margin: "0 auto" } : {}),
          borderRadius: token.borderRadiusLG,
        }}
      >
        {!collapsed && newChatLabel}
      </Button>

      <Button
        data-testid="open-settings"
        icon={<SettingOutlined />}
        onClick={onOpenSettings}
        block={!collapsed}
        shape="default"
        size={collapsed ? "large" : screens.xs ? "small" : "middle"}
        title={settingsLabel}
        aria-label={settingsLabel}
        style={{
          ...(collapsed ? { width: "44px", height: "44px", margin: "0 auto" } : {}),
          borderRadius: token.borderRadiusLG,
        }}
      >
        {!collapsed && settingsLabel}
      </Button>
    </Flex>
  );
};
