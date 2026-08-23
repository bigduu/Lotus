import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import type { ChatItem } from "@shared/types/chat";
import { createChatSlice, type ChatSlice } from "../chatSessionSlice";

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      getSession: mockGetSession,
      deleteSession: vi.fn(),
      patchSession: vi.fn(async () => undefined),
    })),
  },
}));

const receipt = (revision: number, name = `Workflow ${revision}`) => ({
  id: "review",
  name,
  source: "project",
  revision,
  version: String(revision),
  kind: "instruction",
  invoked_by: revision % 2 ? "user" : "model",
  activated_at: `2026-08-23T08:00:${String(revision).padStart(2, "0")}Z`,
  status: "active",
});

const chat = (id: string, activeWorkflow?: ChatItem["activeWorkflow"]): ChatItem =>
  ({
    id,
    title: id,
    createdAt: Date.now(),
    messages: [],
    activeWorkflow,
    config: {
      systemPromptId: "general_assistant",
      baseSystemPrompt: "",
      lastUsedEnhancedPrompt: null,
    },
  }) as ChatItem;

const createTestStore = (chats: ChatItem[]): StoreApi<ChatSlice> => {
  const store = createStore<ChatSlice>()((set, get, api) =>
    (createChatSlice as any)(set, get, api),
  );
  store.setState({ chats, currentSessionId: chats[0]?.id ?? null });
  return store;
};

describe("chatSessionSlice active Workflow detail hydration", () => {
  beforeEach(() => mockGetSession.mockReset());

  it("stores a redacted receipt and authoritative omission clears it", async () => {
    const store = createTestStore([chat("session-a")]);
    mockGetSession.mockResolvedValueOnce({
      active_workflow: {
        ...receipt(1),
        args: { secret: "PRIVATE" },
        body: "PRIVATE BODY",
        resources: ["/private/resource.md"],
      },
    });

    expect(await store.getState().refreshSessionDetail("session-a")).toBe(true);
    const hydrated = store.getState().chats[0].activeWorkflow;
    expect(hydrated).toMatchObject({ id: "review", revision: 1, invokedBy: "user" });
    expect(JSON.stringify(hydrated)).not.toContain("PRIVATE");
    expect(JSON.stringify(hydrated)).not.toContain("resources");

    // Bamboo serializes an empty detail Option by omitting the field.
    mockGetSession.mockResolvedValueOnce({ id: "session-a" });
    expect(await store.getState().refreshSessionDetail("session-a", { force: true })).toBe(true);
    expect(store.getState().chats[0].activeWorkflow).toBeNull();
  });

  it("keeps the last known receipt on transport failure or malformed detail", async () => {
    const previous = {
      id: "review",
      name: "Review",
      source: "project" as const,
      revision: 1,
      kind: "instruction" as const,
      invokedBy: "user" as const,
      activatedAt: "2026-08-23T08:00:01Z",
      status: "active" as const,
    };
    const store = createTestStore([chat("session-a", previous)]);

    mockGetSession.mockRejectedValueOnce(new Error("offline"));
    expect(await store.getState().refreshSessionDetail("session-a")).toBe(false);
    expect(store.getState().chats[0].activeWorkflow).toEqual(previous);

    mockGetSession.mockResolvedValueOnce({ active_workflow: { ...receipt(2), revision: -1 } });
    expect(await store.getState().refreshSessionDetail("session-a", { force: true })).toBe(false);
    expect(store.getState().chats[0].activeWorkflow).toEqual(previous);
  });

  it("does not let an older forced request overwrite a newer receipt", async () => {
    const store = createTestStore([chat("session-a")]);
    let resolveFirst: (value: unknown) => void = () => undefined;
    let resolveSecond: (value: unknown) => void = () => undefined;
    mockGetSession
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const first = store.getState().refreshSessionDetail("session-a", { force: true });
    const second = store.getState().refreshSessionDetail("session-a", { force: true });
    resolveSecond({ active_workflow: receipt(2, "New") });
    expect(await second).toBe(true);
    resolveFirst({ active_workflow: receipt(1, "Old") });
    expect(await first).toBe(false);
    expect(store.getState().chats[0].activeWorkflow).toMatchObject({
      revision: 2,
      name: "New",
    });
  });

  it("refreshes the selected session by id without writing into another session", async () => {
    const store = createTestStore([chat("session-a"), chat("session-b")]);
    mockGetSession.mockResolvedValue({ active_workflow: receipt(3) });

    store.getState().selectSession("session-b");
    await vi.waitFor(() => expect(mockGetSession).toHaveBeenCalledWith("session-b"));
    await vi.waitFor(() =>
      expect(
        store.getState().chats.find((item) => item.id === "session-b")?.activeWorkflow,
      ).toMatchObject({
        revision: 3,
      }),
    );
    expect(
      store.getState().chats.find((item) => item.id === "session-a")?.activeWorkflow,
    ).toBeUndefined();
  });
});
