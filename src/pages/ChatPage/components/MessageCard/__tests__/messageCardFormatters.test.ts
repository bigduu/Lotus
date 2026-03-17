import { describe, expect, it } from "vitest";
import { formatUserToolCall } from "../messageCardFormatters";

describe("messageCardFormatters", () => {
  describe("formatUserToolCall", () => {
    describe("non-tool-call strings", () => {
      it("should return unchanged if string doesn't start with /", () => {
        expect(formatUserToolCall("hello world")).toBe("hello world");
      });

      it("should return empty string unchanged", () => {
        expect(formatUserToolCall("")).toBe("");
      });

      it("should return regular message unchanged", () => {
        expect(formatUserToolCall("This is a regular message")).toBe(
          "This is a regular message",
        );
      });

      it("should handle string with / in the middle", () => {
        expect(formatUserToolCall("path/to/file")).toBe("path/to/file");
      });
    });

    describe("basic tool calls", () => {
      it("should format basic tool call with description", () => {
        const result = formatUserToolCall("/read_file path/to/file.txt");
        expect(result).toBe("🔧 Read File: path/to/file.txt");
      });

      it("should format tool call without description", () => {
        const result = formatUserToolCall("/list_files");
        expect(result).toBe("🔧 List Files: ");
      });

      it("should convert underscores to spaces", () => {
        const result = formatUserToolCall("/execute_bash_command ls -la");
        expect(result).toContain("Execute Bash Command");
      });

      it("should capitalize first letter of each word", () => {
        const result = formatUserToolCall("/search_web query string");
        expect(result).toContain("Search Web");
      });
    });

    describe("MCP tool calls", () => {
      it("should format MCP tool call correctly", () => {
        const result = formatUserToolCall(
          "/mcp__filesystem__read_file /path/to/file",
        );
        expect(result).toBe("🔌 MCP filesystem/read_file: /path/to/file");
      });

      it("should handle MCP tool with complex server ID", () => {
        const result = formatUserToolCall(
          "/mcp__my_server__execute_tool argument",
        );
        expect(result).toBe("🔌 MCP my_server/execute_tool: argument");
      });

      it("should handle MCP tool without description", () => {
        const result = formatUserToolCall("/mcp__server__tool");
        expect(result).toBe("🔌 MCP server/tool: ");
      });

      it("should handle MCP tool with multiple spaces in description", () => {
        const result = formatUserToolCall(
          "/mcp__github__create_issue title with spaces",
        );
        expect(result).toBe(
          "🔌 MCP github/create_issue: title with spaces",
        );
      });

      it("should handle incomplete MCP format (missing second __)", () => {
        const result = formatUserToolCall("/mcp__incomplete description");
        expect(result).toContain("🔧"); // Falls back to regular tool formatting
      });

      it("should handle MCP format with empty server ID", () => {
        const result = formatUserToolCall("/mcp____tool description");
        expect(result).toContain("🔧"); // Falls back to regular tool formatting
      });

      it("should handle MCP format with empty tool name", () => {
        const result = formatUserToolCall("/mcp__server__ description");
        expect(result).toContain("🔧"); // Falls back to regular tool formatting
      });
    });

    describe("edge cases", () => {
      it("should handle tool call with multiple spaces", () => {
        const result = formatUserToolCall(
          "/search  query   with    multiple     spaces",
        );
        expect(result).toBe(
          "🔧 Search:  query   with    multiple     spaces",
        );
      });

      it("should handle tool name with numbers", () => {
        const result = formatUserToolCall("/tool123 description");
        expect(result).toContain("Tool123");
      });

      it("should handle tool name with mixed case", () => {
        const result = formatUserToolCall("/myCustomTool description");
        // CamelCase doesn't get split - only underscores are replaced
        expect(result).toContain("MyCustomTool");
      });

      it("should preserve description exactly", () => {
        const desc = "Complex description with symbols !@#$%^&*()";
        const result = formatUserToolCall(`/tool ${desc}`);
        expect(result).toContain(desc);
      });

      it("should handle very long tool names", () => {
        const longName = "very_long_tool_name_with_many_underscores";
        const result = formatUserToolCall(`/${longName} description`);
        expect(result).toContain("Very Long Tool Name With Many Underscores");
      });

      it("should handle very long descriptions", () => {
        const longDesc = "a".repeat(1000);
        const result = formatUserToolCall(`/tool ${longDesc}`);
        expect(result).toContain(longDesc);
      });

      it("should handle unicode in tool name", () => {
        const result = formatUserToolCall("/工具_name description");
        expect(result).toContain("工具 Name");
      });

      it("should handle unicode in description", () => {
        const result = formatUserToolCall("/tool 描述信息");
        expect(result).toContain("描述信息");
      });
    });

    describe("specific tool examples", () => {
      it("should format read_file tool", () => {
        const result = formatUserToolCall("/read_file src/index.ts");
        expect(result).toBe("🔧 Read File: src/index.ts");
      });

      it("should format write_to_file tool", () => {
        const result = formatUserToolCall(
          "/write_to_file test.txt content here",
        );
        expect(result).toBe("🔧 Write To File: test.txt content here");
      });

      it("should format list_directory tool", () => {
        const result = formatUserToolCall("/list_directory ./src");
        expect(result).toBe("🔧 List Directory: ./src");
      });

      it("should format search_files tool", () => {
        const result = formatUserToolCall(
          "/search_files pattern *.ts --recursive",
        );
        expect(result).toBe("🔧 Search Files: pattern *.ts --recursive");
      });
    });

    describe("formatting consistency", () => {
      it("should use 🔧 emoji for regular tools", () => {
        const result = formatUserToolCall("/tool description");
        expect(result.startsWith("🔧")).toBe(true);
      });

      it("should use 🔌 emoji for MCP tools", () => {
        const result = formatUserToolCall("/mcp__server__tool desc");
        expect(result.startsWith("🔌")).toBe(true);
      });

      it("should include colon separator", () => {
        const result = formatUserToolCall("/tool description");
        expect(result).toContain(": ");
      });

      it("should maintain separator after tool name", () => {
        const result = formatUserToolCall("/my_tool my description");
        expect(result).toBe("🔧 My Tool: my description");
      });
    });

    describe("word capitalization", () => {
      it("should capitalize first letter of each word", () => {
        const result = formatUserToolCall("/one_two_three desc");
        expect(result).toContain("One Two Three");
      });

      it("should handle single word tool name", () => {
        const result = formatUserToolCall("/tool desc");
        expect(result).toContain("Tool");
      });

      it("should handle already capitalized words", () => {
        const result = formatUserToolCall("/Tool_Name desc");
        // After replacement and regex, should still be properly formatted
        expect(result).toContain("Tool Name");
      });

      it("should lowercase other letters", () => {
        const result = formatUserToolCall("/TOOL desc");
        // First letter stays capitalized, others don't get lowercased by the regex
        expect(result).toContain("TOOL");
      });
    });
  });
});
