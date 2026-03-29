import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Message, UserSystemPrompt } from "../../types/chat";
import { SystemPromptService } from "../../services/SystemPromptService";
import { AgentClient } from "../../services/AgentService";

type UseSystemPromptContentArgs = {
  currentChat: {
    id: string;
    config?: { systemPromptId?: string; workspacePath?: string };
  } | null;
  message: Message;
  systemPrompts: UserSystemPrompt[];
};

export const useSystemPromptContent = ({
  currentChat,
  message,
  systemPrompts,
}: UseSystemPromptContentArgs) => {
  const [presetPrompt, setPresetPrompt] = useState<{
    content?: string;
    description?: string;
  } | null>(null);
  const [enhancedPrompt, setEnhancedPrompt] = useState<string | null>(null);
  const [loadingEnhanced, setLoadingEnhanced] = useState(false);
  const [showEnhanced, setShowEnhanced] = useState(false);

  const systemPromptService = useMemo(() => SystemPromptService.getInstance(), []);
  const agentClient = useMemo(() => AgentClient.getInstance(), []);
  const systemMessageContent =
    message.role === "system" && typeof message.content === "string" ? message.content : "";
  const hasPersistedSystemMessage =
    message.role === "system" &&
    !message.id.startsWith("system-prompt-") &&
    systemMessageContent.trim().length > 0;

  useEffect(() => {
    if (message.role === "system") {
      setEnhancedPrompt(null);
      setShowEnhanced(false);
    }
  }, [message.id, message.role, systemMessageContent]);

  const currentSessionId = currentChat?.id ?? null;
  const systemPromptId = currentChat?.config?.systemPromptId ?? null;

  const userPrompt = useMemo(() => {
    if (!systemPromptId) {
      return null;
    }
    return systemPrompts.find((p) => p.id === systemPromptId) ?? null;
  }, [systemPromptId, systemPrompts]);

  const basePrompt = userPrompt?.content ?? presetPrompt?.content ?? "";
  const categoryDescription = userPrompt?.description ?? presetPrompt?.description ?? "";

  const lastPresetLoadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // Reset any previously fetched preset when switching chats/prompts.
    setPresetPrompt(null);
    lastPresetLoadKeyRef.current = null;
  }, [currentSessionId, systemPromptId]);

  useEffect(() => {
    if (!systemPromptId) {
      return;
    }
    const promptId = systemPromptId;
    // If the user prompt already has content, prefer it and avoid preset fetching.
    if (userPrompt?.content) {
      return;
    }

    // Avoid re-fetch loops when upstream dependencies are unstable (e.g. config objects).
    const loadKey = `${currentSessionId ?? "no-chat"}:${promptId}`;
    if (lastPresetLoadKeyRef.current === loadKey) {
      return;
    }
    lastPresetLoadKeyRef.current = loadKey;

    let cancelled = false;
    const loadPreset = async () => {
      try {
        const preset = await systemPromptService.findPresetById(promptId);
        if (cancelled) {
          return;
        }

        const next = preset ? { content: preset.content, description: preset.description } : null;

        setPresetPrompt((prev) => {
          if (!prev && !next) return prev;
          if (prev && next) {
            if (prev.content === next.content && prev.description === next.description) {
              return prev;
            }
          }
          return next;
        });
      } catch (error) {
        console.error("Failed to load preset prompt:", error);
      }
    };

    void loadPreset();
    return () => {
      cancelled = true;
    };
  }, [currentSessionId, systemPromptId, systemPromptService, userPrompt?.content]);

  const loadEnhancedPrompt = useCallback(async () => {
    if (loadingEnhanced) return;

    setLoadingEnhanced(true);
    try {
      if (currentSessionId) {
        try {
          const snapshot = await agentClient.getSessionSystemPrompt(currentSessionId);
          const effectivePrompt = snapshot.effective_system_prompt?.trim();
          if (effectivePrompt) {
            setEnhancedPrompt(effectivePrompt);
            setShowEnhanced(true);
            return;
          }
        } catch (error) {
          console.warn("Failed to load backend prompt snapshot:", error);
        }
      }

      if (hasPersistedSystemMessage) {
        setEnhancedPrompt(systemMessageContent);
        setShowEnhanced(true);
        return;
      }
      console.warn("Enhanced prompt snapshot unavailable; keeping base prompt view.");
    } catch (error) {
      console.error("Failed to load enhanced prompt:", error);
    } finally {
      setLoadingEnhanced(false);
    }
  }, [
    agentClient,
    currentSessionId,
    hasPersistedSystemMessage,
    loadingEnhanced,
    systemMessageContent,
  ]);

  const promptToDisplay = useMemo(() => {
    if (showEnhanced && enhancedPrompt) {
      return enhancedPrompt;
    }
    if (basePrompt) {
      return basePrompt;
    }
    if (categoryDescription) {
      return categoryDescription;
    }
    if (message.role === "system") {
      return systemMessageContent;
    }
    return "System prompt is being prepared...";
  }, [
    showEnhanced,
    enhancedPrompt,
    basePrompt,
    categoryDescription,
    message.role,
    systemMessageContent,
  ]);

  return {
    basePrompt,
    categoryDescription,
    enhancedPrompt,
    loadingEnhanced,
    loadEnhancedPrompt,
    promptToDisplay,
    showEnhanced,
    setShowEnhanced,
    systemMessageContent,
  };
};
