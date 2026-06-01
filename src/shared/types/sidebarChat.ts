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
  };
};
