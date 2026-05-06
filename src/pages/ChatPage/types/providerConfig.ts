import type { ProviderModelRef } from "./providerModelRef";

/**
 * Provider Configuration Types
 *
 * Types for configuring and switching between different LLM providers.
 */

export interface DefaultsConfig {
  chat: ProviderModelRef;
  fast?: ProviderModelRef;
  vision?: ProviderModelRef;
  memory_background?: ProviderModelRef;
  planning?: ProviderModelRef;
  search?: ProviderModelRef;
  code_review?: ProviderModelRef;
  sub_agent?: ProviderModelRef;
  subagent_models?: Record<string, ProviderModelRef>;
}

export interface ProviderConfig {
  provider: string;
  defaults?: DefaultsConfig;
  providers: {
    openai?: OpenAIConfig;
    anthropic?: AnthropicConfig;
    gemini?: GeminiConfig;
    copilot?: CopilotConfig;
    bodhi?: BodhiConfig;
  };
  features?: {
    provider_model_ref?: boolean;
  };
}

export interface RequestOverridesConfig {
  common?: RequestScopeOverride;
  endpoints?: Record<string, RequestScopeOverride>;
  rules?: ModelRequestRule[];
}

export interface ModelRequestRule {
  model_pattern: string;
  endpoint?: string;
  scope?: RequestScopeOverride;
}

export interface RequestScopeOverride {
  headers?: Record<string, TemplateExpr>;
  body_patch?: BodyPatch[];
}

export interface BodyPatch {
  path: string;
  op?: "set" | "remove";
  value?: PatchValue;
}

export type PatchValue = TemplateExpr | unknown;

export type TemplateExpr =
  | string
  | {
      type: "literal";
      value: string;
    }
  | {
      type: "env_ref";
      name: string;
      fallback?: string;
    }
  | {
      type: "generated";
      generator: "uuid" | "unix_ms";
    }
  | {
      type: "format";
      template: string;
    };

export interface OpenAIConfig {
  api_key: string;
  base_url?: string;
  reasoning_effort?: "low" | "medium" | "high" | "xhigh" | "max";
  // Models that must use the OpenAI Responses API upstream (instead of chat/completions).
  // Supports exact match (e.g. "gpt-5.3-codex") and a single trailing wildcard for prefix match
  // (e.g. "gpt-5*").
  responses_only_models?: string[];
  request_overrides?: RequestOverridesConfig;
}

export interface AnthropicConfig {
  api_key: string;
  base_url?: string;
  reasoning_effort?: "low" | "medium" | "high" | "xhigh" | "max";
  max_tokens?: number;
  request_overrides?: RequestOverridesConfig;
}

export interface GeminiConfig {
  api_key: string;
  base_url?: string;
  reasoning_effort?: "low" | "medium" | "high" | "xhigh" | "max";
  request_overrides?: RequestOverridesConfig;
}

export interface CopilotConfig {
  // Copilot uses OAuth - no API key required
  headless_auth?: boolean; // Print login URL in console instead of opening browser
  reasoning_effort?: "low" | "medium" | "high" | "xhigh" | "max";
  // Models that must use the OpenAI Responses API upstream (instead of chat/completions).
  // Supports exact match (e.g. "gpt-5.3-codex") and a single trailing wildcard for prefix match
  // (e.g. "gpt-5*").
  responses_only_models?: string[];
  request_overrides?: RequestOverridesConfig;
}

export interface BodhiConfig {
  api_key?: string;
  base_url?: string;
  /** Which upstream provider to route through bodhi ("openai", "anthropic", "gemini"). */
  target_provider?: string;
  reasoning_effort?: "low" | "medium" | "high" | "xhigh" | "max";
  request_overrides?: RequestOverridesConfig;
}

export type ProviderType = "copilot" | "openai" | "anthropic" | "gemini" | "bodhi";

export const PROVIDER_LABELS: Record<ProviderType, string> = {
  copilot: "GitHub Copilot",
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  bodhi: "Bodhi",
};

export const OPENAI_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { value: "gpt-4-turbo-preview", label: "GPT-4 Turbo Preview" },
  { value: "gpt-4", label: "GPT-4" },
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
] as const;

export const ANTHROPIC_MODELS = [
  { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
  { value: "claude-3-5-sonnet-20240620", label: "Claude 3.5 Sonnet (Legacy)" },
  { value: "claude-3-opus-20240229", label: "Claude 3 Opus" },
  { value: "claude-3-sonnet-20240229", label: "Claude 3 Sonnet" },
  { value: "claude-3-haiku-20240307", label: "Claude 3 Haiku" },
] as const;

export const GEMINI_MODELS = [
  { value: "gemini-pro", label: "Gemini Pro" },
  { value: "gemini-pro-vision", label: "Gemini Pro Vision" },
  { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro" },
  { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
] as const;

// Fallback list used when backend model discovery isn't available yet.
export const COPILOT_MODELS = [
  { value: "gpt-4o", label: "GPT-4o" },
  { value: "gpt-4o-mini", label: "GPT-4o Mini" },
] as const;
