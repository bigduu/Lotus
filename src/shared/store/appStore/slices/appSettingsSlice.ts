import { StateCreator } from "zustand";
import type { AppState } from "..";

// SessionSlice previously held currentRequestController; cancellation is now
// session-scoped via executionStateSlice.markCancel.
export interface SessionSlice {}

export const createSessionSlice: StateCreator<AppState, [], [], SessionSlice> = () => ({});
