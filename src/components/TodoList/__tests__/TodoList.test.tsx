/**
 * Keyboard-accessibility tests for the TodoList header controls (issue #58).
 *
 * The pin toggle and collapse chevron were clickable <span>s without
 * role/tabIndex/keyboard handlers; these tests pin the fixed behavior:
 * - both are exposed as focusable buttons
 * - Enter/Space activate them
 * - aria-pressed / aria-expanded reflect state
 */
import React from "react";
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { useAppStore } from "@shared/store/appStore";
import type { TaskList } from "@shared/store/appStore/slices/todoListSlice";
import { TodoList } from "../TodoList";

const SESSION_ID = "todo-a11y-session";

const makeTaskList = (): TaskList => ({
  session_id: SESSION_ID,
  title: "A11y task list",
  created_at: "2026-07-16T00:00:00.000Z",
  updated_at: "2026-07-16T00:00:00.000Z",
  version: 1,
  items: [
    {
      id: "item-1",
      description: "Do the accessible thing",
      status: "pending",
      depends_on: [],
      notes: "",
    },
  ],
});

const renderTodoList = () =>
  render(<TodoList sessionId={SESSION_ID} initialCollapsed={true} compact={true} />);

describe("TodoList header keyboard accessibility", () => {
  beforeEach(() => {
    useAppStore.setState((state) => ({
      ...state,
      taskLists: { ...state.taskLists, [SESSION_ID]: makeTaskList() },
      activeItems: { ...state.activeItems, [SESSION_ID]: null },
      todoListUiStates: {},
    }));
  });

  it("exposes pin toggle and collapse chevron as focusable buttons", () => {
    renderTodoList();

    const pin = screen.getByRole("button", { name: "Pin" });
    expect(pin).toHaveAttribute("tabindex", "0");
    expect(pin).toHaveAttribute("aria-pressed", "false");

    const chevron = screen.getByRole("button", { name: "Expand task list" });
    expect(chevron).toHaveAttribute("tabindex", "0");
    expect(chevron).toHaveAttribute("aria-expanded", "false");
  });

  it("expands the list with Enter on the chevron and collapses with Space", () => {
    renderTodoList();

    expect(screen.queryByText("Do the accessible thing")).toBeNull();

    const chevron = screen.getByRole("button", { name: "Expand task list" });
    fireEvent.keyDown(chevron, { key: "Enter" });

    expect(screen.getByText("Do the accessible thing")).toBeInTheDocument();
    const collapseChevron = screen.getByRole("button", { name: "Collapse task list" });
    expect(collapseChevron).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(collapseChevron, { key: " " });
    expect(screen.queryByText("Do the accessible thing")).toBeNull();
  });

  it("toggles the pin with Space and reflects aria-pressed", () => {
    renderTodoList();

    const pin = screen.getByRole("button", { name: "Pin" });
    fireEvent.keyDown(pin, { key: " " });

    // Pinning force-expands the list and swaps the label to Unpin.
    const unpin = screen.getByRole("button", { name: "Unpin" });
    expect(unpin).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Do the accessible thing")).toBeInTheDocument();

    // While pinned the collapse chevron is hidden entirely.
    expect(screen.queryByRole("button", { name: "Collapse task list" })).toBeNull();
  });

  it("ignores unrelated keys on the chevron", () => {
    renderTodoList();

    const chevron = screen.getByRole("button", { name: "Expand task list" });
    fireEvent.keyDown(chevron, { key: "a" });
    fireEvent.keyDown(chevron, { key: "Escape" });

    expect(screen.queryByText("Do the accessible thing")).toBeNull();
  });

  it("keeps pin/collapse state across unmount and remount (#170)", () => {
    // The virtualized message list unmounts rows that scroll out of
    // overscan — pin state must survive that cycle.
    const first = renderTodoList();
    fireEvent.keyDown(screen.getByRole("button", { name: "Pin" }), { key: " " });
    expect(screen.getByText("Do the accessible thing")).toBeInTheDocument();

    first.unmount();

    renderTodoList();
    expect(screen.getByRole("button", { name: "Unpin" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Do the accessible thing")).toBeInTheDocument();
  });

  it("keeps manual collapse state across unmount and remount (#170)", () => {
    const first = renderTodoList();
    fireEvent.keyDown(screen.getByRole("button", { name: "Expand task list" }), {
      key: "Enter",
    });
    expect(screen.getByText("Do the accessible thing")).toBeInTheDocument();

    first.unmount();

    renderTodoList();
    expect(screen.getByText("Do the accessible thing")).toBeInTheDocument();
  });
});
