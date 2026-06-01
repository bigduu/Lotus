import { agentApiClient } from "@services/api";
import type { UserSystemPrompt } from "@shared/types/chat";
import { getDefaultSystemPrompts } from "@shared/utils/defaultSystemPrompts";

const DEPRECATED_PROMPT_STORAGE_KEYS = ["system_prompt", "system_prompt_selected_id"];

interface PromptPresetItem {
  id: string;
  name: string;
  description?: string;
  content: string;
  is_default?: boolean;
}

interface PromptPresetListResponse {
  prompts?: PromptPresetItem[];
}

interface PromptPresetResponse {
  prompt?: PromptPresetItem;
}

interface CreatePromptPresetRequest {
  id?: string;
  name: string;
  description?: string;
  content: string;
}

interface PatchPromptPresetRequest {
  name?: string;
  description?: string;
  content?: string;
}

const mapPresetToUserPrompt = (preset: PromptPresetItem): UserSystemPrompt => ({
  id: preset.id,
  name: preset.name || preset.id,
  content: preset.content || "",
  description: preset.description,
  isDefault: Boolean(preset.is_default),
});

/**
 * System prompt access service.
 * Runtime source of truth is backend `/api/v1/prompt-presets`.
 */
export class SystemPromptService {
  private static instance: SystemPromptService;
  private deprecatedKeysCleanupDone = false;

  private constructor() {}

  static getInstance(): SystemPromptService {
    if (!SystemPromptService.instance) {
      SystemPromptService.instance = new SystemPromptService();
    }
    SystemPromptService.instance.cleanupDeprecatedPromptStorageKeys();
    return SystemPromptService.instance;
  }

  private cleanupDeprecatedPromptStorageKeys(): void {
    if (this.deprecatedKeysCleanupDone) return;
    this.deprecatedKeysCleanupDone = true;
    try {
      for (const key of DEPRECATED_PROMPT_STORAGE_KEYS) {
        localStorage.removeItem(key);
      }
    } catch (error) {
      console.warn(
        "[SystemPromptService] Failed to cleanup deprecated prompt storage keys:",
        error,
      );
    }
  }

  /**
   * Get all prompt presets from backend.
   */
  async getSystemPromptPresets(): Promise<UserSystemPrompt[]> {
    try {
      const data = await agentApiClient.get<PromptPresetListResponse>("prompt-presets");
      const prompts = Array.isArray(data?.prompts) ? data.prompts : [];
      const presets = prompts
        .filter((preset) => preset.id && preset.id.trim().length > 0)
        .map(mapPresetToUserPrompt);
      if (presets.length > 0) {
        return presets;
      }
    } catch (error) {
      console.error("Failed to load prompt presets from backend:", error);
    }

    return getDefaultSystemPrompts();
  }

  /**
   * Create a custom prompt preset.
   */
  async createSystemPromptPreset(req: CreatePromptPresetRequest): Promise<UserSystemPrompt> {
    const payload: CreatePromptPresetRequest = {
      name: req.name,
      content: req.content,
    };
    if (req.id?.trim()) {
      payload.id = req.id.trim();
    }
    if (req.description !== undefined) {
      payload.description = req.description;
    }

    const data = await agentApiClient.post<PromptPresetResponse>("prompt-presets", payload);
    if (!data?.prompt) {
      throw new Error("Backend did not return created prompt preset");
    }
    return mapPresetToUserPrompt(data.prompt);
  }

  /**
   * Update an existing custom prompt preset.
   */
  async updateSystemPromptPreset(prompt: UserSystemPrompt): Promise<UserSystemPrompt> {
    const encodedId = encodeURIComponent(prompt.id);
    const payload: PatchPromptPresetRequest = {
      name: prompt.name,
      content: prompt.content,
      description: prompt.description,
    };

    const data = await agentApiClient.patch<PromptPresetResponse>(
      `prompt-presets/${encodedId}`,
      payload,
    );
    if (!data?.prompt) {
      throw new Error("Backend did not return updated prompt preset");
    }
    return mapPresetToUserPrompt(data.prompt);
  }

  /**
   * Delete a custom prompt preset.
   */
  async deleteSystemPromptPreset(promptId: string): Promise<void> {
    const encodedId = encodeURIComponent(promptId);
    await agentApiClient.delete(`prompt-presets/${encodedId}`);
  }

  /**
   * Find preset by preset ID
   */
  async findPresetById(id: string): Promise<UserSystemPrompt | undefined> {
    const presets = await this.getSystemPromptPresets();
    return presets.find((preset) => preset.id === id);
  }

  /**
   * Get current system prompt content
   */
  async getCurrentSystemPromptContent(selectedPresetId: string): Promise<string> {
    const preset = await this.findPresetById(selectedPresetId);
    if (preset) return preset.content;

    const presets = await this.getSystemPromptPresets();
    const defaultPreset = presets.find((item) => item.isDefault) || presets[0];
    return defaultPreset?.content || "";
  }
}
