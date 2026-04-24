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

      // Backend handles migration from old config format
      // No need for frontend migration anymore

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
    const providerConfig = state.providerConfig.providers[state.currentProvider];

    if (!providerConfig) {
      return undefined;
    }

    // Return the model if it exists
    if ("model" in providerConfig && providerConfig.model) {
      return providerConfig.model;
    }

    return undefined;
  },

  // Get fast/cheap model for current provider (falls back to active model)
  getFastModel: () => {
    const state = get();
    const providerConfig = state.providerConfig.providers[state.currentProvider];

    if (providerConfig && "fast_model" in providerConfig && providerConfig.fast_model) {
      return providerConfig.fast_model;
    }

    // Fallback to active model
    return state.getActiveModel();
  },

  // Get vision-capable model for current provider (falls back to active model)
  getVisionModel: () => {
    const state = get();
    const providerConfig = state.providerConfig.providers[state.currentProvider];

    if (providerConfig && "vision_model" in providerConfig && providerConfig.vision_model) {
      return providerConfig.vision_model;
    }

    // Fallback to active model
    return state.getActiveModel();
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

    const providerConfig = state.providerConfig.providers[state.currentProvider];
    if (providerConfig && "fast_model" in providerConfig && providerConfig.fast_model) {
      return { provider: state.currentProvider, model: providerConfig.fast_model };
    }

    const active = state.getActiveModel();
    return active ? { provider: state.currentProvider, model: active } : null;
  },

  // Get vision model as ProviderModelRef
  getVisionModelRef: () => {
    const state = get();

    const providerConfig = state.providerConfig.providers[state.currentProvider];
    if (providerConfig && "vision_model" in providerConfig && providerConfig.vision_model) {
      return { provider: state.currentProvider, model: providerConfig.vision_model };
    }

    const active = state.getActiveModel();
    return active ? { provider: state.currentProvider, model: active } : null;
  },

  getModelsForProvider: (providerName: string) => {
    const { catalog } = get();
    if (!catalog?.models) return [];
    return catalog.models.filter((m) => m.reference.provider === providerName);
  },
}));
