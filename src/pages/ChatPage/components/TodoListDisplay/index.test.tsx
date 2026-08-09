import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import TodoListDisplay from ".";
import type { TaskListMsg } from "@shared/types/todoList";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

const timestamp = "2026-08-09T00:00:00Z";

const taskList: TaskListMsg = {
  list_id: "list-1",
  message_id: "message-1",
  title: "Release checklist",
  description: "Track every state",
  status: "active",
  created_at: timestamp,
  updated_at: timestamp,
  items: [
    {
      id: "pending",
      description: "Waiting task",
      status: "pending",
      order: 0,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: "current",
      description: "Current task",
      status: "in_progress",
      order: 1,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: "complete",
      description: "Finished task",
      status: "completed",
      summary: "Finished cleanly",
      order: 2,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: "skipped",
      description: "Skipped task",
      status: "skipped",
      order: 3,
      created_at: timestamp,
      updated_at: timestamp,
    },
    {
      id: "failed",
      description: "Failed task",
      status: "failed",
      metadata: { error: "Network unavailable" },
      order: 4,
      created_at: timestamp,
      updated_at: timestamp,
    },
  ],
};

describe("TodoListDisplay", () => {
  it("maps list and item states while exposing progress, current work, summaries, and errors", () => {
    render(<TodoListDisplay taskList={taskList} />);

    expect(screen.getByText("Release checklist")).toBeInTheDocument();
    expect(screen.getByText("Track every state")).toBeInTheDocument();
    expect(screen.getByText("components.todoList.listStatus.active")).toBeInTheDocument();
    expect(screen.getByText("components.todoList.status.pending")).toBeInTheDocument();
    expect(screen.getByText("components.todoList.status.inProgress")).toBeInTheDocument();
    expect(screen.getByText("components.todoList.status.completed")).toBeInTheDocument();
    expect(screen.getByText("components.todoList.status.skipped")).toBeInTheDocument();
    expect(screen.getByText("components.todoList.status.failed")).toBeInTheDocument();
    expect(screen.getByText("Finished cleanly")).toBeInTheDocument();
    expect(screen.getByText("Network unavailable")).toBeInTheDocument();
    expect(
      screen.getByText('components.todoList.percentComplete:{"percent":20}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('components.todoList.progressLabel:{"completed":1,"total":5}'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('components.todoList.currentLabel:{"description":"Current task"}'),
    ).toBeInTheDocument();
  });

  it("handles an empty completed list without a current-item label", () => {
    render(<TodoListDisplay taskList={{ ...taskList, status: "completed", items: [] }} />);

    expect(screen.getByText("components.todoList.listStatus.completed")).toBeInTheDocument();
    expect(
      screen.getByText('components.todoList.percentComplete:{"percent":0}'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/components\.todoList\.currentLabel/)).not.toBeInTheDocument();
  });
});
