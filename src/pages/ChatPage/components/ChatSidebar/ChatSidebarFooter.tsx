import type { GlobalToken } from "antd/es/theme/interface";
import React from "react";
import { Badge, Button, Flex, Tooltip, Typography } from "antd";
import {
  CalendarOutlined,
  PlusOutlined,
  ScheduleOutlined,
  SettingOutlined,
  SunOutlined,
  MoonOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { useThemeStore } from "@shared/store/themeStore";
import { useLedgerViewStore } from "@shared/store/ledgerViewStore";
import { APP_VERSION } from "@shared/constants/appVersion";

const { Text } = Typography;

type ChatSidebarFooterProps = {
  collapsed: boolean;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onOpenSchedules: () => void;
  token: GlobalToken;
};

export const ChatSidebarFooter: React.FC<ChatSidebarFooterProps> = ({
  collapsed,
  onNewChat,
  onOpenSettings,
  onOpenSchedules,
  token,
}) => {
  const { t } = useTranslation();
  const themeMode = useThemeStore((s) => s.themeMode);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const openLedger = useLedgerViewStore((s) => s.open);
  const ledgerBadgeCount = useLedgerViewStore((s) => s.badgeCount);
  const newChatLabel = t("chat.sidebar.newSession");
  const settingsLabel = t("settings.page.title");
  const agendaLabel = t("ledger.title");
  // Reuses the Schedules tab's own list title as this button's label/tooltip
  // rather than minting a new key — this button is a one-click deep link
  // into that exact tab (Lotus #99), so the copy should read as the same
  // destination, not a separate feature name.
  const schedulesLabel = t("settings.schedulesTab.listTitle");
  const themeLabel =
    themeMode === "dark"
      ? t("settings.appTab.lightMode", "Light Mode")
      : t("settings.appTab.darkMode", "Dark Mode");

  return (
    <Flex
      vertical
      gap={collapsed ? "small" : 10}
      style={{
        padding: collapsed ? 10 : 12,
        background: "transparent",
        borderTop: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Button
        data-testid="new-chat"
        data-tour-id="new-session"
        type="primary"
        icon={<PlusOutlined />}
        onClick={onNewChat}
        block={!collapsed}
        shape="default"
        size="small"
        title={newChatLabel}
        aria-label={newChatLabel}
        className="lotus-primary-cta"
        style={{
          ...(collapsed ? { width: "40px", height: "40px", margin: "0 auto" } : {}),
          borderRadius: token.borderRadiusLG,
          minHeight: collapsed ? 40 : 38,
          fontWeight: 600,
        }}
      >
        {!collapsed && newChatLabel}
      </Button>

      <Flex gap={6} align="center">
        <Button
          data-testid="open-settings"
          data-tour-id="open-settings"
          icon={<SettingOutlined />}
          onClick={onOpenSettings}
          block={!collapsed}
          shape="default"
          size="small"
          title={settingsLabel}
          aria-label={settingsLabel}
          className="lotus-secondary-button"
          style={{
            ...(collapsed ? { width: "40px", height: "40px", margin: "0 auto" } : {}),
            borderRadius: token.borderRadiusLG,
            minHeight: collapsed ? 40 : 36,
            flex: collapsed ? undefined : 1,
          }}
        >
          {!collapsed && settingsLabel}
        </Button>

        {!collapsed && (
          <Tooltip title={schedulesLabel} placement="top">
            <Button
              data-testid="open-schedules"
              type="text"
              icon={<ScheduleOutlined />}
              onClick={onOpenSchedules}
              aria-label={schedulesLabel}
              className="lotus-toolbar-icon"
              style={{
                width: 36,
                height: 36,
                borderRadius: token.borderRadiusLG,
                flexShrink: 0,
              }}
            />
          </Tooltip>
        )}

        {!collapsed && (
          <Tooltip title={agendaLabel} placement="top">
            <Badge count={ledgerBadgeCount} size="small" offset={[-4, 4]}>
              <Button
                data-testid="open-agenda"
                type="text"
                icon={<CalendarOutlined />}
                onClick={() => openLedger()}
                aria-label={agendaLabel}
                className="lotus-toolbar-icon"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: token.borderRadiusLG,
                  flexShrink: 0,
                }}
              />
            </Badge>
          </Tooltip>
        )}

        {!collapsed && (
          <Tooltip title={themeLabel} placement="top">
            <Button
              data-testid="toggle-theme"
              type="text"
              icon={themeMode === "dark" ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggleTheme}
              aria-label={themeLabel}
              className="lotus-toolbar-icon"
              style={{
                width: 36,
                height: 36,
                borderRadius: token.borderRadiusLG,
                flexShrink: 0,
              }}
            />
          </Tooltip>
        )}
      </Flex>

      {!collapsed && (
        <Text
          type="secondary"
          data-testid="app-version-badge"
          style={{
            fontSize: 11,
            textAlign: "center",
            userSelect: "text",
          }}
        >
          {t("settings.appTab.runningVersion", "Running version")}: v{APP_VERSION}
        </Text>
      )}
    </Flex>
  );
};
