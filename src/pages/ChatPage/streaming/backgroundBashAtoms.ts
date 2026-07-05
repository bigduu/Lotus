import { useMemo } from "react";

import { atom } from "jotai";
import { useAtomValue } from "jotai/react";

import { createStreamingAtomModule, normalizeStreamingKeyPart } from "./streamingStateHelpers";

/**
 * Reactive completion store for background/async shell tools, keyed by
 * `bash_id`. A tool card that already rendered a "Running in background…" state
 * flips automatically when the matching `bash_completed` stream event lands and
 * calls {@link setBashCompleted}. Independent from tool-call-id streaming state
 * because the completion arrives on a distinct event carrying only the bash id.
 */
export type BackgroundBashStatus = "completed" | "killed" | "error";

export interface BackgroundBashDone {
  status: BackgroundBashStatus;
  /** Null for signal/killed termination (no exit code). */
  exitCode: number | null;
  updatedAt: number;
}

export type BackgroundBashStatusMap = Record<string, BackgroundBashDone | null>;

const EMPTY_BACKGROUND_BASH_STATE: BackgroundBashDone | null = null;

const backgroundBashModule = createStreamingAtomModule<BackgroundBashDone | null>(
  EMPTY_BACKGROUND_BASH_STATE,
);

export const backgroundBashStore = backgroundBashModule.store;
export const backgroundBashAtomFamily = backgroundBashModule.atomFamily;

const normalizeBashStatus = (status: string): BackgroundBashStatus => {
  if (status === "killed") return "killed";
  if (status === "error") return "error";
  return "completed";
};

export const setBashCompletedAtom = atom(
  null,
  (_get, set, payload: { bashId: string; status: string; exitCode: number | null }) => {
    const key = normalizeStreamingKeyPart(payload.bashId);
    if (!key) return;

    backgroundBashModule.activeKeys.add(key);
    set(backgroundBashAtomFamily(key), {
      status: normalizeBashStatus(payload.status),
      exitCode: payload.exitCode,
      updatedAt: Date.now(),
    });
  },
);

/** Record a background shell completion. Called from the `onBashCompleted` handler. */
export const setBashCompleted = (
  bashId: string,
  status: string,
  exitCode: number | null,
): void => {
  backgroundBashStore.set(setBashCompletedAtom, { bashId, status, exitCode });
};

export const clearBackgroundBashState = (bashId: string | null | undefined): void => {
  backgroundBashModule.clearState(normalizeStreamingKeyPart(bashId));
};

/**
 * Imperative check: has this shell's completion already been recorded? Used to
 * dedup the completion toast/desktop notification, since `bash_completed` is a
 * cached CRITICAL event that is replayed to every (re)subscriber on reconnect —
 * the card flip via {@link setBashCompleted} is idempotent, but the user-facing
 * ping must fire exactly once.
 */
export const hasBackgroundBashDone = (bashId: string | null | undefined): boolean => {
  const key = normalizeStreamingKeyPart(bashId);
  if (!key) return false;
  return backgroundBashStore.get(backgroundBashAtomFamily(key)) != null;
};

/** Reactive read of a single background shell's completion (or `null` while running). */
export const useBackgroundBashStatus = (
  bashId: string | null | undefined,
): BackgroundBashDone | null => {
  const key = normalizeStreamingKeyPart(bashId);
  const targetAtom = useMemo(
    () => atom((get) => (key ? get(backgroundBashAtomFamily(key)) : null)),
    [key],
  );
  return useAtomValue(targetAtom, { store: backgroundBashStore });
};

/**
 * Reactive read of many background shells at once, keyed by normalized bash id.
 * Mirrors {@link useToolStreamingStates} so a tool-steps card can subscribe to
 * every background shell it renders in a single hook.
 */
export const useBackgroundBashStatuses = (
  bashIds: readonly string[],
): BackgroundBashStatusMap => {
  const normalizedIds = useMemo(
    () =>
      Array.from(new Set(bashIds.map((id) => normalizeStreamingKeyPart(id)).filter(Boolean))).sort(),
    [bashIds],
  );

  const combinedAtom = useMemo(
    () =>
      atom<BackgroundBashStatusMap>((get) => {
        const snapshot: BackgroundBashStatusMap = {};
        normalizedIds.forEach((id) => {
          snapshot[id] = get(backgroundBashAtomFamily(id));
        });
        return snapshot;
      }),
    [normalizedIds],
  );

  return useAtomValue(combinedAtom, { store: backgroundBashStore });
};

export const getBackgroundBashDone = (
  bashId: string | null | undefined,
  statusMap: BackgroundBashStatusMap,
): BackgroundBashDone | null => {
  const normalized = normalizeStreamingKeyPart(bashId);
  if (!normalized) return null;
  return statusMap[normalized] ?? null;
};
