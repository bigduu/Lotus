import { create } from "zustand";
import { settingsService } from "@services/config/SettingsService";
import { providerSectionToInstances } from "@services/config/providerSettings";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
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
 * Provider instances are authoritative. `providerConfig` remains as the
 * normalized compatibility shape consumed by model-selection code.
 */
interface ProviderState {
  // Current active provider instance id.
  currentProvider: string;
  // Normalized provider configuration used by existing model consumers.
  providerConfig: ProviderConfig;

  /** All configured provider instances. */
  providerInstances: ProviderInstance[];
  /** The default provider instance id. */
  defaultProviderInstanceId: string | null;

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
  /** Load provider instances from the typed provider settings section. */
  loadProviderInstances: () => Promise<void>;
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
   * The identifier is normally an instance id; we look up the instance to get
   * its `.type`. Synthesized instances may use the provider type as their id,
   * so falling back to the identifier remains safe during config migration.
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
  isLoading: false,
  error: null,
  selectedModelRef: null,
  catalog: null,
  isCatalogFetching: false,

  // ── Load provider instances ────────────────────────────────
  loadProviderInstances: async () => {
    set({ isLoading: true, error: null });
    try {
      const envelope = await useConfigSectionStore.getState().loadSection("providers");
      const section = envelope.data;
      const instances = providerSectionToInstances(section);
      const defaultId = section.default_provider_instance_id;

      // Build the normalized providerConfig consumed by model selectors.
      const instanceProviders: Record<string, Record<string, unknown>> = {};
      for (const inst of instances) {
        instanceProviders[inst.id] = inst.config;
      }

      const normalizedConfig: ProviderConfig = {
        provider: defaultId ?? section.provider,
        defaults: section.defaults ?? undefined,
        providers: instanceProviders as ProviderConfig["providers"],
        features: section.features,
      };

      // Synthesized instances can carry their model while defaults are still
      // being migrated. Keep that one-way compatibility bridge here.
      if (!normalizedConfig.defaults?.chat?.model && defaultId) {
        const instCfg = instanceProviders[defaultId];
        const instanceModel = instCfg?.model as string | undefined;
        if (instanceModel) {
          normalizedConfig.defaults = {
            chat: { provider: defaultId, model: instanceModel },
          };
        }
      }

      set({
        providerInstances: instances,
        defaultProviderInstanceId: defaultId,
        currentProvider: defaultId ?? section.defaults?.chat?.provider ?? section.provider,
        providerConfig: normalizedConfig,
        isLoading: false,
      });
    } catch (error) {
      console.error("Failed to load provider instances:", error);
      set({
        error: error instanceof Error ? error.message : "Failed to load provider instances",
        isLoading: false,
      });
    }
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
