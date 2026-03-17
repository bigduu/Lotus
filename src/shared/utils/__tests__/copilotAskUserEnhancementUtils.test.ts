import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCopilotAskUserEnhancementPrompt,
  isCopilotAskUserEnhancementEnabled,
  setCopilotAskUserEnhancementEnabled,
} from "../copilotAskUserEnhancementUtils";

const STORAGE_KEY = "copilot_ask_user_enhancement_enabled";

describe("copilotAskUserEnhancementUtils", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("isCopilotAskUserEnhancementEnabled", () => {
    it("returns false when not set", () => {
      expect(isCopilotAskUserEnhancementEnabled()).toBe(false);
    });

    it("returns false when set to 'false'", () => {
      localStorage.setItem(STORAGE_KEY, "false");
      expect(isCopilotAskUserEnhancementEnabled()).toBe(false);
    });

    it("returns true when set to 'true'", () => {
      localStorage.setItem(STORAGE_KEY, "true");
      expect(isCopilotAskUserEnhancementEnabled()).toBe(true);
    });

    it("returns false for other values", () => {
      localStorage.setItem(STORAGE_KEY, "yes");
      expect(isCopilotAskUserEnhancementEnabled()).toBe(false);
    });
  });

  describe("setCopilotAskUserEnhancementEnabled", () => {
    it("sets value to 'true' when enabled", () => {
      setCopilotAskUserEnhancementEnabled(true);
      expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
    });

    it("sets value to 'false' when disabled", () => {
      setCopilotAskUserEnhancementEnabled(false);
      expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
    });

    it("overwrites existing value", () => {
      localStorage.setItem(STORAGE_KEY, "false");
      setCopilotAskUserEnhancementEnabled(true);
      expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
    });

    it("handles localStorage errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw new Error("localStorage error");
      });

      setCopilotAskUserEnhancementEnabled(true);
      expect(consoleSpy).toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

      localStorage.setItem = originalSetItem;
      consoleSpy.mockRestore();
    });
  });

  describe("getCopilotAskUserEnhancementPrompt", () => {
    it("returns a non-empty string", () => {
      const prompt = getCopilotAskUserEnhancementPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("contains expected sections", () => {
      const prompt = getCopilotAskUserEnhancementPrompt();
      expect(prompt).toContain("## Copilot Completion Confirmation Rule");
      expect(prompt).toContain("ask_user");
      expect(prompt).toContain("OK");
    });

    it("includes the core completion-confirmation behavior", () => {
      const prompt = getCopilotAskUserEnhancementPrompt();
      const normalized = prompt.toLowerCase();
      expect(normalized).toContain("before ending");
      expect(normalized).toContain("ask_user");
      expect(normalized).toContain("ok");
      expect(normalized).toContain("continue assisting");
    });
  });
});
