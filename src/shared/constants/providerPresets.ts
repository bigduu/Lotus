import type { ProviderType } from "@shared/types/providerConfig";

/**
 * Vendor presets for the provider instance editor.
 *
 * UI-only convenience data: picking a preset pre-fills the provider type and
 * base URL in the create/edit form. The preset itself is never persisted —
 * the saved instance keeps the plain `type` / `config.base_url` fields.
 */

/** Provider protocols covered by vendor presets. */
export type ProviderPresetType = Extract<ProviderType, "openai" | "anthropic">;

export interface ProviderVendorPreset {
  /** Stable preset id (UI-only, not persisted). */
  id: string;
  /** Vendor display name — intentionally not translated. */
  label: string;
  provider_type: ProviderPresetType;
  base_url: string;
  /** Shown as a hint only — never auto-written into any form field. */
  suggested_models: string[];
  /** Optional one-line note (zh). */
  notes?: string;
}

export const PROVIDER_VENDOR_PRESETS: readonly ProviderVendorPreset[] = [
  // Verified working 2026-07-10 against the live API via bamboo.
  // Docs: https://api-docs.deepseek.com/
  {
    id: "deepseek",
    label: "DeepSeek",
    provider_type: "openai",
    base_url: "https://api.deepseek.com/v1",
    suggested_models: ["deepseek-chat", "deepseek-reasoner"],
  },
  // Verified working 2026-07-10 against the live API via bamboo.
  // Docs: https://api-docs.deepseek.com/guides/anthropic_api
  {
    id: "deepseek-anthropic",
    label: "DeepSeek (Anthropic 协议)",
    provider_type: "anthropic",
    base_url: "https://api.deepseek.com/anthropic",
    suggested_models: ["deepseek-chat", "deepseek-reasoner"],
    notes: "通过 Anthropic 兼容协议接入 DeepSeek",
  },
  // Verified 2026-07-11 via https://docs.bigmodel.cn/cn/guide/develop/openai/introduction
  {
    id: "zhipu",
    label: "智谱 GLM (bigmodel.cn)",
    provider_type: "openai",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    suggested_models: ["glm-5.2"],
  },
  // Verified 2026-07-11 via https://docs.bigmodel.cn/cn/guide/develop/claude/introduction
  {
    id: "zhipu-anthropic",
    label: "智谱 GLM (Anthropic 协议)",
    provider_type: "anthropic",
    base_url: "https://open.bigmodel.cn/api/anthropic",
    suggested_models: ["glm-5.2"],
    notes: "通过 Anthropic 兼容协议接入智谱 GLM",
  },
  // Verified 2026-07-11 via https://docs.z.ai/api-reference/introduction
  {
    id: "zai",
    label: "Z.ai (国际版)",
    provider_type: "openai",
    base_url: "https://api.z.ai/api/paas/v4",
    suggested_models: ["glm-5.2"],
    notes: "智谱 GLM 国际平台",
  },
  // Verified 2026-07-11 via https://platform.minimaxi.com/docs/api-reference/text-openai-api
  {
    id: "minimax-cn",
    label: "MiniMax (中国大陆)",
    provider_type: "openai",
    base_url: "https://api.minimaxi.com/v1",
    suggested_models: ["MiniMax-M3"],
    notes: "中国大陆平台（minimaxi.com）",
  },
  // Verified 2026-07-11 via https://platform.minimax.io/docs/api-reference/text-openai-api
  {
    id: "minimax-intl",
    label: "MiniMax (国际版)",
    provider_type: "openai",
    base_url: "https://api.minimax.io/v1",
    suggested_models: ["MiniMax-M3"],
    notes: "国际平台（minimax.io）",
  },
  // Verified 2026-07-11 via https://help.aliyun.com/en/model-studio/base-url
  // (China/Beijing endpoint; Singapore uses dashscope-intl.aliyuncs.com)
  {
    id: "qwen",
    label: "通义千问 (DashScope)",
    provider_type: "openai",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    suggested_models: ["qwen-plus", "qwen-max"],
    notes: "阿里云百炼 OpenAI 兼容模式（北京地域）",
  },
  // Verified 2026-07-11 via https://platform.kimi.com/docs/api/chat
  // (platform.moonshot.cn redirects there; the API host stays api.moonshot.cn)
  {
    id: "kimi",
    label: "Kimi (Moonshot)",
    provider_type: "openai",
    base_url: "https://api.moonshot.cn/v1",
    suggested_models: ["kimi-k2.6"],
  },
];
