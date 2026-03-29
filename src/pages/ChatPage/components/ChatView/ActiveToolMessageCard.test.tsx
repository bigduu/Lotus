import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ActiveToolMessageCard, type SessionDiffSummary } from "./ActiveToolMessageCard";

const SESSION_ID = "chat-diff-test";
const STORAGE_KEY = `chat-session-diff-collapse:${SESSION_ID}`;

const PRIMARY_FILE_PATH = "/tmp/test_say.py";
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

const SECOND_FILE_PATH = "/tmp/another.py";
const SECOND_DIFF = [
  "--- a/another.py",
  "+++ b/another.py",
  "@@ -1,1 +1,2 @@",
  " print('hello')",
  "+print('world')",
].join("\n");

const createSummary = (files?: SessionDiffSummary["files"]): SessionDiffSummary => ({
  totalAdded: 2,
  totalRemoved: 2,
  changedTools: 1,
  files: files ?? [
    {
      filePath: PRIMARY_FILE_PATH,
      added: 2,
      removed: 2,
      unifiedDiff: PRIMARY_DIFF,
      truncated: false,
    },
  ],
});

describe("ActiveToolMessageCard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists session-level collapse state by session id", () => {
    const summary = createSummary();

    const { unmount } = render(
      <ActiveToolMessageCard sessionDiffSummary={summary} sessionId={SESSION_ID} />,
    );

    expect(screen.getByTestId("session-diff-file-list")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("session-diff-toggle"));

    expect(screen.queryByTestId("session-diff-file-list")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")).toMatchObject({
      isExpanded: false,
    });

    unmount();

    render(<ActiveToolMessageCard sessionDiffSummary={summary} sessionId={SESSION_ID} />);

    expect(screen.queryByTestId("session-diff-file-list")).not.toBeInTheDocument();
  });

  it("persists file-level expansion and renders styled diff lines", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        isExpanded: true,
        expandedFiles: [PRIMARY_FILE_PATH],
      }),
    );

    render(<ActiveToolMessageCard sessionDiffSummary={createSummary()} sessionId={SESSION_ID} />);

    expect(screen.getByTestId("session-diff-file-panel")).toBeInTheDocument();

    const addLine = screen.getByText("+const added = true;");
    const removeLine = screen.getByText("-const deleted = false;");
    const modifiedAddLine = screen.getByText("+const newValue = 1;");
    const modifiedRemoveLine = screen.getByText("-const oldValue = 1;");

    expect((addLine as HTMLElement).dataset.kind).toBe("add");
    expect((removeLine as HTMLElement).dataset.kind).toBe("remove");
    expect((modifiedAddLine as HTMLElement).dataset.kind).toBe("modified_add");
    expect((modifiedRemoveLine as HTMLElement).dataset.kind).toBe("modified_remove");

    expect((addLine as HTMLElement).style.background).not.toBe("");
    expect((removeLine as HTMLElement).style.background).not.toBe("");
    expect((modifiedAddLine as HTMLElement).style.background).not.toBe("");
    expect((modifiedRemoveLine as HTMLElement).style.background).not.toBe("");
    expect((modifiedAddLine as HTMLElement).style.borderLeft).not.toBe("");
    expect((modifiedRemoveLine as HTMLElement).style.borderLeft).not.toBe("");

    fireEvent.click(screen.getByTestId("session-diff-file-header"));

    expect(screen.queryByTestId("session-diff-file-panel")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")).toMatchObject({
      isExpanded: true,
      expandedFiles: [],
    });
  });

  it("does not auto-expand files when persisted expandedFiles is empty", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        isExpanded: true,
        expandedFiles: [],
      }),
    );

    const { rerender } = render(
      <ActiveToolMessageCard sessionDiffSummary={createSummary()} sessionId={SESSION_ID} />,
    );

    expect(screen.queryByTestId("session-diff-file-panel")).not.toBeInTheDocument();

    rerender(
      <ActiveToolMessageCard
        sessionDiffSummary={createSummary([
          {
            filePath: PRIMARY_FILE_PATH,
            added: 2,
            removed: 2,
            unifiedDiff: PRIMARY_DIFF,
            truncated: false,
          },
          {
            filePath: SECOND_FILE_PATH,
            added: 1,
            removed: 0,
            unifiedDiff: SECOND_DIFF,
            truncated: false,
          },
        ])}
        sessionId={SESSION_ID}
      />,
    );

    expect(screen.queryByTestId("session-diff-file-panel")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("session-diff-file-header")).toHaveLength(2);
  });
});
