import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type ProviderType,
  OPENAI_MODELS,
  ANTHROPIC_MODELS,
  GEMINI_MODELS,
  COPILOT_MODELS,
} from "@shared/types/providerConfig";
import { modelService } from "@services/chat/ModelService";
import { readModelOptionsCache, writeModelOptionsCache } from "./modelOptionsCache";
import type { ModelOption } from "./types";

interface UseInputContainerModelOptionsProps {
  resolvedProviderType: ProviderType;
  currentProvider: string;
  activeModel: string | undefined;
  getErrorMessage: (error: unknown) => string;
  redirectToProviderSettingsIfNeeded: () => boolean;
}

export const useInputContainerModelOptions = ({
  resolvedProviderType,
  currentProvider,
  activeModel,
  getErrorMessage,
  redirectToProviderSettingsIfNeeded,
}: UseInputContainerModelOptionsProps) => {
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [isModelOptionsLoading, setIsModelOptionsLoading] = useState(false);
  const [modelOptionsError, setModelOptionsError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const cached = await readModelOptionsCache(resolvedProviderType);
      setModelOptions(cached ?? []);
      setModelOptionsError(null);
    })();
  }, [resolvedProviderType]);

  const fallbackModelOptions = useMemo(() => {
    const byProvider: Record<ProviderType, ModelOption[]> = {
      openai: [...OPENAI_MODELS],
      anthropic: [...ANTHROPIC_MODELS],
      gemini: [...GEMINI_MODELS],
      copilot: [...COPILOT_MODELS],
      bodhi: [],
    };
    return byProvider[resolvedProviderType] || [];
  }, [resolvedProviderType]);

  const resolvedModelOptions = useMemo(() => {
    const base = modelOptions.length > 0 ? modelOptions : fallbackModelOptions;
    const normalized = [...base];
    if (activeModel && !normalized.some((item) => item.value === activeModel)) {
      normalized.unshift({ value: activeModel, label: activeModel });
    }
    return normalized;
  }, [modelOptions, fallbackModelOptions, activeModel]);

  const fetchProviderModels = useCallback(
    async (providerId: string, providerType: ProviderType, options?: { force?: boolean }) => {
      if (!options?.force && modelOptions.length > 0) return;
      try {
        setIsModelOptionsLoading(true);
        setModelOptionsError(null);

        const models =
          providerType === "copilot"
            ? await modelService.getModels(providerId)
            : fallbackModelOptions;
        const options = models.map((model: string | { value: string; label: string }) => ({
          value: typeof model === "string" ? model : model.value,
          label: typeof model === "string" ? model : model.label,
        }));
        setModelOptions(options);
        await writeModelOptionsCache(providerType, options);
      } catch (error) {
        setModelOptionsError(getErrorMessage(error));
      } finally {
        setIsModelOptionsLoading(false);
      }
    },
    [fallbackModelOptions, getErrorMessage, modelOptions.length],
  );

  const handleModelDropdownVisibleChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      if (redirectToProviderSettingsIfNeeded()) return;
      if (isModelOptionsLoading) return;
      if (modelOptions.length > 0) return;
      void fetchProviderModels(currentProvider, resolvedProviderType);
    },
    [
      currentProvider,
      resolvedProviderType,
      fetchProviderModels,
      isModelOptionsLoading,
      modelOptions.length,
      redirectToProviderSettingsIfNeeded,
    ],
  );

  return {
    modelOptions,
    isModelOptionsLoading,
    modelOptionsError,
    resolvedModelOptions,
    handleModelDropdownVisibleChange,
  };
};
