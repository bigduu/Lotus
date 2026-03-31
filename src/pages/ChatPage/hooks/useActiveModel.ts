import { useMemo } from "react";
import { useProviderStore } from "../store/slices/providerSlice";
import { selectSessionById, useAppStore } from "../store";

/**
 * Hook to get the active model for the current session.
 *
 * Priority:
 * 1. current session config model
 * 2. current provider default model
 *
 * This keeps session-level model selection authoritative while preserving
 * provider defaults for brand-new or not-yet-persisted sessions.
 *
 * @returns The active model for the current session, or provider default fallback
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
export function useActiveModel(sessionId?: string | null): string | undefined {
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const providerConfig = useProviderStore((state) => state.providerConfig);
  const currentChat = useAppStore(selectSessionById(sessionId ?? null));

  const activeModel = useMemo(() => {
    const sessionModel = sessionId ? currentChat?.config?.model?.trim() : undefined;
    if (sessionModel) {
      return sessionModel;
    }

    const config = providerConfig.providers[currentProvider];
    if (!config) {
      return undefined;
    }

    if ("model" in config && config.model) {
      return config.model;
    }

    return undefined;
  }, [currentChat, currentProvider, providerConfig]);

  return activeModel;
}

/**
 * Hook to get both the active model and provider info
 *
 * @returns Object containing activeModel, currentProvider, and providerConfig
 */
export function useActiveModelInfo(sessionId?: string | null) {
  const activeModel = useActiveModel(sessionId);
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
export function useFastModel(sessionId?: string | null): string | undefined {
  const activeModel = useActiveModel(sessionId);
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
export function useVisionModel(sessionId?: string | null): string | undefined {
  const activeModel = useActiveModel(sessionId);
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
