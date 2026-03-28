import { StateCreator } from "zustand";
import {
  ChatItem,
  Message,
  SystemMessage,
  UserMessage,
  AssistantTextMessage,
  AssistantToolCallMessage,
  AssistantToolResultMessage,
  MessageImage,
} from "../../types/chat";
import { AgentClient, SessionSummary } from "../../services/AgentService";
import { getDefaultSystemPrompts } from "../../utils/defaultSystemPrompts";
import { getBackendBaseUrlSync } from "@shared/utils/backendBaseUrl";
import { ApiError } from "../../../../services/api";
import type { AppState } from "../";
import { useProviderStore } from "./providerSlice";
import i18n from "../../../../shared/i18n";

const AUTO_TITLE_KEY = "copilot_auto_generate_titles";
const agentClient = AgentClient.getInstance();
const DEFAULT_SYSTEM_PROMPT = getDefaultSystemPrompts()[0];
const DEFAULT_SYSTEM_PROMPT_ID = DEFAULT_SYSTEM_PROMPT?.id || "general_assistant";
const DEFAULT_BASE_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT?.content?.trim() || "";
const FALLBACK_TOOL_NAME = "tool";

export type DeleteMessageFailureReason =
  | "session_not_found"
  | "message_not_found"
  | "backend_not_found"
  | "session_running"
  | "backend_error";

export type DeleteMessageResult =
  | {
      success: true;
      sessionId: string;
      messageId: string;
    }
  | {
      success: false;
      sessionId: string;
      messageId: string;
      reason: DeleteMessageFailureReason;
      statusCode?: number;
      errorMessage?: string;
    };

