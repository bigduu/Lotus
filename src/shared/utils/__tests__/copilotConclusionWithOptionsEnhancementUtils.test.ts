import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCopilotConclusionWithOptionsEnhancementPrompt,
  getCopilotConclusionWithOptionsEnhancementUserFacingText,
  isCopilotConclusionWithOptionsEnhancementEnabled,
  setCopilotConclusionWithOptionsEnhancementEnabled,
} from "../copilotConclusionWithOptionsEnhancementUtils";

const STORAGE_KEY = "copilot_conclusion_with_options_enhancement_enabled";

describe("copilotConclusionWithOptionsEnhancementUtils", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe("isCopilotConclusionWithOptionsEnhancementEnabled", () => {
    it("returns false when not set", () => {
      expect(isCopilotConclusionWithOptionsEnhancementEnabled()).toBe(false);
    });

    it("returns false when set to 'false'", () => {
      localStorage.setItem(STORAGE_KEY, "false");
      expect(isCopilotConclusionWithOptionsEnhancementEnabled()).toBe(false);
    });

    it("returns true when set to 'true'", () => {
      localStorage.setItem(STORAGE_KEY, "true");
      expect(isCopilotConclusionWithOptionsEnhancementEnabled()).toBe(true);
    });

    it("returns false for other values", () => {
      localStorage.setItem(STORAGE_KEY, "yes");
      expect(isCopilotConclusionWithOptionsEnhancementEnabled()).toBe(false);
    });
  });

  describe("setCopilotConclusionWithOptionsEnhancementEnabled", () => {
    it("sets value to 'true' when enabled", () => {
      setCopilotConclusionWithOptionsEnhancementEnabled(true);
      expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
    });

    it("sets value to 'false' when disabled", () => {
      setCopilotConclusionWithOptionsEnhancementEnabled(false);
      expect(localStorage.getItem(STORAGE_KEY)).toBe("false");
    });

    it("overwrites existing value", () => {
      localStorage.setItem(STORAGE_KEY, "false");
      setCopilotConclusionWithOptionsEnhancementEnabled(true);
      expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
    });

    it("handles localStorage errors gracefully", () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw new Error("localStorage error");
      });

      setCopilotConclusionWithOptionsEnhancementEnabled(true);
      expect(consoleSpy).toHaveBeenCalled();
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

      localStorage.setItem = originalSetItem;
      consoleSpy.mockRestore();
    });
  });

  describe("getCopilotConclusionWithOptionsEnhancementUserFacingText", () => {
    it("returns a user-facing runtime description", () => {
      const description = getCopilotConclusionWithOptionsEnhancementUserFacingText();
      expect(description).toContain("conclusion_with_options tool");
      expect(description).toContain("completion policy violation");
      expect(description).not.toContain("retries up to 3 times");
    });
  });

  describe("getCopilotConclusionWithOptionsEnhancementPrompt", () => {
    it("returns a non-empty string", () => {
      const prompt = getCopilotConclusionWithOptionsEnhancementPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("contains expected sections", () => {
      const prompt = getCopilotConclusionWithOptionsEnhancementPrompt();
      expect(prompt).toContain("## Copilot Completion Confirmation Rule");
      expect(prompt).toContain("conclusion_with_options");
      expect(prompt).toContain("OK");
      expect(prompt).toContain("conclusion");
      expect(prompt).toContain("mermaid");
    });

    it("includes the core completion-confirmation behavior", () => {
      const prompt = getCopilotConclusionWithOptionsEnhancementPrompt();
      const normalized = prompt.toLowerCase();
      expect(normalized).toContain("before ending");
      expect(normalized).toContain("conclusion_with_options");
      expect(normalized).toContain("must include a `conclusion` object");
      expect(normalized).toContain("conclusion.summary");
      expect(normalized).toContain("conclusion.mermaid.graph");
      expect(normalized).toContain("mermaid graph");
      expect(normalized).toContain("without `conclusion_with_options` is invalid");
      expect(normalized).toContain("ok");
      expect(normalized).toContain("continue assisting");
    });
  });
});
