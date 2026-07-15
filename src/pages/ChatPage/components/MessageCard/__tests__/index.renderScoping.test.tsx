/**
 * Regression test for Lotus issue #18: MessageCard used to subscribe to
 * `selectIsBusy(sessionId)` directly via `useAppStore`, giving every visible
 * card (10-15 under the virtualizer's overscan) its own store subscription
 * that fired on every execution-state mutation.
 *
 * The fix: `isProcessing` is now resolved once by the list/pane and passed
 * down as a prop, and MessageCard's memo comparator only lets it force a
 * re-render for "question" cards (the only branch that actually reads it).
 *
 * We assert the *actual* render count of `MessageCardComponent`'s function
 * body (not just DOM output) by spying on `useMessageCardActions`, a hook it
 * calls unconditionally on every render before any early return.
 */
import React from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantTextMessage } from "@shared/types/chat";

const mockStoreState = {
  updateSession: vi.fn(),
  loadChatHistory: vi.fn(),
  refreshChats: vi.fn(),
  chats: [] as unknown[],
};

vi.mock("@shared/store/appStore", () => ({
  useAppStore: Object.assign(
    (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
    {
      getState: () => mockStoreState,
      subscribe: vi.fn(() => vi.fn()),
      setState: vi.fn(),
    },
  ),
  selectSessionById: () => () => null,
}));

// Not under test here — pulls in the OpenAI client / provider store, which
// isn't relevant to this render-scoping regression test.
vi.mock("../useMessageCardMermaidFix", () => ({
  useMessageCardMermaidFix: () => vi.fn(),
}));

vi.mock("../useMessageCardActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../useMessageCardActions")>();
  return {
    ...actual,
    useMessageCardActions: vi.fn(actual.useMessageCardActions),
  };
});

import { useMessageCardActions } from "../useMessageCardActions";
import MessageCard from "../index";

const renderSpy = vi.mocked(useMessageCardActions);

const textMessage: AssistantTextMessage = {
  id: "msg-text-1",
  role: "assistant",
  type: "text",
  content: "Hello world",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const questionMessage: AssistantTextMessage = {
  id: "msg-question-1",
  role: "assistant",
  type: "text",
  content: JSON.stringify({
    type: "question",
    question: "Pick one",
    options: [{ label: "A", value: "a", description: "" }],
  }),
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("MessageCard isProcessing render scoping (#18)", () => {
  beforeEach(() => {
    renderSpy.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not re-render a non-question card when isProcessing toggles", () => {
    const { rerender } = render(
      <MessageCard
        sessionId="session-1"
        message={textMessage}
        messageType="text"
        isProcessing={false}
      />,
    );
    // antd's Grid.useBreakpoint settles its matchMedia listeners via an
    // effect, which can cost one extra render on mount — capture the
    // steady-state count instead of assuming exactly one render.
    const countAfterMount = renderSpy.mock.calls.length;

    rerender(
      <MessageCard
        sessionId="session-1"
        message={textMessage}
        messageType="text"
        isProcessing={true}
      />,
    );

    // The memo comparator must bail out entirely — the component function
    // body (and therefore this hook) must not run again just because the
    // session's busy state flipped.
    expect(renderSpy.mock.calls.length).toBe(countAfterMount);
  });

  it("re-renders a question card when isProcessing toggles, to update the disabled state", () => {
    const { rerender } = render(
      <MessageCard
        sessionId="session-1"
        message={questionMessage}
        messageType="question"
        isProcessing={false}
      />,
    );
    const countAfterMount = renderSpy.mock.calls.length;

    rerender(
      <MessageCard
        sessionId="session-1"
        message={questionMessage}
        messageType="question"
        isProcessing={true}
      />,
    );

    expect(renderSpy.mock.calls.length).toBeGreaterThan(countAfterMount);
  });

  it("still bails out for a question card when isProcessing is unchanged", () => {
    const { rerender } = render(
      <MessageCard
        sessionId="session-1"
        message={questionMessage}
        messageType="question"
        isProcessing={true}
      />,
    );
    const countAfterMount = renderSpy.mock.calls.length;

    rerender(
      <MessageCard
        sessionId="session-1"
        message={questionMessage}
        messageType="question"
        isProcessing={true}
      />,
    );

    expect(renderSpy.mock.calls.length).toBe(countAfterMount);
  });
});
