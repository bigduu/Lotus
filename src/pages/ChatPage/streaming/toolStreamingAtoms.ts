import { atom } from "jotai";

import {
  buildStreamingCompositeKey,
  createStreamingAtomModule,
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

const toolModule = createStreamingAtomModule<ToolStreamingState>(EMPTY_TOOL_STREAMING_STATE);

export const toolStreamingStore = toolModule.store;
export const toolStreamingAtomFamily = toolModule.atomFamily;

export const buildToolStreamingKey = (
  sessionId: string | null | undefined,
  toolCallId: string | null | undefined,
): string => {
  return buildStreamingCompositeKey(sessionId, toolCallId);
};

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

    toolModule.activeKeys.add(streamKey);
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

    toolModule.activeKeys.add(streamKey);
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
  toolModule.clearState(buildToolStreamingKey(sessionId, toolCallId));
};

export const clearToolStreamingStatesForSession = (sessionId: string | null | undefined): void => {
  const normalizedSessionId = normalizeStreamingKeyPart(sessionId);
  if (!normalizedSessionId) return;
  toolModule.clearStatesByPrefix(`${normalizedSessionId}::`);
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
  return toolModule.getState(buildToolStreamingKey(sessionId, toolCallId));
};
