import type { PrimitiveAtom } from "jotai";
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
