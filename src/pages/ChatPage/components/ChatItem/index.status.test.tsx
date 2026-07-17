/**
 * Coverage for Lotus issue #94: ChatItem's live status dot.
 *
 * Two things are under test:
 *  1. Visual/a11y output for each `status` value (running/awaiting/error
 *     idle), including that `statusErrorMessage` is surfaced.
 *  2. That `status`/`statusErrorMessage` are actually wired into the
 *     `React.memo` comparator (`arePropsEqual`) — before #94, the memo
 *     compared only id/title/pinned/planMode/isSelected/…, so even a
 *     `status` prop would have been silently dropped and never triggered a
 *     re-render (this is the exact regression #94's issue text calls out).
 *     We assert the *actual* render count of `ChatItemComponent`'s function
 *     body by spying on `useTranslation` (react-i18next), the only hook in
 *     this render tree that resolves to ChatItem's own call — none of its
 *     antd descendants (List.Item/Button/Input/Dropdown/Tooltip) use
 *     react-i18next — mirroring the render-scoping precedent set by #18
 *     (MessageCard, spying on useMessageCardActions) and #3 (SubAgentsPanel).
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App as AntdApp } from "antd";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: vi.fn(actual.useTranslation),
  };
});

import { useTranslation } from "react-i18next";
import { ChatItem } from "./index";
import type { SidebarChatListItem } from "@shared/types/sidebarChat";

const renderSpy = vi.mocked(useTranslation);

const baseChat: SidebarChatListItem = {
  id: "chat-1",
  title: "Original title",
  kind: "root",
  pinned: false,
};

const noop = () => {};

function renderChatItem(overrides: Partial<React.ComponentProps<typeof ChatItem>> = {}) {
  const props: React.ComponentProps<typeof ChatItem> = {
    chat: baseChat,
    isSelected: false,
    onSelect: noop,
    onDelete: noop,
    onPin: noop,
    onUnpin: noop,
    onEdit: vi.fn(),
    ...overrides,
  };

  return render(
    <AntdApp>
      <ChatItem {...props} />
    </AntdApp>,
  );
}

describe("ChatItem status dot (#94)", () => {
  beforeEach(() => {
    renderSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders no status dot when status is idle (default)", () => {
    renderChatItem();
    expect(screen.queryByTestId("chat-item-status")).toBeNull();
  });

  it("renders a running dot with an accessible label", () => {
    renderChatItem({ status: "running" });
    const dot = screen.getByTestId("chat-item-status");
    expect(dot).toHaveClass("is-running");
    expect(dot).toHaveAttribute("aria-label", "Running");
  });

  it("renders an awaiting dot with an accessible label", () => {
    renderChatItem({ status: "awaiting" });
    const dot = screen.getByTestId("chat-item-status");
    expect(dot).toHaveClass("is-awaiting");
    expect(dot).toHaveAttribute("aria-label", "Awaiting your response");
  });

  it("renders an error dot with the generic label when no error detail is given", () => {
    renderChatItem({ status: "error" });
    const dot = screen.getByTestId("chat-item-status");
    expect(dot).toHaveClass("is-error");
    expect(dot).toHaveAttribute("aria-label", "Last run failed");
  });

  it("includes the error detail in the label when statusErrorMessage is set", () => {
    renderChatItem({ status: "error", statusErrorMessage: "Timed out talking to the model" });
    const dot = screen.getByTestId("chat-item-status");
    expect(dot).toHaveAttribute("aria-label", "Last run failed: Timed out talking to the model");
  });

  describe("render scoping", () => {
    it("does not re-render when an unrelated prop (not part of the memo comparator) changes", () => {
      const { rerender } = renderChatItem({ status: "idle" });
      const countAfterMount = renderSpy.mock.calls.length;

      rerender(
        <AntdApp>
          <ChatItem
            chat={baseChat}
            isSelected={false}
            onSelect={() => {}}
            onDelete={noop}
            onPin={noop}
            onUnpin={noop}
            onEdit={vi.fn()}
            status="idle"
          />
        </AntdApp>,
      );

      expect(renderSpy.mock.calls.length).toBe(countAfterMount);
    });

    it("re-renders when status changes (the #94 fix — previously silently dropped by the memo)", () => {
      const { rerender } = renderChatItem({ status: "idle" });
      const countAfterMount = renderSpy.mock.calls.length;

      rerender(
        <AntdApp>
          <ChatItem
            chat={baseChat}
            isSelected={false}
            onSelect={noop}
            onDelete={noop}
            onPin={noop}
            onUnpin={noop}
            onEdit={vi.fn()}
            status="running"
          />
        </AntdApp>,
      );

      expect(renderSpy.mock.calls.length).toBeGreaterThan(countAfterMount);
      expect(screen.getByTestId("chat-item-status")).toHaveClass("is-running");
    });

    it("does not re-render again when status is passed the same value on a later render", () => {
      const { rerender } = renderChatItem({ status: "running" });
      const countAfterMount = renderSpy.mock.calls.length;

      rerender(
        <AntdApp>
          <ChatItem
            chat={baseChat}
            isSelected={false}
            onSelect={noop}
            onDelete={noop}
            onPin={noop}
            onUnpin={noop}
            onEdit={vi.fn()}
            status="running"
          />
        </AntdApp>,
      );

      expect(renderSpy.mock.calls.length).toBe(countAfterMount);
    });

    it("re-renders when only statusErrorMessage changes while status stays 'error'", () => {
      const { rerender } = renderChatItem({ status: "error", statusErrorMessage: "first" });
      const countAfterMount = renderSpy.mock.calls.length;

      rerender(
        <AntdApp>
          <ChatItem
            chat={baseChat}
            isSelected={false}
            onSelect={noop}
            onDelete={noop}
            onPin={noop}
            onUnpin={noop}
            onEdit={vi.fn()}
            status="error"
            statusErrorMessage="second"
          />
        </AntdApp>,
      );

      expect(renderSpy.mock.calls.length).toBeGreaterThan(countAfterMount);
      expect(screen.getByTestId("chat-item-status")).toHaveAttribute(
        "aria-label",
        "Last run failed: second",
      );
    });
  });
});
