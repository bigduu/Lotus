import { ChatItem, Message } from "@shared/types/chat";

export type DeleteMessageFailureReason =
  | "session_not_found"
  | "message_not_found"
  | "backend_not_found"
  | "session_running"
  | "backend_error";

export type DeleteMessageResult =
  | {
      success: true;
      sessionId: string;
      messageId: string;
    }
  | {
      success: false;
      sessionId: string;
      messageId: string;
      reason: DeleteMessageFailureReason;
      statusCode?: number;
      errorMessage?: string;
    };

export interface ChatSlice {
  // State (backend session list)
  chats: ChatItem[];
  currentSessionId: string | null;
  latestActiveSessionId: string | null;

  // Actions
  addChat: (chat: Omit<ChatItem, "id">) => Promise<string>;
  selectSession: (sessionId: string | null) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteSessions: (sessionIds: string[]) => Promise<void>;
  updateSession: (
    sessionId: string,
    updates: Partial<ChatItem>,
    options?: { skipBackendPatch?: boolean },
  ) => void;
  persistSessionTitle: (sessionId: string, title: string) => Promise<void>;
  /**
   * Apply an authoritative server title (from a `session_title_updated` SSE event).
   * Updates `title` + `titleVersion` only when `titleVersion > current.titleVersion`.
   * Does NOT call `patchSession` — the backend has already persisted the change
   * (the SSE event implies persistence).
   */
  applyServerTitle: (sessionId: string, title: string, titleVersion: number) => void;
  /**
   * Apply an authoritative server pinned flag (from a `session_pinned_updated`
   * SSE event). Suppresses replays whose `updatedAt` is older than the local
   * `updatedAt`, and skips writes when the flag already matches. Does NOT call
   * `patchSession` — the SSE event implies persistence.
   */
  applyServerPinned: (sessionId: string, pinned: boolean, updatedAt: string) => void;
  pinSession: (sessionId: string) => void;
  unpinSession: (sessionId: string) => void;

  addMessage: (sessionId: string, message: Message) => Promise<void>;
  setMessages: (sessionId: string, messages: Message[]) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (sessionId: string, messageId: string) => Promise<DeleteMessageResult>;

  loadChats: () => Promise<void>;
  refreshChats: () => Promise<void>;
  refreshChatsNow: () => Promise<void>;
  loadChatHistory: (
    sessionId: string,
    options?: {
      mode?: "replace" | "monotonic";
      retries?: number;
      retryDelayMs?: number;
      waitForAssistant?: boolean;
    },
  ) => Promise<void>;
  /**
   * Multi-device sync: reconcile the CURRENTLY-OPEN session against the server
   * when an account-feed change event for it arrives (a message appended / run
   * completed / clarification raised on ANOTHER device). Debounced per session.
   *
   * Safe to call during a live local stream: it loads history in `monotonic`
   * mode, so it only catches a *behind* (passive-viewer) device up and is a
   * no-op on the device that is driving the run (whose local state is ahead).
   * Also re-pulls the pending question so a clarification answered on another
   * device clears here (and a new one appears). No-op unless `sessionId` is the
   * open session.
   */
  reconcileOpenSession: (sessionId: string, reason?: string) => void;
}
