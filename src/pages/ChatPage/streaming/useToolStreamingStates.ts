import { useMemo } from "react";

import { atom } from "jotai";
import { useAtomValue } from "jotai/react";

import {
  buildToolStreamingKey,
  toolStreamingAtomFamily,
  toolStreamingStore,
  type ToolStreamingState,
} from "./toolStreamingAtoms";
import { normalizeStreamingKeyPart } from "./streamingStateHelpers";

export type ToolStreamingStateMap = Record<string, ToolStreamingState>;

const normalizeIds = (toolCallIds: readonly string[]): string[] =>
  Array.from(
    new Set(toolCallIds.map((id) => normalizeStreamingKeyPart(id)).filter(Boolean)),
  ).sort();

export const useToolStreamingStates = (
  sessionId: string | null | undefined,
  toolCallIds: readonly string[],
): ToolStreamingStateMap => {
  const normalizedSessionId = normalizeStreamingKeyPart(sessionId);
  const normalizedIds = useMemo(() => normalizeIds(toolCallIds), [toolCallIds]);

  const combinedAtom = useMemo(
    () =>
      atom<ToolStreamingStateMap>((get) => {
        const snapshot: ToolStreamingStateMap = {};
        if (!normalizedSessionId) {
          return snapshot;
        }
        normalizedIds.forEach((toolCallId) => {
          const streamKey = buildToolStreamingKey(normalizedSessionId, toolCallId);
          if (!streamKey) return;
          snapshot[toolCallId] = get(toolStreamingAtomFamily(streamKey));
        });
        return snapshot;
      }),
    [normalizedSessionId, normalizedIds],
  );

  return useAtomValue(combinedAtom, { store: toolStreamingStore });
};

export const getMergedToolStreamingOutput = (
  toolCallId: string,
  liveStateMap: ToolStreamingStateMap,
  fallbackOutput?: string,
): string => {
  const normalized = normalizeStreamingKeyPart(toolCallId);
  const liveOutput = normalized ? (liveStateMap[normalized]?.output ?? "") : "";
  return liveOutput || fallbackOutput || "";
};

export const isToolStreamingLive = (
  toolCallId: string,
  liveStateMap: ToolStreamingStateMap,
): boolean => {
  const normalized = normalizeStreamingKeyPart(toolCallId);
  if (!normalized) return false;
  return liveStateMap[normalized]?.status === "running";
};
