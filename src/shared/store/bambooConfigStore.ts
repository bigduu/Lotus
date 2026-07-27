import { create } from "zustand";
import { serviceFactory, type BambooConfig } from "@services/common/ServiceFactory";
import { getErrorMessage, isConfigRecoveryPendingError } from "@services/api";

type LoadOptions = { force?: boolean };

interface BambooConfigStoreState {
  config: BambooConfig | null;
  isLoadingConfig: boolean;
  lastLoadedAt: number | null;
  error: string | null;

  loadConfig: (options?: LoadOptions) => Promise<BambooConfig>;
}

let configInFlight: Promise<BambooConfig> | null = null;

const toErrorMessage = (error: unknown, fallback: string): string => {
  // Surface the config-corruption-recovery block distinctly rather than a
  // generic save error — see the `ConfigRecoveryBanner`/#59.
  if (isConfigRecoveryPendingError(error)) {
    return getErrorMessage(error);
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export const useBambooConfigStore = create<BambooConfigStoreState>((set, get) => ({
  config: null,
  isLoadingConfig: false,
  lastLoadedAt: null,
  error: null,

  loadConfig: async ({ force = false }: LoadOptions = {}) => {
    const existing = get().config;
    if (!force && existing) {
      return existing;
    }

    if (configInFlight) {
      return configInFlight;
    }

    configInFlight = (async () => {
      set({ isLoadingConfig: true, error: null });
      try {
        const config = await serviceFactory.getBambooConfig();
        set({ config, lastLoadedAt: Date.now(), error: null });
        return config;
      } catch (error) {
        const message = toErrorMessage(error, "Failed to load Bamboo config");
        set({ error: message });
        throw error;
      } finally {
        set({ isLoadingConfig: false });
      }
    })();

    try {
      return await configInFlight;
    } finally {
      configInFlight = null;
    }
  },
}));
