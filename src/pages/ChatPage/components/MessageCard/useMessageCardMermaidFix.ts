import { useCallback } from "react";
import { getOpenAIClient } from "../../services/openaiClient";
import { useAppStore } from "../../store";
import { useFastModel } from "../../hooks/useActiveModel";
import { useFastModelRef } from "../../hooks/useActiveModelRef";
import { agentClient } from "@services/chat/AgentService";
import type { AssistantTextMessage, Message } from "@shared/types/chat";

const extractMermaidCode = (content: string) => {
  const match = content.match(/```mermaid\s*([\s\S]*?)```/i);
  if (match) return match[1].trim();
  return content.trim();
};

const replaceMermaidBlock = (content: string, originalChart: string, fixedChart: string) => {
  const normalizedOriginal = originalChart.trim();
  const normalizedFixed = extractMermaidCode(fixedChart);
  const mermaidBlockPattern = /```mermaid\s*([\s\S]*?)```/gi;
  let replaced = false;
  const updated = content.replace(mermaidBlockPattern, (match, block) => {
    if (replaced) return match;
    if (block.trim() !== normalizedOriginal) return match;
    replaced = true;
    return `\`\`\`mermaid\n${normalizedFixed}\n\`\`\``;
  });

  if (replaced) {
    return updated;
  }

  const fallbackMatch = content.match(mermaidBlockPattern);
  if (!fallbackMatch) {
    return null;
  }

  return content.replace(mermaidBlockPattern, (match) => {
    if (replaced) return match;
    replaced = true;
    return `\`\`\`mermaid\n${normalizedFixed}\n\`\`\``;
  });
};

const DERIVED_TEXT_MESSAGE_SUFFIX = "_text";

const isAssistantTextMessage = (message: Message | undefined): message is AssistantTextMessage =>
  Boolean(message && message.role === "assistant" && "type" in message && message.type === "text");

const getBackendMessageId = (
  messageId: string,
  message: AssistantTextMessage,
  messages: Message[],
): string => {
  const metadataBackendId =
    typeof message.metadata?.backendMessageId === "string"
      ? message.metadata.backendMessageId.trim()
      : "";
  if (metadataBackendId) {
    return metadataBackendId;
  }

  if (messageId.endsWith(DERIVED_TEXT_MESSAGE_SUFFIX)) {
    const candidate = messageId.slice(0, -DERIVED_TEXT_MESSAGE_SUFFIX.length);
    if (candidate && messages.some((item) => item.id === candidate)) {
      return candidate;
    }
  }

  return messageId;
};

const hasMatchingMermaidBlock = (content: string, originalChart: string) => {
  const normalizedOriginal = originalChart.trim();
  if (!normalizedOriginal) {
    return false;
  }

  const matches = content.matchAll(/```mermaid\s*([\s\S]*?)```/gi);
  for (const match of matches) {
    if ((match[1] || "").trim() === normalizedOriginal) {
      return true;
    }
  }
  return false;
};

const isMessageNotFoundError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("message not found");
};

const findRetryMessage = (
  messages: Message[],
  originalMessageId: string,
  originalContent: string,
  originalChart: string,
): AssistantTextMessage | undefined => {
  const byExactId = messages.find((item) => item.id === originalMessageId);
  if (isAssistantTextMessage(byExactId)) {
    return byExactId;
  }

  return messages.find(
    (item) =>
      isAssistantTextMessage(item) &&
      (item.content === originalContent || hasMatchingMermaidBlock(item.content, originalChart)),
  ) as AssistantTextMessage | undefined;
};

const buildMermaidFixPrompt = (chart: string, renderError?: string) => {
  const normalizedError = (renderError ?? "").trim();
  const sections = ["Original Mermaid code:", "```mermaid", chart.trim(), "```"];

  if (normalizedError) {
    sections.push("", "Mermaid parser/render error:", normalizedError);
  }

  sections.push(
    "",
    "Please fix the Mermaid syntax while preserving the original meaning and labels.",
  );

  return sections.join("\n");
};

const fixMermaidWithAI = async (chart: string, model?: string | null, renderError?: string) => {
  const modelToUse = model?.trim();
  if (!modelToUse) {
    throw new Error("No model configured. Please select a default model in Provider Settings.");
  }
  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: modelToUse,
    messages: [
      {
        role: "system",
        content:
          "You fix Mermaid diagrams using the parser/render error context. Return only corrected Mermaid code without markdown fences or extra text.",
      },
      {
        role: "user",
        content: buildMermaidFixPrompt(chart, renderError),
      },
    ],
    temperature: 0,
  });
  const content = response.choices?.[0]?.message?.content ?? "";
  return extractMermaidCode(content);
};

export const useMessageCardMermaidFix = (messageId: string, sessionId?: string | null) => {
  // Use fast/cheap model for mermaid fix (lightweight syntax repair task)
  const fastModel = useFastModel();
  const fastModelRef = useFastModelRef();
  const effectiveFastModel = fastModelRef?.model ?? fastModel;

  return useCallback(
    async (chart: string, renderError?: string) => {
      const state = useAppStore.getState();
      const targetSessionId = sessionId ?? state.currentSessionId;
      const currentChat = state.chats.find((c) => c.id === targetSessionId);

      if (!targetSessionId || !currentChat) {
        throw new Error("No active chat available");
      }

      const msg = currentChat.messages.find((m) => m.id === messageId);
      if (!isAssistantTextMessage(msg)) {
        throw new Error("Mermaid fix is only available for assistant text messages");
      }

      const fixedChart = await fixMermaidWithAI(chart, effectiveFastModel, renderError);
      if (!fixedChart) throw new Error("AI did not return a Mermaid fix");

      const updatedContent = replaceMermaidBlock(msg.content, chart, fixedChart);
      if (!updatedContent) {
        throw new Error("Unable to locate Mermaid block to update");
      }

      let patchMessageId = getBackendMessageId(messageId, msg, currentChat.messages);
      try {
        await agentClient.patchSessionMessage(targetSessionId, patchMessageId, {
          content: updatedContent,
        });
      } catch (error) {
        if (!isMessageNotFoundError(error)) {
          throw error;
        }

        await state.loadChatHistory(targetSessionId, {
          mode: "replace",
          retries: 2,
          retryDelayMs: 150,
          waitForAssistant: true,
        });

        const refreshedState = useAppStore.getState();
        const refreshedChat = refreshedState.chats.find((c) => c.id === targetSessionId);
        if (!refreshedChat) {
          throw error;
        }

        const retryMessage = findRetryMessage(
          refreshedChat.messages,
          messageId,
          msg.content,
          chart,
        );
        if (!retryMessage) {
          throw error;
        }

        patchMessageId = getBackendMessageId(retryMessage.id, retryMessage, refreshedChat.messages);

        await agentClient.patchSessionMessage(targetSessionId, patchMessageId, {
          content: updatedContent,
        });
      }

      const latestState = useAppStore.getState();
      const latestChat = latestState.chats.find((c) => c.id === targetSessionId);
      if (!latestChat) {
        throw new Error("No active chat available");
      }

      const idsToUpdate = new Set([messageId, patchMessageId]);
      const updatedMessages = latestChat.messages.map((m) => {
        if (!idsToUpdate.has(m.id) || !isAssistantTextMessage(m)) {
          return m;
        }
        return { ...m, content: updatedContent };
      });

      latestState.updateSession(targetSessionId, { messages: updatedMessages });
    },
    [messageId, sessionId, effectiveFastModel],
  );
};
