export type TaskItemStatus = "pending" | "in_progress" | "completed" | "skipped" | "failed";

export type TaskListStatus = "active" | "completed" | "abandoned";

export interface TaskItem {
  id: string;
  description: string;
  status: TaskItemStatus;
  order: number;
  metadata?: Record<string, unknown>;
  summary?: string;
  created_at: string;
  updated_at: string;
}

export interface TaskListMsg {
  list_id: string;
  message_id: string;
  title: string;
  description?: string;
  items: TaskItem[];
  status: TaskListStatus;
  created_at: string;
  updated_at: string;
}
