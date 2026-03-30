import { useEffect, useRef } from "react";
import { useAppStore } from "../../store";
import { useChatTitleGeneration } from "../../hooks/useChatManager/useChatTitleGeneration";

const AUTO_TITLE_RETRY_COOLDOWN_MS = 15_000;

export const ChatAutoTitleEffect: React.FC = () => {
  const chats = useAppStore((state) => state.chats);
  const updateSession = useAppStore((state) => state.updateSession);
  const { generateChatTitle } = useChatTitleGeneration({ chats, updateSession });

  // Track last processed message ID per chat
  const lastAutoTitleMessageIdsRef = useRef<Map<string, string>>(new Map());
  // Track failed attempts (same assistant message) to avoid retry spam.
  const lastAutoTitleFailedRef = useRef<Map<string, { messageId: string; at: number }>>(new Map());

  useEffect(() => {
    // Process ALL chats, not just current
    chats.forEach((chat) => {
      const sessionId = chat.id;
      const messages = chat.messages;

      if (messages.length === 0) return;

      const lastMessage = messages[messages.length - 1];

      // Skip if not assistant message
      if (lastMessage.role !== "assistant") return;

      // Skip if already processed this message
      const lastProcessedId = lastAutoTitleMessageIdsRef.current.get(sessionId);
      if (lastMessage.id === lastProcessedId) return;

      // Back off retries for the same failed assistant message.
      const failed = lastAutoTitleFailedRef.current.get(sessionId);
      if (
        failed &&
        failed.messageId === lastMessage.id &&
        Date.now() - failed.at < AUTO_TITLE_RETRY_COOLDOWN_MS
      ) {
        return;
      }

      // Generate title
      generateChatTitle(sessionId)
        .then((generated) => {
          if (!generated) {
            return;
          }
          // Mark as processed only after generation flow completes successfully.
          lastAutoTitleMessageIdsRef.current.set(sessionId, lastMessage.id);
          lastAutoTitleFailedRef.current.delete(sessionId);
        })
        .catch((error) => {
          lastAutoTitleFailedRef.current.set(sessionId, {
            messageId: lastMessage.id,
            at: Date.now(),
          });
          console.warn("Auto title generation failed for chat", sessionId, ":", error);
        });
    });
  }, [chats, generateChatTitle]);

  // Clean up refs for deleted chats
  useEffect(() => {
    const currentSessionIds = new Set(chats.map((c) => c.id));
    const trackedIds = Array.from(lastAutoTitleMessageIdsRef.current.keys());

    trackedIds.forEach((sessionId) => {
      if (!currentSessionIds.has(sessionId)) {
        lastAutoTitleMessageIdsRef.current.delete(sessionId);
        lastAutoTitleFailedRef.current.delete(sessionId);
      }
    });
  }, [chats]);

  return null;
};
