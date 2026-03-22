import { useMemo } from "react";
import { useProviderStore } from "../store/slices/providerSlice";

/**
 * Hook to get the active model for the current provider
 *
 * This is the single source of truth for getting the current model
 * in the application. It reads from the provider configuration, not
 * from a global model setting.
 *
 * @returns The active model for the current provider, or undefined if not set
 *
 * @example
 * ```ts
 * const activeModel = useActiveModel();
 *
 * // Use in API calls
 * await client.chat.completions.create({
 *   model: activeModel || 'default',
 *   ...
 * });
 * ```
 */
export function useActiveModel(): string | undefined {
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const providerConfig = useProviderStore((state) => state.providerConfig);

  const activeModel = useMemo(() => {
    const config = providerConfig.providers[currentProvider];

    if (!config) {
      return undefined;
    }

    // Return the model if it exists
    if ("model" in config && config.model) {
      return config.model;
    }

    return undefined;
  }, [currentProvider, providerConfig]);

  return activeModel;
}

/**
 * Hook to get both the active model and provider info
 *
 * @returns Object containing activeModel, currentProvider, and providerConfig
 */
export function useActiveModelInfo() {
  const activeModel = useActiveModel();
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const providerConfig = useProviderStore((state) => state.providerConfig);

  return useMemo(
    () => ({
      activeModel,
      currentProvider,
      providerConfig,
    }),
    [activeModel, currentProvider, providerConfig],
  );
}

/**
 * Hook to get the fast/cheap model for the current provider.
 *
 * Used for lightweight tasks like title generation, mermaid syntax fix, etc.
 * Falls back to the active model when no fast_model is configured.
 *
 * @returns The fast model for the current provider, or activeModel as fallback
 */
export function useFastModel(): string | undefined {
  const activeModel = useActiveModel();
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const providerConfig = useProviderStore((state) => state.providerConfig);

  return useMemo(() => {
    const config = providerConfig.providers[currentProvider];

    if (config && "fast_model" in config && config.fast_model) {
      return config.fast_model;
    }

    // Fallback to active model
    return activeModel;
  }, [currentProvider, providerConfig, activeModel]);
}

/**
 * Hook to get the vision-capable model for the current provider.
 *
 * Used for image understanding tasks.
 * Falls back to the active model when no vision_model is configured.
 *
 * @returns The vision model for the current provider, or activeModel as fallback
 */
export function useVisionModel(): string | undefined {
  const activeModel = useActiveModel();
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const providerConfig = useProviderStore((state) => state.providerConfig);

  return useMemo(() => {
    const config = providerConfig.providers[currentProvider];

    if (config && "vision_model" in config && config.vision_model) {
      return config.vision_model;
    }

    // Fallback to active model
    return activeModel;
  }, [currentProvider, providerConfig, activeModel]);
}
