import {
  assistantStreamingAtomFamily,
  assistantStreamingStore,
  EMPTY_ASSISTANT_STREAMING_STATE,
  type AssistantStreamingState,
} from "./assistantStreamingAtoms";
import { normalizeStreamingKeyPart } from "./streamingStateHelpers";
import { useKeyedRafAtomState } from "./useKeyedRafAtomState";

export const useAssistantStreamingState = (
  sessionId: string | null | undefined,
): AssistantStreamingState => {
  const normalizedSessionId = normalizeStreamingKeyPart(sessionId);

  return useKeyedRafAtomState({
    key: normalizedSessionId,
    atomFamily: assistantStreamingAtomFamily,
    store: assistantStreamingStore,
    emptyState: EMPTY_ASSISTANT_STREAMING_STATE,
  });
};

export const getMergedAssistantStreamingContent = (
  liveState: AssistantStreamingState,
  fallbackContent?: string,
): string => {
  return liveState.content || fallbackContent || "";
};

export const getMergedAssistantReasoningContent = (
  liveState: AssistantStreamingState,
  fallbackContent?: string,
): string => {
  return liveState.reasoningContent || fallbackContent || "";
};

export const hasLiveAssistantStreamingState = (liveState: AssistantStreamingState): boolean => {
  return liveState.updatedAt > 0;
};

export { EMPTY_ASSISTANT_STREAMING_STATE };
