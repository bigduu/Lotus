import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatViewScroll } from "../useChatViewScroll";

const { subscribeMock, handleScrollMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  handleScrollMock: vi.fn(),
}));

vi.mock("../../../utils/streamingMessageBus", () => ({
  streamingMessageBus: {
    subscribe: subscribeMock,
  },
}));

vi.mock("../useScrollAnchorPersistence", () => ({
  useScrollAnchorPersistence: () => ({
    handleScroll: handleScrollMock,
  }),
}));

describe("useChatViewScroll", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    subscribeMock.mockReset();
    handleScrollMock.mockReset();
    subscribeMock.mockImplementation(() => () => undefined);
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        disconnect() {}
      },
    );
  });

  it("keeps correcting scroll-to-bottom while scrollHeight grows", () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    let scrollTop = 0;
    let scrollHeight = 600;
    const clientHeight = 300;
    const scrollToCalls: Array<{ top: number; behavior: ScrollBehavior }> = [];

    const element = {
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        scrollTop = value;
      },
      get scrollHeight() {
        return scrollHeight;
      },
      get clientHeight() {
        return clientHeight;
      },
      scrollTo: ({ top, behavior }: { top: number; behavior: ScrollBehavior }) => {
        scrollToCalls.push({ top, behavior });
        const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
        scrollTop = Math.min(top, maxScrollTop);
        if (scrollToCalls.length === 1) {
          scrollHeight = 720;
        }
      },
    } as unknown as HTMLDivElement;

    const messagesListRef = { current: element };

    const { result } = renderHook(() =>
      useChatViewScroll({
        currentSessionId: "session-1",
        isThinking: false,
        messagesListRef,
        renderableMessages: [{ message: { id: "m1", createdAt: new Date().toISOString() } } as any],
      }),
    );

    act(() => {
      result.current.scrollToBottom();
    });

    while (rafQueue.length > 0) {
      const cb = rafQueue.shift();
      if (!cb) continue;
      act(() => {
        cb(performance.now());
      });
    }

    expect(scrollToCalls.length).toBeGreaterThan(1);
    expect(scrollToCalls[0]).toEqual({ top: 300, behavior: "smooth" });
    expect(scrollToCalls[scrollToCalls.length - 1]?.top).toBe(420);
  });

  it("keeps correcting scroll-to-top until the container reaches the top", () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    let scrollTop = 280;
    const scrollHeight = 900;
    const clientHeight = 300;
    const scrollToCalls: Array<{ top: number; behavior: ScrollBehavior }> = [];

    const element = {
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        scrollTop = value;
      },
      get scrollHeight() {
        return scrollHeight;
      },
      get clientHeight() {
        return clientHeight;
      },
      scrollTo: ({ top, behavior }: { top: number; behavior: ScrollBehavior }) => {
        scrollToCalls.push({ top, behavior });
        scrollTop = top;
      },
    } as unknown as HTMLDivElement;

    const messagesListRef = { current: element };

    const { result } = renderHook(() =>
      useChatViewScroll({
        currentSessionId: "session-1",
        isThinking: false,
        messagesListRef,
        renderableMessages: [{ message: { id: "m1", createdAt: new Date().toISOString() } } as any],
      }),
    );

    act(() => {
      result.current.scrollToTop();
    });

    while (rafQueue.length > 0) {
      const cb = rafQueue.shift();
      if (!cb) continue;
      act(() => {
        cb(performance.now());
      });
    }

    expect(scrollToCalls.length).toBeGreaterThan(0);
    expect(scrollToCalls[0]).toEqual({ top: 0, behavior: "auto" });
    expect(scrollTop).toBe(0);
  });

  it("marks unread activity when streaming updates arrive while the user is scrolled up", () => {
    const listeners: Array<
      (update: { sessionId: string; messageId: string; content: string | null }) => void
    > = [];
    subscribeMock.mockImplementation((listener) => {
      listeners.push(listener);
      return () => undefined;
    });

    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    let scrollTop = 240;
    const scrollHeight = 1000;
    const clientHeight = 300;
    const scrollToCalls: Array<{ top: number; behavior: ScrollBehavior }> = [];

    const element = {
      get scrollTop() {
        return scrollTop;
      },
      set scrollTop(value: number) {
        scrollTop = value;
      },
      get scrollHeight() {
        return scrollHeight;
      },
      get clientHeight() {
        return clientHeight;
      },
      scrollTo: ({ top, behavior }: { top: number; behavior: ScrollBehavior }) => {
        scrollToCalls.push({ top, behavior });
        scrollTop = top;
      },
    } as unknown as HTMLDivElement;

    const messagesListRef = { current: element };

    const { result } = renderHook(() =>
      useChatViewScroll({
        currentSessionId: "session-1",
        isThinking: false,
        messagesListRef,
        renderableMessages: [{ message: { id: "m1", createdAt: new Date().toISOString() } } as any],
      }),
    );

    act(() => {
      result.current.handleMessagesScroll({} as any);
    });

    while (rafQueue.length > 0) {
      const cb = rafQueue.shift();
      if (!cb) continue;
      act(() => {
        cb(performance.now());
      });
    }

    expect(result.current.showScrollToBottom).toBe(true);
    expect(result.current.hasUnreadActivity).toBe(false);

    act(() => {
      listeners[0]?.({
        sessionId: "session-1",
        messageId: "streaming-message",
        content: "hello",
      });
    });

    expect(scrollToCalls).toHaveLength(0);
    expect(result.current.hasUnreadActivity).toBe(true);
  });
});
