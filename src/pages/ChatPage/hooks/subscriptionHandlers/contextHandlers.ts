import type {
  AgentEventHandlers,
  ContextSummaryInfo,
  TokenBudgetUsage,
} from "@services/chat/AgentService";
import { useAppStore } from "../../store";
import { mapTokenBudgetUsage } from "../../types/tokenBudget";
import { sendDesktopNotification } from "@services/notification/desktopNotification";
import i18n from "@shared/i18n";
import type { RunContext } from "../subscriptionContext";

/** Context-window + token-budget handlers (compression / budget / summary / pressure). */
export function createContextHandlers(run: RunContext): Partial<AgentEventHandlers> {
  const { sessionId, setStreamingStatus } = run;
  const { message, setTruncationInfo, updateSession, updateTokenUsage } = run.ctx;
  return {
    onContextCompressionStatus: (_phase, status) => {
      if (status === "started") {
        setStreamingStatus("context_compacting");
        return;
      }
      if (status === "degraded_sections") {
        setStreamingStatus("context_compaction_degraded");
        return;
      }
      if (status === "failed") {
        setStreamingStatus("context_compaction_failed");
        return;
      }
      setStreamingStatus(null);
    },

    onTokenBudgetUpdated: (usage: TokenBudgetUsage) => {
      const tokenUsage = mapTokenBudgetUsage(usage);
      if (!tokenUsage) {
        return;
      }

      updateTokenUsage(sessionId, tokenUsage);
      setTruncationInfo(sessionId, usage.truncation_occurred, usage.segments_removed);

      // Persist in chat config without causing resubscribe:
      const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);

      if (chat) {
        updateSession(sessionId, {
          config: {
            ...chat.config,
            tokenUsage,
            truncationOccurred: usage.truncation_occurred,
            segmentsRemoved: usage.segments_removed,
          },
        });
      }
    },

    onContextSummarized: (summaryInfo: ContextSummaryInfo) => {
      setStreamingStatus(null);
      message.info(
        i18n.t("app.notifications.conversationSummarized", {
          messages: summaryInfo.messages_summarized,
          tokens: summaryInfo.tokens_saved.toLocaleString(),
        }),
        5,
      );
    },

    onContextPressureNotification: (_percent, level, msg) => {
      if (level === "critical") {
        message.error(msg, 6);
        void sendDesktopNotification({
          title: i18n.t("app.notifications.contextPressure.title"),
          body: msg,
          sessionId,
          eventType: "context_pressure",
        });
      } else {
        message.warning(msg, 5);
      }
    },
  };
}
