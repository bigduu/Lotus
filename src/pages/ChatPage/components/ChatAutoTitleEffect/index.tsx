import { useEffect, useRef } from "react";
import { useAppStore } from "../../store";
import { useChatTitleGeneration } from "../../hooks/useChatManager/useChatTitleGeneration";

export const ChatAutoTitleEffect: React.FC = () => {
  const chats = useAppStore((state) => state.chats);
  const updateSession = useAppStore((state) => state.updateSession);
  const { generateChatTitle } = useChatTitleGeneration({ chats, updateSession });

  // Track last processed message ID per chat
  const lastAutoTitleMessageIdsRef = useRef<Map<string, string>>(new Map());

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

      // Mark as processed
      lastAutoTitleMessageIdsRef.current.set(sessionId, lastMessage.id);

      // Generate title
      generateChatTitle(sessionId).catch((error) => {
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
      }
    });
  }, [chats]);

  return null;
};
