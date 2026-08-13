import { describe, expect, it, vi } from "vitest";

import type { ChatItem } from "@shared/types/chat";
import type { SessionReadMarker } from "@shared/store/sessionReadStateStore";
import { loadVisibleHistoryAndAcknowledge } from "./conversationReadLifecycle";

const rendered = {
  id: "session-1",
  kind: "root",
  title: "Session",
  createdAt: 0,
  messages: [],
  messageCount: 2,
  config: {},
} as ChatItem;

const marker = (overrides: Partial<SessionReadMarker> = {}): SessionReadMarker => ({
  activityAt: 0,
  activityRevision: "",
  messageCount: 2,
  hasMessageCount: true,
  ...overrides,
});

describe("ConversationPane unread acknowledgement (#129)", () => {
  it("acknowledges only the coordinate captured before history starts", async () => {
    let currentMarker = marker({ dirtyContentThrough: 10 });
    const markRead = vi.fn();
    let resolveHistory: (loaded: boolean) => void = () => undefined;
    const loadChatHistory = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveHistory = resolve;
        }),
    );

    const promise = loadVisibleHistoryAndAcknowledge({
      sessionId: rendered.id,
      mode: "monotonic",
      loadChatHistory,
      getRenderedSession: () => rendered,
      getReadState: () =>
        ({
          markers: { [rendered.id]: currentMarker },
          feedResetThrough: 0,
          markRead,
        }) as never,
      isPageVisible: () => true,
    });
    currentMarker = marker({ dirtyContentThrough: 11 });
    resolveHistory(true);
    await promise;

    expect(markRead).toHaveBeenCalledWith([rendered], {
      [rendered.id]: { content: 10, reset: 0 },
    });
  });

  it("does not acknowledge when the page becomes hidden during history loading", async () => {
    const markRead = vi.fn();
    let visible = true;
    let resolveHistory: (loaded: boolean) => void = () => undefined;
    const promise = loadVisibleHistoryAndAcknowledge({
      sessionId: rendered.id,
      mode: "replace",
      loadChatHistory: () =>
        new Promise<boolean>((resolve) => {
          resolveHistory = resolve;
        }),
      getRenderedSession: () => rendered,
      getReadState: () =>
        ({
          markers: { [rendered.id]: marker({ dirtyContentThrough: 10 }) },
          feedResetThrough: 0,
          markRead,
        }) as never,
      isPageVisible: () => visible,
    });
    visible = false;
    resolveHistory(true);
    await promise;

    expect(markRead).not.toHaveBeenCalled();
  });
});
