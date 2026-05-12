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
import { applyExecutionEvent } from "./executionStateSlice";
import { applyReplayableSessionEventToList, isSessionMetadataEvent } from "./sessionMetadataSlice";
import i18n from "../../../../shared/i18n";
import { debugLog } from "../../../../shared/utils/debugFlags";

const agentClient = AgentClient.getInstance();
const DEFAULT_SYSTEM_PROMPT = getDefaultSystemPrompts()[0];
const DEFAULT_SYSTEM_PROMPT_ID = DEFAULT_SYSTEM_PROMPT?.id || "general_assistant";
const DEFAULT_BASE_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT?.content?.trim() || "";
const FALLBACK_TOOL_NAME = "tool";

const parseTimestampMs = (value?: string): number | null => {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const areModelRefsEqual = (
  a: ChatItem["config"]["model_ref"],
  b: ChatItem["config"]["model_ref"],
): boolean => {
  if (a === b) return true;
  if (!a || !b) return a == null && b == null;
  return a.provider === b.provider && a.model === b.model;
};

const areTokenUsagesEqual = (
  a: ChatItem["config"]["tokenUsage"],
  b: ChatItem["config"]["tokenUsage"],
): boolean => {
  if (a === b) return true;
  if (!a || !b) return a == null && b == null;
  return (
    a.systemTokens === b.systemTokens &&
    a.summaryTokens === b.summaryTokens &&
    a.windowTokens === b.windowTokens &&
    a.totalTokens === b.totalTokens &&
    a.maxContextTokens === b.maxContextTokens &&
    a.budgetLimit === b.budgetLimit &&
    a.promptCachedToolOutputs === b.promptCachedToolOutputs
  );
};

const areCompressionEventsEqual = (
  a: ChatItem["config"]["compressionEvents"],
  b: ChatItem["config"]["compressionEvents"],
): boolean => {
  if (a === b) return true;
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((event, index) => {
    const other = right[index];
    return (
      Boolean(other) &&
      event.id === other.id &&
      event.createdAt === other.createdAt &&
      event.messagesCompressed === other.messagesCompressed &&
      event.segmentsRemoved === other.segmentsRemoved
    );
  });
};

const areSyncCursorsEqual = (
  a: ChatItem["config"]["syncCursor"],
  b: ChatItem["config"]["syncCursor"],
): boolean => {
  if (a === b) return true;
  if (!a || !b) return a == null && b == null;
  return (
    a.messageCount === b.messageCount &&
    a.lastMessageId === b.lastMessageId &&
    a.hasPendingQuestion === b.hasPendingQuestion &&
    a.pendingQuestionToolCallId === b.pendingQuestionToolCallId
  );
};

const areChatConfigsEquivalent = (a: ChatItem["config"], b: ChatItem["config"]): boolean => {
  if (a === b) return true;
  return (
    a.systemPromptId === b.systemPromptId &&
    a.baseSystemPrompt === b.baseSystemPrompt &&
    a.lastUsedEnhancedPrompt === b.lastUsedEnhancedPrompt &&
    a.agentRole === b.agentRole &&
    a.workspacePath === b.workspacePath &&
    a.model === b.model &&
    areModelRefsEqual(a.model_ref, b.model_ref) &&
    a.reasoningEffort === b.reasoningEffort &&
    areTokenUsagesEqual(a.tokenUsage, b.tokenUsage) &&
    a.truncationOccurred === b.truncationOccurred &&
    a.segmentsRemoved === b.segmentsRemoved &&
    areCompressionEventsEqual(a.compressionEvents, b.compressionEvents) &&
    areSyncCursorsEqual(a.syncCursor, b.syncCursor)
  );
};

const canReuseSessionListChat = (prev: ChatItem, next: ChatItem): boolean => {
  return (
    prev.id === next.id &&
    prev.kind === next.kind &&
    prev.parentSessionId === next.parentSessionId &&
    prev.rootSessionId === next.rootSessionId &&
    prev.spawnDepth === next.spawnDepth &&
    prev.createdByScheduleId === next.createdByScheduleId &&
    prev.isRunning === next.isRunning &&
    prev.updatedAt === next.updatedAt &&
    prev.lastActivityAt === next.lastActivityAt &&
    prev.messageCount === next.messageCount &&
    prev.hasAttachments === next.hasAttachments &&
    prev.lastRunStatus === next.lastRunStatus &&
    prev.lastRunError === next.lastRunError &&
    prev.planMode === next.planMode &&
    prev.subagentType === next.subagentType &&
    prev.title === next.title &&
    prev.titleVersion === next.titleVersion &&
    prev.createdAt === next.createdAt &&
    prev.pinned === next.pinned &&
    prev.messages === next.messages &&
    areChatConfigsEquivalent(prev.config, next.config)
  );
};

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
        ...(typeof s.token_usage.prompt_cached_tool_outputs === "number" &&
        s.token_usage.prompt_cached_tool_outputs > 0
          ? { promptCachedToolOutputs: s.token_usage.prompt_cached_tool_outputs }
          : {}),
        ...(typeof s.token_usage.prompt_cached_tool_tokens_saved === "number" &&
        s.token_usage.prompt_cached_tool_tokens_saved > 0
          ? { promptCachedToolTokensSaved: s.token_usage.prompt_cached_tool_tokens_saved }
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
    planMode: s.plan_mode ?? null,
    subagentType: s.subagent_type ?? null,
    title: s.title || i18n.t("chat.session.defaultTitle"),
    titleVersion: s.title_version ?? 0,
    createdAt: createdAtMs,
    pinned: s.pinned,
    messages: [],
    config: {
      systemPromptId: DEFAULT_SYSTEM_PROMPT_ID,
      baseSystemPrompt: DEFAULT_BASE_SYSTEM_PROMPT,
      lastUsedEnhancedPrompt: null,
      model: s.model,
      model_ref: s.model_ref ?? null,
      reasoningEffort: s.reasoning_effort ?? null,
      tokenUsage,
      truncationOccurred: s.token_usage?.truncation_occurred,
      segmentsRemoved: s.token_usage?.segments_removed,
      compressionEvents: [],
    },
  };
};

