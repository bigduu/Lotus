import type { ReasoningEffort } from "@services/chat/AgentService";
import { isMaskedSecret } from "@shared/utils/secrets";

export const RESERVED_INSTANCE_CONFIG_KEYS = new Set([
  "id",
  "type",
  "provider_type",
  "label",
  "enabled",
  "api_key_encrypted",
]);

export const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * The backend redacts configured secrets to this placeholder in GET responses.
 * It must never be prefilled into an editable field nor sent back on save —
 * a paste that doesn't fully clear a prefilled placeholder produces values
 * like `****...****sk-new…` that used to silently discard the new key.
 *
 * Alias of the shared `isMaskedSecret` contract (`@shared/utils/secrets`) —
 * kept as a distinct export here so existing call sites in this directory
 * don't need to change, but the check itself has a single implementation.
 */
export const isMaskedSecretValue = isMaskedSecret;

export const sanitizeInstanceConfigForForm = (
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> => {
  if (!config) return {};
  return Object.fromEntries(
    Object.entries(config).filter(
      ([key, value]) =>
        !RESERVED_INSTANCE_CONFIG_KEYS.has(key) &&
        !(key === "api_key" && isMaskedSecretValue(value)),
    ),
  );
};
