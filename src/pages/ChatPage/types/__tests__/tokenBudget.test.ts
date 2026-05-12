import { describe, expect, it } from "vitest";

import {
  createBudgetForModel,
  estimateTokens,
  formatCompactTokenCount,
  formatTokenCount,
  getModelContextLimit,
  getUsageColor,
  getUsagePercentage,
  KNOWN_MODEL_LIMITS,
} from "../tokenBudget";

describe("tokenBudget utilities", () => {
  it("creates budget with defaults and clamps output/safety values", () => {
    const tiny = createBudgetForModel(1200);
    expect(tiny.maxOutputTokens).toBe(300);
    expect(tiny.safetyMargin).toBe(100);
    expect(tiny.strategy).toEqual({
      type: "hybrid",
      windowSize: 20,
      enableSummarization: true,
    });

    const huge = createBudgetForModel(1_000_000);
    expect(huge.maxOutputTokens).toBe(4096);
    expect(huge.safetyMargin).toBe(10_000);
  });

  it("uses custom strategy when provided", () => {
    const strategy = { type: "window", size: 42 } as const;
    const budget = createBudgetForModel(128000, strategy);
    expect(budget.strategy).toEqual(strategy);
  });

  it("resolves model context by exact, partial and fallback matching", () => {
    expect(getModelContextLimit("gpt-4o")).toBe(KNOWN_MODEL_LIMITS["gpt-4o"]);
    expect(getModelContextLimit("openai/gpt-4o-mini")).toBe(KNOWN_MODEL_LIMITS["gpt-4o-mini"]);
    expect(getModelContextLimit("unknown-model")).toBe(128000);
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

  it("estimates tokens heuristically", () => {
    expect(estimateTokens("abcd")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});
