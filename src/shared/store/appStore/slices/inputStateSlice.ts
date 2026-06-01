import { StateCreator } from "zustand";
import type { AppState } from "../";
import type { ReasoningEffort } from "@services/chat/AgentService";
import { StorageManager } from "@services/storage/StorageManager";

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
  reasoningEffort: ReasoningEffort;
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
  // Set reasoning effort for a chat
  setInputReasoningEffort: (sessionId: string, reasoningEffort: ReasoningEffort) => void;
  // Clear all input state for a chat
  clearInputState: (sessionId: string) => void;
  // Get input state for a chat (returns default if not found)
  getInputState: (sessionId: string) => InputState;
}

export type InputStateSlice = InputStateSliceState & InputStateSliceActions;

const INPUT_REASONING_BY_SESSION_LS_KEY = "chat_input_reasoning_by_session_v1";
const INPUT_REASONING_LAST_USED_LS_KEY = "chat_input_reasoning_last_used_v1";

const DEFAULT_INPUT_STATE: InputState = {
  content: "",
  referenceText: null,
  attachments: [],
  reasoningEffort: "medium",
};

const isReasoningEffort = (value: unknown): value is ReasoningEffort =>
  value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";

const readReasoningBySession = (): Record<string, ReasoningEffort> => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = localStorage.getItem(INPUT_REASONING_BY_SESSION_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, ReasoningEffort> = {};
    for (const [sessionId, value] of Object.entries(parsed || {})) {
      if (isReasoningEffort(value)) {
        next[sessionId] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
};

const writeReasoningBySession = (value: Record<string, ReasoningEffort>) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(INPUT_REASONING_BY_SESSION_LS_KEY, JSON.stringify(value));
  } catch {
    // ignore localStorage quota/security errors
  }
};

const readLastUsedReasoningEffort = (): ReasoningEffort | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    const raw = localStorage.getItem(INPUT_REASONING_LAST_USED_LS_KEY);
    return isReasoningEffort(raw) ? raw : undefined;
  } catch {
    return undefined;
  }
};

const writeLastUsedReasoningEffort = (value: ReasoningEffort) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    localStorage.setItem(INPUT_REASONING_LAST_USED_LS_KEY, value);
  } catch {
    // ignore localStorage quota/security errors
  }
};

export const readPersistedInputReasoningEffort = (
  sessionId: string,
): ReasoningEffort | undefined => {
  const bySession = readReasoningBySession();
  if (isReasoningEffort(bySession[sessionId])) {
    return bySession[sessionId];
  }
  return readLastUsedReasoningEffort();
};

const defaultInputStateForSession = (sessionId: string): InputState => ({
  ...DEFAULT_INPUT_STATE,
  reasoningEffort:
    readPersistedInputReasoningEffort(sessionId) ?? DEFAULT_INPUT_STATE.reasoningEffort,
});

export const createInputStateSlice: StateCreator<AppState, [], [], InputStateSlice> = (
  set,
  get,
) => ({
  // State
  inputStates: {},

  // Set input content for a chat
  setInputContent: (sessionId, content) =>
    set((state) => ({
      inputStates: {
        ...state.inputStates,
        [sessionId]: {
          ...(state.inputStates[sessionId] || defaultInputStateForSession(sessionId)),
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
          ...(state.inputStates[sessionId] || defaultInputStateForSession(sessionId)),
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
          ...(state.inputStates[sessionId] || defaultInputStateForSession(sessionId)),
          attachments,
        },
      },
    })),

  // Set reasoning effort for a chat
  setInputReasoningEffort: (sessionId, reasoningEffort) => {
    set((state) => ({
      inputStates: {
        ...state.inputStates,
        [sessionId]: {
          ...(state.inputStates[sessionId] || defaultInputStateForSession(sessionId)),
          reasoningEffort,
        },
      },
    }));

    const bySession = readReasoningBySession();
    bySession[sessionId] = reasoningEffort;
    writeReasoningBySession(bySession);
    writeLastUsedReasoningEffort(reasoningEffort);

    // Also persist to IndexedDB for cross-session durability
    const manager = StorageManager.getInstance();
    manager.saveInputReasoning(sessionId, reasoningEffort).catch(() => {});
    manager.saveLastUsedReasoningEffort(reasoningEffort).catch(() => {});
  },

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
    return get().inputStates[sessionId] || defaultInputStateForSession(sessionId);
  },
});
