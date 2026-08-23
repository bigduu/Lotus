import {
  useCallback,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from "react";

import type { WorkspaceFileEntry } from "@shared/types/workspace";
import { cleanupImagePreviews, type ImageFile } from "../../utils/imageUtils";
import type { ProcessedFile } from "../../utils/fileUtils";
import type { WorkflowDraft } from "./types";

export interface SessionComposerDraft {
  workflowDraft: WorkflowDraft | null;
  attachments: ProcessedFile[];
  images: ImageFile[];
  fileReferences: Map<string, WorkspaceFileEntry>;
}

type DraftListener = () => void;

const EMPTY_SESSION_COMPOSER_DRAFT: SessionComposerDraft = {
  workflowDraft: null,
  attachments: [],
  images: [],
  fileReferences: new Map(),
};

const draftsBySession = new Map<string, SessionComposerDraft>();
const listeners = new Set<DraftListener>();

const notifyListeners = (): void => {
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: DraftListener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const snapshotForSession = (sessionId: string | null): SessionComposerDraft =>
  sessionId
    ? (draftsBySession.get(sessionId) ?? EMPTY_SESSION_COMPOSER_DRAFT)
    : EMPTY_SESSION_COMPOSER_DRAFT;

const updateSessionDraft = (
  sessionId: string,
  update: (current: SessionComposerDraft) => SessionComposerDraft,
): void => {
  const current = snapshotForSession(sessionId);
  const next = update(current);
  if (next === current) return;
  draftsBySession.set(sessionId, next);
  notifyListeners();
};

const resolveStateUpdate = <T>(next: SetStateAction<T>, current: T): T =>
  typeof next === "function" ? (next as (previous: T) => T)(current) : next;

const updateField = <K extends keyof SessionComposerDraft>(
  current: SessionComposerDraft,
  field: K,
  next: SetStateAction<SessionComposerDraft[K]>,
): SessionComposerDraft => {
  const resolved = resolveStateUpdate(next, current[field]);
  return Object.is(resolved, current[field]) ? current : { ...current, [field]: resolved };
};

export interface SessionComposerDraftController extends SessionComposerDraft {
  setWorkflowDraft: Dispatch<SetStateAction<WorkflowDraft | null>>;
  setAttachments: Dispatch<SetStateAction<ProcessedFile[]>>;
  setImages: Dispatch<SetStateAction<ImageFile[]>>;
  clearImages: (imageIds?: readonly string[]) => void;
  setFileReferences: Dispatch<SetStateAction<Map<string, WorkspaceFileEntry>>>;
}

/**
 * Keeps non-persisted composer objects scoped to their originating session.
 *
 * Text and quoted-reference text already live in the app store. Workflow
 * selections, processed files, image preview ownership, and resolved file
 * references cannot be serialized safely, but they still need to survive pane
 * remounts and must never flow from one session into another. This in-memory
 * external store provides that boundary without persisting private draft data.
 */
export const useSessionComposerDraft = (
  sessionId: string | null,
): SessionComposerDraftController => {
  const getSnapshot = useCallback(() => snapshotForSession(sessionId), [sessionId]);
  const storedDraft = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => EMPTY_SESSION_COMPOSER_DRAFT,
  );
  const [detachedDraft, setDetachedDraft] = useState<SessionComposerDraft>(() => ({
    ...EMPTY_SESSION_COMPOSER_DRAFT,
    fileReferences: new Map(),
  }));
  const draft = sessionId ? storedDraft : detachedDraft;

  const setField = useCallback(
    <K extends keyof SessionComposerDraft>(
      field: K,
      next: SetStateAction<SessionComposerDraft[K]>,
    ): void => {
      if (sessionId) {
        updateSessionDraft(sessionId, (current) => updateField(current, field, next));
        return;
      }
      setDetachedDraft((current) => updateField(current, field, next));
    },
    [sessionId],
  );

  const setWorkflowDraft = useCallback<Dispatch<SetStateAction<WorkflowDraft | null>>>(
    (next) => setField("workflowDraft", next),
    [setField],
  );
  const setAttachments = useCallback<Dispatch<SetStateAction<ProcessedFile[]>>>(
    (next) => setField("attachments", next),
    [setField],
  );
  const setImages = useCallback<Dispatch<SetStateAction<ImageFile[]>>>(
    (next) => setField("images", next),
    [setField],
  );
  const setFileReferences = useCallback<Dispatch<SetStateAction<Map<string, WorkspaceFileEntry>>>>(
    (next) => setField("fileReferences", next),
    [setField],
  );

  const clearImages = useCallback(
    (imageIds?: readonly string[]) => {
      const clearFromDraft = (current: SessionComposerDraft): SessionComposerDraft => {
        const selectedIds = imageIds ? new Set(imageIds) : null;
        const imagesToClear = selectedIds
          ? current.images.filter((image) => selectedIds.has(image.id))
          : current.images;
        if (imagesToClear.length === 0) return current;

        const imagesToKeep = selectedIds
          ? current.images.filter((image) => !selectedIds.has(image.id))
          : [];
        cleanupImagePreviews(imagesToClear);
        return { ...current, images: imagesToKeep };
      };

      if (sessionId) {
        updateSessionDraft(sessionId, clearFromDraft);
        return;
      }
      setDetachedDraft(clearFromDraft);
    },
    [sessionId],
  );

  return {
    ...draft,
    setWorkflowDraft,
    setAttachments,
    setImages,
    clearImages,
    setFileReferences,
  };
};

export const getSessionComposerDraftSnapshotForTests = (sessionId: string): SessionComposerDraft =>
  snapshotForSession(sessionId);

export const resetSessionComposerDraftStoreForTests = (): void => {
  draftsBySession.forEach((draft) => cleanupImagePreviews(draft.images));
  draftsBySession.clear();
  notifyListeners();
};
