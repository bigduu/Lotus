import { useCallback } from "react";
import { getOpenAIClient } from "../../services/openaiClient";
import { useAppStore } from "../../store";
import { useActiveModel } from "../../hooks/useActiveModel";

const extractMermaidCode = (content: string) => {
  const match = content.match(/```mermaid\s*([\s\S]*?)```/i);
  if (match) return match[1].trim();
  return content.trim();
};

const replaceMermaidBlock = (
  content: string,
  originalChart: string,
  fixedChart: string,
) => {
  const normalizedOriginal = originalChart.trim();
  const normalizedFixed = extractMermaidCode(fixedChart);
  let replaced = false;
  const updated = content.replace(
    /```mermaid\s*([\s\S]*?)```/gi,
    (match, block) => {
      if (replaced) return match;
      if (block.trim() !== normalizedOriginal) return match;
      replaced = true;
      return `\`\`\`mermaid\n${normalizedFixed}\n\`\`\``;
    },
  );
  return replaced ? updated : null;
};

const buildMermaidFixPrompt = (chart: string, renderError?: string) => {
  const normalizedError = (renderError ?? "").trim();
  const sections = [
    "Original Mermaid code:",
    "```mermaid",
    chart.trim(),
    "```",
  ];

  if (normalizedError) {
    sections.push("", "Mermaid parser/render error:", normalizedError);
  }

  sections.push(
    "",
    "Please fix the Mermaid syntax while preserving the original meaning and labels.",
  );

  return sections.join("\n");
};

const fixMermaidWithAI = async (
  chart: string,
  model?: string | null,
  renderError?: string,
) => {
  const modelToUse = model?.trim();
  if (!modelToUse) {
    throw new Error(
      "No model configured. Please select a default model in Provider Settings.",
    );
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

export const useMessageCardMermaidFix = (messageId: string) => {
  const activeModel = useActiveModel();

  return useCallback(
    async (chart: string, renderError?: string) => {
      const state = useAppStore.getState();
      const currentSessionId = state.currentSessionId;
      const currentChat = state.chats.find((c) => c.id === currentSessionId);

      if (!currentSessionId || !currentChat) {
        throw new Error("No active chat available");
      }

      const msg = currentChat.messages.find((m) => m.id === messageId);
      if (!msg || msg.role !== "assistant" || msg.type !== "text") {
        throw new Error(
          "Mermaid fix is only available for assistant text messages",
        );
      }

      const fixedChart = await fixMermaidWithAI(
        chart,
        activeModel,
        renderError,
      );
      if (!fixedChart) throw new Error("AI did not return a Mermaid fix");

      const updatedContent = replaceMermaidBlock(
        msg.content,
        chart,
        fixedChart,
      );
      if (!updatedContent) {
        throw new Error("Unable to locate Mermaid block to update");
      }

      const updatedMessages = currentChat.messages.map((m) =>
        m.id === messageId ? { ...m, content: updatedContent } : m,
      );

      state.updateSession(currentSessionId, { messages: updatedMessages });
    },
    [messageId, activeModel],
  );
};
