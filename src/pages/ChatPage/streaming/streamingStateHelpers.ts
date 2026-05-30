import { atom, type PrimitiveAtom } from "jotai";
import { atomFamily } from "jotai-family";
import { createStore } from "jotai/vanilla";

export type AtomStore = ReturnType<typeof createStore>;

export type KeyedAtomFamily<T> = {
  (key: string): PrimitiveAtom<T>;
  remove: (key: string) => void;
};

export const normalizeStreamingKeyPart = (value: string | null | undefined): string =>
  (value ?? "").trim();

export const buildStreamingCompositeKey = (...parts: Array<string | null | undefined>): string => {
  const normalizedParts = parts.map(normalizeStreamingKeyPart);
  if (normalizedParts.some((part) => !part)) {
    return "";
  }
  return normalizedParts.join("::");
};

export const getKeyedStreamingState = <T>(
  store: AtomStore,
  atomFamily: (key: string) => PrimitiveAtom<T>,
  key: string,
  emptyState: T,
): T => {
  if (!key) return emptyState;
  return store.get(atomFamily(key));
};

export const clearKeyedStreamingState = <T>(
  store: AtomStore,
  atomFamily: KeyedAtomFamily<T>,
  key: string,
  emptyState: T,
  activeKeys?: Set<string>,
): void => {
  if (!key) return;
  store.set(atomFamily(key), emptyState);
  atomFamily.remove(key);
  activeKeys?.delete(key);
};

export const clearKeyedStreamingStatesByPrefix = <T>(
  store: AtomStore,
  atomFamily: KeyedAtomFamily<T>,
  activeKeys: Set<string>,
  prefix: string,
  emptyState: T,
): void => {
  if (!prefix) return;
  Array.from(activeKeys).forEach((key) => {
    if (!key.startsWith(prefix)) return;
    clearKeyedStreamingState(store, atomFamily, key, emptyState, activeKeys);
  });
};

export interface StreamingAtomModule<T> {
  store: AtomStore;
  atomFamily: KeyedAtomFamily<T>;
  /** Keys that have received at least one write; used for prefix clears. */
  activeKeys: Set<string>;
  getState: (key: string) => T;
  clearState: (key: string) => void;
  clearStatesByPrefix: (prefix: string) => void;
}

/**
 * Build a keyed streaming-state module: a vanilla jotai store, an atomFamily
 * seeded with `emptyState`, an active-key registry, and read/clear helpers
 * bound to all three. Callers layer on their own write atoms (which should
 * `activeKeys.add(key)` on write) and key builders.
 */
export const createStreamingAtomModule = <T>(emptyState: T): StreamingAtomModule<T> => {
  const store = createStore();
  const family: KeyedAtomFamily<T> = atomFamily((_key: string) => atom<T>(emptyState));
  const activeKeys = new Set<string>();
  return {
    store,
    atomFamily: family,
    activeKeys,
    getState: (key) => getKeyedStreamingState(store, family, key, emptyState),
    clearState: (key) => clearKeyedStreamingState(store, family, key, emptyState, activeKeys),
    clearStatesByPrefix: (prefix) =>
      clearKeyedStreamingStatesByPrefix(store, family, activeKeys, prefix, emptyState),
  };
};
