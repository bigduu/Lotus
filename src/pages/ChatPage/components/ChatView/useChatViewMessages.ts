import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  Message,
  AssistantToolCallMessage,
  AssistantToolResultMessage,
} from "../../types/chat";
import type { ChatItem } from "../../types/chat";
import type { ToolSessionItem } from "../ToolSessionCard";

export type MessageType = "text" | "plan" | "question" | "tool_call" | "tool_result";

export type RenderableEntry =
  | {
      message: Message;
      messageType?: MessageType;
    }
  | {
      type: "compression_divider";
      id: string;
      createdAt: string;
      label: string;
    }
  | {
      type: "tool_session";
      id: string;
      sessionId: string;
      tools: ToolSessionItem[];
      createdAt: string;
    };

export type ConvertedEntry =
  | {
      type: "message";
      message: Message;
      align: "flex-start" | "flex-end";
      messageType?: MessageType;
    }
  | {
      type: "compression_divider";
      id: string;
      createdAt: string;
      label: string;
    }
  | {
      type: "tool_session";
      id: string;
      sessionId: string;
      tools: ToolSessionItem[];
      createdAt: string;
    };

/**
 * Type guard to check if entry is a tool session
 */
function isToolSessionEntry(
  entry: RenderableEntry,
): entry is Extract<RenderableEntry, { type: "tool_session" }> {
  return "type" in entry && entry.type === "tool_session";
}

function isCompressionDividerEntry(
  entry: RenderableEntry,
): entry is Extract<RenderableEntry, { type: "compression_divider" }> {
  return "type" in entry && entry.type === "compression_divider";
}

const toTimestamp = (iso: string | undefined): number => {
  const parsed = Date.parse(iso || "");
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
};

const getEntryCreatedAt = (entry: RenderableEntry): string => {
  if ("type" in entry) {
    return entry.createdAt;
  }
  return entry.message.createdAt;
};

const isSystemEntry = (entry: RenderableEntry): boolean => {
  return !("type" in entry) && entry.message.role === "system";
};

/**
 * Check if a message is a tool call
 */
function isToolCallMessage(message: Message): message is AssistantToolCallMessage {
  return message.role === "assistant" && "type" in message && message.type === "tool_call";
}

/**
 * Check if a message is a tool result
 */
function isToolResultMessage(message: Message): message is AssistantToolResultMessage {
  return message.role === "assistant" && "type" in message && message.type === "tool_result";
}

const isStructuredSummaryTool = (toolName: string | undefined): boolean => {
  const normalized = (toolName ?? "").trim().toLowerCase();
  return normalized === "conclusion";
};

const getToolCallId = (item: ToolSessionItem): string =>
  item.call.toolCalls?.[0]?.toolCallId || item.result?.toolCallId || "tool-call-missing";

const getToolMessageScopeId = (item: ToolSessionItem, fallbackIndex: number): string =>
  item.call.id ||
  item.callMessageId ||
  item.resultMessageId ||
  item.result?.id ||
  `tool-message-missing-${fallbackIndex}`;

const getToolSessionEntryId = (item: ToolSessionItem, fallbackIndex: number): string =>
  `tool-session-${getToolMessageScopeId(item, fallbackIndex)}:${getToolCallId(item)}`;

/**
 * Split and pair tool call/result messages into per-call entries.
 *
 * This keeps streaming and persisted-history rendering consistent:
 * one tool invocation maps to one visual message entry.
 */
