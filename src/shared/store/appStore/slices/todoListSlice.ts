import { StateCreator } from "zustand";

import { AgentClient } from "@services/chat/AgentService";

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
  isEvaluating: boolean;
  reasoning: string | null;
  timestamp: number | null;
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

  // Set full task list (from TaskListUpdated event)
  setTaskList: (sessionId, taskList) =>
    set((state) => ({
      taskLists: {
        ...state.taskLists,
        [sessionId]: taskList,
      },
      taskListVersions: {
        ...state.taskListVersions,
        [sessionId]: taskList.version || 0,
      },
    })),

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
    set((state) => ({
      evaluationStates: {
        ...state.evaluationStates,
        [sessionId]: evalState,
      },
    })),

  // Clear evaluation state (NEW)
  clearEvaluationState: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...remainingEvaluations } = state.evaluationStates;
      return {
        evaluationStates: remainingEvaluations,
      };
    }),
});
