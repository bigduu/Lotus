import {
  buildChildPreviewKey,
  childPreviewAtomFamily,
  childPreviewStore,
  EMPTY_CHILD_PREVIEW_STATE,
  type ChildPreviewState,
} from "./childPreviewAtoms";
import { useKeyedRafAtomState } from "./useKeyedRafAtomState";

export const useChildPreviewState = (
  parentSessionId: string | null | undefined,
  childSessionId: string | null | undefined,
): ChildPreviewState => {
  const previewKey = buildChildPreviewKey(parentSessionId, childSessionId);

  return useKeyedRafAtomState({
    key: previewKey,
    atomFamily: childPreviewAtomFamily,
    store: childPreviewStore,
    emptyState: EMPTY_CHILD_PREVIEW_STATE,
  });
};

export const getMergedChildPreview = (
  liveState: ChildPreviewState,
  fallbackPreview?: string,
): string => {
  return liveState.outputPreview || fallbackPreview || "";
};

export { EMPTY_CHILD_PREVIEW_STATE };
