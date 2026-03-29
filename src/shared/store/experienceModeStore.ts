import { create } from "zustand";

const EXPERIENCE_MODE_STORAGE_KEY = "lotus_experience_mode_v1";

/**
 * Experience mode controls UI complexity:
 * - "simple": Hides advanced controls for new users
 * - "advanced": Shows all features for power users
 */
export type ExperienceMode = "simple" | "advanced";

/** Settings tabs visible in simple mode */
export const SIMPLE_MODE_SETTINGS_TABS = new Set([
  "provider",
  "model-limits",
  "prompts",
  "mcp",
  "workflows",
  "schedules",
  "app",
]);

/** Settings tabs only visible in advanced mode */
export const ADVANCED_ONLY_SETTINGS_TABS = new Set([
  "skills",
  "hooks",
  "masking",
  "env-vars",
  "metrics",
  "sessions",
  "config",
]);

interface ExperienceModeState {
  mode: ExperienceMode;
  setMode: (mode: ExperienceMode) => void;
  toggleMode: () => void;
  /** Whether the current mode is advanced */
  isAdvanced: boolean;
}

function readPersistedMode(): ExperienceMode {
  try {
    const stored = localStorage.getItem(EXPERIENCE_MODE_STORAGE_KEY);
    if (stored === "simple" || stored === "advanced") return stored;
  } catch {
    /* noop */
  }
  // Default to advanced for existing users (don't break their workflow)
  return "advanced";
}

export const useExperienceModeStore = create<ExperienceModeState>((set) => ({
  mode: readPersistedMode(),
  isAdvanced: readPersistedMode() === "advanced",
  setMode: (mode) => {
    try {
      localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, mode);
    } catch {
      /* noop */
    }
    set({ mode, isAdvanced: mode === "advanced" });
  },
  toggleMode: () =>
    set((s) => {
      const next = s.mode === "simple" ? "advanced" : "simple";
      try {
        localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, next);
      } catch {
        /* noop */
      }
      return { mode: next, isAdvanced: next === "advanced" };
    }),
}));
