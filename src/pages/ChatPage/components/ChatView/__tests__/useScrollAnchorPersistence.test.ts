import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useScrollAnchorPersistence } from "../useScrollAnchorPersistence";
import type { ScrollAnchorV1 } from "../scrollAnchorStorage";
import type { RenderableEntry } from "../useChatViewMessages";

const { loadScrollAnchorMock, saveScrollAnchorMock, restoreScrollAnchorUntilStableMock } =
  vi.hoisted(() => ({
    loadScrollAnchorMock: vi.fn(),
    saveScrollAnchorMock: vi.fn(),
    restoreScrollAnchorUntilStableMock: vi.fn(),
  }));

vi.mock("../scrollAnchorStorage", () => ({
  loadScrollAnchor: loadScrollAnchorMock,
  saveScrollAnchor: saveScrollAnchorMock,
}));

vi.mock("../scrollAnchorRestore", () => ({
  restoreScrollAnchorUntilStable: restoreScrollAnchorUntilStableMock,
}));

const makeEntry = (id: string, createdAt: string): RenderableEntry =>
  ({ message: { id, createdAt, role: "assistant", content: "hi" } }) as unknown as RenderableEntry;

function createMockScrollEl(initialScrollTop = 0) {
  let scrollTop = initialScrollTop;
  return {
    style: {} as CSSStyleDeclaration,
    get scrollTop() {
      return scrollTop;
    },
    set scrollTop(value: number) {
      scrollTop = value;
    },
    scrollHeight: 1000,
    clientHeight: 300,
    getBoundingClientRect: () => ({
      top: 0,
      bottom: 300,
      left: 0,
      right: 0,
      width: 0,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    querySelectorAll: () => [] as unknown as NodeListOf<HTMLElement>,
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as HTMLDivElement;
}

const flushMicrotasks = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useScrollAnchorPersistence", () => {
  beforeEach(() => {
    loadScrollAnchorMock.mockReset();
    saveScrollAnchorMock.mockReset().mockResolvedValue(undefined);
    restoreScrollAnchorUntilStableMock.mockReset().mockResolvedValue(undefined);
  });

  it("lands at the bottom when the session has no saved anchor", async () => {
    loadScrollAnchorMock.mockResolvedValue(null);
    const el = createMockScrollEl();
    const messagesListRef = { current: el };
    const scrollToBottom = vi.fn();

    renderHook(() =>
      useScrollAnchorPersistence({
        currentSessionId: "session-a",
        messagesListRef,
        renderableMessages: [makeEntry("m1", "2026-01-01T00:00:00Z")],
        scrollToBottom,
      }),
    );

    await flushMicrotasks();

    expect(loadScrollAnchorMock).toHaveBeenCalledWith("session-a");
    expect(scrollToBottom).toHaveBeenCalledWith({ behavior: "auto" });
    expect(restoreScrollAnchorUntilStableMock).not.toHaveBeenCalled();
  });

  it("treats an anchor that was effectively at-bottom when saved as 'land at bottom', not the literal offset", async () => {
    const nearBottomAnchor: ScrollAnchorV1 = {
      v: 1,
      anchorId: "m1",
      offsetPx: 400,
      ts: Date.now(),
      distanceFromBottomPx: 50, // well under the "at bottom" threshold
    };
    loadScrollAnchorMock.mockResolvedValue(nearBottomAnchor);
    const el = createMockScrollEl();
    const messagesListRef = { current: el };
    const scrollToBottom = vi.fn();

    renderHook(() =>
      useScrollAnchorPersistence({
        currentSessionId: "session-a",
        messagesListRef,
        renderableMessages: [makeEntry("m1", "2026-01-01T00:00:00Z")],
        scrollToBottom,
      }),
    );

    await flushMicrotasks();

    expect(scrollToBottom).toHaveBeenCalledWith({ behavior: "auto" });
    expect(restoreScrollAnchorUntilStableMock).not.toHaveBeenCalled();
  });

  it("restores a genuinely mid-history anchor to its literal offset", async () => {
    const midHistoryAnchor: ScrollAnchorV1 = {
      v: 1,
      anchorId: "m1",
      offsetPx: 240,
      ts: Date.now(),
      distanceFromBottomPx: 5000, // far from the bottom — a deliberate mid-history read
    };
    loadScrollAnchorMock.mockResolvedValue(midHistoryAnchor);
    const el = createMockScrollEl();
    const messagesListRef = { current: el };
    const scrollToBottom = vi.fn();

    renderHook(() =>
      useScrollAnchorPersistence({
        currentSessionId: "session-a",
        messagesListRef,
        renderableMessages: [makeEntry("m1", "2026-01-01T00:00:00Z")],
        scrollToBottom,
      }),
    );

    await flushMicrotasks();

    expect(restoreScrollAnchorUntilStableMock).toHaveBeenCalledTimes(1);
    const call = restoreScrollAnchorUntilStableMock.mock.calls[0][0];
    expect(call.offsetPx).toBe(240);
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("falls back to a literal-offset restore for anchors saved before distanceFromBottomPx existed", async () => {
    const legacyAnchor: ScrollAnchorV1 = {
      v: 1,
      anchorId: "m1",
      offsetPx: 150,
      ts: Date.now(),
      // distanceFromBottomPx intentionally omitted
    };
    loadScrollAnchorMock.mockResolvedValue(legacyAnchor);
    const el = createMockScrollEl();
    const messagesListRef = { current: el };
    const scrollToBottom = vi.fn();

    renderHook(() =>
      useScrollAnchorPersistence({
        currentSessionId: "session-a",
        messagesListRef,
        renderableMessages: [makeEntry("m1", "2026-01-01T00:00:00Z")],
        scrollToBottom,
      }),
    );

    await flushMicrotasks();

    expect(restoreScrollAnchorUntilStableMock).toHaveBeenCalledTimes(1);
    expect(scrollToBottom).not.toHaveBeenCalled();
  });

  it("re-runs anchor restore on every switch back to a session, not only the first visit", async () => {
    loadScrollAnchorMock.mockImplementation((sessionId: string) => {
      if (sessionId === "session-a") {
        return Promise.resolve({
          v: 1,
          anchorId: "m1",
          offsetPx: 240,
          ts: Date.now(),
          distanceFromBottomPx: 5000,
        } satisfies ScrollAnchorV1);
      }
      return Promise.resolve(null);
    });

    const el = createMockScrollEl();
    const messagesListRef = { current: el };
    const scrollToBottom = vi.fn();
    const entries = [makeEntry("m1", "2026-01-01T00:00:00Z")];

    const { rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useScrollAnchorPersistence({
          currentSessionId: sessionId,
          messagesListRef,
          renderableMessages: entries,
          scrollToBottom,
        }),
      { initialProps: { sessionId: "session-a" } },
    );

    await flushMicrotasks();
    expect(loadScrollAnchorMock).toHaveBeenCalledTimes(1);
    expect(restoreScrollAnchorUntilStableMock).toHaveBeenCalledTimes(1);

    // Switch away to a different session (no saved anchor there -> bottom).
    rerender({ sessionId: "session-b" });
    await flushMicrotasks();
    expect(loadScrollAnchorMock).toHaveBeenCalledTimes(2);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);

    // Switch back to session-a. Under the old "restoredChatsRef only grows"
    // gate this would be skipped entirely (the bug in #93); it must now
    // look up and restore the anchor again.
    rerender({ sessionId: "session-a" });
    await flushMicrotasks();

    expect(loadScrollAnchorMock).toHaveBeenCalledTimes(3);
    expect(loadScrollAnchorMock).toHaveBeenNthCalledWith(3, "session-a");
    expect(restoreScrollAnchorUntilStableMock).toHaveBeenCalledTimes(2);
  });

  it("never inherits the previous session's scrollTop: resets it synchronously before the anchor lookup resolves", () => {
    // Simulate a leftover pixel offset from whatever was previously rendered
    // into this (reused) scroll container.
    const el = createMockScrollEl(9999);
    const messagesListRef = { current: el };
    const scrollToBottom = vi.fn();

    // Never resolves within this test — we only assert the synchronous,
    // pre-paint state set by the layout effect itself.
    loadScrollAnchorMock.mockReturnValue(new Promise(() => {}));

    renderHook(() =>
      useScrollAnchorPersistence({
        currentSessionId: "session-a",
        messagesListRef,
        renderableMessages: [makeEntry("m1", "2026-01-01T00:00:00Z")],
        scrollToBottom,
      }),
    );

    // scrollHeight (1000) - clientHeight (300) = 700: the synchronous "safe
    // default" the layout effect must snap to before any async work settles,
    // regardless of the 9999 the container was left at.
    expect(el.scrollTop).toBe(700);
  });
});
