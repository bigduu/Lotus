import { useMemo } from "react";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import type { ProviderModelRef } from "@shared/types/providerModelRef";

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
  const providerDefaults = useProviderStore((s) => s.providerConfig.defaults);

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

    // 3. Unified provider defaults
    return providerDefaults?.chat?.model?.trim() ? providerDefaults.chat : null;
  }, [sessionModelRef, selectedModelRef, providerDefaults, isProviderModelRefEnabled]);
}

/** Returns the fast/cheap model as ProviderModelRef when the flag is ON. */
export function useFastModelRef(): ProviderModelRef | null {
  const providerDefaults = useProviderStore((s) => s.providerConfig.defaults);

  return useMemo(() => {
    const fastModelRef = providerDefaults?.fast;
    if (fastModelRef?.model?.trim()) {
      return fastModelRef;
    }

    const chatModelRef = providerDefaults?.chat;
    return chatModelRef?.model?.trim() ? chatModelRef : null;
  }, [providerDefaults]);
}

/** Returns the vision-capable model as ProviderModelRef when the flag is ON. */
export function useVisionModelRef(): ProviderModelRef | null {
  const getVisionModelRef = useProviderStore((s) => s.getVisionModelRef);
  return useMemo(() => getVisionModelRef(), [getVisionModelRef]);
}