/** @internal Exported for testing only. */
export const mapHistoryMessagesToUi = (
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
    metadata?: Record<string, unknown>;
    created_at: string;
  }>,
): Message[] => {
  const toolNameByCallId = new Map<string, string>();
  // Pre-build a map from tool_call_id -> metadata from tool result messages.
  // This lets us attach lifecycle metadata to the tool_call card during
  // session loading (when the SSE lifecycle events are no longer available).
  const metadataByToolCallId = new Map<string, Record<string, unknown>>();
  for (const msg of history) {
    if (msg.role === "tool" && msg.tool_call_id && msg.metadata) {
      metadataByToolCallId.set(msg.tool_call_id, msg.metadata);
    }
  }
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
        // Look up lifecycle metadata from the first tool call's result message.
        const firstCallId = toolCalls[0]?.id;
        const lifecycleMetadata = firstCallId ? metadataByToolCallId.get(firstCallId) : undefined;
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
          ...(lifecycleMetadata ? { metadata: lifecycleMetadata } : {}),
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

  // Actions
  addChat: (chat: Omit<ChatItem, "id">) => Promise<string>;
  selectSession: (sessionId: string | null) => void;
  deleteSession: (sessionId: string) => Promise<void>;
  deleteSessions: (sessionIds: string[]) => Promise<void>;
  updateSession: (sessionId: string, updates: Partial<ChatItem>) => void;
  persistSessionTitle: (sessionId: string, title: string) => Promise<void>;
  /**
   * Apply an authoritative server title (from a `session_title_updated` SSE event).
   * Updates `title` + `titleVersion` only when `titleVersion > current.titleVersion`.
   * Does NOT call `patchSession` — the backend has already persisted the change
   * (the SSE event implies persistence).
   */
  applyServerTitle: (sessionId: string, title: string, titleVersion: number) => void;
  /**
   * Apply an authoritative server pinned flag (from a `session_pinned_updated`
   * SSE event). Suppresses replays whose `updatedAt` is older than the local
   * `updatedAt`, and skips writes when the flag already matches. Does NOT call
   * `patchSession` — the SSE event implies persistence.
   */
  applyServerPinned: (sessionId: string, pinned: boolean, updatedAt: string) => void;
  pinSession: (sessionId: string) => void;
  unpinSession: (sessionId: string) => void;

  addMessage: (sessionId: string, message: Message) => Promise<void>;
  setMessages: (sessionId: string, messages: Message[]) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
  deleteMessage: (sessionId: string, messageId: string) => Promise<DeleteMessageResult>;

  loadChats: () => Promise<void>;
  refreshChats: () => Promise<void>;
  refreshChatsNow: () => Promise<void>;
  loadChatHistory: (
    sessionId: string,
    options?: {
      mode?: "replace" | "monotonic";
      retries?: number;
      retryDelayMs?: number;
      waitForAssistant?: boolean;
    },
  ) => Promise<void>;
}

