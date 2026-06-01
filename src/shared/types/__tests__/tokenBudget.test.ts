import { describe, expect, it } from "vitest";

import {
  estimateTokens,
  formatCompactTokenCount,
  formatTokenCount,
  getUsageColor,
  getUsageDenominator,
  getUsagePercentage,
  mapTokenBudgetUsage,
} from "../tokenBudget";

describe("tokenBudget utilities", () => {
  it("derives the usage denominator from backend max context, then budget limit", () => {
    // Prefer the backend-resolved context window when present.
    expect(
      getUsageDenominator({
        systemTokens: 0,
        summaryTokens: 0,
        windowTokens: 0,
        totalTokens: 0,
        budgetLimit: 900,
        maxContextTokens: 200000,
      }),
    ).toBe(200000);

    // Legacy fallback for older payloads missing max_context_tokens.
    expect(
      getUsageDenominator({
        systemTokens: 0,
        summaryTokens: 0,
        windowTokens: 0,
        totalTokens: 0,
        budgetLimit: 900,
      }),
    ).toBe(900);

    // Nothing usable → 0 (callers guard against divide-by-zero).
    expect(
      getUsageDenominator({
        systemTokens: 0,
        summaryTokens: 0,
        windowTokens: 0,
        totalTokens: 0,
        budgetLimit: 0,
      }),
    ).toBe(0);
  });

  it("calculates usage percentage and color thresholds", () => {
    expect(
      getUsagePercentage({
        systemTokens: 1,
        summaryTokens: 1,
        windowTokens: 1,
        totalTokens: 10,
        budgetLimit: 0,
      }),
    ).toBe(0);

    expect(
      getUsagePercentage({
        systemTokens: 1,
        summaryTokens: 1,
        windowTokens: 1,
        totalTokens: 40,
        budgetLimit: 10,
        maxContextTokens: 100,
      }),
    ).toBe(40);

    const mkUsage = (totalTokens: number) => ({
      systemTokens: 0,
      summaryTokens: 0,
      windowTokens: 0,
      totalTokens,
      budgetLimit: 100,
    });

    expect(getUsageColor(mkUsage(49))).toBe("default");
    expect(getUsageColor(mkUsage(50))).toBe("success");
    expect(getUsageColor(mkUsage(70))).toBe("warning");
    expect(getUsageColor(mkUsage(90))).toBe("error");
  });

  it("formats token counts for readable and compact displays", () => {
    expect(formatTokenCount(1234567)).toBe("1,234,567");
    expect(formatCompactTokenCount(999)).toBe("999");
    expect(formatCompactTokenCount(1200)).toBe("1.2K");
    expect(formatCompactTokenCount(10000)).toBe("10K");
    expect(formatCompactTokenCount(1250000)).toBe("1.3M");
    expect(formatCompactTokenCount(1200000000)).toBe("1.2B");
  });

  it("maps backend token budget usage into UI token usage including cache and thinking fields", () => {
    expect(
      mapTokenBudgetUsage({
        system_tokens: 10,
        summary_tokens: 20,
        window_tokens: 30,
        total_tokens: 60,
        max_context_tokens: 1000,
        budget_limit: 900,
        truncation_occurred: false,
        segments_removed: 0,
        prompt_cached_tool_outputs: 2,
        prompt_cached_tool_tokens_saved: 120,
        thinking_tokens: 45,
        cache_read_input_tokens: 67,
      }),
    ).toEqual({
      systemTokens: 10,
      summaryTokens: 20,
      windowTokens: 30,
      totalTokens: 60,
      maxContextTokens: 1000,
      budgetLimit: 900,
      promptCachedToolOutputs: 2,
      promptCachedToolTokensSaved: 120,
      thinkingTokens: 45,
      cacheReadInputTokens: 67,
    });
  });

  it("estimates tokens heuristically", () => {
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});
