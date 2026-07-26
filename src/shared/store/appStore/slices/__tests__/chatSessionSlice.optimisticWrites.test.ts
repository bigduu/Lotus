import { beforeEach, describe, expect, it, vi } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";

import { createChatSlice, type ChatSlice } from "../chatSessionSlice";
import type { ChatItem } from "@shared/types/chat";

const { mockDeleteSession, mockPatchSession } = vi.hoisted(() => ({
  mockDeleteSession: vi.fn(),
  mockPatchSession: vi.fn(),
}));

vi.mock("@services/chat/AgentService", () => ({
  AgentClient: {
    getInstance: vi.fn(() => ({
      deleteSession: mockDeleteSession,
      patchSession: mockPatchSession,
    })),
  },
}));

const makeChat = (id: string, overrides: Partial<ChatItem> = {}): ChatItem =>
  ({
    id,
    title: `Session ${id}`,
    kind: "root",
    createdAt: 1710000000000,
    messages: [],
    pinned: false,
    updatedAt: "2025-03-01T00:00:00Z",
    config: {
      systemPromptId: "general_assistant",
      baseSystemPrompt: "You are helpful.",
      lastUsedEnhancedPrompt: null,
      model: "gpt-old",
      reasoningEffort: "medium",
    },
    ...overrides,
  }) as ChatItem;

const createTestStore = (chats: ChatItem[]) => {
  const store = createStore<ChatSlice>()((set, get, api) => ({
    ...(createChatSlice as any)(set, get, api),
    chats,
    currentSessionId: chats[0]?.id ?? null,
  }));
  return store as StoreApi<ChatSlice>;
};

