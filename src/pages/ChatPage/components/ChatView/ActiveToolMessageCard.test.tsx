import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ActiveToolMessageCard, type SessionDiffSummary } from "./ActiveToolMessageCard";

const SESSION_ID = "chat-diff-test";

const PRIMARY_FILE_PATH = "/tmp/z-test_say.py";
const PRIMARY_DIFF = [
  "--- a/test_say.py",
  "+++ b/test_say.py",
  "@@ -1,2 +1,2 @@",
  "-const oldValue = 1;",
  "+const newValue = 1;",
  " const keep = true;",
  "@@ -5,0 +6,1 @@",
  "+const added = true;",
  "@@ -10,1 +10,0 @@",
  "-const deleted = false;",
].join("\n");

const SECOND_FILE_PATH = "/tmp/a-another.py";
const SECOND_DIFF = [
  "--- a/another.py",
  "+++ b/another.py",
  "@@ -1,1 +1,6 @@",
  " print('hello')",
  "+print('world')",
  "+print('!')",
  "+print('again')",
  "+print('and again')",
  "+print('done')",
].join("\n");

const createSummary = (files?: SessionDiffSummary["files"]): SessionDiffSummary => ({
  totalAdded: 13,
  totalRemoved: 2,
  changedTools: 3,
  files: files ?? [
    {
      filePath: PRIMARY_FILE_PATH,
      added: 8,
      removed: 2,
      unifiedDiff: PRIMARY_DIFF,
      truncated: false,
      toolCount: 1,
    },
    {
      filePath: SECOND_FILE_PATH,
      added: 5,
      removed: 0,
      unifiedDiff: SECOND_DIFF,
      truncated: true,
      toolCount: 2,
    },
  ],
});

const getRowByPath = (path: string): HTMLElement => {
  const row = screen
    .getAllByTestId("session-diff-file-row")
    .find((candidate) => candidate.getAttribute("data-file-path") === path);

  expect(row).toBeDefined();
  return row as HTMLElement;
};

describe("ActiveToolMessageCard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders summary-first diff review with files sorted by largest changes by default", () => {
    render(<ActiveToolMessageCard sessionDiffSummary={createSummary()} sessionId={SESSION_ID} />);

    expect(screen.getByText("Session diffs")).toBeInTheDocument();
    expect(screen.getByText("Changed files")).toBeInTheDocument();
    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getByText("3 tools")).toBeInTheDocument();

    const rows = screen.getAllByTestId("session-diff-file-row");
    expect(rows[0]).toHaveAttribute("data-file-path", PRIMARY_FILE_PATH);
    expect(rows[1]).toHaveAttribute("data-file-path", SECOND_FILE_PATH);
  });

  it("can switch file ordering to path sort", () => {
    render(<ActiveToolMessageCard sessionDiffSummary={createSummary()} sessionId={SESSION_ID} />);

    fireEvent.click(screen.getByTestId("session-diff-sort-path"));

    const rows = screen.getAllByTestId("session-diff-file-row");
    expect(rows[0]).toHaveAttribute("data-file-path", SECOND_FILE_PATH);
    expect(rows[1]).toHaveAttribute("data-file-path", PRIMARY_FILE_PATH);
  });

  it("opens a wider detail drawer and highlights the selected file row", () => {
    render(<ActiveToolMessageCard sessionDiffSummary={createSummary()} sessionId={SESSION_ID} />);

    fireEvent.click(getRowByPath(SECOND_FILE_PATH));

    expect(screen.getByText("Diff details")).toBeInTheDocument();
    expect(screen.getByTestId("session-diff-detail-view")).toBeInTheDocument();
    expect(screen.getByTestId("session-diff-file-list")).toBeInTheDocument();
    expect(screen.getByTestId("session-diff-position")).toHaveTextContent("File 2 of 2");
    expect(screen.getByRole("button", { name: "Side by side" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unified" })).toBeInTheDocument();
    expect(getRowByPath(SECOND_FILE_PATH)).toHaveAttribute("data-selected", "true");
    expect(getRowByPath(PRIMARY_FILE_PATH)).toHaveAttribute("data-selected", "false");
  });

  it("supports previous and next navigation inside the detail drawer", () => {
    render(<ActiveToolMessageCard sessionDiffSummary={createSummary()} sessionId={SESSION_ID} />);

    fireEvent.click(getRowByPath(SECOND_FILE_PATH));

    expect(screen.getByTestId("session-diff-prev")).not.toBeDisabled();
    expect(screen.getByTestId("session-diff-next")).toBeDisabled();

    fireEvent.click(screen.getByTestId("session-diff-prev"));

    expect(screen.getByTestId("session-diff-position")).toHaveTextContent("File 1 of 2");
    expect(getRowByPath(PRIMARY_FILE_PATH)).toHaveAttribute("data-selected", "true");
    expect(getRowByPath(SECOND_FILE_PATH)).toHaveAttribute("data-selected", "false");
    expect(screen.getByTestId("session-diff-prev")).toBeDisabled();
    expect(screen.getByTestId("session-diff-next")).not.toBeDisabled();

    fireEvent.click(screen.getByTestId("session-diff-next"));

    expect(screen.getByTestId("session-diff-position")).toHaveTextContent("File 2 of 2");
    expect(getRowByPath(SECOND_FILE_PATH)).toHaveAttribute("data-selected", "true");
  });

  it("closes the detail drawer and clears selection when returning to the file list", async () => {
    render(<ActiveToolMessageCard sessionDiffSummary={createSummary()} sessionId={SESSION_ID} />);

    fireEvent.click(getRowByPath(SECOND_FILE_PATH));
    fireEvent.click(screen.getByTestId("session-diff-back"));

    await waitFor(() => {
      expect(screen.queryByTestId("session-diff-detail-view")).not.toBeInTheDocument();
    });

    expect(getRowByPath(PRIMARY_FILE_PATH)).toHaveAttribute("data-selected", "false");
    expect(getRowByPath(SECOND_FILE_PATH)).toHaveAttribute("data-selected", "false");
  });
});
