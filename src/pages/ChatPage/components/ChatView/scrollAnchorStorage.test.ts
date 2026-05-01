import { describe, expect, it, beforeEach } from "vitest";
import {
  loadScrollAnchor,
  saveScrollAnchor,
  clearScrollAnchor,
  type ScrollAnchorV1,
} from "./scrollAnchorStorage";
import { storageDb } from "../../../../services/storage/StorageDb";

const SESSION_ID = "test-session-123";
const LEGACY_KEY = "chat_scroll_anchors_v1";
const V2_PREFIX = "chat_scroll_anchor_v2:";

const makeAnchor = (overrides?: Partial<ScrollAnchorV1>): ScrollAnchorV1 => ({
  v: 1,
  anchorId: "msg-1",
  offsetPx: 120,
  ts: Date.now(),
  indexHint: 5,
  createdAt: "2025-01-01T00:00:00Z",
  ...overrides,
});

describe("scrollAnchorStorage", () => {
  beforeEach(async () => {
    localStorage.clear();
    // Clear IndexedDB to prevent data leaking between tests
    await storageDb.delete();
    await storageDb.open();
  });

  describe("saveScrollAnchor + loadScrollAnchor", () => {
    it("should save and load anchor for a session", async () => {
      const anchor = makeAnchor();
      await saveScrollAnchor(SESSION_ID, anchor);

      const loaded = await loadScrollAnchor(SESSION_ID);
      expect(loaded).toEqual(anchor);
    });

    it("should store in v2 per-session key", async () => {
      const anchor = makeAnchor();
      await saveScrollAnchor(SESSION_ID, anchor);

      const raw = localStorage.getItem(`${V2_PREFIX}${SESSION_ID}`);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toEqual(anchor);
    });

    it("should return null when no anchor exists", async () => {
      const loaded = await loadScrollAnchor("non-existent-session");
      expect(loaded).toBeNull();
    });

    it("should return null for invalid stored data", async () => {
      localStorage.setItem(`${V2_PREFIX}${SESSION_ID}`, JSON.stringify({ foo: "bar" }));
      const loaded = await loadScrollAnchor(SESSION_ID);
      expect(loaded).toBeNull();
    });

    it("should isolate different sessions", async () => {
      const anchor1 = makeAnchor({ anchorId: "msg-a" });
      const anchor2 = makeAnchor({ anchorId: "msg-b" });

      await saveScrollAnchor("session-1", anchor1);
      await saveScrollAnchor("session-2", anchor2);

      expect(await loadScrollAnchor("session-1")).toEqual(anchor1);
      expect(await loadScrollAnchor("session-2")).toEqual(anchor2);
    });
  });

  describe("clearScrollAnchor", () => {
    it("should remove anchor for a session", async () => {
      await saveScrollAnchor(SESSION_ID, makeAnchor());
      await clearScrollAnchor(SESSION_ID);

      expect(await loadScrollAnchor(SESSION_ID)).toBeNull();
      expect(localStorage.getItem(`${V2_PREFIX}${SESSION_ID}`)).toBeNull();
    });

    it("should not throw when clearing non-existent session", () => {
      expect(() => clearScrollAnchor("non-existent")).not.toThrow();
    });
  });

  describe("legacy migration", () => {
    it("should migrate from legacy consolidated storage on load", async () => {
      const anchor = makeAnchor();
      const legacyData = {
        [SESSION_ID]: anchor,
        "other-session": makeAnchor({ anchorId: "other" }),
      };
      localStorage.setItem(LEGACY_KEY, JSON.stringify(legacyData));

      const loaded = await loadScrollAnchor(SESSION_ID);
      expect(loaded).toEqual(anchor);

      // Migration writes to IndexedDB (not v2 localStorage)
      // The legacy store should be cleaned up
      const remainingLegacy = JSON.parse(localStorage.getItem(LEGACY_KEY)!);
      expect(remainingLegacy).not.toHaveProperty(SESSION_ID);
      expect(remainingLegacy).toHaveProperty("other-session");
    });

    it("should delete legacy key when all sessions migrated", async () => {
      const anchor = makeAnchor();
      localStorage.setItem(LEGACY_KEY, JSON.stringify({ [SESSION_ID]: anchor }));

      await loadScrollAnchor(SESSION_ID);

      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    it("should prefer v2 over legacy when both exist", async () => {
      const v2Anchor = makeAnchor({ anchorId: "v2-msg" });
      const legacyAnchor = makeAnchor({ anchorId: "legacy-msg" });

      await saveScrollAnchor(SESSION_ID, v2Anchor);
      localStorage.setItem(LEGACY_KEY, JSON.stringify({ [SESSION_ID]: legacyAnchor }));

      const loaded = await loadScrollAnchor(SESSION_ID);
      expect(loaded?.anchorId).toBe("v2-msg");
    });

    it("should handle corrupted legacy data gracefully", async () => {
      localStorage.setItem(LEGACY_KEY, "not-json");
      const loaded = await loadScrollAnchor(SESSION_ID);
      expect(loaded).toBeNull();
    });

    it("should handle legacy data without target session", async () => {
      localStorage.setItem(LEGACY_KEY, JSON.stringify({ "other-session": makeAnchor() }));
      const loaded = await loadScrollAnchor(SESSION_ID);
      expect(loaded).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle save failure gracefully", () => {
      // Simulate quota exceeded by making setItem throw
      const originalSetItem = localStorage.setItem.bind(localStorage);
      localStorage.setItem = () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      };

      expect(() => saveScrollAnchor(SESSION_ID, makeAnchor())).not.toThrow();

      localStorage.setItem = originalSetItem;
    });

    it("should return null when legacy migration write fails", async () => {
      const anchor = makeAnchor();
      localStorage.setItem(LEGACY_KEY, JSON.stringify({ [SESSION_ID]: anchor }));

      // Simulate quota exceeded on IndexedDB write by mocking StorageManager
      const manager = (
        await import("../../../../services/storage/StorageManager")
      ).StorageManager.getInstance();
      const originalSave = manager.saveScrollAnchor.bind(manager);
      manager.saveScrollAnchor = async () => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      };

      // Should still return the anchor from legacy even if IndexedDB migration write fails
      const loaded = await loadScrollAnchor(SESSION_ID);
      expect(loaded).not.toBeNull();
      expect(loaded?.anchorId).toBe(anchor.anchorId);
      expect(loaded?.offsetPx).toBe(anchor.offsetPx);

      manager.saveScrollAnchor = originalSave;
    });
  });
});
