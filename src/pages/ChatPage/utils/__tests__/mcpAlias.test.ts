import { describe, expect, it } from "vitest";
import { parseMcpToolAlias } from "../mcpAlias";

describe("mcpAlias", () => {
  describe("parseMcpToolAlias", () => {
    describe("valid MCP tool aliases", () => {
      it("should parse valid MCP tool alias with server and tool name", () => {
        const result = parseMcpToolAlias("mcp__filesystem__read_file");
        expect(result).toEqual({
          serverId: "filesystem",
          toolName: "read_file",
        });
      });

      it("should parse MCP tool with complex server ID", () => {
        const result = parseMcpToolAlias("mcp__my_server__execute_tool");
        expect(result).toEqual({
          serverId: "my_server",
          toolName: "execute_tool",
        });
      });

      it("should parse MCP tool with underscores in tool name", () => {
        const result = parseMcpToolAlias("mcp__server__tool_with_underscores");
        expect(result).toEqual({
          serverId: "server",
          toolName: "tool_with_underscores",
        });
      });

      it("should parse MCP tool with multiple underscores in tool name", () => {
        const result = parseMcpToolAlias("mcp__server__tool__with__many__underscores");
        expect(result).toEqual({
          serverId: "server",
          toolName: "tool__with__many__underscores",
        });
      });

      it("should parse MCP tool with numbers in server ID", () => {
        const result = parseMcpToolAlias("mcp__server123__tool");
        expect(result).toEqual({
          serverId: "server123",
          toolName: "tool",
        });
      });

      it("should parse MCP tool with numbers in tool name", () => {
        const result = parseMcpToolAlias("mcp__server__tool456");
        expect(result).toEqual({
          serverId: "server",
          toolName: "tool456",
        });
      });
    });

    describe("invalid MCP tool aliases", () => {
      it("should return null for empty string", () => {
        const result = parseMcpToolAlias("");
        expect(result).toBeNull();
      });

      it("should return null for string not starting with mcp__", () => {
        const result = parseMcpToolAlias("tool__server__name");
        expect(result).toBeNull();
      });

      it("should return null for string starting with mcp_ (single underscore)", () => {
        const result = parseMcpToolAlias("mcp_server__tool");
        expect(result).toBeNull();
      });

      it("should return null for incomplete format (missing second __)", () => {
        const result = parseMcpToolAlias("mcp__incomplete");
        expect(result).toBeNull();
      });

      it("should return null for format with empty server ID", () => {
        const result = parseMcpToolAlias("mcp____tool");
        expect(result).toBeNull();
      });

      it("should return null for format with empty tool name", () => {
        const result = parseMcpToolAlias("mcp__server__");
        expect(result).toBeNull();
      });

      it("should return null for format with separator at start", () => {
        const result = parseMcpToolAlias("mcp____");
        expect(result).toBeNull();
      });

      it("should return null for non-string input (number)", () => {
        const result = parseMcpToolAlias(123 as any);
        expect(result).toBeNull();
      });

      it("should return null for non-string input (null)", () => {
        const result = parseMcpToolAlias(null as any);
        expect(result).toBeNull();
      });

      it("should return null for non-string input (undefined)", () => {
        const result = parseMcpToolAlias(undefined as any);
        expect(result).toBeNull();
      });

      it("should return null for non-string input (object)", () => {
        const result = parseMcpToolAlias({} as any);
        expect(result).toBeNull();
      });

      it("should return null for non-string input (array)", () => {
        const result = parseMcpToolAlias([] as any);
        expect(result).toBeNull();
      });
    });

    describe("edge cases", () => {
      it("should handle unicode in server ID", () => {
        const result = parseMcpToolAlias("mcp__服务器__tool");
        expect(result).toEqual({
          serverId: "服务器",
          toolName: "tool",
        });
      });

      it("should handle unicode in tool name", () => {
        const result = parseMcpToolAlias("mcp__server__工具");
        expect(result).toEqual({
          serverId: "server",
          toolName: "工具",
        });
      });

      it("should handle very long server ID", () => {
        const longServerId = "a".repeat(1000);
        const result = parseMcpToolAlias(`mcp__${longServerId}__tool`);
        expect(result).toEqual({
          serverId: longServerId,
          toolName: "tool",
        });
      });

      it("should handle very long tool name", () => {
        const longToolName = "b".repeat(1000);
        const result = parseMcpToolAlias(`mcp__server__${longToolName}`);
        expect(result).toEqual({
          serverId: "server",
          toolName: longToolName,
        });
      });

      it("should handle special characters in server ID", () => {
        const result = parseMcpToolAlias("mcp__my-server__tool");
        expect(result).toEqual({
          serverId: "my-server",
          toolName: "tool",
        });
      });

      it("should handle special characters in tool name", () => {
        const result = parseMcpToolAlias("mcp__server__my-tool");
        expect(result).toEqual({
          serverId: "server",
          toolName: "my-tool",
        });
      });

      it("should handle dots in server ID", () => {
        const result = parseMcpToolAlias("mcp__com.example.server__tool");
        expect(result).toEqual({
          serverId: "com.example.server",
          toolName: "tool",
        });
      });

      it("should handle dots in tool name", () => {
        const result = parseMcpToolAlias("mcp__server__com.example.tool");
        expect(result).toEqual({
          serverId: "server",
          toolName: "com.example.tool",
        });
      });
    });

    describe("real-world examples", () => {
      it("should parse filesystem read_file tool", () => {
        const result = parseMcpToolAlias("mcp__filesystem__read_file");
        expect(result).toEqual({
          serverId: "filesystem",
          toolName: "read_file",
        });
      });

      it("should parse github create_issue tool", () => {
        const result = parseMcpToolAlias("mcp__github__create_issue");
        expect(result).toEqual({
          serverId: "github",
          toolName: "create_issue",
        });
      });

      it("should parse web-search search tool", () => {
        const result = parseMcpToolAlias("mcp__web-search__search");
        expect(result).toEqual({
          serverId: "web-search",
          toolName: "search",
        });
      });
    });

    describe("boundary conditions", () => {
      it("should parse with minimum valid server ID (1 character)", () => {
        const result = parseMcpToolAlias("mcp__a__tool");
        expect(result).toEqual({
          serverId: "a",
          toolName: "tool",
        });
      });

      it("should parse with minimum valid tool name (1 character)", () => {
        const result = parseMcpToolAlias("mcp__server__t");
        expect(result).toEqual({
          serverId: "server",
          toolName: "t",
        });
      });

      it("should parse with single character both", () => {
        const result = parseMcpToolAlias("mcp__s__t");
        expect(result).toEqual({
          serverId: "s",
          toolName: "t",
        });
      });

      it("should handle separator at position 0 after mcp__", () => {
        const result = parseMcpToolAlias("mcp____tool");
        expect(result).toBeNull(); // Empty server ID
      });
    });
  });
});
