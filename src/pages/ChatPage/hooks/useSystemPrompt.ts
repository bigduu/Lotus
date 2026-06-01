import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SystemPromptService } from "@shared/services/SystemPromptService";
import { UserSystemPrompt } from "@shared/types/chat";

/**
 * Hook for managing system prompt functionality
 * Encapsulates SystemPromptService usage to avoid direct service imports in components
 */
interface UseSystemPromptReturn {
  // System prompt presets
  systemPromptPresets: UserSystemPrompt[];
  isLoadingPresets: boolean;
  presetsError: string | null;

  // Current system prompt info
  currentSystemPromptInfo: UserSystemPrompt | null;
  isLoadingCurrentInfo: boolean;
  currentInfoError: string | null;

  // Methods
  findPresetById: (id: string) => Promise<UserSystemPrompt | undefined>;
  getCurrentSystemPromptContent: (selectedPresetId: string) => Promise<string>;
  refreshPresets: () => Promise<void>;
}

export const useSystemPrompt = (currentSystemPromptId?: string | null): UseSystemPromptReturn => {
  const { t } = useTranslation();
  const [systemPromptPresets, setSystemPromptPresets] = useState<UserSystemPrompt[]>([]);
  const [isLoadingPresets, setIsLoadingPresets] = useState(false);
  const [presetsError, setPresetsError] = useState<string | null>(null);

  const [currentSystemPromptInfo, setCurrentSystemPromptInfo] = useState<UserSystemPrompt | null>(
    null,
  );
  const [isLoadingCurrentInfo, setIsLoadingCurrentInfo] = useState(false);
  const [currentInfoError, setCurrentInfoError] = useState<string | null>(null);

  // Get service instance
  const systemPromptService = useMemo(() => SystemPromptService.getInstance(), []);

  // Load system prompt presets
  const loadPresets = async () => {
    setIsLoadingPresets(true);
    setPresetsError(null);
    try {
      const presets = await systemPromptService.getSystemPromptPresets();
      setSystemPromptPresets(presets);
    } catch (error) {
      console.error("Failed to load system prompt presets:", error);
      setPresetsError(error instanceof Error ? error.message : t("chat.prompt.loadPresetsFailed"));
      setSystemPromptPresets([]);
    } finally {
      setIsLoadingPresets(false);
    }
  };

  // Load current system prompt info
  const loadCurrentSystemPromptInfo = async () => {
    if (!currentSystemPromptId) {
      setCurrentSystemPromptInfo(null);
      return;
    }

    setIsLoadingCurrentInfo(true);
    setCurrentInfoError(null);
    try {
      const info = await systemPromptService.findPresetById(currentSystemPromptId);
      setCurrentSystemPromptInfo(info || null);
    } catch (error) {
      console.error("Failed to load current system prompt info:", error);
      setCurrentInfoError(
        error instanceof Error ? error.message : t("chat.prompt.loadCurrentInfoFailed"),
      );
      setCurrentSystemPromptInfo(null);
    } finally {
      setIsLoadingCurrentInfo(false);
    }
  };

  // Load presets on mount
  useEffect(() => {
    loadPresets();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reload presets on mount and locale change only
  }, [t]);

  // Load current system prompt info when ID changes
  useEffect(() => {
    loadCurrentSystemPromptInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: reload when the active prompt id or locale changes
  }, [currentSystemPromptId, t]);

  // Methods to expose
  const findPresetById = async (id: string): Promise<UserSystemPrompt | undefined> => {
    return await systemPromptService.findPresetById(id);
  };

  const getCurrentSystemPromptContent = async (selectedPresetId: string): Promise<string> => {
    return await systemPromptService.getCurrentSystemPromptContent(selectedPresetId);
  };

  const refreshPresets = async (): Promise<void> => {
    await loadPresets();
  };

  return {
    // System prompt presets
    systemPromptPresets,
    isLoadingPresets,
    presetsError,

    // Current system prompt info
    currentSystemPromptInfo,
    isLoadingCurrentInfo,
    currentInfoError,

    // Methods
    findPresetById,
    getCurrentSystemPromptContent,
    refreshPresets,
  };
};
