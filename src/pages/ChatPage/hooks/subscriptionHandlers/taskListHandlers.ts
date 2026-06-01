import type { AgentEventHandlers, TaskList, TaskListDelta } from "@services/chat/AgentService";
import { useAppStore } from "@shared/store/appStore";
import i18n from "@shared/i18n";
import { compactEvaluationReasoning } from "../useAgentEventSubscription.helpers";
import type { RunContext } from "../subscriptionContext";

/** Task-list + task-evaluation handlers. */
export function createTaskListHandlers(run: RunContext): Partial<AgentEventHandlers> {
  const {
    message,
    setTaskList,
    updateTaskListDelta,
    setEvaluationState,
    ensureTaskListBaseline,
    shouldShowTaskListCompletedNotice,
  } = run.ctx;
  return {
    onTaskListUpdated: (taskList: TaskList) => {
      if (taskList.session_id) {
        setTaskList(taskList.session_id, taskList);
      }
    },

    onTaskListItemProgress: (delta: TaskListDelta) => {
      if (delta.session_id) {
        if (!useAppStore.getState().taskLists[delta.session_id]) {
          void ensureTaskListBaseline(delta.session_id);
          return;
        }
        updateTaskListDelta(delta.session_id, delta);
      }
    },

    onTaskListCompleted: (completedSessionId, totalRounds, totalToolCalls, completedAt) => {
      if (
        !shouldShowTaskListCompletedNotice(
          completedSessionId,
          totalRounds,
          totalToolCalls,
          completedAt,
        )
      ) {
        return;
      }

      message.success(
        i18n.t("app.notifications.allTasksCompleted", {
          rounds: totalRounds,
          toolCalls: totalToolCalls,
        }),
        3,
      );
    },

    onTaskEvaluationStarted: (sid, itemsCount) => {
      setEvaluationState(sid, {
        isEvaluating: true,
        reasoning: null,
        timestamp: Date.now(),
      });
      message.info(
        i18n.t("app.notifications.evaluatingTasks", {
          count: itemsCount,
        }),
        2,
      );
    },

    onTaskEvaluationCompleted: (sid, updatesCount, reasoning) => {
      const compactReasoning = compactEvaluationReasoning(reasoning);
      setEvaluationState(sid, {
        isEvaluating: false,
        reasoning: updatesCount > 0 ? compactReasoning : null,
        timestamp: Date.now(),
      });

      if (updatesCount > 0) {
        message.success(
          i18n.t("app.notifications.evaluationCompleteUpdated", {
            count: updatesCount,
          }),
          3,
        );
      } else {
        message.info(i18n.t("app.notifications.evaluationCompleteNoUpdates"), 2);
      }
    },
  };
}
