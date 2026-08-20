import type { ProviderInstanceSettings, ProviderSection } from "@services/config/configSections";
import { PROVIDER_LABELS, type ProviderType } from "@shared/types/providerConfig";

import { isMaskedSecretValue } from "./providerInstanceUtils";

const optionalBoolean = (value: unknown): boolean | null | undefined => {
  if (value === null) return null;
  return typeof value === "boolean" ? value : undefined;
};

const optionalPositiveInteger = (value: unknown): number | null | undefined => {
  if (value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

export const buildProviderInstanceSettings = (
  type: ProviderType,
  label: string | undefined,
  enabled: boolean | undefined,
  rawConfig: Record<string, unknown>,
): { settings: ProviderInstanceSettings; credential?: string } => {
  const config = structuredClone(rawConfig);
  const apiKey = typeof config.api_key === "string" ? config.api_key.trim() : "";
  delete config.api_key;
  const settings: ProviderInstanceSettings = {
    provider_type: type,
    label: label?.trim() || PROVIDER_LABELS[type],
    enabled: enabled ?? true,
    base_url: config.base_url as string | null | undefined,
    model: config.model as string | null | undefined,
    fast_model: config.fast_model as string | null | undefined,
    vision_model: config.vision_model as string | null | undefined,
    reasoning_effort: config.reasoning_effort as
      | ProviderInstanceSettings["reasoning_effort"]
      | undefined,
    responses_only_models: config.responses_only_models as string[] | undefined,
    request_overrides: config.request_overrides as
      | ProviderInstanceSettings["request_overrides"]
      | undefined,
  };

  if (type === "openai") {
    settings.explicit_prompt_cache = optionalBoolean(config.explicit_prompt_cache);
  } else if (type === "anthropic") {
    settings.thinking_replay_always = optionalBoolean(config.thinking_replay_always);
    settings.max_tokens = optionalPositiveInteger(config.max_tokens);
  } else if (type === "copilot") {
    settings.headless_auth = optionalBoolean(config.headless_auth);
  } else if (type === "bodhi") {
    settings.target_provider = config.target_provider as
      | ProviderInstanceSettings["target_provider"]
      | undefined;
  }

  return {
    settings,
    credential: apiKey && !isMaskedSecretValue(apiKey) ? apiKey : undefined,
  };
};

export const insertProviderInstance = (
  draft: ProviderSection,
  id: string,
  settings: ProviderInstanceSettings,
): void => {
  draft.provider_instances[id] = settings;
  const currentDefault = draft.default_provider_instance_id;
  if (!currentDefault || !draft.provider_instances[currentDefault]) {
    draft.default_provider_instance_id = id;
  }
};

const OPTIONAL_DEFAULT_MODEL_FIELDS = [
  "fast",
  "task_summary",
  "vision",
  "memory_background",
  "planning",
  "search",
  "code_review",
  "sub_agent",
] as const;

const nextEnabledProviderInstanceId = (draft: ProviderSection, excludedId: string): string | null =>
  Object.entries(draft.provider_instances)
    .filter(([instanceId, instance]) => instanceId !== excludedId && instance.enabled)
    .map(([instanceId]) => instanceId)
    .sort((left, right) => left.localeCompare(right))[0] ?? null;

const replacementChatModel = (draft: ProviderSection, instanceId: string): string | null => {
  const instance = draft.provider_instances[instanceId];
  const configuredModel = typeof instance?.model === "string" ? instance.model.trim() : "";
  if (configuredModel) return configuredModel;
  return instance?.provider_type === "copilot" ? "gpt-4o" : null;
};

export const removeProviderInstance = (draft: ProviderSection, id: string): void => {
  if (!draft.provider_instances[id]) {
    throw new Error(`Provider instance '${id}' no longer exists.`);
  }

  const nextEnabledId = nextEnabledProviderInstanceId(draft, id);
  // Bamboo keeps migrated legacy aliases during the compatibility window. An
  // empty or all-disabled instance set can therefore reactivate a legacy-only
  // provider that this UI can no longer manage. Require a replacement before
  // mutating the canonical section so deletion always remains instance-native.
  if (!nextEnabledId) {
    throw new Error(
      `Cannot delete provider instance '${id}' because no other enabled provider instance remains.`,
    );
  }

  const nextDefaultId =
    draft.default_provider_instance_id === id ? nextEnabledId : draft.default_provider_instance_id;
  const defaults = draft.defaults;
  const chatReferencesDeletedInstance = defaults?.chat.provider === id;
  const chatReplacementId: string =
    nextDefaultId && nextDefaultId !== id && draft.provider_instances[nextDefaultId]?.enabled
      ? nextDefaultId
      : nextEnabledId;
  const chatReplacementModel = replacementChatModel(draft, chatReplacementId);
  let replacementChat: { provider: string; model: string } | null = null;

  // Refuse to persist a dangling required chat ref when another enabled
  // instance remains but does not declare a usable chat model. The user can
  // choose a valid default model first, then retry the deletion.
  if (chatReferencesDeletedInstance) {
    if (!chatReplacementModel) {
      throw new Error(
        `Cannot delete provider instance '${id}' until '${chatReplacementId}' has a chat model.`,
      );
    }
    replacementChat = {
      provider: chatReplacementId,
      model: chatReplacementModel,
    };
  }

  delete draft.provider_instances[id];
  if (draft.default_provider_instance_id === id) {
    draft.default_provider_instance_id = nextEnabledId;
  }

  if (!defaults) return;

  if (replacementChat) {
    defaults.chat = replacementChat;
  }

  for (const field of OPTIONAL_DEFAULT_MODEL_FIELDS) {
    if (defaults[field]?.provider === id) {
      delete defaults[field];
    }
  }

  if (defaults.subagent_models) {
    for (const [subagentType, modelRef] of Object.entries(defaults.subagent_models)) {
      if (modelRef.provider === id) {
        delete defaults.subagent_models[subagentType];
      }
    }
    if (Object.keys(defaults.subagent_models).length === 0) {
      delete defaults.subagent_models;
    }
  }
};
