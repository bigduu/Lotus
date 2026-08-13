import type { SidebarChatItem } from "@shared/types/sidebarChat";

export const countUnreadSessions = (
  roots: ReadonlyArray<SidebarChatItem>,
  childrenByRoot: Readonly<Record<string, SidebarChatItem[]>>,
): number => {
  let count = 0;
  for (const root of roots) {
    if (root.unread) count += 1;
    for (const child of childrenByRoot[root.id] ?? []) {
      if (child.unread) count += 1;
    }
  }
  return count;
};
