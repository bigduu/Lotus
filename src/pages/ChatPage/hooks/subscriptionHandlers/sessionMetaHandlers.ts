import type { AgentEventHandlers } from "@services/chat/AgentService";
import { useAppStore } from "@shared/store/appStore";
import { applyReplayableSessionEvent } from "@shared/store/appStore/slices/sessionMetadataSlice";
import { planModeStateFromEvent } from "../useAgentEventSubscription.helpers";
import type { RunContext } from "../subscriptionContext";

/** Session metadata (title/pinned) + plan-mode handlers. */
export function createSessionMetaHandlers(run: RunContext): Partial<AgentEventHandlers> {
  const { sessionId } = run;
  const { refreshChatsNow, updateSession } = run.ctx;
  return {
    onSessionTitleUpdated: (event) => {
      applyReplayableSessionEvent(event, useAppStore.getState());
    },

    onSessionPinnedUpdated: (event) => {
      applyReplayableSessionEvent(event, useAppStore.getState());
    },

    onPlanModeEntered: (event) => {
      const targetSessionId = event.session_id || sessionId;
      const planMode = planModeStateFromEvent(event);
      if (!planMode) {
        void refreshChatsNow();
        return;
      }
      updateSession(targetSessionId, {
        planMode,
      });
    },

    onPlanModeExited: (event) => {
      const targetSessionId = event.session_id || sessionId;
      updateSession(targetSessionId, {
        planMode: null,
      });
      void refreshChatsNow();
    },

    onPlanFileUpdated: (event) => {
      const targetSessionId = event.session_id || sessionId;
      const currentSession = useAppStore
        .getState()
        .chats.find((chat) => chat.id === targetSessionId);
      const currentPlanMode = currentSession?.planMode;
      if (currentPlanMode) {
        updateSession(targetSessionId, {
          planMode: {
            ...currentPlanMode,
            plan_file_path: event.plan_file_path ?? currentPlanMode.plan_file_path ?? null,
            status:
              event.status === "exploring" ||
              event.status === "designing" ||
              event.status === "reviewing" ||
              event.status === "finalizing" ||
              event.status === "awaiting_approval"
                ? event.status
                : currentPlanMode.status,
          },
        });
      } else {
        void refreshChatsNow();
      }
    },
  };
}
