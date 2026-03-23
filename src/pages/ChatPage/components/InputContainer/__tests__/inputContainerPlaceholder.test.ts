import { describe, expect, it } from "vitest";
import { getInputContainerPlaceholder } from "../inputContainerPlaceholder";

// Mock translation function that returns the key with interpolation
const mockT = (key: string, options?: Record<string, unknown>) => {
  const translations: Record<string, string> = {
    "chat.input.placeholderWithReference": "Send a message (includes reference)",
    "chat.input.toolCallsOnly": `Tool calls only (allowed tools: ${options?.tools ?? ""})`,
    "chat.input.autoPrefixMode": `Auto-prefix mode: ${options?.prefix ?? ""} (type '/' to select tools)`,
    "chat.input.toolSpecificMode": `Tool-specific mode (allowed tools: ${options?.tools ?? ""})`,
    "chat.input.placeholderWithWorkflows": "Send a message... (type '/' for workflows)",
  };
  return translations[key] || key;
};

describe("inputContainerPlaceholder", () => {
  describe("getInputContainerPlaceholder", () => {
    describe("reference text cases", () => {
      it("should return reference message when referenceText is provided", () => {
        const result = getInputContainerPlaceholder({
          referenceText: "Some reference text",
          isToolSpecificMode: false,
          isRestrictConversation: false,
          allowedTools: [],
          t: mockT,
        });
        expect(result).toBe("Send a message (includes reference)");
      });

      it("should return reference message even when tool mode is enabled", () => {
        const result = getInputContainerPlaceholder({
          referenceText: "Reference",
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: ["tool1"],
          t: mockT,
        });
        expect(result).toBe("Send a message (includes reference)");
      });

      it("should return reference message with empty allowedTools", () => {
        const result = getInputContainerPlaceholder({
          referenceText: "Reference",
          isToolSpecificMode: true,
          isRestrictConversation: true,
          allowedTools: [],
          t: mockT,
        });
        expect(result).toBe("Send a message (includes reference)");
      });
    });

    describe("tool-specific mode with restriction", () => {
      it("should return restricted tool message when isRestrictConversation is true", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: true,
          allowedTools: ["tool1", "tool2"],
          t: mockT,
        });
        expect(result).toBe("Tool calls only (allowed tools: tool1, tool2)");
      });

      it("should return restricted tool message with single tool", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: true,
          allowedTools: ["read_file"],
          t: mockT,
        });
        expect(result).toBe("Tool calls only (allowed tools: read_file)");
      });

      it("should return restricted tool message with empty allowedTools", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: true,
          allowedTools: [],
          t: mockT,
        });
        expect(result).toBe("Tool calls only (allowed tools: )");
      });

      it("should ignore autoToolPrefix when restricted", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: true,
          allowedTools: ["tool1"],
          autoToolPrefix: "/read_file",
          t: mockT,
        });
        expect(result).toBe("Tool calls only (allowed tools: tool1)");
      });
    });

    describe("tool-specific mode with auto-prefix", () => {
      it("should return auto-prefix message when autoToolPrefix is provided", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: ["tool1"],
          autoToolPrefix: "/read_file",
          t: mockT,
        });
        expect(result).toBe("Auto-prefix mode: /read_file (type '/' to select tools)");
      });

      it("should return auto-prefix message with empty allowedTools", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: [],
          autoToolPrefix: "/search",
          t: mockT,
        });
        expect(result).toBe("Auto-prefix mode: /search (type '/' to select tools)");
      });

      it("should handle complex autoToolPrefix", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: ["tool1", "tool2", "tool3"],
          autoToolPrefix: "/mcp__filesystem__read_file",
          t: mockT,
        });
        expect(result).toBe(
          "Auto-prefix mode: /mcp__filesystem__read_file (type '/' to select tools)",
        );
      });
    });

    describe("tool-specific mode without auto-prefix or restriction", () => {
      it("should return tool-specific message when in tool mode without restrictions", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: ["tool1", "tool2"],
          t: mockT,
        });
        expect(result).toBe("Tool-specific mode (allowed tools: tool1, tool2)");
      });

      it("should return tool-specific message with single tool", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: ["read_file"],
          t: mockT,
        });
        expect(result).toBe("Tool-specific mode (allowed tools: read_file)");
      });

      it("should return tool-specific message with empty allowedTools", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: [],
          t: mockT,
        });
        expect(result).toBe("Tool-specific mode (allowed tools: )");
      });

      it("should return tool-specific message when autoToolPrefix is undefined", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: ["tool1"],
          autoToolPrefix: undefined,
          t: mockT,
        });
        expect(result).toBe("Tool-specific mode (allowed tools: tool1)");
      });

      it("should return tool-specific message when autoToolPrefix is empty string", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: ["tool1"],
          autoToolPrefix: "",
          t: mockT,
        });
        expect(result).toBe("Tool-specific mode (allowed tools: tool1)");
      });
    });

    describe("default message", () => {
      it("should return default message when not in tool mode", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: false,
          isRestrictConversation: false,
          allowedTools: [],
          t: mockT,
        });
        expect(result).toBe("Send a message... (type '/' for workflows)");
      });

      it("should return default message when not in tool mode even with tools", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: false,
          isRestrictConversation: false,
          allowedTools: ["tool1", "tool2"],
          t: mockT,
        });
        expect(result).toBe("Send a message... (type '/' for workflows)");
      });

      it("should return default message when not in tool mode even with restrictions", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: false,
          isRestrictConversation: true,
          allowedTools: ["tool1"],
          t: mockT,
        });
        expect(result).toBe("Send a message... (type '/' for workflows)");
      });

      it("should return default message when not in tool mode even with autoToolPrefix", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: false,
          isRestrictConversation: false,
          allowedTools: [],
          autoToolPrefix: "/tool",
          t: mockT,
        });
        expect(result).toBe("Send a message... (type '/' for workflows)");
      });
    });

    describe("priority and branching logic", () => {
      it("should prioritize referenceText over all other options", () => {
        const result = getInputContainerPlaceholder({
          referenceText: "Important reference",
          isToolSpecificMode: true,
          isRestrictConversation: true,
          allowedTools: ["tool1"],
          autoToolPrefix: "/tool",
          t: mockT,
        });
        expect(result).toBe("Send a message (includes reference)");
      });

      it("should prioritize isRestrictConversation over autoToolPrefix", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: true,
          allowedTools: ["tool1"],
          autoToolPrefix: "/tool",
          t: mockT,
        });
        expect(result).toBe("Tool calls only (allowed tools: tool1)");
      });

      it("should prioritize autoToolPrefix over default tool mode", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: ["tool1", "tool2"],
          autoToolPrefix: "/read_file",
          t: mockT,
        });
        expect(result).toBe("Auto-prefix mode: /read_file (type '/' to select tools)");
      });
    });

    describe("edge cases", () => {
      it("should handle very long tool list", () => {
        const tools = Array.from({ length: 50 }, (_, i) => `tool${i}`);
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: tools,
          t: mockT,
        });
        expect(result).toContain("Tool-specific mode");
        expect(result).toContain("tool0, tool1, tool2");
      });

      it("should handle unicode in tool names", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: ["工具1", "outil2"],
          t: mockT,
        });
        expect(result).toBe("Tool-specific mode (allowed tools: 工具1, outil2)");
      });

      it("should handle special characters in tool names", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: ["read-file", "write_file", "search.files"],
          t: mockT,
        });
        expect(result).toBe(
          "Tool-specific mode (allowed tools: read-file, write_file, search.files)",
        );
      });

      it("should handle special characters in autoToolPrefix", () => {
        const result = getInputContainerPlaceholder({
          referenceText: null,
          isToolSpecificMode: true,
          isRestrictConversation: false,
          allowedTools: [],
          autoToolPrefix: "/mcp__my-server__complex_tool-name",
          t: mockT,
        });
        expect(result).toBe(
          "Auto-prefix mode: /mcp__my-server__complex_tool-name (type '/' to select tools)",
        );
      });
    });

    describe("type safety", () => {
      it("should handle referenceText as empty string", () => {
        const result = getInputContainerPlaceholder({
          referenceText: "",
          isToolSpecificMode: false,
          isRestrictConversation: false,
          allowedTools: [],
          t: mockT,
        });
        // Empty string is falsy, so should return default message
        expect(result).toBe("Send a message... (type '/' for workflows)");
      });

      it("should handle referenceText as whitespace only", () => {
        const result = getInputContainerPlaceholder({
          referenceText: "   ",
          isToolSpecificMode: false,
          isRestrictConversation: false,
          allowedTools: [],
          t: mockT,
        });
        // Whitespace is truthy, so should return reference message
        expect(result).toBe("Send a message (includes reference)");
      });
    });
  });
});
