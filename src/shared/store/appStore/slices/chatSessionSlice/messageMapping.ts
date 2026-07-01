import {
  ChatItem,
  Message,
  SystemMessage,
  UserMessage,
  AssistantTextMessage,
  AssistantToolCallMessage,
  AssistantToolResultMessage,
  MessageImage,
} from "@shared/types/chat";
import { SessionSummary } from "@services/chat/AgentService";
import { getDefaultSystemPrompts } from "@shared/utils/defaultSystemPrompts";
import { getBackendBaseUrlSync } from "@shared/utils/backendBaseUrl";
import i18n from "@shared/i18n";
import { mapTokenBudgetUsage } from "@shared/types/tokenBudget";

const DEFAULT_SYSTEM_PROMPT = getDefaultSystemPrompts()[0];
export const DEFAULT_SYSTEM_PROMPT_ID = DEFAULT_SYSTEM_PROMPT?.id || "general_assistant";
export const DEFAULT_BASE_SYSTEM_PROMPT = DEFAULT_SYSTEM_PROMPT?.content?.trim() || "";
const FALLBACK_TOOL_NAME = "tool";

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

export const sessionSummaryToChatItem = (s: SessionSummary): ChatItem => {
  const createdAtMs = Number.isFinite(Date.parse(s.created_at))
    ? Date.parse(s.created_at)
    : Date.now();

  const tokenUsage = mapTokenBudgetUsage(s.token_usage);
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
    lifecycle: s.lifecycle ?? null,
    residentName: s.resident_name ?? null,
    placement: s.placement ?? null,
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
      bypassPermissions: s.bypass_permissions ?? false,
      goldConfig: s.gold_config ?? null,
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
      // Images returned by the tool (e.g. an MCP screenshot) arrive in
      // content_parts, same as user-attached images — surface them for preview.
      const toolImages: MessageImage[] = [];
      for (const part of msg.content_parts || []) {
        if (part.type !== "image_url") continue;
        const rawUrl = part.image_url?.url || "";
        if (!rawUrl) continue;
        toolImages.push({
          id: safeRandomId(),
          url: resolveImageUrlForRender(rawUrl),
          name: "screenshot",
          size: 0,
          type: "image/*",
        });
      }
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
        images: toolImages.length ? toolImages : undefined,
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
