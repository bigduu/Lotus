import { StateCreator } from "zustand";

import { AgentClient } from "@services/chat/AgentService";
import { debugLog } from "@shared/utils/debugFlags";

// Task item status
export type TaskItemStatus = "pending" | "in_progress" | "completed" | "blocked";

// Task item
export interface TaskItem {
  id: string;
  description: string;
  status: TaskItemStatus;
  depends_on: string[];
  notes: string;
  tool_calls_count?: number; // NEW: number of tool calls
  summary?: string; // Concise summary of what was accomplished (for completed tasks)
}

// Task list
export interface TaskList {
  session_id: string;
  title: string;
  items: TaskItem[];
  created_at: string;
  updated_at: string;
  version?: number;
}

// Progress info
export interface TaskProgress {
  completed: number;
  total: number;
  percentage: number;
}

// Delta update for real-time progress
export interface TaskListDelta {
  session_id: string;
  item_id: string;
  status: TaskItemStatus;
  tool_calls_count: number;
  version: number;
}

export interface TaskListState {
  // Map of session ID to task list
  taskLists: Record<string, TaskList>;
  // Map of session ID to version (for conflict detection)
  taskListVersions: Record<string, number>;
  // Map of session ID to active item ID
  activeItems: Record<string, string | null>;
  // Map of session ID to evaluation state (NEW)
  evaluationStates: Record<string, EvaluationState>;
}

// Evaluation state (NEW)
export interface EvaluationState {
  /** Auxiliary evaluator lifecycle; it never implies that the main run is active. */
  phase: "running" | "completed";
  isEvaluating: boolean;
  reasoning: string | null;
  timestamp: number | null;
  itemsCount?: number;
  updatesCount?: number;
  generation?: number;
}

export interface TaskListActions {
  // Set full task list (from TaskListUpdated event)
  setTaskList: (sessionId: string, taskList: TaskList) => void;
  // Load the current task list snapshot from backend (best effort)
  loadTaskList: (sessionId: string) => Promise<TaskList | null>;
  // Update from delta (from TaskListItemProgress event)
  updateTaskListDelta: (sessionId: string, delta: TaskListDelta) => void;
  // Clear task list for a session
  clearTaskList: (sessionId: string) => void;
  // Get current version
  getTaskListVersion: (sessionId: string) => number;
  // Set evaluation state (NEW)
  setEvaluationState: (sessionId: string, state: EvaluationState) => void;
  // Clear evaluation state (NEW)
  clearEvaluationState: (sessionId: string) => void;
}

export type TaskListSlice = TaskListState & TaskListActions;

const agentClient = AgentClient.getInstance();

export const createTaskListSlice: StateCreator<TaskListSlice, [], [], TaskListSlice> = (
  set,
  get,
) => ({
  // State
  taskLists: {},
  taskListVersions: {},
  activeItems: {},
  evaluationStates: {},

  // Set full task list (from TaskListUpdated event, a child sub-agent's
  // forwarded snapshot, or a REST/baseline load). This is a genuine
  // multi-source, out-of-order write path — the SAME monotonic guard as
  // `updateTaskListDelta` applies here so a late-arriving/stale snapshot
  // can't regress a newer, delta-updated list or corrupt the version
  // counter (see issue #39).
  setTaskList: (sessionId, taskList) =>
    set((state) => {
      const currentVersion = state.taskListVersions[sessionId] || 0;
      const currentList = state.taskLists[sessionId];
      const incomingVersion = typeof taskList.version === "number" ? taskList.version : undefined;

      if (incomingVersion !== undefined) {
        // Known version: same "strictly greater" rule as the delta path —
        // ignore an equal-or-older snapshot and never lower the tracked
        // version.
        if (currentList && incomingVersion <= currentVersion) {
          debugLog("[TaskListSlice]", "setTaskList.staleSnapshotIgnored", {
            sessionId,
            incomingVersion,
            currentVersion,
          });
          return state;
        }

        return {
          taskLists: {
            ...state.taskLists,
            [sessionId]: taskList,
          },
          taskListVersions: {
            ...state.taskListVersions,
            [sessionId]: incomingVersion,
          },
        };
      }

      // Unknown version (e.g. an older backend's REST snapshot that omits
      // the field): we can't tell whether this is fresher than what we
      // already track, so never let it clobber an existing list — and
      // never reset the version counter to 0. Only apply it when there is
      // nothing tracked yet (first load / baseline).
      if (currentList) {
        debugLog("[TaskListSlice]", "setTaskList.versionlessSnapshotIgnored", {
          sessionId,
          currentVersion,
        });
        return state;
      }

      return {
        taskLists: {
          ...state.taskLists,
          [sessionId]: taskList,
        },
        taskListVersions: {
          ...state.taskListVersions,
          [sessionId]: currentVersion,
        },
      };
    }),

  loadTaskList: async (sessionId) => {
    const taskList = await agentClient.getTaskList(sessionId);
    if (!taskList) {
      return null;
    }
    get().setTaskList(taskList.session_id || sessionId, taskList);
    return taskList;
  },

  // Update from delta (from TaskListItemProgress event)
  updateTaskListDelta: (sessionId, delta) =>
    set((state) => {
      const currentVersion = state.taskListVersions[sessionId] || 0;

      // Ignore outdated updates
      if (delta.version <= currentVersion) {
        return state;
      }

      const currentList = state.taskLists[sessionId];
      if (!currentList) {
        // No existing list, ignore delta
        return state;
      }

      // Update specific item
      const updatedItems = currentList.items.map((item) =>
        item.id === delta.item_id
          ? {
              ...item,
              status: delta.status,
              tool_calls_count: delta.tool_calls_count,
            }
          : item,
      );

      return {
        taskLists: {
          ...state.taskLists,
          [sessionId]: {
            ...currentList,
            items: updatedItems,
            updated_at: new Date().toISOString(),
          },
        },
        taskListVersions: {
          ...state.taskListVersions,
          [sessionId]: delta.version,
        },
        activeItems: {
          ...state.activeItems,
          [sessionId]: delta.status === "in_progress" ? delta.item_id : null,
        },
      };
    }),

  // Clear task list for a session
  clearTaskList: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...remainingTaskLists } = state.taskLists;
      const { [sessionId]: __, ...remainingVersions } = state.taskListVersions;
      const { [sessionId]: ___, ...remainingActive } = state.activeItems;
      const { [sessionId]: ____, ...remainingEvaluations } = state.evaluationStates;
      return {
        taskLists: remainingTaskLists,
        taskListVersions: remainingVersions,
        activeItems: remainingActive,
        evaluationStates: remainingEvaluations,
      };
    }),

  // Get current version
  getTaskListVersion: (sessionId) => {
    return get().taskListVersions[sessionId] || 0;
  },

  // Set evaluation state (NEW)
  setEvaluationState: (sessionId, evalState) =>
    set((state) => {
      const current = state.evaluationStates[sessionId];
      if (
        evalState.phase === "running" &&
        current?.generation !== undefined &&
        evalState.generation !== undefined &&
        evalState.generation < current.generation
      ) {
        return state;
      }
      if (
        evalState.phase !== "running" &&
        current?.generation !== undefined &&
        evalState.generation !== current.generation
      ) {
        return state;
      }
      return {
        evaluationStates: {
          ...state.evaluationStates,
          [sessionId]: evalState,
        },
      };
    }),

  // Clear evaluation state (NEW)
  clearEvaluationState: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...remainingEvaluations } = state.evaluationStates;
      return {
        evaluationStates: remainingEvaluations,
      };
    }),
});
