import React, { useEffect } from "react";
import { Flex, theme } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { Grid } from "antd";

import SystemPromptSelector from "../SystemPromptSelector";
import { ChatSidebarCollapsedMenu } from "./ChatSidebarCollapsedMenu";
import { ChatSidebarDateGroups } from "./ChatSidebarDateGroups";
import { ChatSidebarFooter } from "./ChatSidebarFooter";
import { useChatSidebarState } from "./useChatSidebarState";

const { useBreakpoint } = Grid;
const { useToken } = theme;

export const ChatSidebar: React.FC = () => {
  const { token } = useToken();
  const screens = useBreakpoint();

  const {
    chats,
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

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: token.colorFillQuaternary,
        borderRight: "none",
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Flex
        justify={collapsed ? "center" : "flex-end"}
        style={{
          flexShrink: 0,
          padding: collapsed ? "8px 0 0 0" : "8px 12px 0 12px",
          minHeight: 34,
        }}
      >
        <Button
          type="text"
          icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          onClick={() => setCollapsed(!collapsed)}
          size={screens.xs ? "small" : "middle"}
        />
      </Flex>

      <Flex
        vertical
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: collapsed ? "8px 10px 0 10px" : "8px 12px 0 12px",
        }}
      >
        {!collapsed ? (
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
        ) : (
          <ChatSidebarCollapsedMenu
            chats={chats}
            currentSessionId={currentSessionId}
            onSelectChat={selectSession}
            screens={screens}
            token={token}
          />
        )}
      </Flex>

      <ChatSidebarFooter
        collapsed={collapsed}
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
        title="Create New Session - Select System Prompt"
        showCancelButton={true}
      />
    </div>
  );
};
