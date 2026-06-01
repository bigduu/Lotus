import { type ReasoningEffort } from "@services/chat/AgentService";

export const CHAT_SEND_MESSAGE_EVENT = "chat-send-message";
export const CHAT_REFERENCE_TEXT_EVENT = "reference-text";
export const MODEL_OPTIONS_CACHE_PREFIX = "chat-model-options-cache-v1";
export const MODEL_OPTIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
export const EMPTY_ALLOWED_TOOLS: string[] = [];
export const DEFAULT_GOAL_MAX_OUTPUT_TOKENS = 1024;
export const DEFAULT_GOAL_MAX_AUTO_CONTINUATIONS = 3;
