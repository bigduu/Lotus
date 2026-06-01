import { StateCreator } from "zustand";
import { UserSystemPrompt } from "@shared/types/chat";
import { SystemPromptService } from "@shared/services/SystemPromptService";
import { getDefaultSystemPrompts } from "@shared/utils/defaultSystemPrompts";
import type { AppState } from "../";

const LAST_SELECTED_PROMPT_ID_LS_KEY = "copilot_last_selected_prompt_id";
const LEGACY_CUSTOM_PROMPTS_LS_KEY = "copilot_custom_system_prompts_v2";
const LEGACY_PROMPTS_MIGRATED_LS_KEY = "copilot_custom_system_prompts_v2_migrated_to_backend";
const DEFAULT_PROMPT_ID = "general_assistant";
const MAX_PROMPT_ID_LENGTH = 80;

const systemPromptService = SystemPromptService.getInstance();
let legacyMigrationPromise: Promise<void> | null = null;

// Helper function to generate ID from name
function generateIdFromName(name: string): string {
  const sanitized = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  // If the name contains no ASCII characters, generate a unique ID
  if (sanitized.length === 0) {
    return `prompt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  return sanitized.slice(0, MAX_PROMPT_ID_LENGTH);
}

function sanitizePresetId(rawValue: unknown): string | null {
  if (typeof rawValue !== "string") return null;
  const normalized = rawValue
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!normalized) {
    return null;
  }
  return normalized.slice(0, MAX_PROMPT_ID_LENGTH);
}

function ensureUniqueId(baseId: string, existingIds: Set<string>): string {
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (true) {
    const suffix = `_${index}`;
    const prefix = baseId.slice(0, Math.max(0, MAX_PROMPT_ID_LENGTH - suffix.length));
    const candidate = `${prefix}${suffix}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
    index += 1;
  }
}

