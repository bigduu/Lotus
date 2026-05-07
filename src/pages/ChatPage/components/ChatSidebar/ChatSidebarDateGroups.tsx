import type { GlobalToken } from "antd/es/theme/interface";
import React, { useMemo } from "react";
import { Button, Empty, Flex, List, Space } from "antd";
import { DeleteOutlined, DownOutlined, RightOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { ChatItem as ChatItemComponent } from "../ChatItem";
import type { SidebarChatItem } from "../../types/sidebarChat";
import { getChatCountByDate } from "../../utils/chatUtils";
import { translateDateKey } from "../../utils/dateGroupTranslation";

type ChatSidebarDateGroupsProps = {
  groupedChatsByDate: Record<string, SidebarChatItem[]>;
  childrenByRoot: Record<string, SidebarChatItem[]>;
  expandedRootIds: Set<string>;
  onToggleRootExpanded: (rootId: string) => void;
  sortedDateKeys: string[];
  expandedKeys: string[];
  onCollapseChange: (keys: string | string[]) => void;
  currentSessionId: string | null;
  onSelectChat: (sessionId: string) => void;
  onDeleteChat: (sessionId: string) => void;
  onDeleteByDate: (dateKey: string) => void;
  onPinChat: (sessionId: string) => void;
  onUnpinChat: (sessionId: string) => void;
  onEditTitle: (sessionId: string, title: string) => void;
  onGenerateTitle: (sessionId: string) => void;
  onRunProjectDream: (sessionId: string) => void;
  titleGenerationState: Record<string, { status: "loading" | "error" | "idle"; error?: string }>;
  projectDreamState: Record<string, { status: "loading" | "idle" }>;
  token: GlobalToken;
  hasActiveFilters: boolean;
};

export const ChatSidebarDateGroups: React.FC<ChatSidebarDateGroupsProps> = ({
  groupedChatsByDate,
  childrenByRoot,
  expandedRootIds,
  onToggleRootExpanded,
  sortedDateKeys,
  expandedKeys,
  onCollapseChange,
  currentSessionId,
  onSelectChat,
  onDeleteChat,
  onDeleteByDate,
  onPinChat,
  onUnpinChat,
  onEditTitle,
  onGenerateTitle,
  onRunProjectDream,
  titleGenerationState,
  projectDreamState,
  token,
  hasActiveFilters,
}) => {
  const { t } = useTranslation();

  const groups = useMemo(() => {
    if (!sortedDateKeys.length) {
      return [];
    }

    return sortedDateKeys.map((dateKey) => {
      const dateGroup = groupedChatsByDate[dateKey];
      const totalChatsInDate = getChatCountByDate(groupedChatsByDate, dateKey);

      return {
        dateKey,
        dateGroup,
        totalChatsInDate,
      };
    });
  }, [groupedChatsByDate, sortedDateKeys]);

  if (!sortedDateKeys.length) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Space direction="vertical" size={4} align="center">
            <span style={{ color: token.colorTextSecondary }}>
              {hasActiveFilters
                ? t("chat.sidebar.empty.noMatches", "No matching sessions")
                : t("chat.sidebar.empty.noSessions")}
            </span>
            <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
              {hasActiveFilters
                ? t("chat.sidebar.empty.filterHint", "Try adjusting your search or filters")
                : t("chat.sidebar.empty.hint")}
            </span>
            {hasActiveFilters && (
              <Button
                size="small"
                type="link"
                onClick={() => {
                  // Clear search by triggering sidebar search clear event
                  const searchInput = document.querySelector<HTMLInputElement>(
                    '[data-testid="sidebar-search-input"] input, .lotus-sidebar-search input',
                  );
                  if (searchInput) {
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                      window.HTMLInputElement.prototype,
                      "value",
                    )?.set;
                    nativeInputValueSetter?.call(searchInput, "");
                    searchInput.dispatchEvent(new Event("input", { bubbles: true }));
                  }
                }}
              >
                {t("chat.sidebar.empty.clearFilters", "Clear filters")}
              </Button>
            )}
          </Space>
        }
      />
    );
  }

  const expanded = new Set(expandedKeys);

  return (
    <Space direction="vertical" size="small" style={{ width: "100%" }}>
      {groups.map(({ dateKey, dateGroup, totalChatsInDate }) => {
        const isExpanded = expanded.has(dateKey);

        return (
          <div
            key={dateKey}
            style={{
              borderRadius: token.borderRadiusSM,
              background: isExpanded ? token.colorFillTertiary : "transparent",
              padding: 4,
            }}
          >
            <Flex
              align="center"
              justify="space-between"
              style={{
                cursor: "pointer",
                padding: "8px 12px",
                borderRadius: token.borderRadiusSM,
                transition: "all 0.2s ease",
                border: "1px solid transparent",
              }}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={`${translateDateKey(dateKey, t)} (${totalChatsInDate})`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  const next = new Set(expanded);
                  if (next.has(dateKey)) {
                    next.delete(dateKey);
                  } else {
                    next.add(dateKey);
                  }
                  onCollapseChange(Array.from(next));
                }
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background =
                  "var(--lotus-sidebar-item-hover-bg, rgba(204, 251, 241, 0.92))";
                e.currentTarget.style.borderColor =
                  "var(--lotus-sidebar-item-hover-border, rgba(13, 148, 136, 0.28))";
                const btn = e.currentTarget.querySelector(
                  ".chat-sidebar-date-group-delete",
                ) as HTMLElement;
                if (btn) btn.style.opacity = "1";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "transparent";
                const btn = e.currentTarget.querySelector(
                  ".chat-sidebar-date-group-delete",
                ) as HTMLElement;
                if (btn) btn.style.opacity = "0";
              }}
              onClick={() => {
                const next = new Set(expanded);
                if (next.has(dateKey)) {
                  next.delete(dateKey);
                } else {
                  next.add(dateKey);
                }
                onCollapseChange(Array.from(next));
              }}
              className="chat-sidebar-date-group-header"
            >
              <Flex align="center" gap="small" style={{ minWidth: 0 }}>
                {isExpanded ? (
                  <DownOutlined style={{ fontSize: 12, opacity: 0.6 }} />
                ) : (
                  <RightOutlined style={{ fontSize: 12, opacity: 0.6 }} />
                )}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: dateKey === "Today" ? "var(--lotus-primary)" : token.colorTextSecondary,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {translateDateKey(dateKey, t)} ({totalChatsInDate})
                </span>
              </Flex>

              <Button
                type="text"
                size="small"
                icon={<DeleteOutlined />}
                className="chat-sidebar-date-group-delete"
                style={{
                  color: token.colorTextTertiary,
                  opacity: 0,
                  transition: "opacity 0.2s ease",
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onDeleteByDate(dateKey);
                }}
              />
            </Flex>

            {isExpanded ? (
              <div style={{ marginTop: 4 }}>
                <List
                  itemLayout="horizontal"
                  dataSource={dateGroup}
                  split={false}
                  renderItem={(chat: SidebarChatItem) => (
                    <div key={chat.id}>
                      <Flex align="center" gap={6}>
                        {childrenByRoot[chat.id]?.length ? (
                          <Button
                            size="small"
                            type="text"
                            style={{ padding: 0, width: 22 }}
                            aria-label={
                              expandedRootIds.has(chat.id)
                                ? t("chat.sidebar.actions.collapseChildren")
                                : t("chat.sidebar.actions.expandChildren")
                            }
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              onToggleRootExpanded(chat.id);
                            }}
                          >
                            {expandedRootIds.has(chat.id) ? <DownOutlined /> : <RightOutlined />}
                          </Button>
                        ) : (
                          <div style={{ width: 22 }} />
                        )}

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <ChatItemComponent
                            chat={chat}
                            isSelected={chat.id === currentSessionId}
                            onSelect={onSelectChat}
                            onDelete={onDeleteChat}
                            onPin={onPinChat}
                            onUnpin={onUnpinChat}
                            onEdit={onEditTitle}
                            onGenerateTitle={onGenerateTitle}
                            onRunProjectDream={onRunProjectDream}
                            isGeneratingTitle={titleGenerationState[chat.id]?.status === "loading"}
                            isRunningProjectDream={projectDreamState[chat.id]?.status === "loading"}
                            titleGenerationError={
                              titleGenerationState[chat.id]?.status === "error"
                                ? titleGenerationState[chat.id]?.error
                                : undefined
                            }
                          />
                        </div>
                      </Flex>

                      {expandedRootIds.has(chat.id) &&
                      (childrenByRoot[chat.id]?.length ?? 0) > 0 ? (
                        <div style={{ marginLeft: 22, marginTop: 2 }}>
                          <List
                            itemLayout="horizontal"
                            dataSource={childrenByRoot[chat.id]}
                            split={false}
                            renderItem={(child: SidebarChatItem) => (
                              <div key={child.id} style={{ paddingLeft: 12 }}>
                                <ChatItemComponent
                                  chat={child}
                                  isSelected={child.id === currentSessionId}
                                  onSelect={onSelectChat}
                                  onDelete={onDeleteChat}
                                  onPin={onPinChat}
                                  onUnpin={onUnpinChat}
                                  onEdit={onEditTitle}
                                  onGenerateTitle={onGenerateTitle}
                                  onRunProjectDream={onRunProjectDream}
                                  isGeneratingTitle={
                                    titleGenerationState[child.id]?.status === "loading"
                                  }
                                  isRunningProjectDream={
                                    projectDreamState[child.id]?.status === "loading"
                                  }
                                  titleGenerationError={
                                    titleGenerationState[child.id]?.status === "error"
                                      ? titleGenerationState[child.id]?.error
                                      : undefined
                                  }
                                />
                              </div>
                            )}
                          />
                        </div>
                      ) : null}
                    </div>
                  )}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </Space>
  );
};
