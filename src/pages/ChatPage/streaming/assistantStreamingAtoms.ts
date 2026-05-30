import { atom } from "jotai";

import { createStreamingAtomModule, normalizeStreamingKeyPart } from "./streamingStateHelpers";

export interface AssistantStreamingState {
  content: string;
  reasoningContent: string;
  updatedAt: number;
}

export const EMPTY_ASSISTANT_STREAMING_STATE: AssistantStreamingState = {
  content: "",
  reasoningContent: "",
  updatedAt: 0,
};

const assistantModule = createStreamingAtomModule<AssistantStreamingState>(
  EMPTY_ASSISTANT_STREAMING_STATE,
);

export const assistantStreamingStore = assistantModule.store;
export const assistantStreamingAtomFamily = assistantModule.atomFamily;

export const appendAssistantStreamingChunkAtom = atom(
  null,
  (
    get,
    set,
    payload: {
      sessionId: string | null | undefined;
      chunk: string;
    },
  ) => {
    const normalizedSessionId = normalizeStreamingKeyPart(payload.sessionId);
    const chunk = payload.chunk ?? "";
    if (!normalizedSessionId || !chunk) return;

    const targetAtom = assistantStreamingAtomFamily(normalizedSessionId);
    const prev = get(targetAtom);
    set(targetAtom, {
      ...prev,
      content: prev.content + chunk,
      updatedAt: Date.now(),
    });
  },
);

export const appendAssistantReasoningChunkAtom = atom(
  null,
  (
    get,
    set,
    payload: {
      sessionId: string | null | undefined;
      chunk: string;
    },
  ) => {
    const normalizedSessionId = normalizeStreamingKeyPart(payload.sessionId);
    const chunk = payload.chunk ?? "";
    if (!normalizedSessionId || !chunk) return;

    const targetAtom = assistantStreamingAtomFamily(normalizedSessionId);
    const prev = get(targetAtom);
    set(targetAtom, {
      ...prev,
      reasoningContent: prev.reasoningContent + chunk,
      updatedAt: Date.now(),
    });
  },
);

export const setAssistantStreamingStateAtom = atom(
  null,
  (
    get,
    set,
    payload: {
      sessionId: string | null | undefined;
      patch: Partial<AssistantStreamingState>;
    },
  ) => {
    const normalizedSessionId = normalizeStreamingKeyPart(payload.sessionId);
    if (!normalizedSessionId) return;

    const targetAtom = assistantStreamingAtomFamily(normalizedSessionId);
    const prev = get(targetAtom);
    set(targetAtom, {
      content: payload.patch.content ?? prev.content,
      reasoningContent: payload.patch.reasoningContent ?? prev.reasoningContent,
      updatedAt: payload.patch.updatedAt ?? Date.now(),
    });
  },
);

export const appendAssistantStreamingChunk = (
  sessionId: string | null | undefined,
  chunk: string,
): void => {
  assistantStreamingStore.set(appendAssistantStreamingChunkAtom, { sessionId, chunk });
};

export const appendAssistantReasoningChunk = (
  sessionId: string | null | undefined,
  chunk: string,
): void => {
  assistantStreamingStore.set(appendAssistantReasoningChunkAtom, { sessionId, chunk });
};

export const setAssistantStreamingState = (
  sessionId: string | null | undefined,
  patch: Partial<AssistantStreamingState>,
): void => {
  assistantStreamingStore.set(setAssistantStreamingStateAtom, { sessionId, patch });
};

export const clearAssistantStreamingState = (sessionId: string | null | undefined): void => {
  assistantModule.clearState(normalizeStreamingKeyPart(sessionId));
};

export const getAssistantStreamingState = (
  sessionId: string | null | undefined,
): AssistantStreamingState => {
  return assistantModule.getState(normalizeStreamingKeyPart(sessionId));
};