function loadLegacyCustomPrompts(): UserSystemPrompt[] {
  try {
    const stored = localStorage.getItem(LEGACY_CUSTOM_PROMPTS_LS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    const seen = new Set<string>();
    const prompts: UserSystemPrompt[] = [];

    for (const item of parsed) {
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const content = typeof item?.content === "string" ? item.content.trim() : "";
      if (!name || !content) continue;

      const rawId = sanitizePresetId(item?.id);
      const baseId = rawId || generateIdFromName(name);
      const id = ensureUniqueId(baseId, seen);
      if (id === DEFAULT_PROMPT_ID) {
        continue;
      }
      seen.add(id);

      prompts.push({
        id,
        name,
        content,
        description:
          typeof item?.description === "string" ? item.description.trim() || undefined : undefined,
        isDefault: Boolean(item?.isDefault),
      });
    }

    return prompts;
  } catch (error) {
    console.error("[promptSlice] Failed to read legacy custom prompts:", error);
    return [];
  }
}

function isLegacyMigrationComplete(): boolean {
  try {
    return localStorage.getItem(LEGACY_PROMPTS_MIGRATED_LS_KEY) === "1";
  } catch (error) {
    console.error("[promptSlice] Failed to read migration marker:", error);
    return false;
  }
}

function markLegacyMigrationComplete(): void {
  try {
    localStorage.setItem(LEGACY_PROMPTS_MIGRATED_LS_KEY, "1");
  } catch (error) {
    console.error("[promptSlice] Failed to write migration marker:", error);
  }
}

function clearLegacyCustomPrompts(): void {
  try {
    localStorage.removeItem(LEGACY_CUSTOM_PROMPTS_LS_KEY);
  } catch (error) {
    console.error("[promptSlice] Failed to clear legacy custom prompts:", error);
  }
}

async function migrateLegacyPromptsToBackend(): Promise<void> {
  if (isLegacyMigrationComplete()) {
    return;
  }

  const legacyPrompts = loadLegacyCustomPrompts();
  if (legacyPrompts.length === 0) {
    clearLegacyCustomPrompts();
    markLegacyMigrationComplete();
    return;
  }

  const existingPrompts = await systemPromptService.getSystemPromptPresets();
  const existingIds = new Set(existingPrompts.map((prompt) => prompt.id));
  let hasFailures = false;

  for (const legacyPrompt of legacyPrompts) {
    const name = legacyPrompt.name?.trim();
    const content = legacyPrompt.content?.trim();
    if (!name || !content) continue;

    if (legacyPrompt.id === DEFAULT_PROMPT_ID || legacyPrompt.isDefault) {
      continue;
    }

    const baseId = sanitizePresetId(legacyPrompt.id) || generateIdFromName(name);
    const id = ensureUniqueId(baseId, existingIds);

    try {
      const created = await systemPromptService.createSystemPromptPreset({
        id,
        name,
        content,
        description: legacyPrompt.description,
      });
      existingIds.add(created.id);
    } catch (error) {
      hasFailures = true;
      console.error(`[promptSlice] Failed to migrate legacy prompt '${name}' to backend:`, error);
    }
  }

  if (!hasFailures) {
    clearLegacyCustomPrompts();
    markLegacyMigrationComplete();
  }
}

async function runLegacyPromptMigrationOnce(): Promise<void> {
  if (!legacyMigrationPromise) {
    legacyMigrationPromise = migrateLegacyPromptsToBackend().finally(() => {
      legacyMigrationPromise = null;
    });
  }
  await legacyMigrationPromise;
}

export interface PromptSlice {
  // State
  systemPrompts: UserSystemPrompt[];
  lastSelectedPromptId: string | null;

  // Actions
  loadSystemPrompts: () => Promise<void>;
  addSystemPrompt: (prompt: Omit<UserSystemPrompt, "id">) => Promise<void>;
  updateSystemPrompt: (prompt: UserSystemPrompt) => Promise<void>;
  deleteSystemPrompt: (promptId: string) => Promise<void>;
  setLastSelectedPromptId: (promptId: string) => void;
}

export const createPromptSlice: StateCreator<AppState, [], [], PromptSlice> = (set, get) => ({
  // Initial state
  systemPrompts: [],
  lastSelectedPromptId: localStorage.getItem(LAST_SELECTED_PROMPT_ID_LS_KEY) || null,

  // System prompt management
  loadSystemPrompts: async () => {
    try {
      await runLegacyPromptMigrationOnce();
    } catch (error) {
      console.warn("[promptSlice] Legacy prompt migration skipped:", error);
    }

    let backendPrompts: UserSystemPrompt[] = [];
    try {
      backendPrompts = await systemPromptService.getSystemPromptPresets();
    } catch (error) {
      console.error("Failed to load system prompts from backend:", error);
    }

    let merged = backendPrompts.length ? backendPrompts : getDefaultSystemPrompts();

    if (!isLegacyMigrationComplete()) {
      const legacyPrompts = loadLegacyCustomPrompts();
      merged = mergePrompts(merged, legacyPrompts);
    }

    if (merged.length === 0) {
      merged = getDefaultSystemPrompts();
    }

    set({ systemPrompts: merged });
  },

  addSystemPrompt: async (promptData) => {
    try {
      await systemPromptService.createSystemPromptPreset({
        id: generateIdFromName(promptData.name),
        name: promptData.name,
        content: promptData.content,
        description: promptData.description,
      });
      await get().loadSystemPrompts();
    } catch (error) {
      console.error("Failed to add system prompt:", error);
      throw error;
    }
  },

  updateSystemPrompt: async (promptToUpdate) => {
    try {
      await systemPromptService.updateSystemPromptPreset(promptToUpdate);
      await get().loadSystemPrompts();
    } catch (error) {
      console.error("Failed to update system prompt:", error);
      throw error;
    }
  },

  deleteSystemPrompt: async (promptId) => {
    try {
      await systemPromptService.deleteSystemPromptPreset(promptId);
      await get().loadSystemPrompts();
    } catch (error) {
      console.error("Failed to delete system prompt:", error);
      throw error;
    }
  },

  setLastSelectedPromptId: (promptId: string) => {
    set({ lastSelectedPromptId: promptId });
    try {
      localStorage.setItem(LAST_SELECTED_PROMPT_ID_LS_KEY, promptId);
    } catch (error) {
      console.error("Failed to save last selected prompt ID to localStorage:", error);
    }
  },
});

const mergePrompts = (
  presets: UserSystemPrompt[],
  customPrompts: UserSystemPrompt[],
): UserSystemPrompt[] => {
  const byId = new Map<string, UserSystemPrompt>();
  presets.forEach((prompt) => {
    byId.set(prompt.id, prompt);
  });
  customPrompts.forEach((prompt) => {
    byId.set(prompt.id, prompt);
  });
  return Array.from(byId.values());
};
