import { useEffect, useMemo, useState } from "react";

import type { PrimitiveAtom } from "jotai";

import { getKeyedStreamingState, type AtomStore } from "./streamingStateHelpers";

interface UseKeyedRafAtomStateOptions<T> {
  key: string;
  atomFamily: (key: string) => PrimitiveAtom<T>;
  store: AtomStore;
  emptyState: T;
}

export const useKeyedRafAtomState = <T>({
  key,
  atomFamily,
  store,
  emptyState,
}: UseKeyedRafAtomStateOptions<T>): T => {
  const stateAtom = useMemo(() => (key ? atomFamily(key) : null), [atomFamily, key]);
  const [snapshot, setSnapshot] = useState<T>(() =>
    getKeyedStreamingState(store, atomFamily, key, emptyState),
  );

  useEffect(() => {
    setSnapshot(getKeyedStreamingState(store, atomFamily, key, emptyState));

    if (!stateAtom || !key) {
      return;
    }

    let animationFrameId: number | null = null;
    let latestState = store.get(stateAtom);

    const unsubscribe = store.sub(stateAtom, () => {
      latestState = store.get(stateAtom);
      if (animationFrameId !== null) {
        return;
      }
      animationFrameId = requestAnimationFrame(() => {
        setSnapshot(latestState);
        animationFrameId = null;
      });
    });

    return () => {
      unsubscribe();
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [atomFamily, emptyState, key, stateAtom, store]);

  return snapshot;
};
