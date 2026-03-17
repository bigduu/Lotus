import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  isMermaidEnhancementEnabled,
  setMermaidEnhancementEnabled,
  getMermaidEnhancementPrompt,
} from "../mermaidUtils";

describe("mermaidUtils", () => {
  const MERMAID_ENHANCEMENT_KEY = "mermaid_enhancement_enabled";

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("isMermaidEnhancementEnabled", () => {
    it("should return true when localStorage key is not set", () => {
      const result = isMermaidEnhancementEnabled();
      expect(result).toBe(true);
    });

    it("should return true when localStorage value is 'true'", () => {
      localStorage.setItem(MERMAID_ENHANCEMENT_KEY, "true");
      const result = isMermaidEnhancementEnabled();
      expect(result).toBe(true);
    });

    it("should return false when localStorage value is 'false'", () => {
      localStorage.setItem(MERMAID_ENHANCEMENT_KEY, "false");
      const result = isMermaidEnhancementEnabled();
      expect(result).toBe(false);
    });

    it("should return true for any value other than 'false'", () => {
      localStorage.setItem(MERMAID_ENHANCEMENT_KEY, "any value");
      const result = isMermaidEnhancementEnabled();
      expect(result).toBe(true);
    });

    it("should return true for empty string", () => {
      localStorage.setItem(MERMAID_ENHANCEMENT_KEY, "");
      const result = isMermaidEnhancementEnabled();
      expect(result).toBe(true);
    });

    it("should check the correct localStorage key", () => {
      isMermaidEnhancementEnabled();
      expect(localStorage.getItem(MERMAID_ENHANCEMENT_KEY)).toBeNull();
    });
  });

  describe("setMermaidEnhancementEnabled", () => {
    it("should set value to 'true' when enabled is true", () => {
      setMermaidEnhancementEnabled(true);
      expect(localStorage.getItem(MERMAID_ENHANCEMENT_KEY)).toBe("true");
    });

    it("should set value to 'false' when enabled is false", () => {
      setMermaidEnhancementEnabled(false);
      expect(localStorage.getItem(MERMAID_ENHANCEMENT_KEY)).toBe("false");
    });

    it("should overwrite existing value", () => {
      localStorage.setItem(MERMAID_ENHANCEMENT_KEY, "false");
      setMermaidEnhancementEnabled(true);
      expect(localStorage.getItem(MERMAID_ENHANCEMENT_KEY)).toBe("true");
    });

    it("should store string representation of boolean", () => {
      setMermaidEnhancementEnabled(true);
      const storedValue = localStorage.getItem(MERMAID_ENHANCEMENT_KEY);
      expect(typeof storedValue).toBe("string");
    });
  });

  describe("getMermaidEnhancementPrompt", () => {
    it("should return a non-empty string", () => {
      const prompt = getMermaidEnhancementPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("should include Mermaid diagram types", () => {
      const prompt = getMermaidEnhancementPrompt();
      expect(prompt).toContain("Flowcharts");
      expect(prompt).toContain("Sequence Diagrams");
      expect(prompt).toContain("Class Diagrams");
      expect(prompt).toContain("State Diagrams");
      expect(prompt).toContain("Gantt Charts");
      expect(prompt).toContain("ER Diagrams");
      expect(prompt).toContain("Git Graphs");
    });

    it("should include syntax guidelines", () => {
      const prompt = getMermaidEnhancementPrompt();
      expect(prompt).toContain("Syntax Notes");
      expect(prompt).toContain("fenced code block");
      expect(prompt).toContain("mermaid");
    });

    it("should include arrow syntax examples", () => {
      const prompt = getMermaidEnhancementPrompt();
      expect(prompt).toContain("-->");
      expect(prompt).toContain("-.->");
      expect(prompt).toContain("==>");
    });

    it("should include nested brackets warning", () => {
      const prompt = getMermaidEnhancementPrompt();
      expect(prompt).toContain("Avoid nested brackets");
    });

    it("should include HTML entities reference", () => {
      const prompt = getMermaidEnhancementPrompt();
      expect(prompt).toContain("HTML entities");
      expect(prompt).toContain("&#35;");
    });

    it("should return the same prompt on multiple calls", () => {
      const prompt1 = getMermaidEnhancementPrompt();
      const prompt2 = getMermaidEnhancementPrompt();
      expect(prompt1).toBe(prompt2);
    });

    it("should include visual representation guidelines header", () => {
      const prompt = getMermaidEnhancementPrompt();
      expect(prompt).toContain("Visual Representation Guidelines");
    });

    it("should mention when to include diagrams", () => {
      const prompt = getMermaidEnhancementPrompt();
      expect(prompt).toContain("architecture");
      expect(prompt).toContain("workflows");
      expect(prompt).toContain("data flow");
    });
  });

  describe("integration tests", () => {
    it("should maintain state between get and set", () => {
      // Initially true (not set)
      expect(isMermaidEnhancementEnabled()).toBe(true);

      // Set to false
      setMermaidEnhancementEnabled(false);
      expect(isMermaidEnhancementEnabled()).toBe(false);

      // Set back to true
      setMermaidEnhancementEnabled(true);
      expect(isMermaidEnhancementEnabled()).toBe(true);
    });

    it("should handle rapid toggling", () => {
      for (let i = 0; i < 10; i++) {
        const value = i % 2 === 0;
        setMermaidEnhancementEnabled(value);
        expect(isMermaidEnhancementEnabled()).toBe(value);
      }
    });
  });
});
