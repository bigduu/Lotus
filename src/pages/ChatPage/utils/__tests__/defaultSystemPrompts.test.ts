import { describe, expect, it } from "vitest";
import { getDefaultSystemPrompts } from "../defaultSystemPrompts";
import type { UserSystemPrompt } from "../../types/chat";

describe("defaultSystemPrompts", () => {
  describe("getDefaultSystemPrompts", () => {
    describe("return value structure", () => {
      it("should return an array", () => {
        const result = getDefaultSystemPrompts();
        expect(Array.isArray(result)).toBe(true);
      });

      it("should return an array with exactly one prompt", () => {
        const result = getDefaultSystemPrompts();
        expect(result).toHaveLength(1);
      });

      it("should return a non-empty array", () => {
        const result = getDefaultSystemPrompts();
        expect(result.length).toBeGreaterThan(0);
      });
    });

    describe("default prompt properties", () => {
      it("should have correct id", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].id).toBe("general_assistant");
      });

      it("should have correct name", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].name).toBe("Bodhi");
      });

      it("should have correct description", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].description).toBe("Default system prompt.");
      });

      it("should have isDefault set to true", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].isDefault).toBe(true);
      });

      it("should have non-empty content", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].content.length).toBeGreaterThan(0);
      });
    });

    describe("content quality", () => {
      it("should contain Bodhi name in content", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].content).toContain("Bodhi");
      });

      it("should contain AI assistant description", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].content).toContain("AI assistant");
      });

      it("should be multi-line content", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].content).toContain("\n");
      });

      it("should start with 'You are'", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].content).toMatch(/^You are/);
      });

      it("should contain instruction about conciseness", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].content).toContain("concise");
      });

      it("should contain instruction about asking questions", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].content).toContain("ask");
        expect(result[0].content).toContain("question");
      });
    });

    describe("type safety", () => {
      it("should return UserSystemPrompt type", () => {
        const result = getDefaultSystemPrompts();
        const prompt: UserSystemPrompt = result[0];
        expect(prompt.id).toBe("general_assistant");
      });

      it("should have all required UserSystemPrompt fields", () => {
        const result = getDefaultSystemPrompts();
        const prompt = result[0];
        expect(prompt).toHaveProperty("id");
        expect(prompt).toHaveProperty("name");
        expect(prompt).toHaveProperty("description");
        expect(prompt).toHaveProperty("content");
        expect(prompt).toHaveProperty("isDefault");
      });

      it("should have correct types for all fields", () => {
        const result = getDefaultSystemPrompts();
        const prompt = result[0];
        expect(typeof prompt.id).toBe("string");
        expect(typeof prompt.name).toBe("string");
        expect(typeof prompt.description).toBe("string");
        expect(typeof prompt.content).toBe("string");
        expect(typeof prompt.isDefault).toBe("boolean");
      });
    });

    describe("immutability", () => {
      it("should return a new array each time", () => {
        const result1 = getDefaultSystemPrompts();
        const result2 = getDefaultSystemPrompts();
        expect(result1).not.toBe(result2);
      });

      it("should return a new object each time (spread operator)", () => {
        const result1 = getDefaultSystemPrompts();
        const result2 = getDefaultSystemPrompts();
        expect(result1[0]).not.toBe(result2[0]);
      });

      it("should allow modification without affecting future calls", () => {
        const result1 = getDefaultSystemPrompts();
        result1[0].name = "Modified";
        const result2 = getDefaultSystemPrompts();
        expect(result2[0].name).toBe("Bodhi");
      });

      it("should not modify array after mutation", () => {
        const result1 = getDefaultSystemPrompts();
        result1.push({} as UserSystemPrompt);
        const result2 = getDefaultSystemPrompts();
        expect(result2).toHaveLength(1);
      });
    });

    describe("consistency", () => {
      it("should return the same prompt on multiple calls", () => {
        const result1 = getDefaultSystemPrompts();
        const result2 = getDefaultSystemPrompts();
        expect(result1[0].id).toBe(result2[0].id);
        expect(result1[0].name).toBe(result2[0].name);
        expect(result1[0].content).toBe(result2[0].content);
      });

      it("should always return the same id", () => {
        const results = Array.from({ length: 10 }, () => getDefaultSystemPrompts());
        const ids = results.map((r) => r[0].id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(1);
      });
    });

    describe("edge cases", () => {
      it("should handle being called multiple times rapidly", () => {
        const results = [];
        for (let i = 0; i < 100; i++) {
          results.push(getDefaultSystemPrompts());
        }
        expect(results).toHaveLength(100);
        results.forEach((r) => {
          expect(r).toHaveLength(1);
          expect(r[0].name).toBe("Bodhi");
        });
      });

      it("should have content with proper line breaks", () => {
        const result = getDefaultSystemPrompts();
        const lines = result[0].content.split("\n");
        expect(lines.length).toBeGreaterThan(1);
      });

      it("should have content ending with a complete sentence", () => {
        const result = getDefaultSystemPrompts();
        expect(result[0].content).toMatch(/\.\s*$/);
      });
    });
  });
});
