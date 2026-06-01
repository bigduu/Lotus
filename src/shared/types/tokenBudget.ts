import type { TokenBudgetUsage as AgentTokenBudgetUsage } from "@services/chat/AgentService";

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

// NOTE: Per-model context-window limits are no longer hardcoded in the
// frontend. The backend is the single source of truth: it sends the resolved
// `max_context_tokens` in the token-budget usage payload (see
// `mapTokenBudgetUsage` / `getUsageDenominator`). Anything else falls back to a
// global default on the backend (see bamboo-compression `limits.rs`).

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
