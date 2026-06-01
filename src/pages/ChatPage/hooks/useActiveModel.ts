import { useMemo } from "react";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import { selectSessionById, useAppStore } from "@shared/store/appStore";

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
  const providerConfig = useProviderStore((state) => state.providerConfig);
  const currentChat = useAppStore(selectSessionById(sessionId ?? null));

  const activeModel = useMemo(() => {
    const sessionModelRef = sessionId ? currentChat?.config?.model_ref : undefined;
    const sessionModelRefModel = sessionModelRef?.model?.trim();
    if (sessionModelRefModel) {
      return sessionModelRefModel;
    }

    const sessionModel = sessionId ? currentChat?.config?.model?.trim() : undefined;
    if (sessionModel && sessionModel !== "unknown") {
      return sessionModel;
    }

    const defaultModel = providerConfig.defaults?.chat?.model?.trim();
    return defaultModel || undefined;
  }, [currentChat, providerConfig, sessionId]);

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
  const providerConfig = useProviderStore((state) => state.providerConfig);

  return useMemo(() => {
    const defaultModel = providerConfig.defaults?.fast?.model?.trim();
    return defaultModel || activeModel;
  }, [providerConfig, activeModel]);
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
  const providerConfig = useProviderStore((state) => state.providerConfig);

  return useMemo(() => {
    const defaultModel = providerConfig.defaults?.vision?.model?.trim();
    return defaultModel || activeModel;
  }, [providerConfig, activeModel]);
}
