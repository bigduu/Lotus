/**
 * Coverage for Lotus issue #93 at the virtualized-list boundary:
 * `ChatSidebarVirtualRootList` must call the virtualizer's own
 * `scrollToIndex` when `scrollToItemId` names a row present in `items` —
 * the only way to reveal a row that isn't currently mounted under
 * virtualization — and must NOT call it again on a later render where
 * `scrollToItemId` is unchanged (e.g. an unrelated re-render while the user
 * is browsing/searching).
 *
 * jsdom does not implement real scroll geometry (`Element.scrollTo` is
 * undefined, so `@tanstack/react-virtual`'s internal scroll-offset never
 * actually updates from a real scroll event — see the doc comment in
 * ChatSidebarVirtualRootList.tsx). So rather than trying to observe a DOM
 * effect of scrolling, this file mocks `useVirtualizer` directly and
 * asserts the exact call sequence to `scrollToIndex`.
 */
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const scrollToIndex = vi.fn();
const useVirtualizerMock = vi.fn();

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: (...args: unknown[]) => useVirtualizerMock(...args),
}));

import { ChatSidebarVirtualRootList } from "./ChatSidebarVirtualRootList";
import type { SidebarChatItem } from "@shared/types/sidebarChat";

const makeChat = (index: number): SidebarChatItem => ({
  id: `session-${index}`,
  title: `Session ${index}`,
  kind: "root",
  pinned: false,
  parentSessionId: null,
  rootSessionId: null,
  createdByScheduleId: null,
  updatedAt: null,
  lastRunStatus: null,
  lastRunError: null,
  createdAt: index,
  config: { systemPromptId: "general_assistant", workspacePath: null },
});

describe("ChatSidebarVirtualRootList scrollToItemId (#93)", () => {
  beforeEach(() => {
    scrollToIndex.mockClear();
    useVirtualizerMock.mockReset();
    useVirtualizerMock.mockReturnValue({
      getVirtualItems: () => [{ key: "session-0", index: 0, start: 0 }],
      getTotalSize: () => 500,
      measureElement: () => {},
      scrollToIndex,
    });
  });

  const items = Array.from({ length: 100 }, (_, i) => makeChat(i));

  it("calls scrollToIndex with the matching row's index when scrollToItemId is set", () => {
    render(
      <ChatSidebarVirtualRootList
        items={items}
        estimateRowHeight={() => 36}
        renderRow={(chat) => <div>{chat.title}</div>}
        maxHeight={480}
        scrollToItemId="session-42"
      />,
    );

    expect(scrollToIndex).toHaveBeenCalledTimes(1);
    expect(scrollToIndex).toHaveBeenCalledWith(42, { align: "auto" });
  });

  it("does not call scrollToIndex when scrollToItemId is null", () => {
    render(
      <ChatSidebarVirtualRootList
        items={items}
        estimateRowHeight={() => 36}
        renderRow={(chat) => <div>{chat.title}</div>}
        maxHeight={480}
        scrollToItemId={null}
      />,
    );

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("is a no-op when scrollToItemId names a row not present in items (filtered out)", () => {
    render(
      <ChatSidebarVirtualRootList
        items={items}
        estimateRowHeight={() => 36}
        renderRow={(chat) => <div>{chat.title}</div>}
        maxHeight={480}
        scrollToItemId="session-does-not-exist"
      />,
    );

    expect(scrollToIndex).not.toHaveBeenCalled();
  });

  it("does not call scrollToIndex again on a rerender with the same scrollToItemId", () => {
    const { rerender } = render(
      <ChatSidebarVirtualRootList
        items={items}
        estimateRowHeight={() => 36}
        renderRow={(chat) => <div>{chat.title}</div>}
        maxHeight={480}
        scrollToItemId="session-5"
      />,
    );
    expect(scrollToIndex).toHaveBeenCalledTimes(1);

    // Unrelated re-render — e.g. a parent re-render triggered by something
    // else entirely — with the identical scrollToItemId value.
    rerender(
      <ChatSidebarVirtualRootList
        items={items}
        estimateRowHeight={() => 40}
        renderRow={(chat) => <div>{chat.title}</div>}
        maxHeight={480}
        scrollToItemId="session-5"
      />,
    );

    expect(scrollToIndex).toHaveBeenCalledTimes(1);
  });

  it("calls scrollToIndex again once scrollToItemId changes to a new session", () => {
    const { rerender } = render(
      <ChatSidebarVirtualRootList
        items={items}
        estimateRowHeight={() => 36}
        renderRow={(chat) => <div>{chat.title}</div>}
        maxHeight={480}
        scrollToItemId="session-5"
      />,
    );
    expect(scrollToIndex).toHaveBeenCalledTimes(1);

    rerender(
      <ChatSidebarVirtualRootList
        items={items}
        estimateRowHeight={() => 36}
        renderRow={(chat) => <div>{chat.title}</div>}
        maxHeight={480}
        scrollToItemId="session-9"
      />,
    );

    expect(scrollToIndex).toHaveBeenCalledTimes(2);
    expect(scrollToIndex).toHaveBeenLastCalledWith(9, { align: "auto" });
  });
});
