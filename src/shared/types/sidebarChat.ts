import type { SessionPlanModeState } from "@services/chat/AgentService";

export type SidebarChatListItem = {
  id: string;
  title: string;
  kind: "root" | "child";
  pinned: boolean;
  planMode?: SessionPlanModeState | null;
};

export type SidebarChatItem = SidebarChatListItem & {
  parentSessionId: string | null;
  rootSessionId: string | null;
  createdByScheduleId: string | null;
  updatedAt: string | null;
  lastRunStatus: string | null;
  lastRunError: string | null;
  createdAt: number;
  config: {
    systemPromptId: string;
    workspacePath: string | null;
    projectId: string | null;
  };
};

/**
 * Identifies the sidebar row that should be scrolled into view for the
 * current active session (#93) — which date group it lives in, its root
 * session id (used for `scrollToIndex` in a virtualized group), and — when
 * the active session is itself a child — the child's own id for a
 * follow-up `scrollIntoView` once its root row is mounted.
 */
export type SidebarScrollTarget = {
  /** Top-level group key (historically named dateKey; a Project id in the
   * Project-first hierarchy, `#134`). */
  dateKey: string;
  /** Stable YYYY-MM-DD nested date key inside the top-level group. */
  nestedDateKey?: string;
  rootId: string;
  childId: string | null;
} | null;
