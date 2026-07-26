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

// ─── Chunk write batching (#166) ───────────────────────────────────────
// Per-token `content: prev.content + chunk` atom writes copy the whole
// accumulated string per chunk (O(n²) over a long stream) and fire a store
// notification per token. Chunks are buffered per session and flushed at
// most once per CHUNK_FLUSH_MS; explicit state writes flush first so the
// event order (chunk stream → finalize/clear) is preserved.
const CHUNK_FLUSH_MS = 50;

const pendingContentChunks = new Map<string, string>();
const pendingReasoningChunks = new Map<string, string>();
let chunkFlushTimer: ReturnType<typeof setTimeout> | null = null;

const appendToState = (
  sessionId: string,
  field: "content" | "reasoningContent",
  text: string,
): void => {
  const targetAtom = assistantStreamingAtomFamily(sessionId);
  const prev = assistantStreamingStore.get(targetAtom);
  assistantStreamingStore.set(targetAtom, {
    ...prev,
    [field]: prev[field] + text,
    updatedAt: Date.now(),
  });
};

export const flushAssistantStreamingChunks = (): void => {
  if (chunkFlushTimer !== null) {
    clearTimeout(chunkFlushTimer);
    chunkFlushTimer = null;
  }
  for (const [sessionId, text] of pendingContentChunks) {
    appendToState(sessionId, "content", text);
  }
  pendingContentChunks.clear();
  for (const [sessionId, text] of pendingReasoningChunks) {
    appendToState(sessionId, "reasoningContent", text);
  }
  pendingReasoningChunks.clear();
};

const scheduleChunkFlush = (): void => {
  if (chunkFlushTimer !== null) return;
  chunkFlushTimer = setTimeout(() => {
    chunkFlushTimer = null;
    flushAssistantStreamingChunks();
  }, CHUNK_FLUSH_MS);
};

const bufferChunk = (
  buffer: Map<string, string>,
  sessionId: string | null | undefined,
  chunk: string,
): void => {
  const normalizedSessionId = normalizeStreamingKeyPart(sessionId);
  if (!normalizedSessionId || !chunk) return;
  buffer.set(normalizedSessionId, (buffer.get(normalizedSessionId) ?? "") + chunk);
  scheduleChunkFlush();
};

export const appendAssistantStreamingChunk = (
  sessionId: string | null | undefined,
  chunk: string,
): void => {
  bufferChunk(pendingContentChunks, sessionId, chunk);
};

export const appendAssistantReasoningChunk = (
  sessionId: string | null | undefined,
  chunk: string,
): void => {
  bufferChunk(pendingReasoningChunks, sessionId, chunk);
};

export const setAssistantStreamingState = (
  sessionId: string | null | undefined,
  patch: Partial<AssistantStreamingState>,
): void => {
  // Explicit writes are authoritative; land any buffered chunks first so
  // they are not applied on top of the new state afterwards.
  flushAssistantStreamingChunks();
  assistantStreamingStore.set(setAssistantStreamingStateAtom, { sessionId, patch });
};

export const clearAssistantStreamingState = (sessionId: string | null | undefined): void => {
  const normalizedSessionId = normalizeStreamingKeyPart(sessionId);
  pendingContentChunks.delete(normalizedSessionId);
  pendingReasoningChunks.delete(normalizedSessionId);
  assistantModule.clearState(normalizedSessionId);
};

export const getAssistantStreamingState = (
  sessionId: string | null | undefined,
): AssistantStreamingState => {
  return assistantModule.getState(normalizeStreamingKeyPart(sessionId));
};