function groupToolMessages(messages: Message[]): Array<Message | ToolSessionItem[]> {
  const result: Array<Message | ToolSessionItem[]> = [];
  const pendingItemsByToolCallId = new Map<string, ToolSessionItem[]>();
  const passthroughToolCallIds = new Set<string>();

  const enqueuePendingItem = (toolCallId: string, item: ToolSessionItem) => {
    const queue = pendingItemsByToolCallId.get(toolCallId) || [];
    queue.push(item);
    pendingItemsByToolCallId.set(toolCallId, queue);
  };

  const consumePendingItem = (toolCallId: string): ToolSessionItem | undefined => {
    const queue = pendingItemsByToolCallId.get(toolCallId);
    if (!queue || queue.length === 0) {
      return undefined;
    }

    let next: ToolSessionItem | undefined;
    while (queue.length > 0 && !next) {
      const candidate = queue.shift();
      if (candidate && !candidate.result) {
        next = candidate;
      }
    }

    if (queue.length === 0) {
      pendingItemsByToolCallId.delete(toolCallId);
    } else {
      pendingItemsByToolCallId.set(toolCallId, queue);
    }

    return next;
  };

  for (const message of messages) {
    if (isToolCallMessage(message)) {
      const toolCalls = message.toolCalls || [];
      if (toolCalls.length === 0) {
        result.push(message);
        continue;
      }

      toolCalls.forEach((toolCall, index) => {
        const callId = toolCall.toolCallId || `${message.id}-${index}`;
        if (isStructuredSummaryTool(toolCall.toolName)) {
          passthroughToolCallIds.add(callId);
          return;
        }
        const singleCallMessage: AssistantToolCallMessage = {
          ...message,
          id: `${message.id}:tool-call:${index}:${callId}`,
          toolCalls: [{ ...toolCall, toolCallId: callId }],
        };
        const item: ToolSessionItem = {
          call: singleCallMessage,
          callMessageId: message.id,
        };
        enqueuePendingItem(callId, item);
        result.push([item]);
      });
      continue;
    }

    if (isToolResultMessage(message)) {
      const toolCallId = message.toolCallId;
      if (toolCallId && passthroughToolCallIds.has(toolCallId)) {
        passthroughToolCallIds.delete(toolCallId);
        result.push(message);
        continue;
      }
      if (isStructuredSummaryTool(message.toolName)) {
        result.push(message);
        continue;
      }
      const existing = toolCallId ? consumePendingItem(toolCallId) : undefined;
      if (existing) {
        existing.result = message;
        existing.resultMessageId = message.id;
      } else {
        const fallbackCallId = toolCallId || `orphan-tool-call:${message.id}`;
        const syntheticCall: AssistantToolCallMessage = {
          role: "assistant",
          type: "tool_call",
          id: `synthetic-tool-call:${message.id}`,
          createdAt: message.createdAt,
          toolCalls: [
            {
              toolCallId: fallbackCallId,
              toolName: (message.toolName || "").trim() || "tool",
              parameters: {},
              streamingOutput: "",
            },
          ],
          isCompressed: message.isCompressed,
          compressedEventId: message.compressedEventId,
        };
        const orphanItem: ToolSessionItem = {
          call: syntheticCall,
          result: message,
          resultMessageId: message.id,
        };
        result.push([orphanItem]);
      }
      continue;
    }

    result.push(message);
  }

  return result;
}

