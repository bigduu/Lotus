import type { GlobalToken } from "antd/es/theme/interface";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Flex, List, Space, Tooltip } from "antd";
import {
  ApartmentOutlined,
  DeleteOutlined,
  DownOutlined,
  PlusOutlined,
  RightOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { ChatItem as ChatItemComponent, type ChatItemStatus } from "../ChatItem";
import { ChatSidebarVirtualRootList } from "./ChatSidebarVirtualRootList";
import type { SidebarChatItem, SidebarScrollTarget } from "@shared/types/sidebarChat";
import type { SidebarRunState } from "@shared/store/appStore";
import {
  getChatCountByDate,
  formatCalendarDateKey,
  getSortedDateKeys,
  groupChatsByCalendarDate,
  NO_WORKSPACE_GROUP_KEY,
} from "../../utils/chatUtils";
import { NO_PROJECT_GROUP_KEY } from "@services/project";
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
const WORKSPACE_DATE_COLLAPSE_STORAGE_KEY = "lotus.sidebar.workspace-date.collapsed.v1";
const PROJECT_DATE_COLLAPSE_STORAGE_KEY = "lotus.sidebar.project-date.collapsed.v1";

const groupDateCollapseKey = (groupKey: string, dateKey: string) =>
  `${encodeURIComponent(groupKey)}::${dateKey}`;

/**
 * Combines the live run state (#94) with the session's persisted last-run
 * outcome into the single status ChatItem renders. Priority: an active
 * run (awaiting > running) always wins over a stale "error" from a
 * *previous* run — otherwise retrying a failed session would keep showing
 * the old error dot while it's actively running again.
 */
const getChatItemStatus = (
  chat: SidebarChatItem,
  runState: SidebarRunState | undefined,
): { status: ChatItemStatus; errorMessage: string | null } => {
  if (runState === "awaiting") return { status: "awaiting", errorMessage: null };
  if (runState === "running") return { status: "running", errorMessage: null };
  if (chat.lastRunStatus === "error") return { status: "error", errorMessage: chat.lastRunError };
  return { status: "idle", errorMessage: null };
};

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
  onCreateChatInProject?: (projectId: string | null) => void;
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
  /** Live busy/awaiting status per session id (#94) — sparse, idle omitted. */
  runStateBySessionId: Record<string, SidebarRunState>;
  /** Root session ids with at least one running/awaiting child (#94). */
  rootHasRunningChildBySessionId: Record<string, boolean>;
  /** Which row to scroll into view for the active session, if any (#93). */
  scrollTarget: SidebarScrollTarget;
  /**
   * Which top-level grouping is being rendered (#95, #134) — defaults to
   * "date", the historical/only behavior, so every existing caller (and
   * every existing test) that never passes this prop is completely
   * unaffected. In "workspace" mode, group keys are workspace paths (or the
   * `NO_WORKSPACE_GROUP_KEY` sentinel); in "project" mode they are stable
   * backend project ids (or the `NO_PROJECT_GROUP_KEY` sentinel). Both
   * non-date modes nest calendar-date buckets inside each top-level group,
   * so the label/tooltip/highlight logic below switches accordingly.
   */
  groupingMode?: "date" | "workspace" | "project";
  /**
   * Group-key -> friendly display label. In workspace mode this maps
   * workspace paths to basenames (see `buildWorkspaceGroupLabels`); in
   * project mode it maps project ids to Project names joined from the
   * Project store (with a "Missing project" fallback already applied).
   */
  groupLabels?: Record<string, string>;
  /**
   * Project group keys whose Project is archived (#134) — rendered with an
   * "Archived" badge in the group header. Only consulted in project mode.
   */
  archivedGroupKeys?: ReadonlySet<string>;
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
  onCreateChatInProject,
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
  runStateBySessionId,
  rootHasRunningChildBySessionId,
  scrollTarget,
  groupingMode = "date",
  groupLabels,
  archivedGroupKeys,
}) => {
  const { t, i18n } = useTranslation();
  const isWorkspaceMode = groupingMode === "workspace";
  const isProjectMode = groupingMode === "project";
  // Both non-date modes nest calendar-date buckets under the top-level group.
  const isNestedMode = isWorkspaceMode || isProjectMode;
  const dateCollapseStorageKey = isProjectMode
    ? PROJECT_DATE_COLLAPSE_STORAGE_KEY
    : WORKSPACE_DATE_COLLAPSE_STORAGE_KEY;
  const [collapsedGroupDates, setCollapsedGroupDates] = useState<Set<string>>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(dateCollapseStorageKey) || "[]");
      return new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string") : []);
    } catch {
      return new Set();
    }
  });

  const toggleGroupDate = (groupKey: string, dateKey: string) => {
    const key = groupDateCollapseKey(groupKey, dateKey);
    setCollapsedGroupDates((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(dateCollapseStorageKey, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  // Resolves the display text for a group header (#95, #134): the translated
  // date-bucket name in the default mode (unchanged), or the friendly
  // workspace label / Project name (falling back to the raw key or the
  // no-workspace / Unassigned sentinel) in the nested modes.
  const resolveGroupLabel = (groupKey: string): string => {
    if (isProjectMode) {
      if (groupKey === NO_PROJECT_GROUP_KEY) {
        return t("chat.sidebar.unassigned", "Unassigned");
      }
      return groupLabels?.[groupKey] ?? t("chat.sidebar.missingProject", "Missing project");
    }
    if (!isWorkspaceMode) {
      return translateDateKey(groupKey, t);
    }
    if (groupKey === NO_WORKSPACE_GROUP_KEY) {
      return t("chat.sidebar.noWorkspace", "No workspace");
    }
    return groupLabels?.[groupKey] ?? groupKey;
  };

  // In workspace mode the group key IS the full workspace path (see
  // `getWorkspaceGroupKey`), so it doubles as the tooltip content that
  // disambiguates a collision-shortened label. Project labels already come
  // from the Project store by name, so no tooltip is needed there.
  const resolveGroupTooltip = (groupKey: string): string | undefined =>
    isWorkspaceMode && groupKey !== NO_WORKSPACE_GROUP_KEY ? groupKey : undefined;

  // ─── Scroll-to-active-session (#93) ────────────────────────────────
  // Row refs cover BOTH root and (always-plain, never virtualized) nested
  // child rows, keyed by session id. Populated by `registerRowRef` below,
  // attached in `renderRootRow` — the same render function shared by the
  // plain `<List>` and virtualized paths, so both keep refs current.
  const rowRefsRef = useRef(new Map<string, HTMLDivElement>());
  const registerRowRef = (sessionId: string) => (el: HTMLDivElement | null) => {
    if (el) {
      rowRefsRef.current.set(sessionId, el);
    } else {
      rowRefsRef.current.delete(sessionId);
    }
  };
  const groupedChatsByDateRef = useRef(groupedChatsByDate);
  groupedChatsByDateRef.current = groupedChatsByDate;

  // jsdom does not implement `scrollIntoView` (real browsers always do) —
  // guard with optional chaining on the call itself so tests that don't
  // stub it keep working instead of throwing.
  const scrollRowIntoView = (sessionId: string) => {
    rowRefsRef.current.get(sessionId)?.scrollIntoView?.({ block: "nearest" });
  };

  useEffect(() => {
    if (!scrollTarget) return;

    const workspaceGroup = groupedChatsByDateRef.current[scrollTarget.dateKey] || [];
    const group = scrollTarget.nestedDateKey
      ? groupChatsByCalendarDate(workspaceGroup)[scrollTarget.nestedDateKey] || []
      : workspaceGroup;
    const isVirtualized = group.length > VIRTUALIZE_THRESHOLD;
    const targetId = scrollTarget.childId ?? scrollTarget.rootId;

    if (!isVirtualized) {
      // Plain (unvirtualized) rows are always fully in the DOM once their
      // date group is expanded — a direct scrollIntoView positions both the
      // outer sidebar scroll container and this row in one call.
      scrollRowIntoView(targetId);
      return;
    }

    if (scrollTarget.childId) {
      // The root row's own visibility is handled by
      // ChatSidebarVirtualRootList's `scrollToItemId` effect (see the
      // `scrollToItemId` prop passed below). Give it a frame to mount the
      // root row — and, with it, the child's always-plain nested list —
      // before attempting to bring the child row itself into view.
      const rafId = requestAnimationFrame(() => {
        scrollRowIntoView(targetId);
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [scrollTarget]);

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
  const renderRootRow = (chat: SidebarChatItem) => {
    const { status: rootStatus, errorMessage: rootErrorMessage } = getChatItemStatus(
      chat,
      runStateBySessionId[chat.id],
    );
    const hasRunningChild = Boolean(rootHasRunningChildBySessionId[chat.id]);

    return (
      <div key={chat.id} ref={registerRowRef(chat.id)}>
        <Flex align="center" gap={6} style={{ padding: "4px 8px" }}>
          {childrenByRoot[chat.id]?.length ? (
            // A conversation that spawned sub-agents. Use a hierarchy
            // icon + child count in the accent color rather than a bare
            // chevron, so it reads as "a chat with N sub-agents" instead
            // of being mistaken for a collapsible date/category group
            // (which owns the plain ▶/▼ chevron affordance). Turns green
            // and pulses when a child is currently running/awaiting (#94),
            // so a collapsed root still surfaces that activity.
            <Tooltip
              title={
                hasRunningChild
                  ? t("chat.chatItem.status.childRunning", "A sub-agent is running")
                  : undefined
              }
            >
              <Button
                size="small"
                type="text"
                data-testid={`chat-item-children-toggle-${chat.id}`}
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
                  className={hasRunningChild ? "lotus-chat-item-child-badge-icon" : undefined}
                  style={{
                    fontSize: 12,
                    color: hasRunningChild ? token.colorSuccess : "var(--lotus-primary)",
                    opacity: expandedRootIds.has(chat.id) || hasRunningChild ? 1 : 0.85,
                  }}
                />
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 600,
                    lineHeight: 1,
                    color: hasRunningChild ? token.colorSuccess : "var(--lotus-primary)",
                  }}
                >
                  {childrenByRoot[chat.id].length}
                </span>
              </Button>
            </Tooltip>
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
              status={rootStatus}
              statusErrorMessage={rootErrorMessage}
              workspacePath={chat.config.workspacePath}
            />
          </div>
        </Flex>

        {expandedRootIds.has(chat.id) && (childrenByRoot[chat.id]?.length ?? 0) > 0 ? (
          <div style={{ marginLeft: 18, marginTop: 1 }}>
            <List
              itemLayout="horizontal"
              dataSource={childrenByRoot[chat.id]}
              split={false}
              renderItem={(child: SidebarChatItem) => {
                const { status: childStatus, errorMessage: childErrorMessage } = getChatItemStatus(
                  child,
                  runStateBySessionId[child.id],
                );
                return (
                  <div
                    key={child.id}
                    ref={registerRowRef(child.id)}
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
                      status={childStatus}
                      statusErrorMessage={childErrorMessage}
                      workspacePath={child.config.workspacePath}
                    />
                  </div>
                );
              }}
            />
          </div>
        ) : null}
      </div>
    );
  };

  // Initial size guess for a root row when it enters the virtualized path —
  // the base row height, plus its inline-expanded children's height if any
  // (self-corrected against the real measured height once mounted).
  const estimateRootRowHeight = (chat: SidebarChatItem): number => {
    const childCount = expandedRootIds.has(chat.id) ? (childrenByRoot[chat.id]?.length ?? 0) : 0;
    return ROOT_ROW_ESTIMATE_PX + childCount * CHILD_ROW_ESTIMATE_PX;
  };

  const renderRows = (items: SidebarChatItem[], groupKey: string, nestedDateKey?: string) =>
    items.length > VIRTUALIZE_THRESHOLD ? (
      <ChatSidebarVirtualRootList
        items={items}
        estimateRowHeight={estimateRootRowHeight}
        renderRow={renderRootRow}
        maxHeight={VIRTUAL_LIST_MAX_HEIGHT_PX}
        scrollToItemId={
          scrollTarget &&
          scrollTarget.dateKey === groupKey &&
          scrollTarget.nestedDateKey === nestedDateKey
            ? scrollTarget.rootId
            : null
        }
      />
    ) : (
      <List itemLayout="horizontal" dataSource={items} split={false} renderItem={renderRootRow} />
    );

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
              aria-label={`${resolveGroupLabel(dateKey)} (${totalChatsInDate})`}
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
                e.currentTarget
                  .querySelectorAll<HTMLElement>(".chat-sidebar-date-group-action")
                  .forEach((button) => {
                    button.style.opacity = "1";
                  });
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "transparent";
                e.currentTarget
                  .querySelectorAll<HTMLElement>(".chat-sidebar-date-group-action")
                  .forEach((button) => {
                    button.style.opacity = "0";
                  });
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
                <Tooltip title={resolveGroupTooltip(dateKey)} placement="top">
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      // Workspace paths and Project names (unlike
                      // "TODAY"/"THIS WEEK") read poorly forced to
                      // uppercase — leave their casing alone in the
                      // nested grouping modes.
                      textTransform: isNestedMode ? "none" : "uppercase",
                      letterSpacing: "0.3px",
                      color:
                        !isNestedMode && dateKey === "Today"
                          ? "var(--lotus-primary)"
                          : token.colorTextSecondary,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {resolveGroupLabel(dateKey)} ({totalChatsInDate})
                  </span>
                </Tooltip>
                {isProjectMode && archivedGroupKeys?.has(dateKey) ? (
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.3px",
                      color: token.colorTextTertiary,
                      border: `1px solid ${token.colorBorderSecondary}`,
                      borderRadius: token.borderRadiusSM,
                      padding: "0 4px",
                      flexShrink: 0,
                    }}
                  >
                    {t("chat.sidebar.archived", "Archived")}
                  </span>
                ) : null}
              </Flex>

              <Flex align="center" style={{ flexShrink: 0 }}>
                {isProjectMode && onCreateChatInProject ? (
                  <Tooltip title={t("chat.sidebar.actions.createInProject")}>
                    <Button
                      type="text"
                      size="small"
                      icon={<PlusOutlined />}
                      aria-label={t("chat.sidebar.actions.createInProject")}
                      className="chat-sidebar-date-group-create chat-sidebar-date-group-action"
                      style={{
                        color: token.colorTextTertiary,
                        opacity: 0,
                        transition: "opacity 0.2s ease",
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCreateChatInProject(dateKey === NO_PROJECT_GROUP_KEY ? null : dateKey);
                      }}
                    />
                  </Tooltip>
                ) : null}
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  className="chat-sidebar-date-group-delete chat-sidebar-date-group-action"
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
            </Flex>

            {isExpanded ? (
              <div style={{ marginTop: 2 }}>
                {isNestedMode
                  ? (() => {
                      const byDate = groupChatsByCalendarDate(dateGroup);
                      return getSortedDateKeys(byDate).map((nestedDateKey) => {
                        const stableKey = groupDateCollapseKey(dateKey, nestedDateKey);
                        const containsCurrent = byDate[nestedDateKey].some(
                          (chat) =>
                            chat.id === currentSessionId ||
                            (childrenByRoot[chat.id] || []).some(
                              (child) => child.id === currentSessionId,
                            ),
                        );
                        const nestedExpanded =
                          hasActiveFilters ||
                          containsCurrent ||
                          !collapsedGroupDates.has(stableKey);
                        const forcedExpanded = hasActiveFilters || containsCurrent;
                        const dateLabel = formatCalendarDateKey(
                          nestedDateKey,
                          i18n.resolvedLanguage,
                        );
                        return (
                          <div key={stableKey} style={{ marginLeft: 10 }}>
                            <Flex
                              role="button"
                              tabIndex={0}
                              aria-expanded={nestedExpanded}
                              aria-label={`${dateLabel} (${byDate[nestedDateKey].length})`}
                              aria-disabled={forcedExpanded}
                              align="center"
                              gap={6}
                              style={{
                                cursor: forcedExpanded ? "default" : "pointer",
                                padding: "3px 8px",
                              }}
                              onClick={() => {
                                if (!forcedExpanded) toggleGroupDate(dateKey, nestedDateKey);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  if (!forcedExpanded) toggleGroupDate(dateKey, nestedDateKey);
                                }
                              }}
                            >
                              {nestedExpanded ? <DownOutlined /> : <RightOutlined />}
                              <span style={{ fontSize: 10, color: token.colorTextSecondary }}>
                                {dateLabel} ({byDate[nestedDateKey].length})
                              </span>
                            </Flex>
                            {nestedExpanded
                              ? renderRows(byDate[nestedDateKey], dateKey, nestedDateKey)
                              : null}
                          </div>
                        );
                      });
                    })()
                  : renderRows(dateGroup, dateKey)}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};
