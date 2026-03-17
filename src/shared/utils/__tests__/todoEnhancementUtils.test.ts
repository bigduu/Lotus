import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isTodoEnhancementEnabled,
  setTodoEnhancementEnabled,
  getTodoEnhancementPrompt,
} from "../todoEnhancementUtils";

describe("todoEnhancementUtils", () => {
  const TODO_ENHANCEMENT_KEY = "todo_enhancement_enabled";

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("isTodoEnhancementEnabled", () => {
    it("should return true when localStorage key is not set", () => {
      const result = isTodoEnhancementEnabled();
      expect(result).toBe(true);
    });

    it("should return true when localStorage value is 'true'", () => {
      localStorage.setItem(TODO_ENHANCEMENT_KEY, "true");
      const result = isTodoEnhancementEnabled();
      expect(result).toBe(true);
    });

    it("should return false when localStorage value is 'false'", () => {
      localStorage.setItem(TODO_ENHANCEMENT_KEY, "false");
      const result = isTodoEnhancementEnabled();
      expect(result).toBe(false);
    });

    it("should return true for any value other than 'false'", () => {
      localStorage.setItem(TODO_ENHANCEMENT_KEY, "any value");
      const result = isTodoEnhancementEnabled();
      expect(result).toBe(true);
    });

    it("should return true for empty string", () => {
      localStorage.setItem(TODO_ENHANCEMENT_KEY, "");
      const result = isTodoEnhancementEnabled();
      expect(result).toBe(true);
    });

    it("should return false only for exact string 'false'", () => {
      localStorage.setItem(TODO_ENHANCEMENT_KEY, "False");
      expect(isTodoEnhancementEnabled()).toBe(true);

      localStorage.setItem(TODO_ENHANCEMENT_KEY, "FALSE");
      expect(isTodoEnhancementEnabled()).toBe(true);

      localStorage.setItem(TODO_ENHANCEMENT_KEY, "false");
      expect(isTodoEnhancementEnabled()).toBe(false);
    });
  });

  describe("setTodoEnhancementEnabled", () => {
    it("should set value to 'true' when enabled is true", () => {
      setTodoEnhancementEnabled(true);
      expect(localStorage.getItem(TODO_ENHANCEMENT_KEY)).toBe("true");
    });

    it("should set value to 'false' when enabled is false", () => {
      setTodoEnhancementEnabled(false);
      expect(localStorage.getItem(TODO_ENHANCEMENT_KEY)).toBe("false");
    });

    it("should overwrite existing value", () => {
      localStorage.setItem(TODO_ENHANCEMENT_KEY, "false");
      setTodoEnhancementEnabled(true);
      expect(localStorage.getItem(TODO_ENHANCEMENT_KEY)).toBe("true");
    });

    it("should store string representation of boolean", () => {
      setTodoEnhancementEnabled(true);
      const storedValue = localStorage.getItem(TODO_ENHANCEMENT_KEY);
      expect(typeof storedValue).toBe("string");
      expect(storedValue).toBe("true");
    });

    it("should convert boolean to string correctly", () => {
      setTodoEnhancementEnabled(true);
      expect(localStorage.getItem(TODO_ENHANCEMENT_KEY)).toBe(String(true));

      setTodoEnhancementEnabled(false);
      expect(localStorage.getItem(TODO_ENHANCEMENT_KEY)).toBe(String(false));
    });
  });

  describe("getTodoEnhancementPrompt", () => {
    it("should return a non-empty string", () => {
      const prompt = getTodoEnhancementPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("should include task management header", () => {
      const prompt = getTodoEnhancementPrompt();
      expect(prompt).toContain("Task Management Rules");
    });

    it("should include TodoWrite tool reference", () => {
      const prompt = getTodoEnhancementPrompt();
      expect(prompt).toContain("TodoWrite");
    });

    it("should include instructions about in_progress state", () => {
      const prompt = getTodoEnhancementPrompt();
      expect(prompt).toContain("in_progress");
    });

    it("should include instruction about immediate updates", () => {
      const prompt = getTodoEnhancementPrompt();
      expect(prompt).toContain("immediately");
    });

    it("should warn against markdown checkboxes", () => {
      const prompt = getTodoEnhancementPrompt();
      expect(prompt).toContain("Markdown checkbox");
    });

    it("should mention when to skip TodoWrite", () => {
      const prompt = getTodoEnhancementPrompt();
      expect(prompt).toContain("simple one-step");
    });

    it("should start with double newline", () => {
      const prompt = getTodoEnhancementPrompt();
      expect(prompt.startsWith("\n\n")).toBe(true);
    });

    it("should return the same prompt on multiple calls", () => {
      const prompt1 = getTodoEnhancementPrompt();
      const prompt2 = getTodoEnhancementPrompt();
      expect(prompt1).toBe(prompt2);
    });

    it("should be a constant string (no dynamic content)", () => {
      const prompts = Array.from({ length: 5 }, () => getTodoEnhancementPrompt());
      const uniquePrompts = new Set(prompts);
      expect(uniquePrompts.size).toBe(1);
    });
  });

  describe("integration tests", () => {
    it("should maintain state between get and set", () => {
      // Initially true (not set)
      expect(isTodoEnhancementEnabled()).toBe(true);

      // Set to false
      setTodoEnhancementEnabled(false);
      expect(isTodoEnhancementEnabled()).toBe(false);

      // Set back to true
      setTodoEnhancementEnabled(true);
      expect(isTodoEnhancementEnabled()).toBe(true);
    });

    it("should handle rapid toggling", () => {
      for (let i = 0; i < 10; i++) {
        const value = i % 2 === 0;
        setTodoEnhancementEnabled(value);
        expect(isTodoEnhancementEnabled()).toBe(value);
      }
    });

    it("should work independently of other localStorage keys", () => {
      localStorage.setItem("other_key", "false");
      setTodoEnhancementEnabled(true);
      expect(isTodoEnhancementEnabled()).toBe(true);
      expect(localStorage.getItem("other_key")).toBe("false");
    });
  });

  describe("edge cases", () => {
    it("should handle localStorage being cleared", () => {
      setTodoEnhancementEnabled(false);
      localStorage.clear();
      expect(isTodoEnhancementEnabled()).toBe(true);
    });

    it("should handle value being removed", () => {
      setTodoEnhancementEnabled(true);
      localStorage.removeItem(TODO_ENHANCEMENT_KEY);
      expect(isTodoEnhancementEnabled()).toBe(true);
    });

    it("should handle concurrent modifications", () => {
      setTodoEnhancementEnabled(true);

      // Simulate external modification
      localStorage.setItem(TODO_ENHANCEMENT_KEY, "false");

      expect(isTodoEnhancementEnabled()).toBe(false);
    });
  });
});
