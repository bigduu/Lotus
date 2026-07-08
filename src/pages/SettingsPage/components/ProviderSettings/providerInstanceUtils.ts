import type { ReasoningEffort } from "@services/chat/AgentService";

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
 */
export const isMaskedSecretValue = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  [...value.trim()].every((c) => c === "*" || c === ".");

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
