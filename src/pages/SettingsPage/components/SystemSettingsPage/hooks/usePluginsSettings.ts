import { useCallback, useEffect, useRef, useState } from "react";
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
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent && mountedRef.current) {
        setIsLoading(true);
      }

      try {
        const incoming = await service.getPlugins();
        if (mountedRef.current) {
          setPlugins(incoming);
          setLoadError(null);
        }
      } catch (error) {
        if (mountedRef.current) {
          setLoadError(toErrorMessage(error, "Failed to load plugins"));
        }
        throw error;
      } finally {
        if (!silent && mountedRef.current) {
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
