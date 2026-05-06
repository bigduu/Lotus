import type { ReasoningEffort } from "../services/AgentService";
import type { ProviderConfig } from "../types/providerConfig";
import type { ProviderModelRef } from "../types/providerModelRef";

export const getReasoningEffortForProvider = (
  providerConfig: ProviderConfig,
  providerName?: string | null,
): ReasoningEffort | undefined => {
  switch (providerName?.trim()) {
    case "openai":
      return providerConfig.providers.openai?.reasoning_effort;
    case "anthropic":
      return providerConfig.providers.anthropic?.reasoning_effort;
    case "gemini":
      return providerConfig.providers.gemini?.reasoning_effort;
    case "copilot":
      return providerConfig.providers.copilot?.reasoning_effort;
    case "bodhi":
      return providerConfig.providers.bodhi?.reasoning_effort;
    default:
      return undefined;
  }
};

export const resolveProviderDefaultReasoningEffort = (
  providerConfig: ProviderConfig,
  modelRef?: ProviderModelRef | null,
  fallbackProvider?: string | null,
): ReasoningEffort | undefined => {
  const providerName =
    modelRef?.provider?.trim() ||
    providerConfig.defaults?.chat?.provider?.trim() ||
    fallbackProvider?.trim() ||
    providerConfig.provider?.trim();

  return getReasoningEffortForProvider(providerConfig, providerName);
};