describe("optimistic write rollback (#163)", () => {
  beforeEach(() => {
    mockDeleteSession.mockReset();
    mockPatchSession.mockReset();
  });

  describe("deleteSession", () => {
    it("keeps the local session when the backend delete fails", async () => {
      mockDeleteSession.mockRejectedValue(new Error("network down"));
      const store = createTestStore([makeChat("s1"), makeChat("s2")]);

      await expect(store.getState().deleteSession("s1")).rejects.toThrow("network down");

      expect(store.getState().chats.map((c) => c.id)).toEqual(["s1", "s2"]);
      expect(store.getState().currentSessionId).toBe("s1");
    });

    it("removes the session and its children only after the backend confirms", async () => {
      mockDeleteSession.mockResolvedValue(undefined);
      const store = createTestStore([
        makeChat("s1"),
        makeChat("child", { kind: "child", rootSessionId: "s1" }),
        makeChat("s2"),
      ]);

      await store.getState().deleteSession("s1");

      expect(store.getState().chats.map((c) => c.id)).toEqual(["s2"]);
      expect(store.getState().currentSessionId).toBeNull();
    });
  });

  describe("deleteSessions", () => {
    it("reports per-item failures without aborting the rest", async () => {
      mockDeleteSession.mockImplementation((id: string) =>
        id === "bad" ? Promise.reject(new Error("409 running")) : Promise.resolve(),
      );
      const store = createTestStore([makeChat("ok1"), makeChat("bad"), makeChat("ok2")]);

      const { failedIds } = await store.getState().deleteSessions(["ok1", "bad", "ok2"]);

      expect(failedIds).toEqual(["bad"]);
      expect(store.getState().chats.map((c) => c.id)).toEqual(["bad"]);
    });
  });

  describe("updateSession", () => {
    it("rolls back the optimistic title/pinned writes when the patch fails", async () => {
      mockPatchSession.mockRejectedValue(new Error("500"));
      const store = createTestStore([makeChat("s1")]);

      store.getState().updateSession("s1", { title: "New title", pinned: true });
      expect(store.getState().chats[0].title).toBe("New title");
      expect(store.getState().chats[0].pinned).toBe(true);

      await vi.waitFor(() => {
        expect(store.getState().chats[0].title).toBe("Session s1");
      });
      expect(store.getState().chats[0].pinned).toBe(false);
    });

    it("rolls back patched config fields only (model/reasoningEffort), leaving others", async () => {
      mockPatchSession.mockRejectedValue(new Error("500"));
      const store = createTestStore([makeChat("s1")]);

      store.getState().updateSession("s1", {
        config: {
          ...store.getState().chats[0].config,
          model: "gpt-new",
          reasoningEffort: "high",
        },
      });
      expect(store.getState().chats[0].config.model).toBe("gpt-new");

      await vi.waitFor(() => {
        expect(store.getState().chats[0].config.model).toBe("gpt-old");
      });
      expect(store.getState().chats[0].config.reasoningEffort).toBe("medium");
    });

    it("keeps the optimistic write when the patch succeeds", async () => {
      mockPatchSession.mockResolvedValue(undefined);
      const store = createTestStore([makeChat("s1")]);

      store.getState().updateSession("s1", { pinned: true });
      await vi.waitFor(() => expect(mockPatchSession).toHaveBeenCalled());

      expect(store.getState().chats[0].pinned).toBe(true);
    });

    it("restores the bumped updatedAt on rollback so refresh can heal", async () => {
      mockPatchSession.mockRejectedValue(new Error("500"));
      const store = createTestStore([makeChat("s1")]);
      const originalUpdatedAt = store.getState().chats[0].updatedAt;

      store.getState().updateSession("s1", { pinned: true });
      expect(store.getState().chats[0].updatedAt).not.toBe(originalUpdatedAt);

      await vi.waitFor(() => {
        expect(store.getState().chats[0].updatedAt).toBe(originalUpdatedAt);
      });
    });

    it("double in-flight: the last failure restores the pre-first-write baseline (Case B)", async () => {
      // Both patches fail (e.g. offline while the user retries a model
      // switch). The first failure must NOT roll back (the newer write owns
      // the outcome); the second must restore the values from BEFORE the
      // first optimistic write — otherwise the first unconfirmed value
      // sticks via preferLocalSessionFields.
      let rejectFirst: (error: Error) => void = () => {};
      let rejectSecond: (error: Error) => void = () => {};
      mockPatchSession
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectFirst = reject;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectSecond = reject;
            }),
        );
      const store = createTestStore([makeChat("s1")]);

      store.getState().updateSession("s1", {
        config: { ...store.getState().chats[0].config, model: "gpt-v1" },
      });
      store.getState().updateSession("s1", {
        config: { ...store.getState().chats[0].config, model: "gpt-v2" },
      });
      expect(store.getState().chats[0].config.model).toBe("gpt-v2");

      // First write fails while the second is still in flight: no rollback.
      rejectFirst(new Error("500"));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(store.getState().chats[0].config.model).toBe("gpt-v2");

      // Second (last) failure rolls back to the pre-first-write baseline.
      rejectSecond(new Error("500"));
      await vi.waitFor(() => {
        expect(store.getState().chats[0].config.model).toBe("gpt-old");
      });
    });

    it("double in-flight: first failure does not clobber a later confirmed value (Case A)", async () => {
      let rejectFirst: (error: Error) => void = () => {};
      mockPatchSession
        .mockImplementationOnce(
          () =>
            new Promise((_, reject) => {
              rejectFirst = reject;
            }),
        )
        .mockResolvedValueOnce(undefined);
      const store = createTestStore([makeChat("s1")]);

      store.getState().updateSession("s1", {
        config: { ...store.getState().chats[0].config, model: "gpt-v1" },
      });
      store.getState().updateSession("s1", {
        config: { ...store.getState().chats[0].config, model: "gpt-v2" },
      });

      rejectFirst(new Error("500"));
      await new Promise((resolve) => setTimeout(resolve, 10));

      // The second write succeeded — its value must survive.
      expect(store.getState().chats[0].config.model).toBe("gpt-v2");
    });
  });
});
