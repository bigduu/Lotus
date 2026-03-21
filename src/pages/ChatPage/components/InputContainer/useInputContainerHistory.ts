import { useCallback } from "react";
import type { Message } from "../../types/chat";
import type { ReasoningEffort } from "../../services/AgentService";
import type { MessageRetryMode } from "../MessageInput/types";

interface UseInputContainerHistoryProps {
  currentSessionId: string | null;
  currentChat: any | null;
  currentMessages: Message[];
  reasoningEffort: ReasoningEffort;
  retryLastTurn: (
    reasoningEffort?: ReasoningEffort,
    mode?: MessageRetryMode,
  ) => Promise<void>;
  navigate: (
    direction: "previous" | "next",
    currentValue: string,
  ) => {
    applied: boolean;
    value: string | null;
  };
}

export const useInputContainerHistory = ({
  currentSessionId,
  currentChat,
  currentMessages,
  reasoningEffort,
  retryLastTurn,
  navigate,
}: UseInputContainerHistoryProps) => {
  const retryLastMessage = useCallback(
    async (mode: MessageRetryMode = "regenerate") => {
      if (!currentSessionId || !currentChat) return;
      const history = [...currentMessages];
      if (history.length === 0) return;

      // Find the last user message
      const lastUserIndex = [...history]
        .reverse()
        .findIndex((msg) => msg.role === "user");

      if (lastUserIndex === -1) return;

      await retryLastTurn(reasoningEffort, mode);
    },
    [
      currentChat,
      currentSessionId,
      currentMessages,
      reasoningEffort,
      retryLastTurn,
    ],
  );

  const handleHistoryNavigate = useCallback(
    (direction: "previous" | "next", currentValue: string): string | null => {
      const result = navigate(direction, currentValue);
      if (!result.applied) {
        return null;
      }
      return result.value;
    },
    [navigate],
  );

  return { retryLastMessage, handleHistoryNavigate };
};
