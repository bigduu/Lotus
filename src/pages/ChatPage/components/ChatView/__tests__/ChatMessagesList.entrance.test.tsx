import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRef } from "react";

import { ChatMessagesList } from "../ChatMessagesList";
import type { RenderableEntry } from "../useChatViewMessages";
import type { UserMessage } from "@shared/types/chat";

const userMessage = (id: string): UserMessage => ({
  id,
  role: "user",
  content: `message ${id}`,
  createdAt: "2026-05-10T00:00:00.000Z",
});

const entriesOf = (ids: string[]): RenderableEntry[] =>
  ids.map((id) => ({ message: userMessage(id) }));

const baseProps = {
  currentChat: null,
  currentSessionId: "session-1",
  convertRenderableEntry: (entry: RenderableEntry) => ({
    type: "message" as const,
    message: (entry as { message: UserMessage }).message,
    align: "flex-end" as const,
  }),
  handleDeleteMessage: () => {},
  handleDeleteToolMessages: () => {},
  handleMessagesScroll: () => {},
  hasSystemPrompt: false,
  messagesListRef: createRef<HTMLDivElement>(),
  bottomAnchorRef: createRef<HTMLDivElement>(),
  rowGap: 8,
  showMessagesView: true,
  screens: { xs: false } as never,
  workflowDraftId: null,
  isThinking: false,
  padding: "8px",
  selectionMode: false,
  selectedMessageIds: new Set<string>(),
  selectableMessageIds: new Set<string>(),
  onToggleMessageSelection: () => {},
};

describe("ChatMessagesList entrance animations (#170)", () => {
  let originalOffsetHeight: PropertyDescriptor | undefined;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.hasAttribute("data-index") ? 100 : 800;
      },
    });

    // jsdom has no ResizeObserver; the virtualizer needs rect reports to
    // produce any virtual items.
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      private callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
      observe(target: Element) {
        const height = target.hasAttribute("data-index") ? 100 : 800;
        const entry = {
          target,
          borderBoxSize: [{ inlineSize: 800, blockSize: height }],
        } as unknown as ResizeObserverEntry;
        // Defer like the real observer — a synchronous callback recurses
        // through measureElement → setState → render → observe.
        queueMicrotask(() => this.callback([entry], this as unknown as ResizeObserver));
      }
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, "offsetHeight", originalOffsetHeight);
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver;
  });

  it("animates entries only on their first render, not on remounts", async () => {
    const props = { ...baseProps, renderableMessages: entriesOf(["m1", "m2"]) };
    const { container, rerender } = render(<ChatMessagesList {...props} />);

    // First render: both entries get the entrance animation.
    await waitFor(() => {
      expect(container.querySelectorAll(".messageEnter")).toHaveLength(2);
    });

    // Same entries on a later render (e.g. scrolled out and back into the
    // overscan): no replay.
    rerender(<ChatMessagesList {...props} />);
    await waitFor(() => {
      expect(container.querySelectorAll(".messageEnter")).toHaveLength(0);
    });
  });

  it("animates only the newly appended entry", async () => {
    const props = { ...baseProps, renderableMessages: entriesOf(["m1", "m2"]) };
    const { container, rerender } = render(<ChatMessagesList {...props} />);
    await waitFor(() => {
      expect(container.querySelectorAll(".messageEnter")).toHaveLength(2);
    });
    rerender(<ChatMessagesList {...props} />);
    await waitFor(() => {
      expect(container.querySelectorAll(".messageEnter")).toHaveLength(0);
    });

    rerender(<ChatMessagesList {...props} renderableMessages={entriesOf(["m1", "m2", "m3"])} />);
    await waitFor(() => {
      const animated = container.querySelectorAll(".messageEnter");
      expect(animated).toHaveLength(1);
      expect(animated[0].textContent).toContain("m3");
    });
  });

  it("marks rows revealed by scrolling so revisiting them does not replay (#170)", async () => {
    const many = entriesOf(Array.from({ length: 20 }, (_, i) => `m${i + 1}`));
    const props = { ...baseProps, renderableMessages: many };
    const { container } = render(<ChatMessagesList {...props} />);
    const scroller = baseProps.messagesListRef.current as HTMLElement;

    // Initial viewport rows animate, then get marked.
    await waitFor(() => {
      expect(container.querySelectorAll(".messageEnter").length).toBeGreaterThan(0);
    });
    await waitFor(() => {
      expect(container.querySelectorAll(".messageEnter")).toHaveLength(0);
    });

    // Scroll down: previously unmounted rows appear (they animate once)…
    scroller.scrollTop = 1600;
    fireEvent.scroll(scroller);
    await waitFor(() => {
      expect(container.querySelectorAll('[data-chat-entry-id="m20"]').length).toBe(1);
    });
    await waitFor(() => {
      // …and are then marked too — nothing left animating.
      expect(container.querySelectorAll(".messageEnter")).toHaveLength(0);
    });

    // Scroll back up: the initial rows were marked long ago — no replay.
    scroller.scrollTop = 0;
    fireEvent.scroll(scroller);
    await waitFor(() => {
      expect(container.querySelectorAll('[data-chat-entry-id="m1"]').length).toBe(1);
    });
    expect(container.querySelectorAll(".messageEnter")).toHaveLength(0);
  });
});
