import { useCallback, useEffect, useState } from "react";
import { pluginsService, type InstalledPluginView } from "@services/plugins";

interface PluginsSettingsService {
  getPlugins: () => Promise<InstalledPluginView[]>;
}

interface UsePluginsSettingsOptions {
  service?: PluginsSettingsService;
}

interface UsePluginsSettingsResult {
  plugins: InstalledPluginView[];
  isLoading: boolean;
  loadError: string | null;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
}

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

export const usePluginsSettings = (
  options: UsePluginsSettingsOptions = {},
): UsePluginsSettingsResult => {
  const { service = pluginsService } = options;

  const [plugins, setPlugins] = useState<InstalledPluginView[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) {
        setIsLoading(true);
      }

      try {
        const incoming = await service.getPlugins();
        setPlugins(incoming);
        setLoadError(null);
      } catch (error) {
        setLoadError(toErrorMessage(error, "Failed to load plugins"));
        throw error;
      } finally {
        if (!silent) {
          setIsLoading(false);
        }
      }
    },
    [service],
  );

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  return {
    plugins,
    isLoading,
    loadError,
    refresh,
  };
};
