export const CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT = "chat-toggle-batch-export-selection";
export const CHAT_OPEN_INSPECTOR_EVENT = "chat-open-inspector";
export const CHAT_FOCUS_INPUT_EVENT = "chat-focus-input";

export const CHAT_PENDING_QUESTION_RESOLVED_EVENT = "chat-pending-question-resolved";

export interface ChatPendingQuestionResolvedEventDetail {
  sessionId?: string | null;
  requestId?: string | null;
}
