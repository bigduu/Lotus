import { create } from "zustand";
import { THEME_STORAGE_KEY } from "@shared/theme/storageKeys";

type ThemeMode = "light" | "dark";

type ThemeState = {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
};

function readPersistedTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    /* noop */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export const useThemeStore = create<ThemeState>((set) => ({
  themeMode: readPersistedTheme(),
  setThemeMode: (mode) => set({ themeMode: mode }),
  toggleTheme: () =>
    set((s) => ({
      themeMode: s.themeMode === "dark" ? "light" : "dark",
    })),
}));
