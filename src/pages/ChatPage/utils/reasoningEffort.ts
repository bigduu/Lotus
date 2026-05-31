import type { ReasoningEffort } from "@services/chat/AgentService";
import type { ProviderConfig, ProviderInstance } from "../types/providerConfig";
import type { ProviderModelRef } from "../types/providerModelRef";

const readEffort = (cfg: Record<string, unknown> | undefined): ReasoningEffort | undefined =>
  cfg?.reasoning_effort as ReasoningEffort | undefined;

/**
 * Resolve the configured default reasoning effort for a provider routing key.
 *
 * The key may be a legacy `ProviderType` (e.g. `"openai"`) or, in multi-instance
 * mode, an instance id (e.g. `"copilot-work"`). Resolution must not depend on
 * which load path populated the store, because:
 *   - `loadProviderInstances` keys `providerConfig.providers` by instance id, and
 *   - `loadProviderConfig` keys it by ProviderType.
 *
 * So we prefer the authoritative `providerInstances` array (when available),
 * then the `providers` map keyed directly by `key`, and finally — for an
 * instance id — the `providers` entry keyed by the instance's provider type.
 */
const resolveReasoningEffortByKey = (
  providerConfig: ProviderConfig,
  providerOrInstanceId?: string | null,
  providerInstances?: ProviderInstance[],
): ReasoningEffort | undefined => {
  if (!providerOrInstanceId?.trim()) return undefined;

  const key = providerOrInstanceId.trim();
  const providers = providerConfig.providers as Record<string, Record<string, unknown> | undefined>;

  // 1. Authoritative: the instance's own config (independent of load path).
  const instance = providerInstances?.find((inst) => inst.id === key);
  const fromInstance = readEffort(instance?.config as Record<string, unknown> | undefined);
  if (fromInstance) return fromInstance;

  // 2. The providers map keyed directly by `key`
  //    (instance id in instance mode, ProviderType in legacy mode).
  const direct = readEffort(providers[key]);
  if (direct) return direct;

  // 3. Instance id whose providers map is type-keyed (legacy load path ran):
  //    fall back to the entry for the instance's provider type.
  if (instance) {
    return readEffort(providers[instance.type]);
  }

  return undefined;
};

export const getReasoningEffortForProvider = (
  providerConfig: ProviderConfig,
  providerName?: string | null,
  providerInstances?: ProviderInstance[],
): ReasoningEffort | undefined => {
  return resolveReasoningEffortByKey(providerConfig, providerName, providerInstances);
};

export const resolveProviderDefaultReasoningEffort = (
  providerConfig: ProviderConfig,
  modelRef?: ProviderModelRef | null,
  fallbackProvider?: string | null,
  providerInstances?: ProviderInstance[],
): ReasoningEffort | undefined => {
  const providerName =
    modelRef?.provider?.trim() ||
    providerConfig.defaults?.chat?.provider?.trim() ||
    fallbackProvider?.trim() ||
    providerConfig.provider?.trim();

  return resolveReasoningEffortByKey(providerConfig, providerName, providerInstances);
};
