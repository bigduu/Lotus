import { describe, expect, it, vi, beforeEach } from "vitest";
import { ToolService } from "../ToolService";
import { apiClient, ApiError } from "../../api";

// Mock dependencies
vi.mock("../../api", () => ({
  apiClient: {
    post: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
      public statusText: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  },
}));

describe("ToolService", () => {
  let toolService: ToolService;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const toolServiceClass = ToolService as unknown as { instance?: ToolService };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton instance for deterministic tests.
    toolServiceClass.instance = undefined;
    toolService = ToolService.getInstance();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance", () => {
      const instance1 = ToolService.getInstance();
      const instance2 = ToolService.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("should create new instance only once", () => {
      toolServiceClass.instance = undefined;

      const instance1 = ToolService.getInstance();
      const instance2 = ToolService.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe("parseUserCommand", () => {
    it("should parse simple tool command without description", () => {
      const result = toolService.parseUserCommand("/simple_tool");

      expect(result).toEqual({
        tool_name: "simple_tool",
        user_description: "",
      });
    });

    it("should parse tool command with description", () => {
      const result = toolService.parseUserCommand("/my_tool do something cool");

      expect(result).toEqual({
        tool_name: "my_tool",
        user_description: "do something cool",
      });
    });

    it("should trim whitespace from command", () => {
      const result = toolService.parseUserCommand("  /test   ");

      expect(result).toEqual({
        tool_name: "test",
        user_description: "",
      });
    });

    it("should trim whitespace from description", () => {
      const result = toolService.parseUserCommand("/tool   description here  ");

      expect(result).toEqual({
        tool_name: "tool",
        user_description: "description here",
      });
    });

    it("should return null for content not starting with /", () => {
      const result = toolService.parseUserCommand("not a tool command");

      expect(result).toBeNull();
    });

    it("should return null for empty string", () => {
      const result = toolService.parseUserCommand("");

      expect(result).toBeNull();
    });

    it("should return null for whitespace-only string", () => {
      const result = toolService.parseUserCommand("   ");

      expect(result).toBeNull();
    });

    it("should handle tool name with underscores", () => {
      const result = toolService.parseUserCommand("/my_tool_name");

      expect(result).toEqual({
        tool_name: "my_tool_name",
        user_description: "",
      });
    });

    it("should handle tool name with hyphens", () => {
      const result = toolService.parseUserCommand("/my-tool-name");

      expect(result).toEqual({
        tool_name: "my-tool-name",
        user_description: "",
      });
    });

    it("should handle description with special characters", () => {
      const result = toolService.parseUserCommand("/tool test@example.com");

      expect(result).toEqual({
        tool_name: "tool",
        user_description: "test@example.com",
      });
    });

    it("should handle description with numbers", () => {
      const result = toolService.parseUserCommand("/tool 123 456");

      expect(result).toEqual({
        tool_name: "tool",
        user_description: "123 456",
      });
    });

    it("should return null for just forward slash", () => {
      const result = toolService.parseUserCommand("/");

      expect(result).toBeNull();
    });

    it("should handle multiple spaces between tool name and description", () => {
      const result = toolService.parseUserCommand("/tool     description");

      expect(result).toEqual({
        tool_name: "tool",
        user_description: "description",
      });
    });

    it("should handle unicode in description", () => {
      const result = toolService.parseUserCommand("/tool 你好世界");

      expect(result).toEqual({
        tool_name: "tool",
        user_description: "你好世界",
      });
    });
  });

  describe("parseAIResponseToToolCall", () => {
    it("should delegate to parseUserCommand", () => {
      const result = toolService.parseAIResponseToToolCall("/ai_tool test");

      expect(result).toEqual({
        tool_name: "ai_tool",
        user_description: "test",
      });
    });

    it("should return null for invalid input", () => {
      const result = toolService.parseAIResponseToToolCall("not a command");

      expect(result).toBeNull();
    });
  });

  describe("executeTool", () => {
    it("should execute tool successfully", async () => {
      const mockResult = {
        tool_name: "test_tool",
        success: true,
        result: "success",
        display_preference: "Default",
      };
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        result: JSON.stringify(mockResult),
      });

      const request = {
        tool_name: "test_tool",
        parameters: [{ name: "param1", value: "value1" }],
      };

      const result = await toolService.executeTool(request);

      expect(result).toEqual(mockResult);
      expect(apiClient.post).toHaveBeenCalledWith("tools/execute", request);
    });

    it("should execute tool with session_id", async () => {
      const mockResult = {
        tool_name: "test_tool",
        success: true,
        result: "done",
        display_preference: "Default",
      };
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        result: JSON.stringify(mockResult),
      });

      const request = {
        tool_name: "test_tool",
        parameters: [],
        session_id: "session-123",
      };

      const result = await toolService.executeTool(request);

      expect(result).toEqual(mockResult);
      expect(apiClient.post).toHaveBeenCalledWith("tools/execute", request);
    });

    it("should handle complex result JSON", async () => {
      const mockResult = {
        tool_name: "complex_tool",
        success: false,
        result: JSON.stringify({
          nested: {
            data: [1, 2, 3],
          },
        }),
        display_preference: "Collapsible",
      };
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        result: JSON.stringify(mockResult),
      });

      const request = {
        tool_name: "complex_tool",
        parameters: [],
      };

      const result = await toolService.executeTool(request);

      expect(result).toEqual(mockResult);
    });

    it("should throw ApiError with formatted message", async () => {
      const apiError = new ApiError("Network failed", 500, "Internal Error");
      vi.mocked(apiClient.post).mockRejectedValueOnce(apiError);

      const request = {
        tool_name: "failing_tool",
        parameters: [],
      };

      await expect(toolService.executeTool(request)).rejects.toThrow(
        "Workflow execution failed: Network failed",
      );
    });

    it("should rethrow non-ApiError errors", async () => {
      const genericError = new Error("Generic error");
      vi.mocked(apiClient.post).mockRejectedValueOnce(genericError);

      const request = {
        tool_name: "error_tool",
        parameters: [],
      };

      await expect(toolService.executeTool(request)).rejects.toThrow("Generic error");
    });

    it("should not leak console.log in production (uses debugLog)", async () => {
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        result: JSON.stringify({
          tool_name: "logged_tool",
          success: true,
          result: "ok",
          display_preference: "Default",
        }),
      });

      await toolService.executeTool({
        tool_name: "logged_tool",
        parameters: [{ name: "p1", value: "v1" }],
      });

      // debugLog is a no-op in test mode, so console.log should NOT be called
      expect(consoleLogSpy).not.toHaveBeenCalled();
    });

    it("should log error on failure", async () => {
      const error = new Error("Test error");
      vi.mocked(apiClient.post).mockRejectedValueOnce(error);

      try {
        await toolService.executeTool({
          tool_name: "test",
          parameters: [],
        });
      } catch {
        // Expected
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[ToolService] executeTool: HTTP tool execution failed:",
        error,
      );
    });

    it("should handle empty parameters array", async () => {
      const mockResult = {
        tool_name: "no_params",
        success: true,
        result: "",
        display_preference: "Default",
      };
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        result: JSON.stringify(mockResult),
      });

      const result = await toolService.executeTool({
        tool_name: "no_params",
        parameters: [],
      });

      expect(result).toEqual(mockResult);
    });

    it("should handle multiple parameters", async () => {
      const mockResult = {
        tool_name: "multi_param",
        success: true,
        result: "",
        display_preference: "Default",
      };
      vi.mocked(apiClient.post).mockResolvedValueOnce({
        result: JSON.stringify(mockResult),
      });

      const request = {
        tool_name: "multi_param",
        parameters: [
          { name: "param1", value: "value1" },
          { name: "param2", value: "value2" },
          { name: "param3", value: "value3" },
        ],
      };

      const result = await toolService.executeTool(request);

      expect(result).toEqual(mockResult);
      expect(apiClient.post).toHaveBeenCalledWith("tools/execute", request);
    });
  });
});
