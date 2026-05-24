import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { createStore } from "jotai/vanilla";

import {
  buildStreamingCompositeKey,
  clearKeyedStreamingState,
  clearKeyedStreamingStatesByPrefix,
  getKeyedStreamingState,
  normalizeStreamingKeyPart,
} from "./streamingStateHelpers";

export type ToolStreamingStatus = "idle" | "running" | "completed" | "error";

export interface ToolStreamingState {
  output: string;
  status: ToolStreamingStatus;
  updatedAt: number;
}

const EMPTY_TOOL_STREAMING_STATE: ToolStreamingState = {
  output: "",
  status: "idle",
  updatedAt: 0,
};

const activeStreamingKeys = new Set<string>();

export const toolStreamingStore = createStore();

export const buildToolStreamingKey = (
  sessionId: string | null | undefined,
  toolCallId: string | null | undefined,
): string => {
  return buildStreamingCompositeKey(sessionId, toolCallId);
};

export const toolStreamingAtomFamily = atomFamily((_streamKey: string) =>
  atom<ToolStreamingState>(EMPTY_TOOL_STREAMING_STATE),
);

export const appendToolStreamingChunkAtom = atom(
  null,
  (
    get,
    set,
    payload: { sessionId: string | null | undefined; toolCallId: string; chunk: string },
  ) => {
    const streamKey = buildToolStreamingKey(payload.sessionId, payload.toolCallId);
    if (!streamKey) return;
    const chunk = payload.chunk ?? "";
    if (!chunk) return;

    activeStreamingKeys.add(streamKey);
    const targetAtom = toolStreamingAtomFamily(streamKey);
    const prev = get(targetAtom);
    set(targetAtom, {
      output: prev.output + chunk,
      status: "running",
      updatedAt: Date.now(),
    });
  },
);

export const setToolStreamingStatusAtom = atom(
  null,
  (
    get,
    set,
    payload: {
      sessionId: string | null | undefined;
      toolCallId: string;
      status: ToolStreamingStatus;
    },
  ) => {
    const streamKey = buildToolStreamingKey(payload.sessionId, payload.toolCallId);
    if (!streamKey) return;

    activeStreamingKeys.add(streamKey);
    const targetAtom = toolStreamingAtomFamily(streamKey);
    const prev = get(targetAtom);
    set(targetAtom, {
      ...prev,
      status: payload.status,
      updatedAt: Date.now(),
    });
  },
);

export const clearToolStreamingState = (
  sessionId: string | null | undefined,
  toolCallId: string | null | undefined,
): void => {
  clearKeyedStreamingState(
    toolStreamingStore,
    toolStreamingAtomFamily,
    buildToolStreamingKey(sessionId, toolCallId),
    EMPTY_TOOL_STREAMING_STATE,
    activeStreamingKeys,
  );
};

export const clearToolStreamingStatesForSession = (sessionId: string | null | undefined): void => {
  const normalizedSessionId = normalizeStreamingKeyPart(sessionId);
  if (!normalizedSessionId) return;
  clearKeyedStreamingStatesByPrefix(
    toolStreamingStore,
    toolStreamingAtomFamily,
    activeStreamingKeys,
    `${normalizedSessionId}::`,
    EMPTY_TOOL_STREAMING_STATE,
  );
};

export const appendToolStreamingChunk = (
  sessionId: string | null | undefined,
  toolCallId: string,
  chunk: string,
): void => {
  toolStreamingStore.set(appendToolStreamingChunkAtom, { sessionId, toolCallId, chunk });
};

export const setToolStreamingStatus = (
  sessionId: string | null | undefined,
  toolCallId: string,
  status: ToolStreamingStatus,
): void => {
  toolStreamingStore.set(setToolStreamingStatusAtom, { sessionId, toolCallId, status });
};

export const getToolStreamingState = (
  sessionId: string | null | undefined,
  toolCallId: string | null | undefined,
): ToolStreamingState => {
  return getKeyedStreamingState(
    toolStreamingStore,
    toolStreamingAtomFamily,
    buildToolStreamingKey(sessionId, toolCallId),
    EMPTY_TOOL_STREAMING_STATE,
  );
};
