import { create } from "zustand";
import { settingsService } from "@services/config/SettingsService";
import type { ProviderConfig, ProviderType, ProviderInstance } from "@shared/types/providerConfig";
import type {
  ProviderModelRef,
  ProviderCatalog,
  ProviderModelDescriptor,
} from "@shared/types/providerModelRef";

const filterCatalogModelsForProvider = (
  catalog: ProviderCatalog | null,
  providerName: string,
  providerInstances: ProviderInstance[],
): ProviderModelDescriptor[] => {
  if (!catalog?.models || !providerName.trim()) return [];

  const exactMatches = catalog.models.filter((model) => model.reference.provider === providerName);
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const providerType = providerInstances.find((instance) => instance.id === providerName)?.type;
  if (!providerType) {
    return [];
  }

  return catalog.models.filter((model) => model.reference.provider === providerType);
};

/**
 * Provider State
 *
 * Manages the current active provider and its configuration.
 * This is the single source of truth for provider-related state.
 *
 * Supports both legacy (fixed provider-type keys) and multi-instance modes.
 * When `providerInstances` is populated, instance-based semantics take precedence.
 */
interface ProviderState {
  // ── Legacy (backward compat) ──────────────────────────────
  // Current active provider (legacy: ProviderType; instance mode: instance id)
  currentProvider: string;
  // Full provider configuration loaded from backend (legacy shape)
  providerConfig: ProviderConfig;

  // ── Multi-instance ────────────────────────────────────────
  /** All configured provider instances. */
  providerInstances: ProviderInstance[];
  /** The default provider instance id. */
  defaultProviderInstanceId: string | null;
  /** Whether the instance-based API is available / loaded. */
  isInstancesLoaded: boolean;

  // ── Common ────────────────────────────────────────────────
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
  /** Load provider instances from the new instance-based API. */
  loadProviderInstances: () => Promise<void>;
  setCurrentProvider: (provider: string) => void;
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
  /** Get a provider instance by id. */
  getProviderInstance: (instanceId: string) => ProviderInstance | undefined;
  /** Resolve a human-readable provider display label from instance id or legacy provider type. */
  getProviderDisplayLabel: (providerOrInstanceId: string) => string;
  /**
   * Resolve the ProviderType for the given provider identifier.
   *
   * In legacy mode the identifier is already a ProviderType ("openai", "copilot", …).
   * In instance mode it is an instance id; we look up the instance to get its `.type`.
   * Falls back to the identifier itself if no instance is found.
   */
  getProviderType: (providerOrInstanceId: string) => ProviderType;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  // ── Initial state ────────────────────────────────────────
  currentProvider: "copilot",
  providerConfig: {
    provider: "copilot",
    defaults: undefined,
    providers: {},
  },
  providerInstances: [],
  defaultProviderInstanceId: null,
  isInstancesLoaded: false,
  isLoading: false,
  error: null,
  selectedModelRef: null,
  catalog: null,
  isCatalogFetching: false,

  // ── Load legacy provider configuration from backend ────────
  loadProviderConfig: async () => {
    set({ isLoading: true, error: null });
    try {
      const config = await settingsService.getProviderConfig();

      // Build defaults from providers.{provider}.model if defaults is missing
      // (backward compatibility with backend that stores model in providers).
      if (!config.defaults?.chat?.model && config.provider && config.providers) {
        const providerName = config.provider;
        const providerCfg = config.providers[providerName as keyof typeof config.providers];
        const legacyModel = (providerCfg as Record<string, unknown> | undefined)?.model as
          | string
          | undefined;
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

  // ── Load provider instances (multi-instance API) ──────────
  loadProviderInstances: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await settingsService.getProviderInstances();

      const instances = response.instances ?? [];
      const defaultId = response.default_provider_instance_id ?? null;

      // Build legacy-compatible providerConfig from instances + defaults.
      // This keeps existing consumers working during migration.
      const legacyProviders: Record<string, Record<string, unknown>> = {};
      for (const inst of instances) {
        legacyProviders[inst.id] = inst.config;
      }

      // Also preserve original type-keyed entries so legacy code can still
      // look up providers by type name.
      const legacyConfig: ProviderConfig = {
        provider: defaultId ?? "",
        defaults: response.defaults,
        providers: legacyProviders as ProviderConfig["providers"],
        features: response.features,
      };

      // Back-fill defaults from legacy model field if needed
      if (!legacyConfig.defaults?.chat?.model && defaultId) {
        const instCfg = legacyProviders[defaultId];
        const legacyModel = instCfg?.model as string | undefined;
        if (legacyModel) {
          legacyConfig.defaults = {
            chat: { provider: defaultId, model: legacyModel },
          };
        }
      }

      set({
        providerInstances: instances,
        defaultProviderInstanceId: defaultId,
        currentProvider: defaultId ?? response.defaults?.chat?.provider ?? "",
        providerConfig: legacyConfig,
        isInstancesLoaded: true,
        isLoading: false,
      });
    } catch (error) {
      console.error("Failed to load provider instances:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to load provider instances",
        isLoading: false,
        isInstancesLoaded: false,
      });
    }
  },