export const useChatViewMessages = (currentChat: ChatItem | null, currentMessages: Message[]) => {
  const { t } = useTranslation();
  const systemPromptMessage = useMemo(() => {
    const existingSystemMessage = currentMessages.find((msg: Message) => msg.role === "system");
    if (existingSystemMessage) {
      return existingSystemMessage as Message;
    }

    if (currentChat?.config?.baseSystemPrompt) {
      return {
        id: `system-prompt-${currentChat.id}`,
        role: "system" as const,
        content: currentChat.config.baseSystemPrompt,
        createdAt: new Date(currentChat.createdAt).toISOString(),
      };
    }

    return null;
  }, [currentChat, currentMessages]);

  const shouldHideMessage = useCallback((_item: Message): boolean => {
    // Keep tool_result messages even when `display_preference === "Hidden"` so
    // ToolSessionCard can accurately compute completion status.
    return false;
  }, []);

  const convertRenderableEntry = useCallback((entry: RenderableEntry): ConvertedEntry => {
    if (isCompressionDividerEntry(entry)) {
      return {
        type: "compression_divider",
        id: entry.id,
        createdAt: entry.createdAt,
        label: entry.label,
      };
    }

    // Handle tool session type
    if (isToolSessionEntry(entry)) {
      return {
        type: "tool_session",
        id: entry.id,
        sessionId: entry.sessionId,
        tools: entry.tools,
        createdAt: entry.createdAt,
      };
    }

    // Handle regular message type
    const align = entry.message.role === "user" ? "flex-end" : "flex-start";

    let resolvedType = entry.messageType;
    if (!resolvedType && entry.message.role === "assistant" && "type" in entry.message) {
      const assistantType = "type" in entry.message ? (entry.message.type as string) : undefined;
      if (
        assistantType === "text" ||
        assistantType === "plan" ||
        assistantType === "question" ||
        assistantType === "tool_call" ||
        assistantType === "tool_result"
      ) {
        resolvedType = assistantType;
      }
    }

    return {
      type: "message",
      message: entry.message,
      align,
      messageType: resolvedType,
    };
  }, []);

  const renderableMessages = useMemo<RenderableEntry[]>(() => {
    const filtered = currentMessages.filter((item) => {
      const role = item.role;

      if (role !== "user" && role !== "assistant" && role !== "system" && role !== "tool") {
        return false;
      }

      if (shouldHideMessage(item)) {
        return false;
      }

      return true;
    });

    // Build per-tool visual entries (stable between streaming and persisted history)
    const grouped = groupToolMessages(filtered);
    const entries: RenderableEntry[] = [];

    grouped.forEach((group, index) => {
      if (Array.isArray(group)) {
        const firstTool = group[0];
        entries.push({
          type: "tool_session",
          id: firstTool ? getToolSessionEntryId(firstTool, index) : `tool-session-unknown-${index}`,
          sessionId: currentChat?.id || "default",
          tools: group,
          createdAt:
            firstTool?.call?.createdAt || firstTool?.result?.createdAt || new Date().toISOString(),
        });
        return;
      }

      // This is a regular message
      const message = group as Message;
      let inferredType: MessageType | undefined;
      if (message.role === "assistant" && "type" in message) {
        const assistantType = "type" in message ? (message.type as string) : undefined;
        if (
          assistantType === "text" ||
          assistantType === "plan" ||
          assistantType === "question" ||
          assistantType === "tool_call" ||
          assistantType === "tool_result"
        ) {
          inferredType = assistantType;
        }
      }

      entries.push({
        message,
        messageType: inferredType,
      });
    });

    const hasSystemMessage = filtered.some((item) => item.role === "system");
    if (!hasSystemMessage && systemPromptMessage) {
      entries.unshift({ message: systemPromptMessage });
    }

    // Insert compression events into timeline by timestamp so newer messages
    // naturally appear below historical compression separators.
    const compressionEvents = currentChat?.config?.compressionEvents || [];
    const firstNonSystemIndex = entries.findIndex((entry) => !isSystemEntry(entry));
    const insertBoundary = firstNonSystemIndex === -1 ? entries.length : firstNonSystemIndex;

    for (const event of compressionEvents) {
      const divider: RenderableEntry = {
        type: "compression_divider",
        id: `compression-divider-${event.id}`,
        createdAt: event.createdAt,
        label: t("chat.compression.timelineDetail", {
          count: event.messagesCompressed,
          defaultValue: "{{count}} messages archived",
        }),
      };
      const eventTs = toTimestamp(event.createdAt);
      const insertIndex = entries.findIndex(
        (entry, index) =>
          index >= insertBoundary && toTimestamp(getEntryCreatedAt(entry)) > eventTs,
      );
      if (insertIndex === -1) {
        entries.push(divider);
      } else {
        entries.splice(insertIndex, 0, divider);
      }
    }

    return entries;
  }, [
    currentChat?.config?.compressionEvents,
    currentChat?.id,
    currentMessages,
    shouldHideMessage,
    systemPromptMessage,
    t,
  ]);

  return {
    systemPromptMessage,
    renderableMessages,
    convertRenderableEntry,
  };
};
