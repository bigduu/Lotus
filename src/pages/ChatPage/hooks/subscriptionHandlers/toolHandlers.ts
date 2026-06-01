import type { AgentEvent, AgentEventHandlers } from "@services/chat/AgentService";
import { useAppStore } from "../../store";
import { streamingMessageBus } from "../../utils/streamingMessageBus";
import { setAssistantStreamingState } from "../../streaming/assistantStreamingAtoms";
import {
  appendToolStreamingChunk,
  setToolStreamingStatus,
} from "../../streaming/toolStreamingAtoms";
import type { Message } from "@shared/types/chatMessages";
import { sendDesktopNotification } from "@services/notification/desktopNotification";
import i18n from "@shared/i18n";
import { isMemoryStatusTool } from "../useAgentEventSubscription.helpers";
import type { RunContext } from "../subscriptionContext";

/** Tool lifecycle handlers (start / token / complete / error / lifecycle). */
export function createToolHandlers(run: RunContext): Partial<AgentEventHandlers> {
  const { sessionId, generation, setStreamingStatus } = run;
  const {
    addMessage,
    applyAgentEvent,
    updateMessage,
    streamingStateBySessionRef,
    toolNamesByCallIdRef,
    toolCallMessageIdByCallIdRef,
  } = run.ctx;
  return {
    onToolStart: (toolCallId, toolName, args) => {
      applyAgentEvent(
        sessionId,
        { type: "tool_start", tool_call_id: toolCallId, tool_name: toolName } as AgentEvent,
        generation,
      );
      // Flush any buffered assistant draft before tool execution starts
      // so streaming view keeps a natural "assistant text -> tool call" order.
      const streamingState = streamingStateBySessionRef.current.get(sessionId);
      const bufferedRaw = streamingState?.content || "";
      const bufferedReasoningRaw = streamingState?.reasoningContent || "";
      const hasBufferedContent = bufferedRaw.trim().length > 0;
      const hasBufferedReasoning = bufferedReasoningRaw.trim().length > 0;
      if (hasBufferedContent || hasBufferedReasoning) {
        const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
        const last = chat?.messages?.[chat.messages.length - 1] as
          | (Message & { metadata?: { reasoning?: string } })
          | undefined;
        const lastReasoning =
          typeof last?.metadata?.reasoning === "string" ? last.metadata.reasoning : "";
        const lastIsSame =
          last?.role === "assistant" &&
          last?.type === "text" &&
          typeof last?.content === "string" &&
          last.content === bufferedRaw &&
          lastReasoning === bufferedReasoningRaw;

        if (!lastIsSame) {
          void addMessage(sessionId, {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            type: "text",
            content: bufferedRaw,
            createdAt: new Date().toISOString(),
            metadata: {
              sessionId,
              model: "agent",
              ...(hasBufferedReasoning ? { reasoning: bufferedReasoningRaw } : {}),
            },
          });
        }

        if (streamingState) {
          streamingState.content = "";
          streamingState.reasoningContent = "";
          setAssistantStreamingState(streamingState.sessionId, {
            content: "",
            reasoningContent: "",
          });
          if (streamingState.status) {
            streamingState.status = "";
            streamingMessageBus.clear(streamingState.sessionId, streamingState.statusMessageId);
          }
        }
      }

      // Track tool name for later use in onToolComplete
      toolNamesByCallIdRef.current.set(toolCallId, toolName);
      const normalizedToolName = toolName.trim().toLowerCase();
      if (isMemoryStatusTool(toolName)) {
        setStreamingStatus("memory_updating");
      } else {
        setStreamingStatus(`tool_running:${normalizedToolName || "tool"}`);
      }

      const messageId = crypto.randomUUID();
      toolCallMessageIdByCallIdRef.current.set(toolCallId, messageId);

      void addMessage(sessionId, {
        id: messageId,
        role: "assistant",
        type: "tool_call",
        toolCalls: [
          {
            toolCallId,
            toolName,
            parameters: args || {},
            streamingOutput: "",
          },
        ],
        metadata: {},
        createdAt: new Date().toISOString(),
      });
    },

    onToolToken: (toolCallId: string, tokenContent: string) => {
      applyAgentEvent(
        sessionId,
        {
          type: "tool_token",
          tool_call_id: toolCallId,
          content: tokenContent,
        } as AgentEvent,
        generation,
      );

      if (!toolNamesByCallIdRef.current.has(toolCallId)) {
        const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
        const matchingMessage =
          chat?.messages
            ?.slice()
            .reverse()
            .find(
              (message) =>
                "type" in message &&
                message.type === "tool_call" &&
                Array.isArray(message.toolCalls) &&
                message.toolCalls.some((call) => call.toolCallId === toolCallId),
            ) ?? null;

        if (
          matchingMessage &&
          "toolCalls" in matchingMessage &&
          Array.isArray(matchingMessage.toolCalls)
        ) {
          const targetCall = matchingMessage.toolCalls.find(
            (call) => call.toolCallId === toolCallId,
          );
          if (targetCall) {
            toolNamesByCallIdRef.current.set(toolCallId, targetCall.toolName);
            toolCallMessageIdByCallIdRef.current.set(toolCallId, matchingMessage.id);
          }
        }
      }

      appendToolStreamingChunk(sessionId, toolCallId, tokenContent);
    },

    onToolComplete: (toolCallId, result: AgentEvent["result"]) => {
      applyAgentEvent(
        sessionId,
        { type: "tool_complete", tool_call_id: toolCallId } as AgentEvent,
        generation,
      );
      // Retrieve tool name tracked in onToolStart
      const toolName = toolNamesByCallIdRef.current.get(toolCallId) || "unknown";
      setToolStreamingStatus(sessionId, toolCallId, "completed");
      toolNamesByCallIdRef.current.delete(toolCallId);
      toolCallMessageIdByCallIdRef.current.delete(toolCallId);

      const normalizedToolName = toolName.trim().toLowerCase();
      const currentState = streamingStateBySessionRef.current.get(sessionId);
      const shouldClearStatus = isMemoryStatusTool(toolName)
        ? currentState?.status === "memory_updating"
        : Boolean(currentState?.status && currentState.status.includes(normalizedToolName));
      if (shouldClearStatus) {
        setStreamingStatus(null);
      }

      const displayPreference =
        (result?.display_preference as "Default" | "Collapsible" | "Hidden") || "Default";

      void addMessage(sessionId, {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "tool_result",
        toolName,
        toolCallId,
        result: {
          tool_name: toolName,
          result: result?.result ?? "",
          display_preference: displayPreference,
        },
        isError: !result?.success,
        createdAt: new Date().toISOString(),
      });
    },

    onToolError: (toolCallId, error: string) => {
      applyAgentEvent(
        sessionId,
        { type: "tool_error", tool_call_id: toolCallId } as AgentEvent,
        generation,
      );
      const toolName = toolNamesByCallIdRef.current.get(toolCallId) || "unknown";
      setToolStreamingStatus(sessionId, toolCallId, "error");
      toolNamesByCallIdRef.current.delete(toolCallId);
      toolCallMessageIdByCallIdRef.current.delete(toolCallId);
      setStreamingStatus(null);
      void addMessage(sessionId, {
        id: crypto.randomUUID(),
        role: "assistant",
        type: "tool_result",
        toolName,
        toolCallId,
        result: {
          tool_name: toolName,
          result: error,
          display_preference: "Default",
        },
        isError: true,
        createdAt: new Date().toISOString(),
      });
    },

    onToolLifecycle: (
      toolCallId,
      _toolName,
      phase,
      elapsedMs,
      isMutating,
      autoApproved,
      summary,
    ) => {
      if (phase === "begin") {
        const normalizedToolName = (_toolName || "").trim().toLowerCase();
        if (isMemoryStatusTool(_toolName || "")) {
          setStreamingStatus("memory_updating");
        } else {
          setStreamingStatus(`tool_running:${normalizedToolName || "tool"}`);
        }

        // Notify when a mutating tool needs user approval
        if (autoApproved === false) {
          void sendDesktopNotification({
            title: i18n.t("app.notifications.toolApproval.title", {
              tool: _toolName || i18n.t("app.notifications.toolApproval.unknownTool"),
            }),
            body: i18n.t("app.notifications.toolApproval.body", { tool: _toolName || "" }),
            sessionId,
            eventType: "tool_approval",
            eventId: toolCallId,
          });
        }
      }

      // When a tool finishes, update its message card with timing metadata
      if (phase === "finished" || phase === "error" || phase === "cancelled") {
        setToolStreamingStatus(sessionId, toolCallId, phase === "finished" ? "completed" : "error");
        const messageId = toolCallMessageIdByCallIdRef.current.get(toolCallId);
        if (messageId) {
          const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
          const existingMessage = chat?.messages.find((m) => m.id === messageId);
          const existingMetadata =
            existingMessage && "metadata" in existingMessage
              ? ((existingMessage as { metadata?: Record<string, unknown> }).metadata ?? {})
              : {};

          void updateMessage(sessionId, messageId, {
            metadata: {
              ...existingMetadata,
              elapsed_ms: elapsedMs,
              is_mutating: isMutating,
              ...(summary ? { summary } : {}),
            },
          });
        }

        // Only clear the streaming status if it's currently showing THIS tool
        const normalizedToolName = (_toolName || "").trim().toLowerCase();
        const currentState = streamingStateBySessionRef.current.get(sessionId);
        const shouldClearStatus = isMemoryStatusTool(_toolName || "")
          ? currentState?.status === "memory_updating"
          : Boolean(currentState?.status && currentState.status.includes(normalizedToolName));
        if (shouldClearStatus) {
          setStreamingStatus(null);
        }
      }
    },
  };
}
