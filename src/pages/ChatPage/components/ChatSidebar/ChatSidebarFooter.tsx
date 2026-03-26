import React from "react";
import { Button, Flex, Tooltip } from "antd";
import {
  PlusOutlined,
  SettingOutlined,
  SunOutlined,
  MoonOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "@shared/store/themeStore";

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
  const themeMode = useThemeStore((s) => s.themeMode);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const newChatLabel = t("chat.sidebar.newSession");
  const settingsLabel = t("settings.page.title");
  const themeLabel =
    themeMode === "dark" ? t("settings.app.lightMode", "Light mode") : t("settings.app.darkMode", "Dark mode");

  return (
    <Flex
      vertical
      gap={collapsed ? "small" : "middle"}
      style={{
        padding: collapsed ? 10 : 16,
        background: "transparent",
        borderTop: `1px solid ${token.colorBorderSecondary}`,
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
        className="lotus-primary-cta"
        style={{
          ...(collapsed ? { width: "44px", height: "44px", margin: "0 auto" } : {}),
          borderRadius: token.borderRadiusLG,
          minHeight: collapsed ? 44 : 46,
          fontWeight: 600,
        }}
      >
        {!collapsed && newChatLabel}
      </Button>

      <Flex gap={8} align="center">
        <Button
          data-testid="open-settings"
          icon={<SettingOutlined />}
          onClick={onOpenSettings}
          block={!collapsed}
          shape="default"
          size={collapsed ? "large" : screens.xs ? "small" : "middle"}
          title={settingsLabel}
          aria-label={settingsLabel}
          className="lotus-secondary-button"
          style={{
            ...(collapsed ? { width: "44px", height: "44px", margin: "0 auto" } : {}),
            borderRadius: token.borderRadiusLG,
            minHeight: collapsed ? 44 : 44,
            flex: collapsed ? undefined : 1,
          }}
        >
          {!collapsed && settingsLabel}
        </Button>

        {!collapsed && (
          <Tooltip title={themeLabel} placement="top">
            <Button
              data-testid="toggle-theme"
              type="text"
              icon={
                themeMode === "dark" ? (
                  <SunOutlined />
                ) : (
                  <MoonOutlined />
                )
              }
              onClick={toggleTheme}
              aria-label={themeLabel}
              className="lotus-toolbar-icon"
              style={{
                width: 44,
                height: 44,
                borderRadius: token.borderRadiusLG,
                flexShrink: 0,
              }}
            />
          </Tooltip>
        )}
      </Flex>
    </Flex>
  );
};
