import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChatViewScroll } from "../useChatViewScroll";

vi.mock("../../../utils/streamingMessageBus", () => ({
  streamingMessageBus: {
    subscribe: vi.fn(() => () => undefined),
  },
}));

vi.mock("../useScrollAnchorPersistence", () => ({
  useScrollAnchorPersistence: () => ({
    handleScroll: vi.fn(),
  }),
}));

describe("useChatViewScroll", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
    const interactionState = {
      value: "IDLE" as const,
      matches: (stateName: "IDLE" | "THINKING" | "AWAITING_APPROVAL") => stateName === "IDLE",
    };

    const { result } = renderHook(() =>
      useChatViewScroll({
        currentSessionId: "session-1",
        interactionState,
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
    const interactionState = {
      value: "IDLE" as const,
      matches: (stateName: "IDLE" | "THINKING" | "AWAITING_APPROVAL") => stateName === "IDLE",
    };

    const { result } = renderHook(() =>
      useChatViewScroll({
        currentSessionId: "session-1",
        interactionState,
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
});
