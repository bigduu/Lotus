import type { TokenBudgetUsage as AgentTokenBudgetUsage } from "../../../services/chat/AgentService";

/**
 * Token budget management types for the Bamboo chat application.
 *
 * These types mirror the Rust backend types defined in agent-core/src/budget/types.rs
 */

/**
 * Budget strategy for managing token limits.
 */
export type BudgetStrategy =
  | { type: "window"; size: number }
  | { type: "hybrid"; windowSize: number; enableSummarization: boolean };

/**
 * Token budget configuration for a conversation.
 */
export interface TokenBudget {
  /** Maximum context window size for the model (input + output) */
  maxContextTokens: number;
  /** Maximum tokens reserved for model output */
  maxOutputTokens: number;
  /** Budget enforcement strategy */
  strategy: BudgetStrategy;
  /** Safety margin for tokenizer estimation errors (default: 100) */
  safetyMargin?: number;
}

/**
 * Detailed token usage breakdown.
 */
export interface TokenUsage {
  /** Tokens used by system message(s) */
  systemTokens: number;
  /** Tokens used by conversation summary (if any) */
  summaryTokens: number;
  /** Tokens used by recent message window */
  windowTokens: number;
  /** Total tokens in prepared context */
  totalTokens: number;
  /** Optional model context window size (input + output) */
  maxContextTokens?: number;
  /** Context-window limit denominator (legacy field name from backend payload) */
  budgetLimit: number;
  /** Number of long tool outputs compacted into prompt-side cached summaries */
  promptCachedToolOutputs?: number;
  /** Tokens saved by prompt-side tool output compaction */
  promptCachedToolTokensSaved?: number;
  /** Provider-reported reasoning / thinking tokens */
  thinkingTokens?: number;
  /** Provider-side cache hits on input tokens */
  cacheReadInputTokens?: number;
}

/**
 * Budget information returned after preparing context.
 */
export interface PreparedContextInfo {
  /** Whether truncation occurred */
  truncationOccurred: boolean;
  /** Number of message segments removed */
  segmentsRemoved: number;
  /** Token usage breakdown */
  tokenUsage: TokenUsage;
}

export function mapTokenBudgetUsage(usage?: AgentTokenBudgetUsage | null): TokenUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const tokenUsage: TokenUsage = {
    systemTokens: usage.system_tokens,
    summaryTokens: usage.summary_tokens,
    windowTokens: usage.window_tokens,
    totalTokens: usage.total_tokens,
    budgetLimit: usage.budget_limit,
  };

  if (typeof usage.max_context_tokens === "number" && usage.max_context_tokens > 0) {
    tokenUsage.maxContextTokens = usage.max_context_tokens;
  }

  if (typeof usage.prompt_cached_tool_outputs === "number") {
    tokenUsage.promptCachedToolOutputs = usage.prompt_cached_tool_outputs;
  }

  if (typeof usage.prompt_cached_tool_tokens_saved === "number") {
    tokenUsage.promptCachedToolTokensSaved = usage.prompt_cached_tool_tokens_saved;
  }

  if (typeof usage.thinking_tokens === "number") {
    tokenUsage.thinkingTokens = usage.thinking_tokens;
  }

  if (typeof usage.cache_read_input_tokens === "number") {
    tokenUsage.cacheReadInputTokens = usage.cache_read_input_tokens;
  }

  return tokenUsage;
}

/**
 * Known model context window sizes.
 * These are the default context window limits for popular models.
 */
export const KNOWN_MODEL_LIMITS: Record<string, number> = {
  // OpenAI (GPT-5)
  "gpt-5.4-thinking": 1000000,
  "gpt-5.3-codex": 1000000,
  "gpt-5.2-pro": 256000,
  "gpt-5-mini": 400000,
  // OpenAI (Legacy)
  "gpt-4.1": 1000000,
  "gpt-4o": 128000,
  // Google
  "gemini-2.5-pro": 1000000,
  // China (Moonshot)
  "kimi-k2.5": 256000,
  "kimi-for-coding": 256000,
  // China (Zhipu)
  "glm-5": 200000,
  // Compatibility fallbacks
  "gpt-4o-mini": 128000,
  "gpt-4-turbo": 128000,
  "gpt-4": 8192,
  "gpt-3.5-turbo": 16385,
  "claude-3-5-sonnet": 200000,
  "claude-3-5-sonnet-20241022": 200000,
  "claude-3-opus": 200000,
  "claude-3-sonnet": 200000,
  "claude-3-haiku": 200000,
  "copilot-chat": 128000,
};

