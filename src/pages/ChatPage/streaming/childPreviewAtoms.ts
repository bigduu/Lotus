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

export interface ChildPreviewState {
  outputPreview: string;
  updatedAt: number;
}

export const EMPTY_CHILD_PREVIEW_STATE: ChildPreviewState = {
  outputPreview: "",
  updatedAt: 0,
};

export const childPreviewStore = createStore();

export const buildChildPreviewKey = (
  parentSessionId: string | null | undefined,
  childSessionId: string | null | undefined,
): string => {
  return buildStreamingCompositeKey(parentSessionId, childSessionId);
};

const activeChildPreviewKeys = new Set<string>();

export const childPreviewAtomFamily = atomFamily((_previewKey: string) =>
  atom<ChildPreviewState>(EMPTY_CHILD_PREVIEW_STATE),
);

export const setChildPreviewStateAtom = atom(
  null,
  (
    get,
    set,
    payload: {
      parentSessionId: string | null | undefined;
      childSessionId: string | null | undefined;
      outputPreview: string;
    },
  ) => {
    const previewKey = buildChildPreviewKey(payload.parentSessionId, payload.childSessionId);
    if (!previewKey) return;

    activeChildPreviewKeys.add(previewKey);
    const targetAtom = childPreviewAtomFamily(previewKey);
    const prev = get(targetAtom);
    set(targetAtom, {
      ...prev,
      outputPreview: payload.outputPreview,
      updatedAt: Date.now(),
    });
  },
);

export const setChildPreviewState = (
  parentSessionId: string | null | undefined,
  childSessionId: string | null | undefined,
  outputPreview: string,
): void => {
  childPreviewStore.set(setChildPreviewStateAtom, {
    parentSessionId,
    childSessionId,
    outputPreview,
  });
};

export const clearChildPreviewState = (
  parentSessionId: string | null | undefined,
  childSessionId: string | null | undefined,
): void => {
  clearKeyedStreamingState(
    childPreviewStore,
    childPreviewAtomFamily,
    buildChildPreviewKey(parentSessionId, childSessionId),
    EMPTY_CHILD_PREVIEW_STATE,
    activeChildPreviewKeys,
  );
};

export const clearChildPreviewStatesForParent = (
  parentSessionId: string | null | undefined,
): void => {
  const normalizedParentSessionId = normalizeStreamingKeyPart(parentSessionId);
  if (!normalizedParentSessionId) return;
  clearKeyedStreamingStatesByPrefix(
    childPreviewStore,
    childPreviewAtomFamily,
    activeChildPreviewKeys,
    `${normalizedParentSessionId}::`,
    EMPTY_CHILD_PREVIEW_STATE,
  );
};

export const getChildPreviewState = (
  parentSessionId: string | null | undefined,
  childSessionId: string | null | undefined,
): ChildPreviewState => {
  return getKeyedStreamingState(
    childPreviewStore,
    childPreviewAtomFamily,
    buildChildPreviewKey(parentSessionId, childSessionId),
    EMPTY_CHILD_PREVIEW_STATE,
  );
};
