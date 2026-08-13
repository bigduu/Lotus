import type { ChatItem } from "@shared/types/chat";
import type {
  SessionActivity,
  SessionReadMarker,
  SessionReadObservation,
} from "@shared/store/sessionReadStateStore";

type ReadStateSnapshot = {
  markers: Readonly<Record<string, SessionReadMarker>>;
  feedResetThrough: number;
  markRead: (
    sessions: ReadonlyArray<SessionActivity>,
    observed?: Readonly<Record<string, SessionReadObservation | undefined>>,
  ) => void;
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
  mode: "replace" | "monotonic";
  loadChatHistory: (
    sessionId: string,
    options: { mode: "replace" | "monotonic" },
  ) => Promise<boolean>;
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
