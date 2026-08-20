import type { ReasoningEffort } from "@services/chat/AgentService";
import type { ProviderConfig, ProviderInstance } from "@shared/types/providerConfig";
import type { ProviderModelRef } from "@shared/types/providerModelRef";

/**
 * The single terminal default for reasoning effort, used when nothing is
 * configured anywhere in the resolution chain. This is the ONE place the
 * `"medium"` default lives on the frontend — mirror of the backend's
 * `DEFAULT_REASONING_EFFORT`. Do not hardcode a level at call sites.
 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

/**
 * Resolve the *effective* reasoning effort a session will use right now, from
 * the layered sources, most specific first:
 *   session config → pending input selection → persisted input → provider
 *   default → {@link DEFAULT_REASONING_EFFORT}.
 *
 * This is the single source of the precedence order. Every display/use site
 * (input box, question dialog) must call this instead of re-spelling the chain,
 * so they can never drift apart. (Session *creation* is intentionally separate:
 * it seeds from the provider default and may pass `undefined`, letting the
 * backend decide — it must NOT force a terminal default.)
 */
export const resolveEffectiveReasoningEffort = (sources: {
  sessionEffort?: ReasoningEffort | null;
  inputEffort?: ReasoningEffort | null;
  persistedEffort?: ReasoningEffort | null;
  providerDefault?: ReasoningEffort | null;
}): ReasoningEffort =>
  sources.sessionEffort ??
  sources.inputEffort ??
  sources.persistedEffort ??
  sources.providerDefault ??
  DEFAULT_REASONING_EFFORT;

const readEffort = (cfg: Record<string, unknown> | undefined): ReasoningEffort | undefined =>
  cfg?.reasoning_effort as ReasoningEffort | undefined;

/**
 * Resolve the configured default reasoning effort for a provider routing key.
 *
 * The key is a provider instance id (for migrated single-provider configs the
 * synthesized instance id may equal the provider type, e.g. `"openai"`). We
 * prefer the authoritative `providerInstances` array, then the normalized
 * `providers` map keyed by that same id.
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

  // 2. The normalized providers map keyed directly by instance id.
  const direct = readEffort(providers[key]);
  if (direct) return direct;

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
