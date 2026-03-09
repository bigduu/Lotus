import type { UserSystemPrompt } from "../types/chat";

const DEFAULT_SYSTEM_PROMPT: UserSystemPrompt = {
  // Keep this aligned with the app-wide default prompt id used in chat configs.
  id: "general_assistant",
  name: "Bodhi",
  description: "Default system prompt.",
  content:
    "You are Bodhi, a highly capable AI assistant.\n\n" +
    "You help users solve problems quickly and correctly. Be concise, practical, and proactive.\n" +
    "If requirements are unclear, ask focused clarifying questions before proceeding.\n" +
    "For recurring or delayed tasks, use the `schedule_tasks` tool to create and manage schedule jobs.\n" +
    "Bamboo configuration is stored at `${BAMBOO_DATA_DIR}/config.json` (default: `~/.bamboo/config.json`, Windows: `%USERPROFILE%\\\\.bamboo\\\\config.json`).",
  isDefault: true,
};

export const getDefaultSystemPrompts = (): UserSystemPrompt[] => [
  { ...DEFAULT_SYSTEM_PROMPT },
];
