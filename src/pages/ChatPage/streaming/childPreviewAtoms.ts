import { atom } from "jotai";

import {
  buildStreamingCompositeKey,
  createStreamingAtomModule,
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

const childPreviewModule = createStreamingAtomModule<ChildPreviewState>(EMPTY_CHILD_PREVIEW_STATE);

export const childPreviewStore = childPreviewModule.store;
export const childPreviewAtomFamily = childPreviewModule.atomFamily;

export const buildChildPreviewKey = (
  parentSessionId: string | null | undefined,
  childSessionId: string | null | undefined,
): string => {
  return buildStreamingCompositeKey(parentSessionId, childSessionId);
};

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

    childPreviewModule.activeKeys.add(previewKey);
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
  childPreviewModule.clearState(buildChildPreviewKey(parentSessionId, childSessionId));
};

export const clearChildPreviewStatesForParent = (
  parentSessionId: string | null | undefined,
): void => {
  const normalizedParentSessionId = normalizeStreamingKeyPart(parentSessionId);
  if (!normalizedParentSessionId) return;
  childPreviewModule.clearStatesByPrefix(`${normalizedParentSessionId}::`);
};

export const getChildPreviewState = (
  parentSessionId: string | null | undefined,
  childSessionId: string | null | undefined,
): ChildPreviewState => {
  return childPreviewModule.getState(buildChildPreviewKey(parentSessionId, childSessionId));
};
