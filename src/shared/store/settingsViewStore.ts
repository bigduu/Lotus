import { create } from "zustand";

export type SettingsOrigin = "chat";

export type SettingsTabKey =
  | "provider"
  | "model-limits"
  | "prompts"
  | "skills"
  | "mcp"
  | "workflows"
  | "hooks"
  | "permissions"
  | "masking"
  | "env-vars"
  | "metrics"
  | "sessions"
  | "config"
  | "schedules"
  | "app";

export const DEFAULT_SETTINGS_TAB_KEY: SettingsTabKey = "provider";

interface SettingsViewState {
  isOpen: boolean;
  origin: SettingsOrigin;
  activeTabKey: SettingsTabKey;
  open: (origin: SettingsOrigin, activeTabKey?: SettingsTabKey) => void;
  close: () => void;
  setActiveTabKey: (activeTabKey: SettingsTabKey) => void;
}

export const useSettingsViewStore = create<SettingsViewState>((set) => ({
  isOpen: false,
  origin: "chat",
  activeTabKey: DEFAULT_SETTINGS_TAB_KEY,
  open: (origin, activeTabKey = DEFAULT_SETTINGS_TAB_KEY) =>
    set({ isOpen: true, origin, activeTabKey }),
  close: () => set({ isOpen: false }),
  setActiveTabKey: (activeTabKey) => set({ activeTabKey }),
}));