  // ── Set current provider (accepts ProviderType or instance id) ──
  setCurrentProvider: (provider: string) => {
    set({ currentProvider: provider });
  },

  // ── Update provider configuration ─────────────────────────
  updateProviderConfig: (config: Partial<ProviderConfig>) => {
    set((state) => ({
      providerConfig: {
        ...state.providerConfig,
        ...config,
      },
    }));
  },

  // ── Get the active model for current provider ──────────────
  getActiveModel: () => {
    const state = get();
    const model = state.providerConfig.defaults?.chat?.model?.trim();
    return model || undefined;
  },

  // ── Get fast/cheap model for current provider (falls back to active model) ──
  getFastModel: () => {
    const state = get();
    const model = state.providerConfig.defaults?.fast?.model?.trim();
    return model || state.getActiveModel();
  },

  // ── Get vision-capable model for current provider (falls back to active model) ──
  getVisionModel: () => {
    const state = get();
    const model = state.providerConfig.defaults?.vision?.model?.trim();
    return model || state.getActiveModel();
  },

  // ── Feature flag check — always enabled now ────────────────
  isProviderModelRefEnabled: () => true,

  // ── Set selected model ref ─────────────────────────────────
  setSelectedModelRef: (ref) => {
    set({ selectedModelRef: ref });
  },

  // ── Load provider catalog from backend ─────────────────────
  loadCatalog: async () => {
    try {
      const catalog = await settingsService.getProviderCatalog();
      set({ catalog });
    } catch {
      // Catalog is optional; ignore errors
    }
  },

  // ── Fetch models from providers and reload catalog ─────────
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

  // ── Get fast model as ProviderModelRef ─────────────────────
  getFastModelRef: () => {
    const state = get();
    const fast = state.providerConfig.defaults?.fast;
    if (fast?.model?.trim()) return fast;
    const chat = state.providerConfig.defaults?.chat;
    return chat?.model?.trim() ? chat : null;
  },

  // ── Get vision model as ProviderModelRef ───────────────────
  getVisionModelRef: () => {
    const state = get();
    const vision = state.providerConfig.defaults?.vision;
    if (vision?.model?.trim()) return vision;
    const chat = state.providerConfig.defaults?.chat;
    return chat?.model?.trim() ? chat : null;
  },

  getModelsForProvider: (providerName: string) => {
    const { catalog, providerInstances } = get();
    return filterCatalogModelsForProvider(catalog, providerName, providerInstances);
  },

  getProviderInstance: (instanceId: string) => {
    return get().providerInstances.find((inst) => inst.id === instanceId);
  },

  getProviderDisplayLabel: (providerOrInstanceId: string): string => {
    const inst = get().providerInstances.find((i) => i.id === providerOrInstanceId);
    if (inst) {
      return inst.label || inst.type;
    }
    return providerOrInstanceId;
  },

  getProviderType: (providerOrInstanceId: string): ProviderType => {
    const inst = get().providerInstances.find((i) => i.id === providerOrInstanceId);
    return inst?.type ?? (providerOrInstanceId as ProviderType);
  },
}));
