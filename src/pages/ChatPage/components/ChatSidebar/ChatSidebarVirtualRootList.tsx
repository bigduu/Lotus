import React, { useCallback, useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { SidebarChatItem } from "@shared/types/sidebarChat";

// Below this many root sessions in a single date group, the plain
// (non-virtualized) `<List>` rendering in ChatSidebarDateGroups is used
// instead — see VIRTUALIZE_THRESHOLD there. This component is only ever
// mounted once a group crosses that threshold, so typical sidebars (a
// handful to a few dozen sessions per date group) never pay the
// virtualizer's overhead and their DOM output is byte-for-byte unchanged.
type ChatSidebarVirtualRootListProps = {
  items: SidebarChatItem[];
  estimateRowHeight: (chat: SidebarChatItem) => number;
  renderRow: (chat: SidebarChatItem) => React.ReactNode;
  maxHeight: number;
  /**
   * When set to an id present in `items`, scrolls that row into view via
   * the virtualizer's own `scrollToIndex` (#93) — the only way to reveal a
   * row that isn't currently mounted, since virtualization means most rows
   * simply don't exist in the DOM until scrolled near. `null`/`undefined`
   * is a no-op. Callers are expected to only change this value when the
   * *active session itself* changes (see useChatSidebarState's
   * `scrollTarget`), not on every render — this effect fires whenever the
   * value changes, with no additional gating on this end.
   */
  scrollToItemId?: string | null;
};

/**
 * Windows a date group's root-session rows with `@tanstack/react-virtual`
 * (already a project dependency — see ChatMessagesList.tsx for the same
 * pattern applied to chat message entries) so only the sessions currently
 * scrolled into view are mounted, bounding DOM node count regardless of how
 * many sessions a date group holds (see Lotus issue #4).
 *
 * Each row's rendered content is the *entire* root-session block, including
 * its inline-expanded sub-agent children (if any) — the row height therefore
 * varies per-item; `estimateRowHeight` supplies the initial guess and the
 * virtualizer self-corrects against the real measured height via
 * `measureElement` once mounted (this requires ResizeObserver to track
 * *later* size changes — e.g. toggling a root's children open/closed inside
 * an already-mounted virtualized row — which is a no-op in the jsdom test
 * environment; real browsers pick it up immediately).
 *
 * The virtualized viewport is height-capped (`maxHeight`) and independently
 * scrollable so it nests inside the sidebar's own naturally-flowing scroll
 * container without fighting it for scroll ownership — the date-group
 * header above it is a normal (non-virtualized) DOM node, so it is never
 * scrolled out of the DOM the way a virtualized row would be.
 */
export const ChatSidebarVirtualRootList: React.FC<ChatSidebarVirtualRootListProps> = ({
  items,
  estimateRowHeight,
  renderRow,
  maxHeight,
  scrollToItemId,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ref-stable copies so the virtualizer's callbacks don't change identity
  // (and therefore reset internal measurement state) on every render —
  // mirrors the pattern already used in ChatMessagesList.tsx.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const estimateRowHeightRef = useRef(estimateRowHeight);
  estimateRowHeightRef.current = estimateRowHeight;

  const getItemKey = useCallback((index: number) => {
    const chat = itemsRef.current[index];
    return chat ? chat.id : String(index);
  }, []);

  const estimateSize = useCallback((index: number) => {
    const chat = itemsRef.current[index];
    return chat ? estimateRowHeightRef.current(chat) : 36;
  }, []);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize,
    overscan: 8,
    getItemKey,
  });

  // Scroll-to-active-session (#93): only re-runs when `scrollToItemId`
  // itself changes value (or on mount), which the caller guarantees only
  // happens on an actual active-session change — never merely because
  // `items` was narrowed by a search/status filter. `virtualizer` is a
  // stable instance for the component's lifetime (useVirtualizer creates it
  // once via useState and only ever mutates it via setOptions), so listing
  // it as a dependency is a no-op in practice, not an extra trigger.
  useEffect(() => {
    if (!scrollToItemId) return;
    const idx = itemsRef.current.findIndex((chat) => chat.id === scrollToItemId);
    if (idx < 0) return;
    virtualizer.scrollToIndex(idx, { align: "auto" });
  }, [scrollToItemId, virtualizer]);

  const virtualItems = virtualizer.getVirtualItems();
  const viewportHeight = Math.min(maxHeight, virtualizer.getTotalSize()) || maxHeight;

  return (
    <div
      ref={scrollRef}
      data-testid="chat-sidebar-virtual-root-list"
      style={{
        height: viewportHeight,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: virtualizer.getTotalSize(),
        }}
      >
        {virtualItems.map((virtualItem) => {
          const chat = items[virtualItem.index];
          if (!chat) return null;

          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              {renderRow(chat)}
            </div>
          );
        })}
      </div>
    </div>
  );
};
