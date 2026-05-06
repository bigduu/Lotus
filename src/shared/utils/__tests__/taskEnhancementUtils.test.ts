import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getTaskEnhancementPrompt,
  isTaskEnhancementEnabled,
  setTaskEnhancementEnabled,
} from "../taskEnhancementUtils";

describe("taskEnhancementUtils", () => {
  const TASK_ENHANCEMENT_KEY = "task_enhancement_enabled";
  const LEGACY_ENHANCEMENT_KEY = "todo_enhancement_enabled";

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("isTaskEnhancementEnabled", () => {
    it("should return true when no key is set", () => {
      expect(isTaskEnhancementEnabled()).toBe(true);
    });

    it("should read from task key", () => {
      localStorage.setItem(TASK_ENHANCEMENT_KEY, "false");
      expect(isTaskEnhancementEnabled()).toBe(false);
    });

    it("should migrate legacy key into task key", () => {
      localStorage.setItem(LEGACY_ENHANCEMENT_KEY, "false");
      expect(isTaskEnhancementEnabled()).toBe(false);
      expect(localStorage.getItem(TASK_ENHANCEMENT_KEY)).toBe("false");
      expect(localStorage.getItem(LEGACY_ENHANCEMENT_KEY)).toBeNull();
    });

    it("should return true for any value other than exact false", () => {
      localStorage.setItem(TASK_ENHANCEMENT_KEY, "False");
      expect(isTaskEnhancementEnabled()).toBe(true);
      localStorage.setItem(TASK_ENHANCEMENT_KEY, "anything");
      expect(isTaskEnhancementEnabled()).toBe(true);
    });
  });

  describe("setTaskEnhancementEnabled", () => {
    it("should write task key", () => {
      setTaskEnhancementEnabled(true);

      expect(localStorage.getItem(TASK_ENHANCEMENT_KEY)).toBe("true");
    });

    it("should persist false correctly", () => {
      setTaskEnhancementEnabled(false);
      expect(localStorage.getItem(TASK_ENHANCEMENT_KEY)).toBe("false");
    });
  });

  describe("getTaskEnhancementPrompt", () => {
    it("should include task management guidance", () => {
      const prompt = getTaskEnhancementPrompt();
      expect(prompt).toContain("Task Management Rules");
      expect(prompt).toContain("Task");
      expect(prompt).toContain("SubAgent");
      expect(prompt).toContain("shared");
      expect(prompt.startsWith("\n\n")).toBe(true);
    });
  });
});
