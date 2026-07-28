import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import i18n from "i18next";

import type { Message, UserSystemPrompt } from "@shared/types/chat";
import { SystemPromptService } from "@shared/services/SystemPromptService";
import { AgentClient, type SessionSystemPromptResponse } from "@services/chat/AgentService";

type UseSystemPromptContentArgs = {
  currentChat: {
    id: string;
    config?: { systemPromptId?: string; workspacePath?: string };
  } | null;
  message: Message;
  systemPrompts: UserSystemPrompt[];
};

export type PromptSnapshotSectionKey =
  | "base"
  | "enhancement"
  | "project"
  | "workspace"
  | "instruction"
  | "env"
  | "skills"
  | "toolGuide"
  | "dream"
  | "sessionMemory"
  | "externalMemory"
  | "taskList"
  | "effective";

export type PromptSnapshotSection = {
  key: PromptSnapshotSectionKey;
  content: string;
};

export type PromptInspectorContextDetails = {
  projectPath: string | null;
  sessionWorkspacePath: string | null;
  effectiveWorkspacePath: string | null;
  resourceRevision: number | null;
  usesProjectPathFallback: boolean;
};

const normalizeSnapshotContent = (value?: string | null): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

/**
 * Join Bamboo's structured Project/session fields for the Inspector.
 *
 * `project_context` and `workspace_context` are opaque prompt sections. They
 * are deliberately not parsed for metadata: Project path and resource
 * revision come from ProjectStore, while the session workspace comes from the
 * authoritative SessionSummary mapped onto `currentChat`.
 */
export const buildPromptInspectorContextDetails = (
  fields: {
    projectPath?: string | null;
    sessionWorkspacePath?: string | null;
    resourceRevision?: number | null;
  } = {},
): PromptInspectorContextDetails => {
  const projectPath = normalizeSnapshotContent(fields.projectPath);
  const sessionWorkspacePath = normalizeSnapshotContent(fields.sessionWorkspacePath);
  const effectiveWorkspacePath = sessionWorkspacePath ?? projectPath;

  return {
    projectPath,
    sessionWorkspacePath,
    effectiveWorkspacePath,
    resourceRevision:
      typeof fields.resourceRevision === "number" && Number.isFinite(fields.resourceRevision)
        ? fields.resourceRevision
        : null,
    usesProjectPathFallback: sessionWorkspacePath === null && projectPath !== null,
  };
};

export const buildPromptSnapshotSections = (
  snapshot: SessionSystemPromptResponse | null,
): PromptSnapshotSection[] => {
  if (!snapshot) {
    return [];
  }

  const candidates: Array<[PromptSnapshotSectionKey, string | undefined]> = [
    ["base", snapshot.base_system_prompt],
    ["enhancement", snapshot.enhancement_prompt],
    ["project", snapshot.project_context],
    ["workspace", snapshot.workspace_context],
    ["instruction", snapshot.instruction_context],
    ["env", snapshot.env_context],
    ["skills", snapshot.skill_context],
    ["toolGuide", snapshot.tool_guide_context],
    ["dream", snapshot.dream_notebook],
    ["sessionMemory", snapshot.session_memory_note],
    ["externalMemory", snapshot.external_memory],
    ["taskList", snapshot.task_list],
    ["effective", snapshot.effective_system_prompt],
  ];

  return candidates.flatMap(([key, content]) => {
    const normalized = normalizeSnapshotContent(content);
    return normalized ? [{ key, content: normalized }] : [];
  });
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
  const [promptSnapshot, setPromptSnapshot] = useState<SessionSystemPromptResponse | null>(null);
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
      setPromptSnapshot(null);
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
    setPresetPrompt(null);
    lastPresetLoadKeyRef.current = null;
  }, [currentSessionId, systemPromptId]);

  useEffect(() => {
    if (!systemPromptId) {
      return;
    }
    const promptId = systemPromptId;
    if (userPrompt?.content) {
      return;
    }

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
          setPromptSnapshot(snapshot);
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
        setPromptSnapshot(null);
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
    return i18n.t("chat.systemPrompt.preparing");
  }, [
    showEnhanced,
    enhancedPrompt,
    basePrompt,
    categoryDescription,
    message.role,
    systemMessageContent,
  ]);

  const snapshotSections = useMemo(
    () => buildPromptSnapshotSections(promptSnapshot),
    [promptSnapshot],
  );

  return {
    basePrompt,
    categoryDescription,
    enhancedPrompt,
    loadingEnhanced,
    loadEnhancedPrompt,
    promptSnapshot,
    promptToDisplay,
    showEnhanced,
    setShowEnhanced,
    snapshotSections,
    systemMessageContent,
  };
};
