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
  const flushAnimationFrames = (queue: FrameRequestCallback[]) => {
    while (queue.length > 0) {
      const cb = queue.shift();
      if (!cb) continue;
      act(() => {
        cb(performance.now());
      });
    }
  };

  const createBottomAnchorRef = (
    getTop: () => number,
    calls: Array<{ block?: ScrollLogicalPosition; behavior?: ScrollBehavior }>,
    onScrollIntoView?: (options: ScrollIntoViewOptions) => void,
  ) => ({
    current: {
      scrollIntoView: (options: ScrollIntoViewOptions = {}) => {
        calls.push({ block: options.block, behavior: options.behavior });
        onScrollIntoView?.(options);
      },
      getBoundingClientRect: () => ({
        top: getTop(),
        bottom: getTop() + 1,
        left: 0,
        right: 0,
        width: 0,
        height: 1,
        x: 0,
        y: getTop(),
        toJSON: () => ({}),
      }),
    } as unknown as HTMLDivElement,
  });

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

  it("keeps correcting anchor-driven scroll-to-bottom while content grows", () => {
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
    const anchorScrollCalls: Array<{ block?: ScrollLogicalPosition; behavior?: ScrollBehavior }> =
      [];

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
      },
      getBoundingClientRect: () => ({
        top: 0,
        bottom: clientHeight,
        left: 0,
        right: 400,
        width: 400,
        height: clientHeight,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    } as unknown as HTMLDivElement;

    const messagesListRef = { current: element };
    const bottomAnchorRef = createBottomAnchorRef(
      () => scrollHeight - scrollTop,
      anchorScrollCalls,
      ({ behavior }) => {
        const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
        scrollTop = maxScrollTop;
        if (anchorScrollCalls.length === 1) {
          scrollHeight = 720;
        }
        scrollToCalls.push({ top: maxScrollTop, behavior: (behavior ?? "auto") as ScrollBehavior });
      },
    );

    const { result } = renderHook(() =>
      useChatViewScroll({
        currentSessionId: "session-1",
        isThinking: false,
        messagesListRef,
        bottomAnchorRef,
        renderableMessages: [{ message: { id: "m1", createdAt: new Date().toISOString() } } as any],
      }),
    );

    act(() => {
      result.current.scrollToBottom();
    });

    flushAnimationFrames(rafQueue);

    expect(anchorScrollCalls.length).toBeGreaterThan(1);
    expect(anchorScrollCalls[0]).toEqual({ block: "end", behavior: "smooth" });
    expect(scrollToCalls[scrollToCalls.length - 1]?.top).toBe(420);
  });

  it("keeps following the bottom when the content height grows in place", () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    let resizeCallback: ResizeObserverCallback | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        constructor(cb: ResizeObserverCallback) {
          resizeCallback = cb;
        }
        observe() {}
        disconnect() {}
      },
    );

    let scrollTop = 300;
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
      },
      getBoundingClientRect: () => ({
        top: 0,
        bottom: clientHeight,
        left: 0,
        right: 400,
        width: 400,
        height: clientHeight,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
      firstElementChild: null,
    } as unknown as HTMLDivElement;

    const messagesListRef = { current: element };
    const anchorScrollCalls: Array<{ block?: ScrollLogicalPosition; behavior?: ScrollBehavior }> =
      [];
    const bottomAnchorRef = createBottomAnchorRef(
      () => scrollHeight - scrollTop,
      anchorScrollCalls,
      ({ behavior }) => {
        const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
        scrollTop = maxScrollTop;
        scrollToCalls.push({ top: maxScrollTop, behavior: (behavior ?? "auto") as ScrollBehavior });
      },
    );

    const { result } = renderHook(() =>
      useChatViewScroll({
        currentSessionId: "session-1",
        isThinking: false,
        messagesListRef,
        bottomAnchorRef,
        renderableMessages: [{ message: { id: "m1", createdAt: new Date().toISOString() } } as any],
      }),
    );

    flushAnimationFrames(rafQueue);
    scrollToCalls.length = 0;

    act(() => {
      scrollHeight = 760;
      resizeCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
    });

    flushAnimationFrames(rafQueue);

    expect(scrollToCalls.length).toBeGreaterThan(0);
    expect(scrollToCalls[0]).toEqual({ top: 460, behavior: "auto" });
    expect(scrollTop).toBe(460);
    expect(result.current.showScrollToBottom).toBe(false);
  });

  it("does not force scroll to bottom on resize when the user has scrolled up", () => {
    const rafQueue: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      rafQueue.push(cb);
      return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    let resizeCallback: ResizeObserverCallback | null = null;
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        constructor(cb: ResizeObserverCallback) {
          resizeCallback = cb;
        }
        observe() {}
        disconnect() {}
      },
    );

    let scrollTop = 300;
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
      },
      firstElementChild: null,
    } as unknown as HTMLDivElement;

    const messagesListRef = { current: element };
    const bottomAnchorRef = createBottomAnchorRef(() => scrollHeight - scrollTop, []);

    const { result } = renderHook(() =>
      useChatViewScroll({
        currentSessionId: "session-1",
        isThinking: false,
        messagesListRef,
        bottomAnchorRef,
        renderableMessages: [{ message: { id: "m1", createdAt: new Date().toISOString() } } as any],
      }),
    );

    flushAnimationFrames(rafQueue);
    scrollToCalls.length = 0;

    act(() => {
      scrollTop = 120;
      result.current.handleMessagesScroll({} as any);
    });

    flushAnimationFrames(rafQueue);

    act(() => {
      scrollHeight = 760;
      resizeCallback?.([] as ResizeObserverEntry[], {} as ResizeObserver);
    });

    flushAnimationFrames(rafQueue);

    expect(scrollToCalls).toHaveLength(0);
    expect(scrollTop).toBe(120);
    expect(result.current.showScrollToBottom).toBe(true);
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
    const bottomAnchorRef = createBottomAnchorRef(() => scrollHeight - scrollTop, []);

    const { result } = renderHook(() =>
      useChatViewScroll({
        currentSessionId: "session-1",
        isThinking: false,
        messagesListRef,
        bottomAnchorRef,
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
    const bottomAnchorRef = createBottomAnchorRef(() => scrollHeight - scrollTop, []);

    const { result } = renderHook(() =>
      useChatViewScroll({
        currentSessionId: "session-1",
        isThinking: false,
        messagesListRef,
        bottomAnchorRef,
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
