import React from "react";

import { SessionWorkspaceShell } from "../../workspace/SessionWorkspaceShell";
import type { ConversationWorkspaceState } from "../../workspace/workspaceState";

export type ChatViewProps = {
  /**
   * If omitted, falls back to the globally selected chat.
   * When rendering a non-root workspace leaf, always pass an explicit sessionId.
   */
  sessionId?: string | null;
  /**
   * When embedded in split panes, use full width and tighter spacing.
   */
  embedded?: boolean;
  /**
   * Legacy fallback for deriving visible-leaf workspace context when explicit workspaceState is not supplied.
   */
  paneCount?: number;
  /**
   * Preferred explicit workspace state when rendered inside the pane workspace.
   */
  workspaceState?: ConversationWorkspaceState;
};

export const ChatView: React.FC<ChatViewProps> = ({
  sessionId,
  embedded = false,
  paneCount = 1,
  workspaceState,
}) => {
  return (
    <SessionWorkspaceShell
      sessionId={sessionId}
      embedded={embedded}
      paneCount={paneCount}
      workspaceState={workspaceState}
    />
  );
};

export default ChatView;
