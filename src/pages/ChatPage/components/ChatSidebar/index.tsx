import React, { useEffect } from "react";
import { Flex, theme } from "antd";
import { MenuFoldOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { Grid } from "antd";
import { useTranslation } from "react-i18next";

import SystemPromptSelector from "../SystemPromptSelector";
import { ChatSidebarDateGroups } from "./ChatSidebarDateGroups";
import { ChatSidebarFooter } from "./ChatSidebarFooter";
import { useChatSidebarState } from "./useChatSidebarState";

const { useBreakpoint } = Grid;
const { useToken } = theme;

export const ChatSidebar: React.FC = () => {
  const { token } = useToken();
  const { t } = useTranslation();
  const screens = useBreakpoint();

  const {
    childrenByRoot,
    expandedRootIds,
    toggleRootExpanded,
    collapsed,
    currentSessionId,
    expandedKeys,
    groupedChatsByDate,
    handleCollapseChange,
    handleDelete,
    handleDeleteByDate,
    handleEditTitle,
    handleGenerateTitle,
    handleNewChat,
    handleNewChatSelectorClose,
    handleOpenSettings,
    handleSystemPromptSelect,
    isNewChatSelectorOpen,
    pinSession,
    selectSession,
    setCollapsed,
    sortedDateKeys,
    systemPrompts,
    titleGenerationState,
    unpinSession,
  } = useChatSidebarState();

  useEffect(() => {
    // `useBreakpoint()` returns a fresh object reference very frequently.
    // Depend only on the primitive booleans to avoid effect re-running every render.
    const { xs, sm } = screens;
    if (typeof xs !== "boolean" || typeof sm !== "boolean") return;
    if (xs === false && sm === false) {
      setCollapsed(true);
    }
  }, [screens.xs, screens.sm, setCollapsed]);

  if (collapsed) {
    return null;
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "transparent",
        borderRight: `1px solid ${token.colorBorderSecondary}`,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Flex
        justify="flex-end"
        style={{
          flexShrink: 0,
          padding: "10px 12px 2px 12px",
          minHeight: 40,
        }}
      >
        <Button
          type="text"
          icon={<MenuFoldOutlined />}
          onClick={() => setCollapsed(true)}
          size={screens.xs ? "small" : "middle"}
          className="lotus-toolbar-icon"
        />
      </Flex>

      <Flex
        vertical
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "10px 12px 0 12px",
        }}
      >
        <ChatSidebarDateGroups
          groupedChatsByDate={groupedChatsByDate}
          childrenByRoot={childrenByRoot}
          expandedRootIds={expandedRootIds}
          onToggleRootExpanded={toggleRootExpanded}
          sortedDateKeys={sortedDateKeys}
          expandedKeys={expandedKeys}
          onCollapseChange={handleCollapseChange}
          currentSessionId={currentSessionId}
          onSelectChat={selectSession}
          onDeleteChat={handleDelete}
          onDeleteByDate={handleDeleteByDate}
          onPinChat={pinSession}
          onUnpinChat={unpinSession}
          onEditTitle={handleEditTitle}
          onGenerateTitle={handleGenerateTitle}
          titleGenerationState={titleGenerationState}
          token={token}
        />
      </Flex>

      <ChatSidebarFooter
        collapsed={false}
        onNewChat={handleNewChat}
        onOpenSettings={handleOpenSettings}
        screens={screens}
        token={token}
      />

      <SystemPromptSelector
        open={isNewChatSelectorOpen}
        onClose={handleNewChatSelectorClose}
        onSelect={handleSystemPromptSelect}
        prompts={systemPrompts}
        title={t("chat.prompt.newSessionSelectorTitle")}
        showCancelButton={true}
      />
    </div>
  );
};
