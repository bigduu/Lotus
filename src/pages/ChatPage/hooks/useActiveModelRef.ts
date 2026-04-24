import { useMemo } from "react";
import { useProviderStore } from "../store/slices/providerSlice";
import type { ProviderModelRef } from "../types/providerModelRef";

/**
 * Returns the active ProviderModelRef when the feature flag is enabled.
 *
 * Priority:
 * 1. session-specific model_ref (passed in, if available)
 * 2. store-level selectedModelRef
 * 3. construct from currentProvider + activeModel
 *
 * When the flag is OFF, returns null.
 */
export function useActiveModelRef(
  sessionModelRef?: ProviderModelRef | null,
): ProviderModelRef | null {
  const isProviderModelRefEnabled = useProviderStore((s) => s.isProviderModelRefEnabled);
  const selectedModelRef = useProviderStore((s) => s.selectedModelRef);
  const currentProvider = useProviderStore((s) => s.currentProvider);
  const getActiveModel = useProviderStore((s) => s.getActiveModel);

  return useMemo(() => {
    if (!isProviderModelRefEnabled()) {
      return null;
    }

    // 1. Session-specific override
    if (sessionModelRef) {
      return sessionModelRef;
    }

    // 2. Store-level selection
    if (selectedModelRef) {
      return selectedModelRef;
    }

    // 3. Construct from current provider + active model
    const model = getActiveModel();
    if (model) {
      return { provider: currentProvider, model };
    }

    return null;
  }, [
    sessionModelRef,
    selectedModelRef,
    currentProvider,
    isProviderModelRefEnabled,
    getActiveModel,
  ]);
}

/** Returns the fast/cheap model as ProviderModelRef when the flag is ON. */
export function useFastModelRef(): ProviderModelRef | null {
  const getFastModelRef = useProviderStore((s) => s.getFastModelRef);
  return useMemo(() => getFastModelRef(), [getFastModelRef]);
}

/** Returns the vision-capable model as ProviderModelRef when the flag is ON. */
export function useVisionModelRef(): ProviderModelRef | null {
  const getVisionModelRef = useProviderStore((s) => s.getVisionModelRef);
  return useMemo(() => getVisionModelRef(), [getVisionModelRef]);
}
