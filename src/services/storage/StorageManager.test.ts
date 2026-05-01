import { describe, expect, it, beforeEach } from "vitest";
import { StorageManager } from "./StorageManager";
import { storageDb } from "./StorageDb";
import type { ScrollAnchorV1 } from "../../pages/ChatPage/components/ChatView/scrollAnchorStorage";

describe("StorageManager", () => {
  beforeEach(async () => {
    // Reset singleton so each test gets a fresh StorageManager instance
    // @ts-expect-error accessing private field for test cleanup
    StorageManager.instance = undefined;
    await storageDb.delete();
    await storageDb.open();
  });

  describe("scrollAnchors", () => {
    it("should save and load scroll anchor", async () => {
      const manager = StorageManager.getInstance();
      const anchor: ScrollAnchorV1 = {
        v: 1,
        anchorId: "msg-1",
        offsetPx: 100,
        ts: Date.now(),
        indexHint: 5,
        createdAt: "2025-01-01T00:00:00Z",
      };
      await manager.saveScrollAnchor("session-1", anchor);
      const loaded = await manager.loadScrollAnchor("session-1");
      expect(loaded).toEqual(anchor);
    });

    it("should return null for non-existent anchor", async () => {
      const manager = StorageManager.getInstance();
      const loaded = await manager.loadScrollAnchor("non-existent");
      expect(loaded).toBeNull();
    });

    it("should clear scroll anchor", async () => {
      const manager = StorageManager.getInstance();
      await manager.saveScrollAnchor("session-1", {
        v: 1,
        anchorId: "msg-1",
        offsetPx: 100,
        ts: Date.now(),
      });
      await manager.clearScrollAnchor("session-1");
      const loaded = await manager.loadScrollAnchor("session-1");
      expect(loaded).toBeNull();
    });
  });

  describe("toolSessionCollapses", () => {
    it("should save and load tool session collapse", async () => {
      const manager = StorageManager.getInstance();
      await manager.saveToolSessionCollapse("sess-1", "tool-1", {
        isExpanded: true,
        expandedTools: ["t1", "t2"],
      });
      const loaded = await manager.loadToolSessionCollapse("sess-1", "tool-1");
      expect(loaded).toEqual({ isExpanded: true, expandedTools: ["t1", "t2"] });
    });
  });

  describe("diffCollapses", () => {
    it("should save and load diff collapse", async () => {
      const manager = StorageManager.getInstance();
      await manager.saveDiffCollapse("sess-1", {
        isExpanded: false,
        expandedFiles: ["file1.ts"],
      });
      const loaded = await manager.loadDiffCollapse("sess-1");
      expect(loaded).toEqual({ isExpanded: false, expandedFiles: ["file1.ts"] });
    });
  });

  describe("inputState", () => {
    it("should save and load reasoning effort", async () => {
      const manager = StorageManager.getInstance();
      await manager.saveInputReasoning("sess-1", "high");
      const loaded = await manager.loadInputReasoning("sess-1");
      expect(loaded).toBe("high");
    });

    it("should save and load last used reasoning effort", async () => {
      const manager = StorageManager.getInstance();
      await manager.saveLastUsedReasoningEffort("max");
      const loaded = await manager.loadLastUsedReasoningEffort();
      expect(loaded).toBe("max");
    });
  });

  describe("modelOptionsCache", () => {
    it("should save and load model options cache", async () => {
      const manager = StorageManager.getInstance();
      const options = [{ value: "gpt-4", label: "GPT-4" }];
      await manager.saveModelOptionsCache("openai", options, Date.now());
      const loaded = await manager.loadModelOptionsCache("openai");
      expect(loaded?.options).toEqual(options);
    });
  });

  describe("cleanup", () => {
    it("should clear all session data", async () => {
      const manager = StorageManager.getInstance();
      await manager.saveScrollAnchor("sess-1", {
        v: 1,
        anchorId: "a",
        offsetPx: 0,
        ts: Date.now(),
      });
      await manager.saveDiffCollapse("sess-1", { isExpanded: true, expandedFiles: [] });
      await manager.saveInputReasoning("sess-1", "medium");

      await manager.clearSessionData("sess-1");

      expect(await manager.loadScrollAnchor("sess-1")).toBeNull();
      expect(await manager.loadDiffCollapse("sess-1")).toBeNull();
      expect(await manager.loadInputReasoning("sess-1")).toBeNull();
    });

    it("should remove stale data", async () => {
      const manager = StorageManager.getInstance();
      const oldTs = Date.now() - 31 * 24 * 60 * 60 * 1000;
      await manager.saveScrollAnchor("old-sess", { v: 1, anchorId: "a", offsetPx: 0, ts: oldTs });
      await manager.saveScrollAnchor("new-sess", {
        v: 1,
        anchorId: "b",
        offsetPx: 0,
        ts: Date.now(),
      });

      await manager.cleanupStaleData(30);

      expect(await manager.loadScrollAnchor("old-sess")).toBeNull();
      expect(await manager.loadScrollAnchor("new-sess")).not.toBeNull();
    });
  });

  describe("stats", () => {
    it("should return counts", async () => {
      const manager = StorageManager.getInstance();
      await manager.saveScrollAnchor("s1", { v: 1, anchorId: "a", offsetPx: 0, ts: Date.now() });
      await manager.saveDiffCollapse("s1", { isExpanded: true, expandedFiles: [] });

      const stats = await manager.getStats();
      expect(stats.scrollAnchors).toBe(1);
      expect(stats.diffCollapses).toBe(1);
    });
  });
});
