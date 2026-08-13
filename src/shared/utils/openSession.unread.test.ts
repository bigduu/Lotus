import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAppStore } from "@shared/store/appStore";
import { useSessionReadStateStore } from "@shared/store/sessionReadStateStore";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import { openSession } from "./openSession";

const chat = {
  id: "copied-session",
  title: "Copied session",
  kind: "root" as const,
  createdAt: Date.parse("2026-08-14T00:00:00.000Z"),
  updatedAt: "2026-08-14T00:00:00.000Z",
  lastActivityAt: "2026-08-14T00:00:00.000Z",
  messageCount: 2,
  messages: [],
  config: {
    systemPromptId: "general_assistant",
    baseSystemPrompt: "You are helpful.",
    lastUsedEnhancedPrompt: null,
  },
};
const originalSelectSession = useAppStore.getState().selectSession;

describe("openSession unread transition (#129)", () => {
  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    useSessionReadStateStore.setState({
      v: 2,
      initialized: true,
      markers: {},
      feedResetThrough: 0,
      pendingFeedReset: false,
    });
    useUILayoutStore.setState((state) => ({
      ...state,
      tree: { type: "leaf", id: "leaf" },
      activeLeafId: "leaf",
      leafSessionIds: { leaf: null },
    }));
    useAppStore.setState((state) => ({
      ...state,
      chats: [chat],
      currentSessionId: null,
      latestActiveSessionId: null,
      loadChatHistory: vi.fn().mockResolvedValue(true),
      selectSession: originalSelectSession,
    }));
  });

  it("marks a copied/background session read after its content is loaded", async () => {
    openSession(chat.id, { subscribeIfRunning: false });

    await vi.waitFor(() =>
      expect(useSessionReadStateStore.getState().markers[chat.id]).toMatchObject({
        messageCount: 2,
        hasMessageCount: true,
      }),
    );
    expect(useAppStore.getState().currentSessionId).toBe(chat.id);
    expect(useUILayoutStore.getState().leafSessionIds.leaf).toBe(chat.id);
  });

  it("does not clear unread state while the document is hidden", async () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });

    openSession(chat.id, { subscribeIfRunning: false });

    await Promise.resolve();
    expect(useSessionReadStateStore.getState().markers[chat.id]).toBeUndefined();
  });

  it("loads authoritative history before clearing a count-neutral dirty coordinate", async () => {
    const loadedChat = { ...chat, messages: [{ id: "m1" }] } as unknown as typeof chat;
    const loadChatHistory = vi.fn().mockResolvedValue(true);
    useAppStore.setState((state) => ({ ...state, chats: [loadedChat], loadChatHistory }));
    useSessionReadStateStore.getState().markUnreadFromFeed(chat.id, 10);

    openSession(chat.id, { subscribeIfRunning: false });

    await vi.waitFor(() => expect(loadChatHistory).toHaveBeenCalledWith(chat.id));
    expect(useSessionReadStateStore.getState().markers[chat.id]).toMatchObject({
      dirtyContentThrough: 10,
      readContentThrough: 10,
    });
  });

  it("acknowledges only the coordinate captured before history starts", async () => {
    const loadedChat = { ...chat, messages: [{ id: "m1" }] } as unknown as typeof chat;
    let resolveHistory: (loaded: boolean) => void = () => undefined;
    const loadChatHistory = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveHistory = resolve;
        }),
    );
    useAppStore.setState((state) => ({ ...state, chats: [loadedChat], loadChatHistory }));
    useSessionReadStateStore.getState().markUnreadFromFeed(chat.id, 10);

    openSession(chat.id, { subscribeIfRunning: false });
    await vi.waitFor(() => expect(loadChatHistory).toHaveBeenCalledWith(chat.id));
    useSessionReadStateStore.getState().markUnreadFromFeed(chat.id, 11);
    resolveHistory(true);

    await vi.waitFor(() =>
      expect(useSessionReadStateStore.getState().markers[chat.id]).toMatchObject({
        dirtyContentThrough: 11,
        readContentThrough: 10,
      }),
    );
  });

  it("does not acknowledge a history response that finishes while hidden", async () => {
    const loadedChat = { ...chat, messages: [{ id: "m1" }] } as unknown as typeof chat;
    let resolveHistory: (loaded: boolean) => void = () => undefined;
    const loadChatHistory = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveHistory = resolve;
        }),
    );
    useAppStore.setState((state) => ({ ...state, chats: [loadedChat], loadChatHistory }));
    useSessionReadStateStore.getState().markUnreadFromFeed(chat.id, 10);

    openSession(chat.id, { subscribeIfRunning: false });
    await vi.waitFor(() => expect(loadChatHistory).toHaveBeenCalledWith(chat.id));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    resolveHistory(true);

    await Promise.resolve();
    expect(useSessionReadStateStore.getState().markers[chat.id].readContentThrough ?? 0).toBe(0);
  });
});
