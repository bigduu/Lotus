import { useCallback } from "react";
import { useAppStore } from "../../store";
import type { ChatItem } from "@shared/types/chat";

interface UseMessageCardPlanActionsProps {
  currentSessionId?: string | null;
  updateSession: (sessionId: string, update: Partial<ChatItem>) => void;
  sendMessage: (message: string) => Promise<void>;
}

export const useMessageCardPlanActions = ({
  currentSessionId,
  updateSession,
  sendMessage,
}: UseMessageCardPlanActionsProps) => {
  const handleExecutePlan = useCallback(async () => {
    if (!currentSessionId) return;

    // Get current chat state lazily at execution time
    const state = useAppStore.getState();
    const currentChat = state.chats.find((c) => c.id === currentSessionId);
    if (!currentChat) return;

    try {
      updateSession(currentSessionId, {
        config: {
          ...currentChat.config,
          agentRole: "actor",
        },
      });
    } catch (error) {
      console.error("Failed to switch to Actor role:", error);
    }
  }, [currentSessionId, updateSession]);

  const handleRefinePlan = useCallback(
    async (feedback: string) => {
      if (!feedback.trim()) return;
      try {
        await sendMessage(feedback.trim());
      } catch (error) {
        console.error("Failed to send plan refinement:", error);
      }
    },
    [sendMessage],
  );

  const handleQuestionAnswer = useCallback(
    async (answer: string) => {
      if (!answer) return;
      try {
        await sendMessage(answer);
      } catch (error) {
        console.error("Failed to send answer:", error);
        throw error;
      }
    },
    [sendMessage],
  );

  return { handleExecutePlan, handleRefinePlan, handleQuestionAnswer };
};