// === REFRESH CHATS DEDUPLICATION ===
const REFRESH_CHATS_THROTTLE_MS = 750;

interface RefreshChatsState {
  inFlight: Promise<void> | null;
  forcedPromise: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
  trailingPromise: Promise<void> | null;
  trailingResolve: (() => void) | null;
  trailingReject: ((error: unknown) => void) | null;
}

const refreshChatsState: RefreshChatsState = {
  inFlight: null,
  forcedPromise: null,
  timer: null,
  trailingPromise: null,
  trailingResolve: null,
  trailingReject: null,
};

function consumeTrailingRefreshCallbacks(): {
  resolve: (() => void) | null;
  reject: ((error: unknown) => void) | null;
} {
  const callbacks = {
    resolve: refreshChatsState.trailingResolve,
    reject: refreshChatsState.trailingReject,
  };
  refreshChatsState.trailingPromise = null;
  refreshChatsState.trailingResolve = null;
  refreshChatsState.trailingReject = null;
  return callbacks;
}

function settleTrailingRefreshCallbacks(
  promise: Promise<void>,
  callbacks: { resolve: (() => void) | null; reject: ((error: unknown) => void) | null },
): void {
  if (!callbacks.resolve && !callbacks.reject) {
    return;
  }
  void promise.then(
    () => callbacks.resolve?.(),
    (error) => callbacks.reject?.(error),
  );
}

function clearRefreshChatsThrottleWindow(): {
  resolve: (() => void) | null;
  reject: ((error: unknown) => void) | null;
} {
  if (refreshChatsState.timer) {
    clearTimeout(refreshChatsState.timer);
    refreshChatsState.timer = null;
  }
  return consumeTrailingRefreshCallbacks();
}

/**
 * Apply a fetched session list to the store.
 * Preserves in-memory messages and merges local state.
 */
