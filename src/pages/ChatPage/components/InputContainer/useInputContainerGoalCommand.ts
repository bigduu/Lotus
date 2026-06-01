import { useCallback } from "react";
import type { RefObject } from "react";
import type { TextAreaRef } from "antd/es/input/TextArea";
import type { MessageInstance } from "antd/es/message/interface";
import type { ChatItem } from "@shared/types/chat";
import { type GoldConfig } from "@services/chat/AgentService";
import { DEFAULT_GOAL_MAX_OUTPUT_TOKENS, DEFAULT_GOAL_MAX_AUTO_CONTINUATIONS } from "./constants";

interface UseInputContainerGoalCommandProps {
  sessionId: string | null;
  currentChat: ChatItem | null;
  updateSession: (
    sessionId: string,
    updates: Partial<ChatItem>,
    options?: { skipBackendPatch?: boolean },
  ) => void;
  messageApi: MessageInstance;
  recordEntry: (entry: string) => void;
  clearCommandDraft: () => void;
  textAreaRef: RefObject<TextAreaRef>;
  setContent: (newContent: string) => void;
}

/**
 * /goal command handling. NOTE: /goal commands are now handled server-side by
 * Bamboo; this hook is retained for local-only UI feedback (toasts) in a future
 * iteration. `handleGoalCommand` is currently not wired into the submit path.
 */
export const useInputContainerGoalCommand = ({
  sessionId,
  currentChat,
  updateSession,
  messageApi,
  recordEntry,
  clearCommandDraft,
  textAreaRef,
  setContent,
}: UseInputContainerGoalCommandProps) => {
  const sessionGoldConfig = currentChat?.config?.goldConfig ?? null;
  const isGoalEnabled = sessionGoldConfig?.enabled === true;
  const goalPrompt = sessionGoldConfig?.goal ?? sessionGoldConfig?.evaluation_prompt ?? "";

  const buildSessionGoalConfig = useCallback(
    (enabled: boolean, prompt: string): GoldConfig => ({
      ...(sessionGoldConfig ?? {}),
      enabled,
      auto_answer_enabled: enabled,
      auto_continue_enabled: enabled,
      goal: prompt.trim() || undefined,
      max_output_tokens: sessionGoldConfig?.max_output_tokens ?? DEFAULT_GOAL_MAX_OUTPUT_TOKENS,
      max_auto_continuations:
        sessionGoldConfig?.max_auto_continuations ?? DEFAULT_GOAL_MAX_AUTO_CONTINUATIONS,
    }),
    [sessionGoldConfig],
  );

  const persistGoalConfig = useCallback(
    (nextConfig: GoldConfig) => {
      if (!sessionId || !currentChat) return;
      updateSession(sessionId, {
        config: {
          ...currentChat.config,
          goldConfig: nextConfig,
        },
      });
    },
    [currentChat, sessionId, updateSession],
  );

  const clearGoalCommandInput = useCallback(() => {
    setContent("");
    clearCommandDraft();
    requestAnimationFrame(() => {
      textAreaRef.current?.focus();
    });
  }, [clearCommandDraft, setContent, textAreaRef]);

  const handleGoalCommand = useCallback(
    async (rawMessage: string): Promise<boolean> => {
      const trimmed = rawMessage.trim();
      if (!/^\/goal(?:\s|$)/i.test(trimmed)) {
        return false;
      }

      if (!sessionId || !currentChat) {
        messageApi.warning("Create or select a session before using /goal.");
        return true;
      }

      const commandArg = trimmed.replace(/^\/goal(?:\s+)?/i, "").trim();
      const normalizedArg = commandArg.toLowerCase();
      recordEntry(trimmed);

      if (!commandArg || normalizedArg === "status") {
        const previewPrompt = goalPrompt.trim();
        const clippedPrompt =
          previewPrompt.length > 120 ? `${previewPrompt.slice(0, 120)}…` : previewPrompt;
        messageApi.info(
          isGoalEnabled
            ? `Goal is enabled for this session${clippedPrompt ? `: ${clippedPrompt}` : "."}`
            : "Goal is disabled for this session. Use /goal <prompt> to enable it.",
        );
        clearGoalCommandInput();
        return true;
      }

      if (["off", "disable", "disabled"].includes(normalizedArg)) {
        const nextPrompt = goalPrompt;
        persistGoalConfig(buildSessionGoalConfig(false, nextPrompt));
        messageApi.success("Goal disabled for this session.");
        clearGoalCommandInput();
        return true;
      }

      if (["clear", "reset"].includes(normalizedArg)) {
        persistGoalConfig(buildSessionGoalConfig(false, ""));
        messageApi.success("Goal cleared for this session.");
        clearGoalCommandInput();
        return true;
      }

      if (["on", "enable", "enabled"].includes(normalizedArg)) {
        const nextPrompt = goalPrompt.trim();
        if (!nextPrompt) {
          messageApi.warning("Usage: /goal <prompt> to enable Goal for this session.");
          return true;
        }
        persistGoalConfig(buildSessionGoalConfig(true, nextPrompt));
        messageApi.success("Goal enabled for this session.");
        clearGoalCommandInput();
        return true;
      }

      persistGoalConfig(buildSessionGoalConfig(true, commandArg));
      messageApi.success("Goal enabled for this session.");
      clearGoalCommandInput();
      return true;
    },
    [
      buildSessionGoalConfig,
      clearGoalCommandInput,
      currentChat,
      goalPrompt,
      isGoalEnabled,
      messageApi,
      persistGoalConfig,
      recordEntry,
      sessionId,
    ],
  );

  return { handleGoalCommand };
};
