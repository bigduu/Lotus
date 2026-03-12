import { StateCreator } from "zustand";
import type { AppState } from "../";

// Attachment type (same as in InputContainer)
export interface Attachment {
  id: string;
  base64: string;
  name: string;
  size: number;
  type: string;
}

// Input state for a single chat session
export interface InputState {
  content: string;
  referenceText: string | null;
  attachments: Attachment[];
}

export interface InputStateSliceState {
  // Map of sessionId to input state
  inputStates: Record<string, InputState>;
}

export interface InputStateSliceActions {
  // Set input content for a chat
  setInputContent: (sessionId: string, content: string) => void;
  // Set reference text for a chat
  setReferenceText: (sessionId: string, referenceText: string | null) => void;
  // Set attachments for a chat
  setAttachments: (sessionId: string, attachments: Attachment[]) => void;
  // Clear all input state for a chat
  clearInputState: (sessionId: string) => void;
  // Get input state for a chat (returns default if not found)
  getInputState: (sessionId: string) => InputState;
}

export type InputStateSlice = InputStateSliceState & InputStateSliceActions;

const DEFAULT_INPUT_STATE: InputState = {
  content: "",
  referenceText: null,
  attachments: [],
};

export const createInputStateSlice: StateCreator<
  AppState,
  [],
  [],
  InputStateSlice
> = (set, get) => ({
  // State
  inputStates: {},

  // Set input content for a chat
  setInputContent: (sessionId, content) =>
    set((state) => ({
      inputStates: {
        ...state.inputStates,
        [sessionId]: {
          ...(state.inputStates[sessionId] || DEFAULT_INPUT_STATE),
          content,
        },
      },
    })),

  // Set reference text for a chat
  setReferenceText: (sessionId, referenceText) =>
    set((state) => ({
      inputStates: {
        ...state.inputStates,
        [sessionId]: {
          ...(state.inputStates[sessionId] || DEFAULT_INPUT_STATE),
          referenceText,
        },
      },
    })),

  // Set attachments for a chat
  setAttachments: (sessionId, attachments) =>
    set((state) => ({
      inputStates: {
        ...state.inputStates,
        [sessionId]: {
          ...(state.inputStates[sessionId] || DEFAULT_INPUT_STATE),
          attachments,
        },
      },
    })),

  // Clear all input state for a chat
  clearInputState: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...remainingInputStates } = state.inputStates;
      return {
        inputStates: remainingInputStates,
      };
    }),

  // Get input state for a chat (returns default if not found)
  getInputState: (sessionId) => {
    return get().inputStates[sessionId] || DEFAULT_INPUT_STATE;
  },
});
