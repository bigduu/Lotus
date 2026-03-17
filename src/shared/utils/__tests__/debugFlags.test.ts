import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isUILayoutDebugEnabled,
  uiLayoutDebug,
} from "../debugFlags";

describe("debugFlags", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    console.log = vi.fn();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("isUILayoutDebugEnabled", () => {
    it("should return false when flag is not set", () => {
      const result = isUILayoutDebugEnabled();
      // In test mode, should always return false
      expect(result).toBe(false);
    });

    it("should return false even when flag is set in test mode", () => {
      localStorage.setItem("bodhi_debug_ui_layout", "1");
      const result = isUILayoutDebugEnabled();
      // In test mode, should always return false even with flag set
      expect(result).toBe(false);
    });

    it("should return false when flag is set to other values", () => {
      localStorage.setItem("bodhi_debug_ui_layout", "true");
      const result = isUILayoutDebugEnabled();
      expect(result).toBe(false);
    });

    it("should handle localStorage errors gracefully", () => {
      // Mock localStorage to throw error
      const getItemSpy = vi.spyOn(Storage.prototype, "getItem");
      getItemSpy.mockImplementation(() => {
        throw new Error("localStorage not available");
      });

      const result = isUILayoutDebugEnabled();
      expect(result).toBe(false);
      getItemSpy.mockRestore();
    });
  });

  describe("uiLayoutDebug", () => {
    it("should not log in test mode", () => {
      localStorage.setItem("bodhi_debug_ui_layout", "1");

      uiLayoutDebug("test message", { foo: "bar" });
      expect(console.log).not.toHaveBeenCalled();
    });

    it("should not log when debug is disabled", () => {
      uiLayoutDebug("test message", { foo: "bar" });
      expect(console.log).not.toHaveBeenCalled();
    });

    it("should not log message without data", () => {
      uiLayoutDebug("test message");
      expect(console.log).not.toHaveBeenCalled();
    });

    it("should not log empty string when data is undefined", () => {
      uiLayoutDebug("test message", undefined);
      expect(console.log).not.toHaveBeenCalled();
    });

    it("should not log complex data structures", () => {
      const complexData = {
        nested: { deep: { value: 123 } },
        array: [1, 2, 3],
      };

      uiLayoutDebug("complex test", complexData);
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe("behavior in test mode", () => {
    it("should always return false in test mode", () => {
      // Test with various localStorage states
      localStorage.setItem("bodhi_debug_ui_layout", "1");
      expect(isUILayoutDebugEnabled()).toBe(false);

      localStorage.setItem("bodhi_debug_ui_layout", "true");
      expect(isUILayoutDebugEnabled()).toBe(false);

      localStorage.removeItem("bodhi_debug_ui_layout");
      expect(isUILayoutDebugEnabled()).toBe(false);
    });

    it("should never log in test mode regardless of flag", () => {
      localStorage.setItem("bodhi_debug_ui_layout", "1");

      uiLayoutDebug("test1");
      uiLayoutDebug("test2", { data: "value" });
      uiLayoutDebug("test3", undefined);

      expect(console.log).not.toHaveBeenCalled();
    });
  });
});
