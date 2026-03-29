import { useCallback, useMemo, useRef, useState } from "react";
import { App as AntApp } from "antd";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { getOpenAIClient } from "../../services/openaiClient";
import type { AssistantTextMessage, Message } from "../../types/chat";
import type { UseChatState } from "./types";
import { useFastModel } from "../useActiveModel";
import i18n from "../../../../shared/i18n";

const PROMPT_TEMPLATE_MARKER = "__BODHI_PROMPT_TITLE__";

const normalizeTitleText = (value: string): string => value.trim().toLowerCase();

const readNestedString = (input: unknown, path: readonly string[]): string | undefined => {
  let current: unknown = input;
  for (const key of path) {
    if (!current || typeof current !== "object" || !(key in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
};

const getResourceTranslationValues = (path: readonly string[]): string[] => {
  const out = new Set<string>();
  const resources = i18n.options.resources;
  if (!resources || typeof resources !== "object") {
    return [];
  }

  Object.values(resources as Record<string, unknown>).forEach((resourceByLocale) => {
    if (!resourceByLocale || typeof resourceByLocale !== "object") {
      return;
    }
    const root =
      "translation" in resourceByLocale &&
      (resourceByLocale as Record<string, unknown>).translation &&
      typeof (resourceByLocale as Record<string, unknown>).translation === "object"
        ? (resourceByLocale as Record<string, unknown>).translation
        : resourceByLocale;
    const value = readNestedString(root, path);
    if (!value) {
      return;
    }
    const normalized = normalizeTitleText(value);
    if (normalized) {
      out.add(normalized);
    }
  });

  return Array.from(out);
};

const buildDefaultTitleMatcher = (
  t: (key: string, options?: Record<string, unknown>) => string,
): ((title: string | undefined | null) => boolean) => {
  const exactMatches = new Set<string>(["new session", "new chat", "main"]);
  const prefixMatches = new Set<string>(["new session", "new chat"]);
  const templateMatches: Array<{ prefix: string; suffix: string }> = [];

  const addDefaultLabel = (label: string) => {
    const normalized = normalizeTitleText(label);
    if (!normalized) {
      return;
    }
    exactMatches.add(normalized);
    prefixMatches.add(normalized);
  };

  const addTemplateLabel = (template: string) => {
    const normalized = normalizeTitleText(template);
    if (!normalized) {
      return;
    }
    if (normalized.includes("{{prompt}}")) {
      const [prefix, suffix] = normalized.split("{{prompt}}", 2);
      templateMatches.push({ prefix, suffix });
      return;
    }
    if (normalized.includes(PROMPT_TEMPLATE_MARKER.toLowerCase())) {
      const [prefix, suffix] = normalized.split(PROMPT_TEMPLATE_MARKER.toLowerCase(), 2);
      templateMatches.push({ prefix, suffix });
      return;
    }
    prefixMatches.add(normalized);
  };

  getResourceTranslationValues(["chat", "sidebar", "newSession"]).forEach(addDefaultLabel);
  getResourceTranslationValues(["chat", "session", "defaultTitle"]).forEach(addDefaultLabel);
  getResourceTranslationValues(["chat", "sidebar", "newSessionWithPrompt"]).forEach(addTemplateLabel);

  addDefaultLabel(t("chat.sidebar.newSession"));
  addDefaultLabel(t("chat.session.defaultTitle"));
  addTemplateLabel(t("chat.sidebar.newSessionWithPrompt", { prompt: PROMPT_TEMPLATE_MARKER }));

  return (title: string | undefined | null) => {
    if (!title) return true;
    const normalized = normalizeTitleText(title);
    if (!normalized) return true;
    if (exactMatches.has(normalized)) return true;

    for (const prefix of prefixMatches) {
      if (!prefix) continue;
      if (
        normalized.startsWith(`${prefix} -`) ||
        normalized.startsWith(`${prefix}-`) ||
        normalized.startsWith(`${prefix}:`) ||
        normalized.startsWith(`${prefix}：`)
      ) {
        return true;
      }
    }

    for (const { prefix, suffix } of templateMatches) {
      if (!normalized.startsWith(prefix) || !normalized.endsWith(suffix)) {
        continue;
      }
      const middle = normalized.slice(prefix.length, normalized.length - suffix.length);
      if (middle.trim().length > 0) {
        return true;
      }
    }

    return false;
  };
};

/**
 * Hook for chat title generation and validation
 * Handles both auto and manual title generation
 */
export interface UseChatTitleGeneration {
  titleGenerationState: Record<string, { status: "idle" | "loading" | "error"; error?: string }>;
  autoGenerateTitles: boolean;
  isUpdatingAutoTitlePreference: boolean;
  generateChatTitle: (sessionId: string, options?: { force?: boolean }) => Promise<void>;
  setAutoGenerateTitlesPreference: (enabled: boolean) => Promise<void>;
  isDefaultTitle: (title: string | undefined | null) => boolean;
}

type ChatTitleState = Pick<UseChatState, "chats" | "updateSession">;

export function useChatTitleGeneration(state: ChatTitleState): UseChatTitleGeneration {
  const { message: appMessage } = AntApp.useApp();
  const { t } = useTranslation();

  const autoGenerateTitles = useAppStore((state) => state.autoGenerateTitles);
  // Use fast/cheap model for title generation (lightweight task, max 20 tokens)
  const fastModel = useFastModel();
  const setAutoGenerateTitlesPreference = useAppStore(
    (state) => state.setAutoGenerateTitlesPreference,
  );
  const isUpdatingAutoTitlePreference = useAppStore((state) => state.isUpdatingAutoTitlePreference);

  const autoTitleGeneratedRef = useRef<Set<string>>(new Set());
  const titleGenerationInFlightRef = useRef<Set<string>>(new Set());
  const [titleGenerationState, setTitleGenerationState] = useState<
    Record<string, { status: "idle" | "loading" | "error"; error?: string }>
  >({});

  const isDefaultTitleMatcher = useMemo(
    () => buildDefaultTitleMatcher((key, options) => t(key, options)),
    [t, i18n.language],
  );
  const isDefaultTitle = useCallback(
    (title: string | undefined | null) => isDefaultTitleMatcher(title),
    [isDefaultTitleMatcher],
  );

  const generateChatTitle = useCallback(
    async (sessionId: string, options?: { force?: boolean }) => {
      const chat = state.chats.find((c) => c.id === sessionId);
      if (!chat) {
        return;
      }

      const userAssistantMessages = chat.messages.filter((msg: Message) => {
        if (msg.role === "user") return true;
        if (msg.role === "assistant" && "type" in msg) {
          return (msg as AssistantTextMessage).type === "text";
        }
        return false;
      });

      const isAuto = !options?.force;
      if (isAuto && !autoGenerateTitles) {
        return;
      }
      const MAX_AUTO_MESSAGES = 6;

      if (isAuto) {
        if (titleGenerationInFlightRef.current.has(sessionId)) {
          return;
        }
        if (autoTitleGeneratedRef.current.has(sessionId)) {
          return;
        }
        if (!isDefaultTitle(chat.title)) {
          return;
        }
        if (userAssistantMessages.length === 0) {
          return;
        }
        if (userAssistantMessages.length > MAX_AUTO_MESSAGES) {
          return;
        }
      }

      titleGenerationInFlightRef.current.add(sessionId);
      setTitleGenerationState((prev) => ({
        ...prev,
        [sessionId]: { status: "loading" },
      }));

      try {
        let candidate = await generateTitleWithAI(userAssistantMessages, fastModel);
        if (!candidate) {
          candidate = buildFallbackTitle(userAssistantMessages);
        }
        if (!candidate) {
          if (isAuto) {
            setTitleGenerationState((prev) => ({
              ...prev,
              [sessionId]: { status: "idle" },
            }));
            return;
          }
          throw new Error(t("chat.title.generateFailed"));
        }

        state.updateSession(sessionId, { title: candidate });
        if (!isAuto || candidate.toLowerCase() !== "new chat") {
          autoTitleGeneratedRef.current.add(sessionId);
        }

        setTitleGenerationState((prev) => ({
          ...prev,
          [sessionId]: { status: "idle" },
        }));

        if (options?.force) {
          appMessage?.success?.(t("chat.title.updated"));
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : t("chat.title.generateFailed");
        setTitleGenerationState((prev) => ({
          ...prev,
          [sessionId]: { status: "error", error: errorMessage },
        }));
        if (options?.force) {
          appMessage?.error?.(errorMessage);
        } else {
          appMessage?.warning?.(errorMessage);
        }
      } finally {
        titleGenerationInFlightRef.current.delete(sessionId);
      }
    },
    [appMessage, autoGenerateTitles, isDefaultTitle, fastModel, state, t],
  );

  return {
    titleGenerationState,
    autoGenerateTitles,
    isUpdatingAutoTitlePreference,
    generateChatTitle,
    setAutoGenerateTitlesPreference,
    isDefaultTitle,
  };
}

const MAX_TITLE_CHARS = 60;
const MAX_TITLE_TOKENS = 20;
const MAX_MESSAGES_FOR_TITLE = 8;
const MAX_MESSAGE_CHARS = 220;

const extractMessageText = (message: Message): string => {
  if ("content" in message && typeof message.content === "string") {
    return message.content.trim();
  }
  if ("displayText" in message && typeof message.displayText === "string") {
    return message.displayText.trim();
  }
  return "";
};

const buildTitleContext = (messages: Message[]): string => {
  const slice = messages.slice(0, MAX_MESSAGES_FOR_TITLE);
  const lines = slice
    .map((message) => {
      const role = message.role === "user" ? "User" : "Assistant";
      const text = extractMessageText(message);
      if (!text) return "";
      const trimmed =
        text.length > MAX_MESSAGE_CHARS ? `${text.slice(0, MAX_MESSAGE_CHARS - 3)}...` : text;
      return `${role}: ${trimmed}`;
    })
    .filter((line) => line.length > 0);

  return lines.join("\n");
};

const buildFallbackTitle = (messages: Message[]): string => {
  const ordered = [
    ...messages.filter((message) => message.role === "user"),
    ...messages.filter((message) => message.role !== "user"),
  ];
  for (const message of ordered) {
    const text = extractMessageText(message).replace(/\s+/g, " ").trim();
    if (!text) {
      continue;
    }
    const title = normalizeTitle(text);
    if (title) {
      return title;
    }
  }
  return "";
};

const normalizeTitle = (title: string): string => {
  const singleLine = title.split(/\r?\n/)[0]?.trim() ?? "";
  const unquoted = singleLine.replace(/^["']+|["']+$/g, "");
  if (unquoted.length <= MAX_TITLE_CHARS) {
    return unquoted;
  }
  return `${unquoted.slice(0, MAX_TITLE_CHARS - 3)}...`;
};

const extractTextFromCompletionMessage = (message: unknown): string => {
  if (!message || typeof message !== "object") {
    return "";
  }
  const record = message as Record<string, unknown>;
  const content = record.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (!part || typeof part !== "object") {
          return "";
        }
        const obj = part as Record<string, unknown>;
        if (typeof obj.text === "string") {
          return obj.text;
        }
        if (obj.text && typeof obj.text === "object") {
          const nested = obj.text as Record<string, unknown>;
          if (typeof nested.value === "string") {
            return nested.value;
          }
        }
        if (typeof obj.content === "string") {
          return obj.content;
        }
        return "";
      })
      .filter((part): part is string => part.trim().length > 0);
    return parts.join("\n");
  }

  if (typeof record.refusal === "string") {
    return record.refusal;
  }

  return "";
};

const generateTitleWithAI = async (messages: Message[], model?: string | null): Promise<string> => {
  const context = buildTitleContext(messages);
  if (!context) {
    return "";
  }

  const modelToUse = model?.trim();
  if (!modelToUse) {
    throw new Error("No model configured. Please select a default model in Provider Settings.");
  }

  const client = getOpenAIClient();
  const response = await client.chat.completions.create({
    model: modelToUse,
    temperature: 0.2,
    max_tokens: MAX_TITLE_TOKENS,
    messages: [
      {
        role: "system",
        content:
          "You generate concise English chat titles. Return only the title text, no quotes or punctuation.",
      },
      {
        role: "user",
        content: `Create a short descriptive title (max ${MAX_TITLE_CHARS} characters) for this chat:\n\n${context}`,
      },
    ],
  });

  const candidate = extractTextFromCompletionMessage(response.choices?.[0]?.message).trim();
  return normalizeTitle(candidate);
};
