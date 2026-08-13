import React, { useEffect, lazy, Suspense } from "react";
import { Button, Flex, Grid, Input, Segmented, theme } from "antd";
import { MenuFoldOutlined, SearchOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { ChatSidebarDateGroups } from "./ChatSidebarDateGroups";
import { ChatSidebarFooter } from "./ChatSidebarFooter";
import { ProjectSwitcher } from "../ProjectSwitcher";
import { useChatSidebarState } from "./useChatSidebarState";

// Lazy-load SystemPromptSelector — its full module tree (Modal, Radio, List,
// SystemPromptListItem, SystemPromptPreview, etc.) is only fetched when the
// user actually opens the "new chat" selector dialog.
const SystemPromptSelector = lazy(() => import("../SystemPromptSelector"));

// Lazy-load the "Schedule this…" modal — it pulls in the full schedule form
// (trigger builder, policy selects, etc.) plus the schedules API client, none
// of which is needed until the user actually opens it from a session menu.
const ScheduleThisModal = lazy(() => import("../ScheduleThisModal"));

const { useBreakpoint } = Grid;
const { useToken } = theme;

export const ChatSidebar: React.FC = () => {
  const { token } = useToken();
  const { t } = useTranslation();
  const screens = useBreakpoint();

  const {
    activeGroupedChats,
    activeSortedGroupKeys,
    childrenByRoot,
    expandedRootIds,
    toggleRootExpanded,
    collapsed,
    currentSessionId,
    expandedKeys,
    groupingMode,
    projectGroupLabels,
    unreadCountByProject,
    unreadCountByProjectDate,
    sessionCountByProject,
    sessionCountByProjectDate,
    archivedProjectKeys,
    handleCollapseChange,
    handleDelete,
    handleDeleteByDate,
    handleEditTitle,
    handleGenerateTitle,
    handleCreateChatInProject,
    handleNewChat,
    handleNewChatSelectorClose,
    handleOpenSettings,
    handleOpenSchedules,
    handleRunProjectDream,
    handleScheduleThis,
    handleCopySession,
    handleCloseScheduleThis,
    handleSearchQueryChange,
    handleStatusFilterChange,
    handleClearFilters,
    handleSystemPromptSelect,
    hasActiveFilters,
    isNewChatSelectorOpen,
    pinSession,
    projectDreamState,
    copyingSessionIds,
    rootHasRunningChildBySessionId,
    runStateBySessionId,
    scheduleThisSessionId,
    scrollTarget,
    searchQuery,
    selectSession,
    setCollapsed,
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
      aria-label={t("chat.sidebar.title")}
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
          padding: "8px 10px 0 10px",
          minHeight: 34,
        }}
      >
        <Button
          type="text"
          icon={<MenuFoldOutlined />}
          onClick={() => setCollapsed(true)}
          size={screens.xs ? "small" : "middle"}
          className="lotus-toolbar-icon"
          aria-label={t("chat.sidebar.collapse")}
        />
      </Flex>

      <Flex
        vertical
        gap={6}
        style={{
          flexShrink: 0,
          padding: "6px 10px 6px 10px",
        }}
      >
        <ProjectSwitcher />
        <Input
          allowClear
          value={searchQuery}
          onChange={(event) => handleSearchQueryChange(event.target.value)}
          prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
          placeholder={t("chat.sidebar.searchPlaceholder")}
          aria-label={t("chat.sidebar.searchPlaceholder")}
          size="small"
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
            { label: t("chat.sidebar.filters.all"), value: "all" },
            { label: t("chat.sidebar.filters.pinned"), value: "pinned" },
            { label: t("chat.sidebar.filters.running"), value: "running" },
            { label: t("chat.sidebar.filters.child"), value: "child" },
          ]}
        />
      </Flex>

      <Flex
        vertical
        role="list"
        aria-label={t("chat.sidebar.chatList")}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "0 10px",
        }}
      >
        <ChatSidebarDateGroups
          groupedChatsByDate={activeGroupedChats}
          sortedDateKeys={activeSortedGroupKeys}
          groupingMode={groupingMode}
          groupLabels={projectGroupLabels}
          archivedGroupKeys={archivedProjectKeys}
          unreadCountByGroup={unreadCountByProject}
          unreadCountByGroupDate={unreadCountByProjectDate}
          sessionCountByGroup={sessionCountByProject}
          sessionCountByGroupDate={sessionCountByProjectDate}
          childrenByRoot={childrenByRoot}
          expandedRootIds={expandedRootIds}
          onToggleRootExpanded={toggleRootExpanded}
          expandedKeys={expandedKeys}
          onCollapseChange={handleCollapseChange}
          currentSessionId={currentSessionId}
          onSelectChat={selectSession}
          onDeleteChat={handleDelete}
          onDeleteByDate={handleDeleteByDate}
          onCreateChatInProject={handleCreateChatInProject}
          onPinChat={pinSession}
          onUnpinChat={unpinSession}
          onEditTitle={handleEditTitle}
          onGenerateTitle={handleGenerateTitle}
          onRunProjectDream={handleRunProjectDream}
          onScheduleThis={handleScheduleThis}
          onCopy={handleCopySession}
          titleGenerationState={titleGenerationState}
          projectDreamState={projectDreamState}
          copyingSessionIds={copyingSessionIds}
          token={token}
          hasActiveFilters={hasActiveFilters}
          onClearFilters={handleClearFilters}
          runStateBySessionId={runStateBySessionId}
          rootHasRunningChildBySessionId={rootHasRunningChildBySessionId}
          scrollTarget={scrollTarget}
        />
      </Flex>

      <ChatSidebarFooter
        collapsed={false}
        onNewChat={handleNewChat}
        onOpenSettings={handleOpenSettings}
        onOpenSchedules={handleOpenSchedules}
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

      {scheduleThisSessionId ? (
        <Suspense fallback={null}>
          <ScheduleThisModal
            open={Boolean(scheduleThisSessionId)}
            sessionId={scheduleThisSessionId}
            onClose={handleCloseScheduleThis}
          />
        </Suspense>
      ) : null}
    </nav>
  );
};