const safeRandomId = (): string => {
  try {
    const c = globalThis.crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    // ignore
  }
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

const getAgentApiBaseUrlSync = (): string => {
  let normalized = getBackendBaseUrlSync().trim().replace(/\/+$/, "");
  // Remove /v1 suffix if present, then add /api/v1
  if (normalized.endsWith("/v1")) {
    normalized = normalized.slice(0, -3);
  }
  return `${normalized}/api/v1`;
};

const parseBambooAttachmentUrl = (
  url: string,
): { sessionId: string; attachmentId: string } | null => {
  const trimmed = url.trim();
  if (!trimmed.startsWith("bamboo-attachment://")) return null;
  const rest = trimmed.slice("bamboo-attachment://".length);
  const [sessionId, attachmentId] = rest.split("/", 2);
  if (!sessionId || !attachmentId) return null;
  return { sessionId, attachmentId };
};

const resolveImageUrlForRender = (rawUrl: string): string => {
  const ref = parseBambooAttachmentUrl(rawUrl);
  if (!ref) return rawUrl;
  const base = getAgentApiBaseUrlSync();
  return `${base}/sessions/${encodeURIComponent(ref.sessionId)}/attachments/${encodeURIComponent(ref.attachmentId)}`;
};

const normalizeToolName = (name: string | undefined | null): string | undefined => {
  if (typeof name !== "string") return undefined;
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  if (trimmed.toLowerCase() === "unknown") return undefined;
  return trimmed;
};

const inferToolNameFromToolContent = (content: string | undefined): string | undefined => {
  const text = (content || "").trim();
  if (!text) return undefined;

  // Example: Tool policy blocked 'conclusion': ...
  const blockedMatch = text.match(/tool policy blocked ['"`]([^'"`]+)['"`]/i);
  if (blockedMatch?.[1]) {
    return normalizeToolName(blockedMatch[1]);
  }

  // JSON payloads may include "tool_name": "xxx"
  try {
    const parsed = JSON.parse(text) as { tool_name?: unknown };
    if (typeof parsed?.tool_name === "string") {
      return normalizeToolName(parsed.tool_name);
    }
  } catch {
    // best effort only
  }

  return undefined;
};

const sessionSummaryToChatItem = (s: SessionSummary): ChatItem => {
  const createdAtMs = Number.isFinite(Date.parse(s.created_at))
    ? Date.parse(s.created_at)
    : Date.now();

  const tokenUsage = s.token_usage
    ? {
        systemTokens: s.token_usage.system_tokens,
        summaryTokens: s.token_usage.summary_tokens,
        windowTokens: s.token_usage.window_tokens,
        totalTokens: s.token_usage.total_tokens,
        budgetLimit: s.token_usage.budget_limit,
        ...(typeof s.token_usage.max_context_tokens === "number" &&
        s.token_usage.max_context_tokens > 0
          ? { maxContextTokens: s.token_usage.max_context_tokens }
          : {}),
      }
    : undefined;
  return {
    id: s.id,
    kind: s.kind,
    parentSessionId: s.parent_session_id ?? null,
    rootSessionId: s.root_session_id,
    spawnDepth: s.spawn_depth,
    createdByScheduleId: s.created_by_schedule_id ?? null,
    isRunning: s.is_running,
    updatedAt: s.updated_at,
    lastActivityAt: s.last_activity_at,
    messageCount: s.message_count,
    hasAttachments: s.has_attachments,
    lastRunStatus: s.last_run_status,
    lastRunError: s.last_run_error,
    title: s.title || i18n.t("chat.session.defaultTitle"),
    createdAt: createdAtMs,
    pinned: s.pinned,
    messages: [],
    config: {
      systemPromptId: DEFAULT_SYSTEM_PROMPT_ID,
      baseSystemPrompt: DEFAULT_BASE_SYSTEM_PROMPT,
      lastUsedEnhancedPrompt: null,
      tokenUsage,
      truncationOccurred: s.token_usage?.truncation_occurred,
      segmentsRemoved: s.token_usage?.segments_removed,
      compressionEvents: [],
    },
    currentInteraction: null,
  };
};

const mapHistoryMessagesToUi = (
  sessionId: string,
  history: Array<{
    id: string;
    role: "user" | "assistant" | "tool" | "system";
    content: string;
    name?: string;
    tool_name?: string;
    compressed?: boolean;
    compressed_by_event_id?: string;
    content_parts?: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string; detail?: string } }
    >;
    image_ocr?: Array<{
      image_url: string;
      lines?: Array<{
        text: string;
        left: number;
        top: number;
        width: number;
        height: number;
      }>;
      error?: string | null;
    }>;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
    tool_call_id?: string;
    tool_success?: boolean;
    reasoning?: string;
    created_at: string;
  }>,
): Message[] => {
  const toolNameByCallId = new Map<string, string>();
  const out: Message[] = [];

  for (const msg of history) {
    const createdAt = msg.created_at || new Date().toISOString();

    if (msg.role === "system") {
      const sys: SystemMessage = {
        role: "system",
        id: msg.id,
        createdAt,
        content: msg.content || "",
        isCompressed: Boolean(msg.compressed),
        compressedEventId: msg.compressed_by_event_id,
      };
      out.push(sys);
      continue;
    }

    if (msg.role === "user") {
      const ocrByUrl = new Map<string, { ocrText?: string; ocrError?: string }>();
      for (const item of msg.image_ocr || []) {
        const url = item.image_url?.trim();
        if (!url) continue;
        const lines = item.lines || [];
        const text = lines.map((l) => (l?.text || "").trim()).filter(Boolean);
        ocrByUrl.set(url, {
          ocrText: text.length ? text.join("\n") : undefined,
          ocrError: item.error ? String(item.error) : undefined,
        });
      }

      const images: MessageImage[] = [];
      for (const part of msg.content_parts || []) {
        if (part.type !== "image_url") continue;
        const rawUrl = part.image_url?.url || "";
        if (!rawUrl) continue;
        const resolved = resolveImageUrlForRender(rawUrl);
        const ref = parseBambooAttachmentUrl(rawUrl);
        const ocr = ocrByUrl.get(rawUrl.trim());
        images.push({
          id: safeRandomId(),
          url: resolved,
          ocrText: ocr?.ocrText,
          ocrError: ocr?.ocrError,
          name: ref ? `attachment-${ref.attachmentId}` : "image",
          size: 0,
          type: "image/*",
        });
      }

      const user: UserMessage = {
        role: "user",
        id: msg.id,
        createdAt,
        content: msg.content || "",
        images: images.length ? images : undefined,
        isCompressed: Boolean(msg.compressed),
        compressedEventId: msg.compressed_by_event_id,
      };
      out.push(user);
      continue;
    }

    if (msg.role === "assistant") {
      const toolCalls = msg.tool_calls || [];
      if (toolCalls.length > 0) {
        const assistantText = (msg.content || "").trim();
        const hasReasoning = typeof msg.reasoning === "string" && msg.reasoning.trim().length > 0;
        if (assistantText || hasReasoning) {
          const metadata = hasReasoning
            ? { reasoning: msg.reasoning, backendMessageId: msg.id }
            : { backendMessageId: msg.id };
          const asst: AssistantTextMessage = {
            role: "assistant",
            type: "text",
            id: `${msg.id}_text`,
            createdAt,
            content: msg.content || "",
            metadata,
            isCompressed: Boolean(msg.compressed),
            compressedEventId: msg.compressed_by_event_id,
          };
          out.push(asst);
        }

        for (const call of toolCalls) {
          if (call.id) {
            toolNameByCallId.set(
              call.id,
              normalizeToolName(call.function?.name) || FALLBACK_TOOL_NAME,
            );
          }
        }
        const toolCallMsg: AssistantToolCallMessage = {
          role: "assistant",
          type: "tool_call",
          id: msg.id,
          createdAt,
          toolCalls: toolCalls.map((c) => ({
            toolCallId: c.id,
            toolName: normalizeToolName(c.function?.name) || FALLBACK_TOOL_NAME,
            parameters: (() => {
              try {
                return JSON.parse(c.function?.arguments || "{}") as Record<string, unknown>;
              } catch {
                return { raw: c.function?.arguments || "" };
              }
            })(),
            streamingOutput: "",
          })),
          isCompressed: Boolean(msg.compressed),
          compressedEventId: msg.compressed_by_event_id,
        };
        out.push(toolCallMsg);
        continue;
      }

      const metadata =
        typeof msg.reasoning === "string" && msg.reasoning.trim().length > 0
          ? { reasoning: msg.reasoning }
          : {};
      const asst: AssistantTextMessage = {
        role: "assistant",
        type: "text",
        id: msg.id,
        createdAt,
        content: msg.content || "",
        metadata,
        isCompressed: Boolean(msg.compressed),
        compressedEventId: msg.compressed_by_event_id,
      };
      out.push(asst);
      continue;
    }

    if (msg.role === "tool") {
      const toolCallId = msg.tool_call_id?.trim() || `orphan-tool-call:${msg.id}`;
      const toolName =
        normalizeToolName(toolNameByCallId.get(toolCallId)) ||
        normalizeToolName(msg.tool_name) ||
        normalizeToolName(msg.name) ||
        inferToolNameFromToolContent(msg.content) ||
        FALLBACK_TOOL_NAME;
      const inferredError =
        msg.tool_success === false ||
        (msg.tool_success == null &&
          typeof msg.content === "string" &&
          msg.content.trimStart().startsWith("Error:"));
      const toolResult: AssistantToolResultMessage = {
        role: "assistant",
        type: "tool_result",
        id: msg.id,
        createdAt,
        toolName,
        toolCallId,
        result: {
          tool_name: toolName,
          result: msg.content || "",
          display_preference: "Default",
        },
        isError: inferredError,
        isCompressed: Boolean(msg.compressed),
        compressedEventId: msg.compressed_by_event_id,
      };
      out.push(toolResult);
      continue;
    }
  }

  // Ensure we always have at least one message-less session - UI can still render.
  // The "sessionId" param is currently unused but kept for future mapping needs.
  void sessionId;
  return out;
};

export interface ChatSlice {
  // State (backend session list)
  chats: ChatItem[];
  currentSessionId: string | null;
  latestActiveSessionId: string | null;
  processingChats: Set<string>;
  autoGenerateTitles: boolean;
  isUpdatingAutoTitlePreference: boolean;
  // parentSessionId -> childSessionId -> progress
  subSessionsByParent: Record<
    string,
    Record<
      string,
      {
        title?: string;
        status?: string;
        error?: string;
        lastHeartbeatAt?: string;
        lastEventAt?: string;
        // Small rolling preview of child output (token stream).
        outputPreview?: string;
      }
    >
  >;

  // Actions
  addChat: (chat: Omit<ChatItem, "id">) => Promise<string>;
  selectSession: (sessionId: string | null) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteSessions: (sessionIds: string[]) => Promise<void>;
  updateSession: (sessionId: string, updates: Partial<ChatItem>) => void;
  pinSession: (sessionId: string) => void;
  unpinSession: (sessionId: string) => void;

  addMessage: (sessionId: string, message: Message) => Promise<void>;
  setMessages: (sessionId: string, messages: Message[]) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (sessionId: string, messageId: string) => Promise<DeleteMessageResult>;

  loadChats: () => Promise<void>;
  refreshChats: () => Promise<void>;
  loadChatHistory: (
    sessionId: string,
    options?: {
      mode?: "replace" | "monotonic";
      retries?: number;
      retryDelayMs?: number;
      // When true, retry while backend history ends with a user message.
      // This helps avoid a race where SSE emits "complete" before the session is persisted.
      waitForAssistant?: boolean;
    },
  ) => Promise<void>;
  upsertSubSessionProgress: (
    parentSessionId: string,
    childSessionId: string,
    patch: Partial<{
      title?: string;
      status?: string;
      error?: string;
      lastHeartbeatAt?: string;
      lastEventAt?: string;
      outputPreview?: string;
    }>,
  ) => void;
  clearSubSessionProgress: (parentSessionId: string, childSessionId: string) => void;

  setSessionProcessing: (sessionId: string, isProcessing: boolean) => void;
  isSessionProcessing: (sessionId: string) => boolean;
  setAutoGenerateTitlesPreference: (enabled: boolean) => Promise<void>;
}

export const createChatSlice: StateCreator<AppState, [], [], ChatSlice> = (set, get) => ({
  chats: [],
  currentSessionId: null,
  latestActiveSessionId: null,
  processingChats: new Set<string>(),
  autoGenerateTitles: true,
  isUpdatingAutoTitlePreference: false,
  subSessionsByParent: {},

  addChat: async (chatData) => {
    const title = (chatData.title || i18n.t("chat.sidebar.newSession")).trim();
    const basePrompt = chatData.config?.baseSystemPrompt?.trim() || "";
    const activeModel = useProviderStore.getState().getActiveModel()?.trim();
    const model = activeModel || undefined;

    const created = await agentClient.createSession({
      title,
      system_prompt: basePrompt || undefined,
      model,
    });

    const newChat: ChatItem = {
      ...sessionSummaryToChatItem(created.session),
      title,
      config: {
        ...chatData.config,
        // If the caller provided a base prompt, keep it; otherwise fall back.
        baseSystemPrompt: basePrompt || DEFAULT_BASE_SYSTEM_PROMPT,
      },
      messages: [],
      currentInteraction: null,
    };

    set((state) => {
      const chats = [newChat, ...state.chats.filter((c) => c.id !== newChat.id)];
      return {
        ...state,
        chats,
        currentSessionId: newChat.id,
        latestActiveSessionId: newChat.id,
      };
    });

    return newChat.id;
  },

  selectSession: (sessionId) => {
    const prev = get();
    if (prev.currentSessionId === sessionId && prev.latestActiveSessionId === sessionId) {
      return;
    }
    set({ currentSessionId: sessionId, latestActiveSessionId: sessionId });
  },

  deleteSession: async (sessionId) => {
    try {
      await agentClient.deleteSession(sessionId);
    } catch (error) {
      console.error(`[ChatSlice] Failed to delete backend session ${sessionId}:`, error);
    }

    set((state) => {
      const toDelete = new Set<string>();
      for (const chat of state.chats) {
        if (chat.id === sessionId) toDelete.add(chat.id);
        if (chat.rootSessionId === sessionId) toDelete.add(chat.id);
      }

      const newChats = state.chats.filter((c) => !toDelete.has(c.id));
      const nextCurrent =
        state.currentSessionId && toDelete.has(state.currentSessionId)
          ? null
          : state.currentSessionId;
      const nextLatest =
        state.latestActiveSessionId && toDelete.has(state.latestActiveSessionId)
          ? (newChats[0]?.id ?? null)
          : state.latestActiveSessionId;

      return {
        ...state,
        chats: newChats,
        currentSessionId: nextCurrent,
        latestActiveSessionId: nextLatest,
      };
    });
  },

  deleteSessions: async (sessionIds) => {
    for (const id of sessionIds) {
      await get().deleteSession(id);
    }
  },

  updateSession: (sessionId, updates) => {
    set((state) => {
      const chats = state.chats.map((chat) =>
        chat.id === sessionId ? { ...chat, ...updates } : chat,
      );
      return { ...state, chats };
    });

    // Best-effort backend patch for title/pin updates.
    const patch: Record<string, string | boolean> = {};
    if (typeof updates.title === "string") {
      patch.title = updates.title;
    }
    if (typeof updates.pinned === "boolean") {
      patch.pinned = updates.pinned;
    }
    if (Object.keys(patch).length > 0) {
      agentClient.patchSession(sessionId, patch).catch((e) => {
        console.warn(`[ChatSlice] Failed to patch session ${sessionId}:`, e);
      });
    }
  },

  pinSession: (sessionId) => {
    get().updateSession(sessionId, { pinned: true });
  },

  unpinSession: (sessionId) => {
    get().updateSession(sessionId, { pinned: false });
  },

  setMessages: (sessionId, messages) => {
    const chat = get().chats.find((c) => c.id === sessionId);
    if (chat) {
      get().updateSession(sessionId, { messages });
    }
  },

  addMessage: async (sessionId, message) => {
    const chat = get().chats.find((c) => c.id === sessionId);
    if (!chat) return;
    const updatedMessages = [...chat.messages, message];
    get().updateSession(sessionId, { messages: updatedMessages });
  },

  updateMessage: (sessionId, messageId, updates) => {
    const chat = get().chats.find((c) => c.id === sessionId);
    if (!chat) return;

    const updatedMessages = chat.messages.map((msg) => {
      if (msg.id !== messageId) return msg;
      const updatedMsg = { ...msg } as Record<string, unknown>;
      Object.keys(updates).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(updatedMsg, key)) {
          updatedMsg[key] = (updates as Record<string, unknown>)[key];
        }
      });
      return updatedMsg as unknown as Message;
    });

    get().updateSession(sessionId, { messages: updatedMessages });
  },

  deleteMessage: async (sessionId, messageId) => {
    const chat = get().chats.find((c) => c.id === sessionId);
    if (!chat) {
      return {
        success: false,
        sessionId,
        messageId,
        reason: "session_not_found",
      };
    }
    if (!chat.messages.some((msg) => msg.id === messageId)) {
      return {
        success: false,
        sessionId,
        messageId,
        reason: "message_not_found",
      };
    }

    try {
      await agentClient.deleteSessionMessage(sessionId, messageId);
    } catch (e) {
      console.warn(
        `[ChatSlice] Failed to delete message ${messageId} from session ${sessionId}:`,
        e,
      );

      if (e instanceof ApiError) {
        if (e.status === 404) {
          return {
            success: false,
            sessionId,
            messageId,
            reason: "backend_not_found",
            statusCode: e.status,
            errorMessage: e.message,
          };
        }
        if (e.status === 409) {
          return {
            success: false,
            sessionId,
            messageId,
            reason: "session_running",
            statusCode: e.status,
            errorMessage: e.message,
          };
        }
        return {
          success: false,
          sessionId,
          messageId,
          reason: "backend_error",
          statusCode: e.status,
          errorMessage: e.message,
        };
      }

      return {
        success: false,
        sessionId,
        messageId,
        reason: "backend_error",
        errorMessage: e instanceof Error ? e.message : undefined,
      };
    }

    set((state) => ({
      ...state,
      chats: state.chats.map((existingChat) =>
        existingChat.id === sessionId
          ? {
              ...existingChat,
              messages: existingChat.messages.filter((msg) => msg.id !== messageId),
            }
          : existingChat,
      ),
    }));

    return {
      success: true,
      sessionId,
      messageId,
    };
  },

  refreshChats: async () => {
    const list = await agentClient.listSessions();
    const next = list.sessions.map(sessionSummaryToChatItem);
    set((state) => {
      // Preserve in-memory messages when possible.
      const prevById = new Map(state.chats.map((c) => [c.id, c]));
      const merged = next.map((c) => {
        const prev = prevById.get(c.id);
        return prev ? { ...c, messages: prev.messages, config: prev.config } : c;
      });
      return { ...state, chats: merged };
    });
  },

  loadChats: async () => {
    const storedAutoTitles = localStorage.getItem(AUTO_TITLE_KEY);
    const autoGenerateTitles =
      storedAutoTitles === null ? get().autoGenerateTitles : storedAutoTitles === "true";

    let list = await agentClient.listSessions();
    if (!list.sessions || list.sessions.length === 0) {
      const created = await agentClient.createSession({
        title: i18n.t("chat.sidebar.newSession"),
      });
      list = { sessions: [created.session] };
    }

    const chats = list.sessions.map(sessionSummaryToChatItem);
    const currentSessionId = chats[0]?.id ?? null;

    set({
      chats,
      latestActiveSessionId: currentSessionId,
      currentSessionId,
      processingChats: new Set<string>(),
      autoGenerateTitles,
    });

    if (currentSessionId) {
      // Lazy load history for the initial session.
      await get().loadChatHistory(currentSessionId);
    }
  },

  loadChatHistory: async (sessionId, options) => {
    const mode = options?.mode ?? "replace";
    const retries = Math.max(0, options?.retries ?? 0);
    const retryDelayMs = Math.max(0, options?.retryDelayMs ?? 0);

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        // Avoid spurious backend calls when the UI layout references a stale session id.
        // (e.g. after backend reset or manual data cleanup)
        const chat = get().chats.find((c) => c.id === sessionId);
        if (!chat) return;

        const history = await agentClient.getHistory(sessionId);

        const lastRole = history.messages[history.messages.length - 1]?.role;
        if (options?.waitForAssistant && lastRole === "user" && attempt < retries) {
          // Backoff to give the backend time to persist the assistant reply.
          const delay = retryDelayMs > 0 ? retryDelayMs * (attempt + 1) : 200 * (attempt + 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        const nextMessages = mapHistoryMessagesToUi(sessionId, history.messages);

        if (mode === "monotonic") {
          const prevMessages = chat.messages || [];
          const prevLen = prevMessages.length;
          const nextLen = nextMessages.length;
          const nextLastRole = nextMessages[nextMessages.length - 1]?.role;
          const prevLastRole = prevMessages[prevMessages.length - 1]?.role;
          const prevLastMessage = prevMessages[prevMessages.length - 1] as Message | undefined;
          const nextLastMessage = nextMessages[nextMessages.length - 1] as Message | undefined;
          const prevLastId = prevLastMessage?.id;
          const nextLastId = nextLastMessage?.id;

          // Avoid wiping newer in-memory UI state with shorter backend snapshots.
          // Only replace when backend is strictly longer, or when lengths are equal
          // but backend clearly progressed from a user tail / changed terminal item.
          let shouldReplace = false;
          if (nextLen > prevLen) {
            shouldReplace = true;
          } else if (nextLen === prevLen) {
            const resolvedUserTail = prevLastRole === "user" && nextLastRole !== "user";
            const terminalChanged =
              typeof prevLastId === "string" &&
              typeof nextLastId === "string" &&
              prevLastId !== nextLastId;
            shouldReplace = resolvedUserTail || terminalChanged;
          }

          if (!shouldReplace) {
            get().updateSession(sessionId, {
              messageCount: Math.max(chat.messageCount ?? 0, history.messages.length),
            });
            return;
          }
        }

        get().updateSession(sessionId, {
          messages: nextMessages,
          messageCount: history.messages.length,
          config: {
            ...(chat.config || {}),
            compressionEvents: (history.compression_events || []).map((event) => ({
              id: event.id,
              createdAt: event.created_at,
              messagesCompressed: event.messages_compressed,
              segmentsRemoved: event.segments_removed,
            })),
          },
        });
        return;
      } catch (error) {
        if (attempt >= retries) {
          console.warn(`[ChatSlice] Failed to load history for ${sessionId}:`, error);
          return;
        }
        const delay = retryDelayMs > 0 ? retryDelayMs * (attempt + 1) : 200 * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  },

  upsertSubSessionProgress: (parentSessionId, childSessionId, patch) => {
    set((state) => {
      const existingParent = state.subSessionsByParent[parentSessionId] || {};
      const existingChild = existingParent[childSessionId] || {};
      const nextParent = {
        ...existingParent,
        [childSessionId]: { ...existingChild, ...patch },
      };
      return {
        subSessionsByParent: {
          ...state.subSessionsByParent,
          [parentSessionId]: nextParent,
        },
      };
    });
  },

  clearSubSessionProgress: (parentSessionId, childSessionId) => {
    set((state) => {
      const existingParent = state.subSessionsByParent[parentSessionId];
      if (!existingParent || !existingParent[childSessionId]) return {};
      const { [childSessionId]: _removed, ...rest } = existingParent;
      return {
        subSessionsByParent: {
          ...state.subSessionsByParent,
          [parentSessionId]: rest,
        },
      };
    });
  },

  setSessionProcessing: (sessionId, isProcessing) => {
    set((state) => {
      const processingChats = new Set(state.processingChats);
      if (isProcessing) processingChats.add(sessionId);
      else processingChats.delete(sessionId);
      return { processingChats };
    });
  },

  isSessionProcessing: (sessionId) => get().processingChats.has(sessionId),

  setAutoGenerateTitlesPreference: async (enabled) => {
    const previousValue = get().autoGenerateTitles;
    set({ autoGenerateTitles: enabled, isUpdatingAutoTitlePreference: true });
    try {
      localStorage.setItem(AUTO_TITLE_KEY, String(enabled));
    } catch (error) {
      console.warn("[ChatSlice] Failed to update auto-title preference:", error);
      set({ autoGenerateTitles: previousValue });
      throw error;
    } finally {
      set({ isUpdatingAutoTitlePreference: false });
    }
  },
});
