import type { ReasoningEffort } from "../../../ChatPage/services/AgentService";

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

export const sanitizeInstanceConfigForForm = (
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> => {
  if (!config) return {};
  return Object.fromEntries(
    Object.entries(config).filter(([key]) => !RESERVED_INSTANCE_CONFIG_KEYS.has(key)),
  );
};