function applySessionsList(
  sessions: SessionSummary[],
  set: Parameters<typeof createChatSlice>[0],
): void {
  const next = sessions.map(sessionSummaryToChatItem);

  set((state) => {
    // Reconcile executionBySession against every summary.
    let executionBySession = state.executionBySession;
    for (const summary of sessions) {
      executionBySession = applyExecutionEvent(executionBySession, {
        type: "applySessionSummary",
        sessionId: summary.id,
        summary,
      });
    }

    // Preserve in-memory messages when possible.
    const prevById = new Map(state.chats.map((c) => [c.id, c]));
    let chatsChanged = state.chats.length !== next.length;

    const merged = next.map((c, index) => {
      const prev = prevById.get(c.id);
      if (!prev) {
        chatsChanged = true;
        return c;
      }

      const prevUpdatedAtMs = parseTimestampMs(prev.updatedAt);
      const remoteUpdatedAtMs = parseTimestampMs(c.updatedAt);
      const preferLocalSessionFields =
        prevUpdatedAtMs !== null &&
        remoteUpdatedAtMs !== null &&
        prevUpdatedAtMs > remoteUpdatedAtMs;

      const prevConfig = prev.config || {};
      const nextConfig = c.config || {};
      const hasLocalModel = Object.prototype.hasOwnProperty.call(prevConfig, "model");
      const hasLocalModelRef = Object.prototype.hasOwnProperty.call(prevConfig, "model_ref");
      const hasLocalReasoning = Object.prototype.hasOwnProperty.call(prevConfig, "reasoningEffort");

      // Ensure messageCount stays monotonic, as listSessions summary might briefly lag
      const effectiveMessageCount = Math.max(prev.messageCount ?? 0, c.messageCount ?? 0);

      // Title precedence is governed by `title_version`, NOT `updatedAt`.
      // The backend bumps `title_version` on every authoritative title change
      // (manual PATCH or auto-title generation), so the highest version always wins.
      const remoteTitleVersion = c.titleVersion ?? 0;
      const localTitleVersion = prev.titleVersion ?? 0;
      const titleFields =
        remoteTitleVersion > localTitleVersion
          ? { title: c.title, titleVersion: remoteTitleVersion }
          : { title: prev.title, titleVersion: localTitleVersion };

      const mergedConfig = {
        ...prevConfig,
        ...nextConfig,
        model: preferLocalSessionFields
          ? hasLocalModel
            ? prevConfig.model
            : nextConfig.model
          : nextConfig.model,
        model_ref: preferLocalSessionFields
          ? hasLocalModelRef
            ? prevConfig.model_ref
            : nextConfig.model_ref
          : nextConfig.model_ref,
        reasoningEffort: preferLocalSessionFields
          ? hasLocalReasoning
            ? prevConfig.reasoningEffort
            : nextConfig.reasoningEffort
          : nextConfig.reasoningEffort,
        compressionEvents: prev.config?.compressionEvents ?? c.config?.compressionEvents,
        syncCursor: prev.config?.syncCursor ?? c.config?.syncCursor,
      };

      const mergedChat: ChatItem = {
        ...c,
        // `title` and `titleVersion` are deliberately omitted here —
        // version-based precedence below (`...titleFields`) is the source of truth
        // for those two fields, overriding the `updatedAt`-based logic.
        pinned: preferLocalSessionFields ? prev.pinned : c.pinned,
        updatedAt: preferLocalSessionFields ? prev.updatedAt : c.updatedAt,
        messages: prev.messages,
        messageCount: effectiveMessageCount,
        planMode: c.planMode,
        config: mergedConfig,
        // Override title/titleVersion with version-based precedence,
        // overriding the `updatedAt`-based decision for these fields specifically.
        ...titleFields,
      };

      if (canReuseSessionListChat(prev, mergedChat)) {
        if (state.chats[index] !== prev) {
          chatsChanged = true;
        }
        return prev;
      }

      chatsChanged = true;
      return mergedChat;
    });

    if (!chatsChanged && executionBySession === state.executionBySession) {
      return state;
    }

    return {
      ...state,
      chats: chatsChanged ? merged : state.chats,
      executionBySession,
    };
  });
}

async function executeRefreshChats(set: Parameters<typeof createChatSlice>[0]): Promise<void> {
  if (refreshChatsState.inFlight) {
    debugLog("[ChatSlice]", "refreshChats.inFlight.reuse", {});
    return refreshChatsState.inFlight;
  }

  debugLog("[ChatSlice]", "refreshChats.start", {});
  refreshChatsState.inFlight = (async () => {
    try {
      const list = await agentClient.listSessions();
      debugLog("[ChatSlice]", "refreshChats.response", {
        count: list.sessions.length,
        runningCount: list.sessions.filter((session) => session.is_running).length,
      });
      applySessionsList(list.sessions, set);
    } catch (error) {
      console.error("[ChatSlice] Failed to refresh sessions:", error);
      debugLog("[ChatSlice]", "refreshChats.error", { error });
      throw error;
    }
  })().finally(() => {
    debugLog("[ChatSlice]", "refreshChats.finally", {});
    refreshChatsState.inFlight = null;
  });

  return refreshChatsState.inFlight;
}

function executeForcedRefreshChats(set: Parameters<typeof createChatSlice>[0]): Promise<void> {
  if (refreshChatsState.forcedPromise) {
    debugLog("[ChatSlice]", "refreshChatsNow.forced.reuse", {});
    return refreshChatsState.forcedPromise;
  }

  debugLog("[ChatSlice]", "refreshChatsNow.forced.start", {
    hasInflight: Boolean(refreshChatsState.inFlight),
  });
  refreshChatsState.forcedPromise = (async () => {
    if (refreshChatsState.inFlight) {
      await refreshChatsState.inFlight;
    }
    await executeRefreshChats(set);
  })().finally(() => {
    debugLog("[ChatSlice]", "refreshChatsNow.forced.finally", {});
    refreshChatsState.forcedPromise = null;
  });

  return refreshChatsState.forcedPromise;
}

