import { StateCreator } from "zustand";
import type { AppState } from "..";

export interface SessionSlice {
  // State
  currentRequestController: AbortController | null;

  // Actions
  setCurrentRequestController: (controller: AbortController | null) => void;
  cancelCurrentRequest: () => void;
}

export const createSessionSlice: StateCreator<AppState, [], [], SessionSlice> = (set, get) => ({
  // Initial state
  currentRequestController: null,

  setCurrentRequestController: (controller) => {
    set({ currentRequestController: controller });
  },

  cancelCurrentRequest: () => {
    get().currentRequestController?.abort();
    // Clear all processing chats since we don't have a specific sessionId context
    get().processingChats.forEach((sessionId) => {
      get().setSessionProcessing(sessionId, false);
    });
    set({ currentRequestController: null });
  },
});
