import { StateCreator } from "zustand";
import { TokenUsage } from "@shared/types/tokenBudget";

export interface TokenBudgetState {
  // Map of chat ID to token usage
  tokenUsages: Record<string, TokenUsage>;
  // Map of chat ID to truncation flag
  truncationOccurred: Record<string, boolean>;
  // Map of chat ID to segments removed count
  segmentsRemoved: Record<string, number>;
}

export interface TokenBudgetActions {
  updateTokenUsage: (sessionId: string, usage: TokenUsage) => void;
  setTruncationInfo: (
    sessionId: string,
    truncationOccurred: boolean,
    segmentsRemoved: number,
  ) => void;
  clearTokenUsage: (sessionId: string) => void;
}

export type TokenBudgetSlice = TokenBudgetState & TokenBudgetActions;

export const createTokenBudgetSlice: StateCreator<TokenBudgetSlice, [], [], TokenBudgetSlice> = (
  set,
) => ({
  tokenUsages: {},
  truncationOccurred: {},
  segmentsRemoved: {},

  updateTokenUsage: (sessionId, usage) =>
    set((state) => ({
      tokenUsages: {
        ...state.tokenUsages,
        [sessionId]: usage,
      },
    })),

  setTruncationInfo: (sessionId, truncationOccurred, segmentsRemoved) =>
    set((state) => ({
      truncationOccurred: {
        ...state.truncationOccurred,
        [sessionId]: truncationOccurred,
      },
      segmentsRemoved: {
        ...state.segmentsRemoved,
        [sessionId]: segmentsRemoved,
      },
    })),

  clearTokenUsage: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...remainingUsages } = state.tokenUsages;
      const { [sessionId]: __, ...remainingTruncation } = state.truncationOccurred;
      const { [sessionId]: ___, ...remainingSegments } = state.segmentsRemoved;
      return {
        tokenUsages: remainingUsages,
        truncationOccurred: remainingTruncation,
        segmentsRemoved: remainingSegments,
      };
    }),
});
