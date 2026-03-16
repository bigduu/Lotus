import { describe, expect, it } from "vitest";

import {
  createTokenBudgetSlice,
  type TokenBudgetSlice,
} from "../tokenBudgetSlice";
import { createSliceHarness } from "./sliceHarness";

describe("tokenBudgetSlice", () => {
  it("updates token usage and truncation info", () => {
    const harness = createSliceHarness<TokenBudgetSlice>(createTokenBudgetSlice);

    harness.getState().updateTokenUsage("session-1", {
      systemTokens: 10,
      summaryTokens: 5,
      windowTokens: 20,
      totalTokens: 35,
      budgetLimit: 100,
    });

    harness.getState().setTruncationInfo("session-1", true, 2);

    expect(harness.getState().tokenUsages["session-1"]?.totalTokens).toBe(35);
    expect(harness.getState().truncationOccurred["session-1"]).toBe(true);
    expect(harness.getState().segmentsRemoved["session-1"]).toBe(2);
  });

  it("clears one session without affecting others", () => {
    const harness = createSliceHarness<TokenBudgetSlice>(createTokenBudgetSlice);

    harness.getState().updateTokenUsage("session-1", {
      systemTokens: 1,
      summaryTokens: 1,
      windowTokens: 1,
      totalTokens: 3,
      budgetLimit: 10,
    });
    harness.getState().setTruncationInfo("session-1", true, 1);

    harness.getState().updateTokenUsage("session-2", {
      systemTokens: 2,
      summaryTokens: 2,
      windowTokens: 2,
      totalTokens: 6,
      budgetLimit: 12,
    });
    harness.getState().setTruncationInfo("session-2", false, 0);

    harness.getState().clearTokenUsage("session-1");

    expect(harness.getState().tokenUsages["session-1"]).toBeUndefined();
    expect(harness.getState().truncationOccurred["session-1"]).toBeUndefined();
    expect(harness.getState().segmentsRemoved["session-1"]).toBeUndefined();
    expect(harness.getState().tokenUsages["session-2"]?.totalTokens).toBe(6);
  });
});
