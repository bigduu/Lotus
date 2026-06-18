import type { AgentEvent, AgentEventHandlers } from "@services/chat/AgentService";
import { useAppStore, selectChildren } from "@shared/store/appStore";
import {
  clearChildPreviewState,
  getChildPreviewState,
  setChildPreviewState,
} from "../../streaming/childPreviewAtoms";
import {
  compactEvaluationReasoning,
  getChildStatus,
  isTaskItemStatus,
  isTerminalChildStatus,
  CHILD_HEARTBEAT_MIN_INTERVAL_MS,
  CHILD_PREVIEW_MAX_CHARS,
} from "../useAgentEventSubscription.helpers";
import type { RunContext } from "../subscriptionContext";

/** Sub-agent (background child) lifecycle + preview handlers. */
export function createChildHandlers(run: RunContext): Partial<AgentEventHandlers> {
  const { scheduleParentSettleCheck, sessionId: parentSessionId } = run;
  const {
    applyChildProgress,
    ensureTaskListBaseline,
    flushChildPreview,
    persistSessionTitle,
    refreshChatsNow,
    scheduleChildPreviewFlush,
    setEvaluationState,
    setPendingChildApproval,
    setTaskList,
    updateTaskListDelta,
    backgroundChildrenByParentRef,
    lastChildHeartbeatAtRef,
    lastChildRoundCountRef,
    pendingChildPreviewRef,
  } = run.ctx;
  return {
    onSubAgentStarted: (parentSessionId, childSessionId, title) => {
      const bg =
        backgroundChildrenByParentRef.current.get(parentSessionId) ??
        ({ children: new Set<string>(), parentDone: false } as const);
      const children = new Set(bg.children);
      children.add(childSessionId);
      backgroundChildrenByParentRef.current.set(parentSessionId, {
        children,
        parentDone: bg.parentDone,
      });

      // Parent phase is already driven by applyAgentEvent(sub_agent_started)
      // via applyChildProgress → applyChildProgress.

      applyChildProgress(parentSessionId, childSessionId, {
        title,
        // "started" now means "created + queued". Mark as pending until
        // we observe child events/heartbeat/completion.
        status: "pending",
        lastEventAt: new Date().toISOString(),
      });

      // Persist child session title to backend so it survives refresh.
      // Fire-and-forget to avoid blocking the SSE event loop.
      if (title && title.trim()) {
        persistSessionTitle(childSessionId, title).catch((e) => {
          console.warn(
            `[useAgentEventSubscription] Failed to persist sub-agent title for ${childSessionId}:`,
            e,
          );
        });
      }

      // Ensure the child session appears in the session list immediately.
      void refreshChatsNow();
    },

    onChildApprovalRequested: (childSessionId, requestId, request) => {
      // A blocked out-of-process child sub-agent hit a gated tool and is
      // awaiting a human approve/deny decision. Surface the prompt on the
      // parent session (the one whose SSE stream we are subscribed to).
      setPendingChildApproval(parentSessionId, {
        childSessionId,
        requestId,
        toolName: request.toolName ?? null,
        permission: request.permission ?? null,
        resource: request.resource ?? null,
      });
    },

    onSubAgentEvent: (parentSessionId, childSessionId, evt: AgentEvent) => {
      if (evt.type === "task_list_updated" && evt.task_list) {
        const sharedSessionId = evt.task_list.session_id || parentSessionId;
        setTaskList(sharedSessionId, evt.task_list);
        return;
      }
      if (evt.type === "task_list_item_progress") {
        const sharedSessionId = evt.session_id || parentSessionId;
        if (
          typeof evt.item_id === "string" &&
          isTaskItemStatus(evt.status) &&
          typeof evt.tool_calls_count === "number" &&
          typeof evt.version === "number"
        ) {
          if (!useAppStore.getState().taskLists[sharedSessionId]) {
            void ensureTaskListBaseline(sharedSessionId);
            return;
          }
          updateTaskListDelta(sharedSessionId, {
            session_id: sharedSessionId,
            item_id: evt.item_id,
            status: evt.status,
            tool_calls_count: evt.tool_calls_count,
            version: evt.version,
          });
        }
        return;
      }
      if (evt.type === "task_evaluation_started") {
        const sharedSessionId = evt.session_id || parentSessionId;
        setEvaluationState(sharedSessionId, {
          isEvaluating: true,
          reasoning: null,
          timestamp: Date.now(),
        });
        return;
      }
      if (evt.type === "task_evaluation_completed") {
        const sharedSessionId = evt.session_id || parentSessionId;
        const updatesCount = evt.updates_count ?? 0;
        setEvaluationState(sharedSessionId, {
          isEvaluating: false,
          reasoning: updatesCount > 0 ? compactEvaluationReasoning(evt.reasoning ?? "") : null,
          timestamp: Date.now(),
        });
        return;
      }

      const current = selectChildren(parentSessionId)(useAppStore.getState())?.[childSessionId];
      if (isTerminalChildStatus(current?.status)) {
        return;
      }

      if (evt.type === "runner_progress") {
        const nextRoundCount =
          typeof evt.round_count === "number" ? evt.round_count : current?.roundCount;
        const roundKey = `${parentSessionId}:${childSessionId}`;
        if (
          typeof nextRoundCount === "number" &&
          lastChildRoundCountRef.current.get(roundKey) === nextRoundCount
        ) {
          return;
        }
        if (typeof nextRoundCount === "number") {
          lastChildRoundCountRef.current.set(roundKey, nextRoundCount);
        }
        applyChildProgress(parentSessionId, childSessionId, {
          status: "running",
          roundCount: nextRoundCount,
          lastEventAt: new Date().toISOString(),
        });
        return;
      }

      // Maintain a small rolling preview for fast UI feedback, but flush it in a
      // throttled way so we don't write global execution state on every child token.
      if (evt.type === "token" && typeof evt.content === "string") {
        const previewKey = `${parentSessionId}:${childSessionId}`;
        const pendingPreview = pendingChildPreviewRef.current.get(previewKey);
        const livePreview = getChildPreviewState(parentSessionId, childSessionId);
        const prev =
          pendingPreview?.content ?? livePreview.outputPreview ?? current?.outputPreview ?? "";
        const next = (prev + evt.content).slice(-CHILD_PREVIEW_MAX_CHARS);
        setChildPreviewState(parentSessionId, childSessionId, next);
        scheduleChildPreviewFlush(parentSessionId, childSessionId, next, new Date().toISOString());
      } else {
        applyChildProgress(parentSessionId, childSessionId, {
          status: "running",
          lastEventAt: new Date().toISOString(),
        });
      }
    },

    onSubAgentHeartbeat: (parentSessionId, childSessionId, ts) => {
      if (isTerminalChildStatus(getChildStatus(parentSessionId, childSessionId))) {
        return;
      }
      const heartbeatKey = `${parentSessionId}:${childSessionId}`;
      const lastHeartbeatAt = lastChildHeartbeatAtRef.current.get(heartbeatKey) ?? 0;
      const nextHeartbeatAt = Date.parse(ts || "") || Date.now();
      if (nextHeartbeatAt - lastHeartbeatAt < CHILD_HEARTBEAT_MIN_INTERVAL_MS) {
        return;
      }
      lastChildHeartbeatAtRef.current.set(heartbeatKey, nextHeartbeatAt);
      applyChildProgress(parentSessionId, childSessionId, {
        status: "running",
        lastHeartbeatAt: ts,
      });
    },

    onSubAgentCompleted: (parentSessionId, childSessionId, status, error) => {
      const bg =
        backgroundChildrenByParentRef.current.get(parentSessionId) ??
        ({ children: new Set<string>(), parentDone: false } as const);
      const children = new Set(bg.children);
      children.delete(childSessionId);
      backgroundChildrenByParentRef.current.set(parentSessionId, {
        children,
        parentDone: bg.parentDone,
      });

      flushChildPreview(parentSessionId, childSessionId);
      clearChildPreviewState(parentSessionId, childSessionId);
      const childStateKey = `${parentSessionId}:${childSessionId}`;
      lastChildHeartbeatAtRef.current.delete(childStateKey);
      lastChildRoundCountRef.current.delete(childStateKey);
      applyChildProgress(parentSessionId, childSessionId, {
        status,
        error,
        lastEventAt: new Date().toISOString(),
      });
      // Desktop notification on sub-agent completion is delivered by the backend
      // via the `notification` event (see agentSubscriptionRunner.onNotification).

      // If parent already completed and no more background children, wait briefly
      // for any backend auto-resume/root-resume handoff before tearing down the stream.
      if (bg.parentDone && children.size === 0) {
        scheduleParentSettleCheck();
      }

      void refreshChatsNow();
    },
  };
}
