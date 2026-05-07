import React, { useEffect, lazy, Suspense } from "react";
import { Button, Flex, Grid, Input, Segmented, theme } from "antd";
import { MenuFoldOutlined, SearchOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { ChatSidebarDateGroups } from "./ChatSidebarDateGroups";
import { ChatSidebarFooter } from "./ChatSidebarFooter";
import { useChatSidebarState } from "./useChatSidebarState";

// Lazy-load SystemPromptSelector — its full module tree (Modal, Radio, List,
// SystemPromptListItem, SystemPromptPreview, etc.) is only fetched when the
// user actually opens the "new chat" selector dialog.
const SystemPromptSelector = lazy(() => import("../SystemPromptSelector"));

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
    handleRunProjectDream,
    handleSearchQueryChange,
    handleStatusFilterChange,
    handleSystemPromptSelect,
    hasActiveFilters,
    isNewChatSelectorOpen,
    pinSession,
    projectDreamState,
    searchQuery,
    selectSession,
    setCollapsed,
    sortedDateKeys,
    statusFilter,
    systemPrompts,
    titleGenerationState,
    unpinSession,
  } = useChatSidebarState();

  const { xs, sm } = screens;

  useEffect(() => {
    // `useBreakpoint()` returns a fresh object reference very frequently.
    // Depend only on the primitive booleans to avoid effect re-running every render.
    if (typeof xs !== "boolean" || typeof sm !== "boolean") return;
    if (xs === false && sm === false) {
      setCollapsed(true);
    }
  }, [sm, xs, setCollapsed]);

  if (collapsed) {
    return null;
  }

  return (
    <nav
      data-tour-id="sidebar"
      aria-label={t("chat.sidebar.title", "Chat sidebar")}
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
          aria-label={t("chat.sidebar.collapse", "Collapse sidebar")}
        />
      </Flex>

      <Flex
        vertical
        gap="small"
        style={{
          flexShrink: 0,
          padding: "10px 12px 8px 12px",
        }}
      >
        <Input
          allowClear
          value={searchQuery}
          onChange={(event) => handleSearchQueryChange(event.target.value)}
          prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder={t("chat.sidebar.searchPlaceholder", "Search sessions")}
          aria-label={t("chat.sidebar.searchPlaceholder", "Search sessions")}
          size={screens.xs ? "middle" : "large"}
          style={{
            borderRadius: token.borderRadiusLG,
          }}
        />

        <Segmented
          block
          size={screens.xs ? "middle" : "small"}
          value={statusFilter}
          onChange={(value) => handleStatusFilterChange(value as typeof statusFilter)}
          options={[
            { label: t("chat.sidebar.filters.all", "All"), value: "all" },
            { label: t("chat.sidebar.filters.pinned", "Pinned"), value: "pinned" },
            { label: t("chat.sidebar.filters.running", "Running"), value: "running" },
            { label: t("chat.sidebar.filters.child", "Child"), value: "child" },
          ]}
        />
      </Flex>

      <Flex
        vertical
        role="list"
        aria-label={t("chat.sidebar.chatList", "Chat list")}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 12px 0 12px",
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
          onRunProjectDream={handleRunProjectDream}
          titleGenerationState={titleGenerationState}
          projectDreamState={projectDreamState}
          token={token}
          hasActiveFilters={hasActiveFilters}
        />
      </Flex>

      <ChatSidebarFooter
        collapsed={false}
        onNewChat={handleNewChat}
        onOpenSettings={handleOpenSettings}
        screens={screens}
        token={token}
      />

      <Suspense fallback={null}>
        <SystemPromptSelector
          open={isNewChatSelectorOpen}
          onClose={handleNewChatSelectorClose}
          onSelect={handleSystemPromptSelect}
          prompts={systemPrompts}
          title={t("chat.prompt.newSessionSelectorTitle")}
          showCancelButton={true}
        />
      </Suspense>
    </nav>
  );
};