export const createChatSlice: StateCreator<AppState, [], [], ChatSlice> = (set, get) => ({
  chats: [],
  currentSessionId: null,
  latestActiveSessionId: null,

  addChat: async (chatData) => {
    const title = (chatData.title || i18n.t("chat.sidebar.newSession")).trim();
    const basePrompt = chatData.config?.baseSystemPrompt?.trim() || "";
    const activeModel = useProviderStore.getState().getActiveModel()?.trim();
    const model = chatData.config?.model?.trim() || activeModel || undefined;
    const reasoningEffort = chatData.config?.reasoningEffort ?? undefined;

    // Resolve model_ref when feature flag is ON
    // Always use provider defaults for new sessions, not the global selectedModelRef.
    // selectedModelRef is session-scoped user selection and should not leak into new sessions.
    let modelRef: { provider: string; model: string } | undefined;
    let providerValue: string | undefined;
    if (useProviderStore.getState().isProviderModelRefEnabled()) {
      // Prefer caller-provided model_ref (e.g. from EmptyTaskLauncher with explicit config)
      const callerModelRef = chatData.config?.model_ref;
      if (callerModelRef?.provider?.trim() && callerModelRef?.model?.trim()) {
        modelRef = callerModelRef;
        providerValue = callerModelRef.provider;
      } else {
        // Fall back to provider defaults (settings default model)
        const defaultChat = useProviderStore.getState().providerConfig.defaults?.chat;
        if (defaultChat?.provider?.trim() && defaultChat?.model?.trim()) {
          modelRef = defaultChat;
          providerValue = defaultChat.provider;
        } else {
          const m = useProviderStore.getState().getActiveModel();
          if (m) {
            modelRef = { provider: useProviderStore.getState().currentProvider, model: m };
            providerValue = useProviderStore.getState().currentProvider;
          }
        }
      }
    }

    const created = await agentClient.createSession({
      title,
      system_prompt: basePrompt || undefined,
      model,
      model_ref: modelRef,
      provider: providerValue,
      reasoning_effort: reasoningEffort || undefined,
    });

    const newChat: ChatItem = {
      ...sessionSummaryToChatItem(created.session),
      title,
      config: {
        ...chatData.config,
        model: created.session.model,
        model_ref: created.session.model_ref ?? null,
        reasoningEffort: created.session.reasoning_effort ?? null,
        // If the caller provided a base prompt, keep it; otherwise fall back.
        baseSystemPrompt: basePrompt || DEFAULT_BASE_SYSTEM_PROMPT,
      },
      messages: [],
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
    const hasSessionLevelConfigUpdate =
      !!updates.config &&
      (Object.prototype.hasOwnProperty.call(updates.config, "model") ||
        Object.prototype.hasOwnProperty.call(updates.config, "reasoningEffort"));
    const hasSessionLevelTopLevelUpdate =
      typeof updates.title === "string" || typeof updates.pinned === "boolean";
    const shouldBumpUpdatedAt = hasSessionLevelConfigUpdate || hasSessionLevelTopLevelUpdate;
    const localUpdatedAt = shouldBumpUpdatedAt ? new Date().toISOString() : undefined;

    set((state) => {
      const chats = state.chats.map((chat) =>
        chat.id === sessionId
          ? {
              ...chat,
              ...updates,
              ...(localUpdatedAt ? { updatedAt: localUpdatedAt } : {}),
            }
          : chat,
      );
      return { ...state, chats };
    });

    // Best-effort backend patch for session-level metadata updates.
    const patch: Record<string, unknown> = {};
    if (typeof updates.title === "string") {
      patch.title = updates.title;
    }
    if (typeof updates.pinned === "boolean") {
      patch.pinned = updates.pinned;
    }
    if (updates.config && Object.prototype.hasOwnProperty.call(updates.config, "model")) {
      patch.model = updates.config.model ?? null;
    }
    if (updates.config && Object.prototype.hasOwnProperty.call(updates.config, "model_ref")) {
      if (useProviderStore.getState().isProviderModelRefEnabled()) {
        patch.model_ref = updates.config.model_ref ?? null;
        if (updates.config.model_ref) {
          patch.provider = updates.config.model_ref.provider;
        }
      }
    }
    if (updates.config && Object.prototype.hasOwnProperty.call(updates.config, "reasoningEffort")) {
      const reasoningEffort = updates.config.reasoningEffort;
      if (reasoningEffort) {
        patch.reasoning_effort = reasoningEffort;
      } else {
        patch.clear_reasoning_effort = true;
      }
    }
    if (Object.keys(patch).length > 0) {
      // NOTE: `patchSession` returns void, so the backend's bumped
      // `title_version` (and any other authoritative server fields) is not
      // available here. The backend emits SSE events (e.g. `session_title_updated`)
      // that `applyServerTitle` reconciles into local state.
      agentClient.patchSession(sessionId, patch).catch((e) => {
        console.warn(`[ChatSlice] Failed to patch session ${sessionId}:`, e);
      });
    }
  },

  persistSessionTitle: async (sessionId, title) => {
    // Capture previous title for rollback.
    const previousTitle = get().chats.find((c) => c.id === sessionId)?.title;

    // Optimistic local update.
    set((state) => ({
      ...state,
      chats: state.chats.map((chat) =>
        chat.id === sessionId ? { ...chat, title, updatedAt: new Date().toISOString() } : chat,
      ),
    }));

    try {
      await agentClient.patchSession(sessionId, { title });
      // NOTE: `patchSession` returns void, so we cannot read the new
      // `title_version` from the PATCH response. The backend emits a
      // `session_title_updated` SSE event after the PATCH bumps the version,
      // and `applyServerTitle` will reconcile `titleVersion` locally there.
    } catch (e) {
      // Roll back to previous title on failure.
      if (typeof previousTitle === "string") {
        set((state) => ({
          ...state,
          chats: state.chats.map((chat) =>
            chat.id === sessionId ? { ...chat, title: previousTitle } : chat,
          ),
        }));
      }
      console.warn(`[ChatSlice] persistSessionTitle failed for ${sessionId}:`, e);
      throw e;
    }
  },

  applyServerTitle: (sessionId, title, titleVersion) =>
    set((state) => {
      const existing = state.chats.find((c) => c.id === sessionId);
      if (!existing) return state;
      if (titleVersion <= (existing.titleVersion ?? 0)) return state;
      return {
        ...state,
        chats: state.chats.map((chat) =>
          chat.id === sessionId
            ? { ...chat, title, titleVersion, updatedAt: new Date().toISOString() }
            : chat,
        ),
      };
    }),

  applyServerPinned: (sessionId, pinned, updatedAt) =>
    set((state) => {
      const existing = state.chats.find((c) => c.id === sessionId);
      if (!existing) return state;
      // Suppress stale replays: if the local copy is newer than the incoming
      // event, ignore. (`pinned` has no version field; we use `updatedAt`.)
      const incoming = Date.parse(updatedAt);
      const local = existing.updatedAt ? Date.parse(existing.updatedAt) : NaN;
      if (Number.isFinite(incoming) && Number.isFinite(local) && incoming < local) {
        return state;
      }
      // Idempotent — skip the re-render if nothing actually changed.
      if (existing.pinned === pinned) return state;
      return {
        ...state,
        chats: state.chats.map((chat) =>
          chat.id === sessionId ? { ...chat, pinned, updatedAt } : chat,
        ),
      };
    }),

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
    // If a request is already in flight, wait for it
    if (refreshChatsState.inFlight) {
      return refreshChatsState.inFlight;
    }

    // If we're within the throttle window, queue a trailing call
    if (refreshChatsState.timer) {
      if (!refreshChatsState.trailingPromise) {
        refreshChatsState.trailingPromise = new Promise<void>((resolve, reject) => {
          refreshChatsState.trailingResolve = resolve;
          refreshChatsState.trailingReject = reject;
        });
      }
      return refreshChatsState.trailingPromise;
    }

    // Start throttle window. The timer callback is responsible for flushing
    // any trailing call that arrives while this window is active.
    refreshChatsState.timer = setTimeout(() => {
      refreshChatsState.timer = null;

      if (refreshChatsState.trailingPromise) {
        const callbacks = consumeTrailingRefreshCallbacks();
        settleTrailingRefreshCallbacks(executeRefreshChats(set), callbacks);
      }
    }, REFRESH_CHATS_THROTTLE_MS);

    // Execute immediately
    return executeRefreshChats(set);
  },

  refreshChatsNow: async () => {
    const trailingCallbacks = clearRefreshChatsThrottleWindow();
    debugLog("[ChatSlice]", "refreshChatsNow.start", {
      hadTrailingCallbacks: Boolean(trailingCallbacks),
      hasInflight: Boolean(refreshChatsState.inFlight),
    });
    const refreshPromise = refreshChatsState.inFlight
      ? executeForcedRefreshChats(set)
      : executeRefreshChats(set);
    settleTrailingRefreshCallbacks(refreshPromise, trailingCallbacks);
    return refreshPromise;
  },

  loadChats: async () => {
    debugLog("[ChatSlice]", "loadChats.start", {});
    let list = await agentClient.listSessions();
    if (!list.sessions || list.sessions.length === 0) {
      // Use provider defaults when creating the initial session on startup
      const defaultModel = useProviderStore.getState().getActiveModel()?.trim();
      const defaultModelRef = useProviderStore.getState().providerConfig.defaults?.chat;
      debugLog("[ChatSlice]", "loadChats.createInitialSession", {
        defaultModel: defaultModel ?? null,
        defaultModelRef: defaultModelRef ?? null,
      });
      const created = await agentClient.createSession({
        title: i18n.t("chat.sidebar.newSession"),
        model: defaultModel,
        model_ref: defaultModelRef,
        provider: defaultModelRef?.provider,
      });
      list = { sessions: [created.session] };
    }

    const chats = list.sessions.map(sessionSummaryToChatItem);
    const currentSessionId = chats[0]?.id ?? null;
    debugLog("[ChatSlice]", "loadChats.listResolved", {
      count: list.sessions.length,
      currentSessionId,
    });

    // Reconcile executionBySession against every summary.
    let executionBySession = get().executionBySession;
    for (const summary of list.sessions) {
      executionBySession = applyExecutionEvent(executionBySession, {
        type: "applySessionSummary",
        sessionId: summary.id,
        summary,
      });
    }

    // Replay active running sessions so the UI reflects live state immediately
    // after boot (removes the need for OPTIMISTIC_RACE_WINDOW_MS).
    try {
      const running = await agentClient.getRunningSessions();
      debugLog("[ChatSlice]", "loadChats.runningSnapshot", {
        count: running.sessions.length,
      });
      if (running.sessions.length > 0) {
        // Partition criticalEvents into metadata vs execution before replay.
        // Metadata events (title/pinned) flow through `applyReplayableSessionEvent`
        // so live SSE and boot replay share the same precedence rules; the
        // execution reducer never sees them.
        const partitioned = running.sessions.map((s) => {
          const executionOnly = [];
          for (const event of s.last_critical_events) {
            if (isSessionMetadataEvent(event)) {
              // Bake replay metadata into the local `chats` snapshot before
              // the single trailing `set`. Applying against the store here
              // would be overwritten by that `set` because `chats` was built
              // from the baseline before replay events arrived.
              applyReplayableSessionEventToList(event, chats);
              continue;
            }
            executionOnly.push(event);
          }
          return {
            sessionId: s.session_id,
            runId: s.run_id,
            criticalEvents: executionOnly,
          };
        });

        executionBySession = applyExecutionEvent(
          executionBySession,
          {
            type: "applyRunningSnapshot",
            sessions: partitioned,
          },
          () => new Date().toISOString(),
        );
      }
    } catch (error) {
      debugLog("[ChatSlice]", "loadChats.runningSnapshot.error", { error });
      // Non-fatal: if the backend doesn't support /runs/active yet,
      // fall back to the summary-based reconciliation above.
    }

    set({
      chats,
      latestActiveSessionId: currentSessionId,
      currentSessionId,
      executionBySession,
    });

    debugLog("[ChatSlice]", "loadChats.applied", {
      currentSessionId,
      chatCount: chats.length,
      executionSessionCount: Object.keys(executionBySession || {}).length,
    });

    if (currentSessionId) {
      // Lazy load history for the initial session.
      debugLog("[ChatSlice]", "loadChats.loadInitialHistory", { currentSessionId });
      await get().loadChatHistory(currentSessionId);
    }
  },

  loadChatHistory: async (sessionId, options) => {
    const mode = options?.mode ?? "replace";
    const retries = Math.max(0, options?.retries ?? 0);
    const retryDelayMs = Math.max(0, options?.retryDelayMs ?? 0);

    debugLog("[ChatSlice]", "loadChatHistory.start", {
      sessionId,
      mode,
      retries,
      retryDelayMs,
      waitForAssistant: options?.waitForAssistant ?? false,
    });

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        // Avoid spurious backend calls when the UI layout references a stale session id.
        // (e.g. after backend reset or manual data cleanup)
        const chat = get().chats.find((c) => c.id === sessionId);
        if (!chat) {
          debugLog("[ChatSlice]", "loadChatHistory.skipMissingChat", { sessionId, attempt });
          return;
        }

        const history = await agentClient.getHistory(sessionId);
        debugLog("[ChatSlice]", "loadChatHistory.response", {
          sessionId,
          attempt,
          historyMessageCount: history.messages.length,
          localMessageCount: chat.messages.length,
          localStoredMessageCount: chat.messageCount ?? null,
          lastMessageId: history.messages[history.messages.length - 1]?.id ?? null,
          lastRole: history.messages[history.messages.length - 1]?.role ?? null,
        });

        const lastRole = history.messages[history.messages.length - 1]?.role;
        if (options?.waitForAssistant && lastRole === "user" && attempt < retries) {
          // Backoff to give the backend time to persist the assistant reply.
          const delay = retryDelayMs > 0 ? retryDelayMs * (attempt + 1) : 200 * (attempt + 1);
          debugLog("[ChatSlice]", "loadChatHistory.waitForAssistant.retry", {
            sessionId,
            attempt,
            delay,
          });
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

          debugLog("[ChatSlice]", "loadChatHistory.monotonicDecision", {
            sessionId,
            attempt,
            prevLen,
            nextLen,
            prevLastRole: prevLastRole ?? null,
            nextLastRole: nextLastRole ?? null,
            prevLastId: prevLastId ?? null,
            nextLastId: nextLastId ?? null,
            shouldReplace,
          });

          if (!shouldReplace) {
            get().updateSession(sessionId, {
              messageCount: Math.max(chat.messageCount ?? 0, history.messages.length),
            });
            debugLog("[ChatSlice]", "loadChatHistory.monotonicSkip", {
              sessionId,
              attempt,
              localMessageCount: chat.messages.length,
              serverMessageCount: history.messages.length,
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
            syncCursor: {
              messageCount: history.messages.length,
              lastMessageId: history.messages[history.messages.length - 1]?.id ?? null,
              hasPendingQuestion: Boolean(
                get().executionBySession?.[sessionId]?.interaction.respondMode?.sessionId ===
                  sessionId,
              ),
              pendingQuestionToolCallId:
                get().executionBySession?.[sessionId]?.interaction.respondMode?.sessionId ===
                sessionId
                  ? (get().executionBySession?.[sessionId]?.interaction.respondMode?.toolCallId ??
                    null)
                  : null,
            },
          },
        });
        debugLog("[ChatSlice]", "loadChatHistory.applied", {
          sessionId,
          attempt,
          mode,
          messageCount: history.messages.length,
          lastMessageId: history.messages[history.messages.length - 1]?.id ?? null,
        });
        return;
      } catch (error) {
        if (attempt >= retries) {
          console.warn(`[ChatSlice] Failed to load history for ${sessionId}:`, error);
          debugLog("[ChatSlice]", "loadChatHistory.error.final", {
            sessionId,
            attempt,
            retries,
            error,
          });
          return;
        }
        const delay = retryDelayMs > 0 ? retryDelayMs * (attempt + 1) : 200 * (attempt + 1);
        debugLog("[ChatSlice]", "loadChatHistory.error.retry", {
          sessionId,
          attempt,
          delay,
          error,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  },
});
