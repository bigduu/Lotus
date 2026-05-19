import type { ReasoningEffort } from "../services/AgentService";
import type { ProviderConfig } from "../types/providerConfig";
import type { ProviderModelRef } from "../types/providerModelRef";

const PROVIDER_TYPE_KEYS = new Set<string>(["openai", "anthropic", "gemini", "copilot", "bodhi"]);

/**
 * Resolve a `providerOrInstanceId` to the actual `ProviderType`.
 *
 * In legacy mode the value is already a ProviderType string.
 * In instance mode it may be an instance id — in that case we look up
 * the config entry keyed by that id and read `reasoning_effort` directly.
 */
const resolveReasoningEffortByKey = (
  providerConfig: ProviderConfig,
  providerOrInstanceId?: string | null,
): ReasoningEffort | undefined => {
  if (!providerOrInstanceId?.trim()) return undefined;

  const key = providerOrInstanceId.trim();

  // Legacy fast-path: key is a well-known ProviderType
  if (PROVIDER_TYPE_KEYS.has(key)) {
    const providers = providerConfig.providers as Record<
      string,
      Record<string, unknown> | undefined
    >;
    const cfg = providers[key];
    return cfg?.reasoning_effort as ReasoningEffort | undefined;
  }

  // Instance mode: look up by instance id in the providers map.
  // providerSlice.loadProviderInstances stores instance configs keyed by id.
  const providers = providerConfig.providers as Record<string, Record<string, unknown> | undefined>;
  const instanceCfg = providers[key];
  return instanceCfg?.reasoning_effort as ReasoningEffort | undefined;
};

export const getReasoningEffortForProvider = (
  providerConfig: ProviderConfig,
  providerName?: string | null,
): ReasoningEffort | undefined => {
  return resolveReasoningEffortByKey(providerConfig, providerName);
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

  return resolveReasoningEffortByKey(providerConfig, providerName);
};
