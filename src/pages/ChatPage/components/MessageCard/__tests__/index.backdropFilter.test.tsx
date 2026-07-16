/**
 * Regression test for Lotus issue #17: every message card carried
 * `backdrop-filter: blur(14px)`, an expensive per-frame GPU compositor op
 * repeated across every visible card (10-15 under the virtualizer's
 * overscan). The fix drops the per-card blur in favor of a solid/near-solid
 * background (see the `--lotus-message-*-bg` tokens in src/app/App.css).
 *
 * This only asserts the *style prop* no longer requests a blur — it cannot
 * assert the visual result matches the old frosted look. See the PR body
 * for the human-eyeball checklist (light/dark theme, hover, streaming).
 */
import React from "react";
import { render } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantTextMessage, UserMessage } from "@shared/types/chat";

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
// isn't relevant to this style regression test.
vi.mock("../useMessageCardMermaidFix", () => ({
  useMessageCardMermaidFix: () => vi.fn(),
}));

import MessageCard from "../index";

const textMessage: AssistantTextMessage = {
  id: "msg-text-1",
  role: "assistant",
  type: "text",
  content: "Hello world",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const userMessage: UserMessage = {
  id: "msg-text-2",
  role: "user",
  content: "Hi there",
  createdAt: "2026-07-01T00:00:00.000Z",
};

describe("MessageCard backdrop-filter removal (#17)", () => {
  beforeEach(() => {
    document.body.removeAttribute("data-vdi-safe");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not set backdropFilter on an assistant message card", () => {
    const { getByTestId } = render(
      <AntApp>
        <MessageCard sessionId="session-1" message={textMessage} messageType="text" />
      </AntApp>,
    );

    const card = getByTestId("assistant-message");
    expect(card.getAttribute("style") ?? "").not.toMatch(/backdrop-filter/i);
  });

  it("does not set backdropFilter on a user message card", () => {
    const { getByTestId } = render(
      <AntApp>
        <MessageCard sessionId="session-1" message={userMessage} messageType="text" />
      </AntApp>,
    );

    const card = getByTestId("user-message");
    expect(card.getAttribute("style") ?? "").not.toMatch(/backdrop-filter/i);
  });
});
