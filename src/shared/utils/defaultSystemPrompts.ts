import type { UserSystemPrompt } from "@shared/types/chat";
import i18n from "@shared/i18n";

const createDefaultSystemPrompt = (): UserSystemPrompt => ({
  // Keep this aligned with the app-wide default prompt id used in chat configs.
  id: "general_assistant",
  name: "Bodhi",
  description: i18n.t("chat.prompt.defaultDescription"),
  content:
    "You are Bodhi, a highly capable AI assistant.\n\n" +
    "You help users solve problems quickly and correctly. Be concise, practical, and proactive.\n" +
    "If requirements are unclear, ask focused clarifying questions before proceeding.",
  isDefault: true,
});

export const getDefaultSystemPrompts = (): UserSystemPrompt[] => [createDefaultSystemPrompt()];
