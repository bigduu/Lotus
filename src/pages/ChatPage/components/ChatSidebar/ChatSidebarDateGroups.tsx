import type { GlobalToken } from "antd/es/theme/interface";
import React, { useMemo } from "react";
import { Button, Empty, Flex, List, Space } from "antd";
import { ApartmentOutlined, DeleteOutlined, DownOutlined, RightOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { ChatItem as ChatItemComponent } from "../ChatItem";
import { ChatSidebarVirtualRootList } from "./ChatSidebarVirtualRootList";
import type { SidebarChatItem } from "@shared/types/sidebarChat";
import { getChatCountByDate } from "../../utils/chatUtils";
import { translateDateKey } from "../../utils/dateGroupTranslation";

// A date group's root-session list switches from plain (unvirtualized)
// rendering to a windowed `@tanstack/react-virtual` viewport once it holds
// more sessions than this. Typical sidebars (a handful to a few dozen
// sessions per date bucket) never cross it, so their DOM output — and every
// existing test written against it — is completely unaffected; this only
// engages for power users with very large session counts in one date group
// (see Lotus issue #4).
const VIRTUALIZE_THRESHOLD = 50;
// Approximate per-row heights used as the virtualizer's initial size guess;
// self-corrected against the real measured height once mounted (see
// ChatSidebarVirtualRootList's `measureElement` usage).
const ROOT_ROW_ESTIMATE_PX = 36;
const CHILD_ROW_ESTIMATE_PX = 28;
// Caps how tall the virtualized viewport for a single date group can grow —
// it scrolls internally beyond this, independent of the sidebar's own outer
// scroll container, so the date-group header above it (a normal, always-
// rendered DOM node — never virtualized away) stays reliably visible instead
// of requiring real CSS `position: sticky`.
const VIRTUAL_LIST_MAX_HEIGHT_PX = 480;

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
  onScheduleThis: (sessionId: string) => void;
  titleGenerationState: Record<string, { status: "loading" | "error" | "idle"; error?: string }>;
  projectDreamState: Record<string, { status: "loading" | "idle" }>;
  token: GlobalToken;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
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
  onScheduleThis,
  titleGenerationState,
  projectDreamState,
  token,
  hasActiveFilters,
  onClearFilters,
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
              <Button size="small" type="link" onClick={onClearFilters}>
                {t("chat.sidebar.empty.clearFilters", "Clear filters")}
              </Button>
            )}
          </Space>
        }
      />
    );
  }

  const expanded = new Set(expandedKeys);

  // Renders one root session's row, including its inline-expanded sub-agent
  // children (if any) directly beneath it — shared verbatim between the
  // plain `<List>` path (small/typical date groups) and the virtualized
  // path (large date groups), so both produce identical markup per row.
  const renderRootRow = (chat: SidebarChatItem) => (
    <div key={chat.id}>
      <Flex align="center" gap={6} style={{ padding: "4px 8px" }}>
        {childrenByRoot[chat.id]?.length ? (
          // A conversation that spawned sub-agents. Use a hierarchy
          // icon + child count in the accent color rather than a bare
          // chevron, so it reads as "a chat with N sub-agents" instead
          // of being mistaken for a collapsible date/category group
          // (which owns the plain ▶/▼ chevron affordance).
          <Button
            size="small"
            type="text"
            style={{
              padding: 0,
              minWidth: 18,
              height: 18,
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
            }}
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
            <ApartmentOutlined
              style={{
                fontSize: 12,
                color: "var(--lotus-primary)",
                opacity: expandedRootIds.has(chat.id) ? 1 : 0.85,
              }}
            />
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                lineHeight: 1,
                color: "var(--lotus-primary)",
              }}
            >
              {childrenByRoot[chat.id].length}
            </span>
          </Button>
        ) : (
          <div style={{ width: 18 }} />
        )}

        <div style={{ flex: 1, minWidth: 0, marginLeft: -8 }}>
          <ChatItemComponent
            chat={chat}
            compact
            isSelected={chat.id === currentSessionId}
            onSelect={onSelectChat}
            onDelete={onDeleteChat}
            onPin={onPinChat}
            onUnpin={onUnpinChat}
            onEdit={onEditTitle}
            onGenerateTitle={onGenerateTitle}
            onRunProjectDream={onRunProjectDream}
            onScheduleThis={onScheduleThis}
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

      {expandedRootIds.has(chat.id) && (childrenByRoot[chat.id]?.length ?? 0) > 0 ? (
        <div style={{ marginLeft: 18, marginTop: 1 }}>
          <List
            itemLayout="horizontal"
            dataSource={childrenByRoot[chat.id]}
            split={false}
            renderItem={(child: SidebarChatItem) => (
              <div
                key={child.id}
                style={{
                  paddingLeft: 8,
                  borderLeft: `1px solid ${token.colorBorderSecondary}`,
                  marginLeft: 2,
                }}
              >
                <ChatItemComponent
                  chat={child}
                  compact
                  isSelected={child.id === currentSessionId}
                  onSelect={onSelectChat}
                  onDelete={onDeleteChat}
                  onPin={onPinChat}
                  onUnpin={onUnpinChat}
                  onEdit={onEditTitle}
                  onGenerateTitle={onGenerateTitle}
                  onRunProjectDream={onRunProjectDream}
                  onScheduleThis={onScheduleThis}
                  isGeneratingTitle={titleGenerationState[child.id]?.status === "loading"}
                  isRunningProjectDream={projectDreamState[child.id]?.status === "loading"}
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
  );

  // Initial size guess for a root row when it enters the virtualized path —
  // the base row height, plus its inline-expanded children's height if any
  // (self-corrected against the real measured height once mounted).
  const estimateRootRowHeight = (chat: SidebarChatItem): number => {
    const childCount = expandedRootIds.has(chat.id) ? (childrenByRoot[chat.id]?.length ?? 0) : 0;
    return ROOT_ROW_ESTIMATE_PX + childCount * CHILD_ROW_ESTIMATE_PX;
  };

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 2 }}>
      {groups.map(({ dateKey, dateGroup, totalChatsInDate }) => {
        const isExpanded = expanded.has(dateKey);

        return (
          <div
            key={dateKey}
            style={{
              borderRadius: token.borderRadiusSM,
              background: "transparent",
              padding: 0,
            }}
          >
            <Flex
              align="center"
              justify="space-between"
              style={{
                cursor: "pointer",
                padding: "4px 8px",
                borderRadius: token.borderRadiusSM,
                transition: "background-color 0.2s ease, color 0.2s ease",
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
                  "var(--lotus-sidebar-item-hover-bg, rgba(204, 251, 241, 0.76))";
                e.currentTarget.style.borderColor = "transparent";
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
                    fontSize: 10.5,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.3px",
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
              <div style={{ marginTop: 2 }}>
                {dateGroup.length > VIRTUALIZE_THRESHOLD ? (
                  <ChatSidebarVirtualRootList
                    items={dateGroup}
                    estimateRowHeight={estimateRootRowHeight}
                    renderRow={renderRootRow}
                    maxHeight={VIRTUAL_LIST_MAX_HEIGHT_PX}
                  />
                ) : (
                  <List
                    itemLayout="horizontal"
                    dataSource={dateGroup}
                    split={false}
                    renderItem={renderRootRow}
                  />
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
