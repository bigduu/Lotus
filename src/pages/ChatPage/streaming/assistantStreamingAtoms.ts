import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { createStore } from "jotai/vanilla";

import {
  clearKeyedStreamingState,
  getKeyedStreamingState,
  normalizeStreamingKeyPart,
} from "./streamingStateHelpers";

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

export const assistantStreamingStore = createStore();

export const assistantStreamingAtomFamily = atomFamily((_sessionId: string) =>
  atom<AssistantStreamingState>(EMPTY_ASSISTANT_STREAMING_STATE),
);

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
  clearKeyedStreamingState(
    assistantStreamingStore,
    assistantStreamingAtomFamily,
    normalizeStreamingKeyPart(sessionId),
    EMPTY_ASSISTANT_STREAMING_STATE,
  );
};

export const getAssistantStreamingState = (
  sessionId: string | null | undefined,
): AssistantStreamingState => {
  return getKeyedStreamingState(
    assistantStreamingStore,
    assistantStreamingAtomFamily,
    normalizeStreamingKeyPart(sessionId),
    EMPTY_ASSISTANT_STREAMING_STATE,
  );
};
