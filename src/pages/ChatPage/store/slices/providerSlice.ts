import { create } from "zustand";
import { settingsService } from "@services/config/SettingsService";
import type { ProviderConfig, ProviderType } from "../../types/providerConfig";
import type {
  ProviderModelRef,
  ProviderCatalog,
  ProviderModelDescriptor,
} from "../../types/providerModelRef";

/**
 * Provider State
 *
 * Manages the current active provider and its configuration.
 * This is the single source of truth for provider-related state.
 */
interface ProviderState {
  // Current active provider
  currentProvider: ProviderType;

  // Full provider configuration loaded from backend
  providerConfig: ProviderConfig;

  // Loading state
  isLoading: boolean;

  // Error state
  error: string | null;

  // ProviderModelRef system
  /** User-selected model ref (set via ProviderModelPicker) */
  selectedModelRef: ProviderModelRef | null;
  /** Cached provider catalog for model picker */
  catalog: ProviderCatalog | null;
  /** Whether a catalog fetch is in progress */
  isCatalogFetching: boolean;

  // Actions
  loadProviderConfig: () => Promise<void>;
  setCurrentProvider: (provider: ProviderType) => void;
  updateProviderConfig: (config: Partial<ProviderConfig>) => void;
  setSelectedModelRef: (ref: ProviderModelRef | null) => void;
  loadCatalog: () => Promise<void>;
  /** Fetch models from one or all providers, then reload catalog. */
  fetchCatalogModels: (provider?: string) => Promise<void>;

  // Getters
  getActiveModel: () => string | undefined;
  /** Get fast/cheap model for current provider. Falls back to active model. */
  getFastModel: () => string | undefined;
  /** Get vision-capable model for current provider. Falls back to active model. */
  getVisionModel: () => string | undefined;
  /** Always returns true — catalog mode is always enabled. */
  isProviderModelRefEnabled: () => boolean;
  /** Get fast model as ProviderModelRef. */
  getFastModelRef: () => ProviderModelRef | null;
  /** Get vision model as ProviderModelRef. */
  getVisionModelRef: () => ProviderModelRef | null;
  /** Get models from catalog filtered by provider name. */
  getModelsForProvider: (providerName: string) => ProviderModelDescriptor[];
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  // Initial state
  currentProvider: "copilot",
  providerConfig: {
    provider: "copilot",
    defaults: undefined,
    providers: {},
  },
  isLoading: false,
  error: null,
  selectedModelRef: null,
  catalog: null,
  isCatalogFetching: false,

  // Load provider configuration from backend
  loadProviderConfig: async () => {
    set({ isLoading: true, error: null });
    try {
      const config = await settingsService.getProviderConfig();

      // Build defaults from providers.{provider}.model if defaults is missing
      // (backward compatibility with backend that stores model in providers).
      if (!config.defaults?.chat?.model && config.provider && config.providers) {
        const providerName = config.provider;
        const providerCfg = config.providers[providerName as keyof typeof config.providers];
        const legacyModel = (providerCfg as Record<string, unknown> | undefined)?.model as string | undefined;
        if (legacyModel) {
          config.defaults = {
            chat: {
              provider: providerName,
              model: legacyModel,
            },
          };
        }
      }

      set({
        providerConfig: config,
        currentProvider: config.provider as ProviderType,
        isLoading: false,
      });
    } catch (error) {
      console.error("Failed to load provider config:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to load provider config",
        isLoading: false,
      });
    }
  },

  // Set current provider
  setCurrentProvider: (provider: ProviderType) => {
    set({ currentProvider: provider });
  },

  // Update provider configuration
  updateProviderConfig: (config: Partial<ProviderConfig>) => {
    set((state) => ({
      providerConfig: {
        ...state.providerConfig,
        ...config,
      },
    }));
  },

  // Get the active model for current provider
  getActiveModel: () => {
    const state = get();
    const model = state.providerConfig.defaults?.chat?.model?.trim();
    return model || undefined;
  },

  // Get fast/cheap model for current provider (falls back to active model)
  getFastModel: () => {
    const state = get();
    const model = state.providerConfig.defaults?.fast?.model?.trim();
    return model || state.getActiveModel();
  },

  // Get vision-capable model for current provider (falls back to active model)
  getVisionModel: () => {
    const state = get();
    const model = state.providerConfig.defaults?.vision?.model?.trim();
    return model || state.getActiveModel();
  },

  // Feature flag check — always enabled now
  isProviderModelRefEnabled: () => true,

  // Set selected model ref
  setSelectedModelRef: (ref) => {
    set({ selectedModelRef: ref });
  },

  // Load provider catalog from backend
  loadCatalog: async () => {
    try {
      const catalog = await settingsService.getProviderCatalog();
      set({ catalog });
    } catch {
      // Catalog is optional; ignore errors
    }
  },

  // Fetch models from providers and reload catalog
  fetchCatalogModels: async (provider?: string) => {
    set({ isCatalogFetching: true });
    try {
      await settingsService.fetchCatalogModels(provider);
      await get().loadCatalog();
    } catch {
      // Best-effort; catalog may still be stale
    } finally {
      set({ isCatalogFetching: false });
    }
  },

  // Get fast model as ProviderModelRef
  getFastModelRef: () => {
    const state = get();
    const fast = state.providerConfig.defaults?.fast;
    if (fast?.model?.trim()) return fast;
    const chat = state.providerConfig.defaults?.chat;
    return chat?.model?.trim() ? chat : null;
  },

  // Get vision model as ProviderModelRef
  getVisionModelRef: () => {
    const state = get();
    const vision = state.providerConfig.defaults?.vision;
    if (vision?.model?.trim()) return vision;
    const chat = state.providerConfig.defaults?.chat;
    return chat?.model?.trim() ? chat : null;
  },

  getModelsForProvider: (providerName: string) => {
    const { catalog } = get();
    if (!catalog?.models) return [];
    return catalog.models.filter((m) => m.reference.provider === providerName);
  },
}));