/**
 * Get the default budget for a model with the given context window.
 */
export function createBudgetForModel(
  maxContextTokens: number,
  strategy?: BudgetStrategy,
): TokenBudget {
  // Reserve ~25% for output by default
  const maxOutputTokens = Math.min(4096, Math.floor(maxContextTokens / 4));
  return {
    maxContextTokens,
    maxOutputTokens,
    strategy: strategy || {
      type: "hybrid",
      windowSize: 20,
      enableSummarization: true,
    },
    safetyMargin: Math.max(100, Math.floor(maxContextTokens * 0.01)),
  };
}

/**
 * Get the context limit for a model name.
 * Supports partial matching.
 */
export function getModelContextLimit(model: string): number {
  // Exact match
  if (model in KNOWN_MODEL_LIMITS) {
    return KNOWN_MODEL_LIMITS[model];
  }

  // Partial match
  for (const [pattern, limit] of Object.entries(KNOWN_MODEL_LIMITS)) {
    if (model.includes(pattern) || pattern.includes(model)) {
      return limit;
    }
  }

  // Default fallback
  return 128000;
}

export function getUsageDenominator(usage: TokenUsage): number {
  if (typeof usage.maxContextTokens === "number" && usage.maxContextTokens > 0) {
    return usage.maxContextTokens;
  }
  // Legacy fallback for older payloads missing max_context_tokens.
  if (usage.budgetLimit > 0) {
    return usage.budgetLimit;
  }
  return 0;
}

/**
 * Calculate the percentage of budget used.
 */
export function getUsagePercentage(usage: TokenUsage): number {
  const denominator = getUsageDenominator(usage);
  if (denominator === 0) {
    return 0;
  }
  return (usage.totalTokens / denominator) * 100;
}

/**
 * Get the color for the usage percentage.
 * Returns 'success', 'warning', or 'error' for different ranges.
 */
export function getUsageColor(usage: TokenUsage): "success" | "warning" | "error" | "default" {
  const percentage = getUsagePercentage(usage);
  if (percentage >= 90) return "error";
  if (percentage >= 70) return "warning";
  if (percentage >= 50) return "success";
  return "default";
}

/**
 * Format token count with commas for readability.
 */
export function formatTokenCount(count: number): string {
  return count.toLocaleString();
}

/**
 * Format token counts in a compact K/M/B style for dense UI surfaces.
 * Uses fixed English suffixes regardless of locale to keep labels stable.
 */
export function formatCompactTokenCount(count: number): string {
  const abs = Math.abs(count);

  const trimTrailingZero = (value: string): string => value.replace(/\.0$/, "");

  if (abs >= 1_000_000_000) {
    const digits = abs >= 10_000_000_000 ? 0 : 1;
    return `${trimTrailingZero((count / 1_000_000_000).toFixed(digits))}B`;
  }

  if (abs >= 1_000_000) {
    const digits = abs >= 10_000_000 ? 0 : 1;
    return `${trimTrailingZero((count / 1_000_000).toFixed(digits))}M`;
  }

  if (abs >= 1_000) {
    const digits = abs >= 10_000 ? 0 : 1;
    return `${trimTrailingZero((count / 1_000).toFixed(digits))}K`;
  }

  return `${count}`;
}

/**
 * Heuristic token counter - estimates tokens based on character count.
 * Mirrors the Rust HeuristicTokenCounter (chars/4 + 10% margin).
 */
export function estimateTokens(text: string): number {
  const charCount = text.length;
  const baseTokens = charCount / 4;
  const adjustedTokens = baseTokens * 1.1; // 10% safety margin
  return Math.ceil(adjustedTokens);
}

/**
 * Default token budget using GPT-4o-mini context window.
 */
export const DEFAULT_TOKEN_BUDGET: TokenBudget = createBudgetForModel(128000);
