import type { ChatItem } from "@shared/types/chat";
import type {
  SessionActivity,
  SessionReadMarker,
  SessionReadObservation,
} from "@shared/store/sessionReadStateStore";

type ReadStateSnapshot = {
  markers: Readonly<Record<string, SessionReadMarker>>;
  feedResetThrough: number;
  pendingFeedReset?: boolean;
  markRead: (
    sessions: ReadonlyArray<SessionActivity>,
    observed?: Readonly<Record<string, SessionReadObservation | undefined>>,
  ) => void;
};

export type HistoryLoadMode = "replace" | "monotonic";

/**
 * A dirty feed coordinate can represent a count-neutral clear/truncate. In
 * that case a monotonic history load is allowed to preserve the longer local
 * transcript, so it cannot prove that the visible UI reflects the change.
 */
export const visibleHistoryLoadMode = ({
  sessionId,
  readState,
}: {
  sessionId: string;
  readState: ReadStateSnapshot;
}): HistoryLoadMode => {
  const marker = readState.markers[sessionId];
  const hasUnreadCoordinate =
    readState.pendingFeedReset === true ||
    (marker?.dirtyContentThrough ?? 0) > (marker?.readContentThrough ?? 0) ||
    readState.feedResetThrough > (marker?.readResetThrough ?? 0);
  return hasUnreadCoordinate ? "replace" : "monotonic";
};

/**
 * Load an authoritative transcript and acknowledge only the feed coordinate
 * that was observable before the request started. A later event therefore
 * remains dirty, and a tab hidden while awaiting the response acknowledges
 * nothing.
 */
export const loadVisibleHistoryAndAcknowledge = async ({
  sessionId,
  mode,
  loadChatHistory,
  getRenderedSession,
  getReadState,
  isPageVisible,
}: {
  sessionId: string;
  mode: HistoryLoadMode;
  loadChatHistory: (sessionId: string, options: { mode: HistoryLoadMode }) => Promise<boolean>;
  getRenderedSession: () => ChatItem | undefined;
  getReadState: () => ReadStateSnapshot;
  isPageVisible: () => boolean;
}): Promise<void> => {
  const readState = getReadState();
  const marker = readState.markers[sessionId];
  const readObservation = {
    content: marker?.dirtyContentThrough,
    reset: readState.feedResetThrough,
  };
  const loaded = await loadChatHistory(sessionId, { mode });
  if (!loaded || !isPageVisible()) return;
  const rendered = getRenderedSession();
  if (rendered) getReadState().markRead([rendered], { [sessionId]: readObservation });
};
