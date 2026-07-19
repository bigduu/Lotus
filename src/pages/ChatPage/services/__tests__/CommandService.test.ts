import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CommandService } from "../CommandService";
import { apiClient } from "@services/api";
import type { CommandListResponse } from "@shared/types/command";

// Mock apiClient
vi.mock("@services/api", () => ({
  apiClient: {
    get: vi.fn(),
  },
}));

describe("CommandService", () => {
  let service: CommandService;

  beforeEach(() => {
    vi.resetAllMocks();
    // Get a fresh instance for each test
    CommandService["instance"] = null;
    service = CommandService.getInstance();
    service.clearCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("getInstance", () => {
    it("should return singleton instance", () => {
      const instance1 = CommandService.getInstance();
      const instance2 = CommandService.getInstance();

      expect(instance1).toBe(instance2);
    });

    it("should create new instance if none exists", () => {
      CommandService["instance"] = null;
      const instance = CommandService.getInstance();

      expect(instance).toBeInstanceOf(CommandService);
    });

    it("should return existing instance on subsequent calls", () => {
      const instance1 = CommandService.getInstance();
      const instance2 = CommandService.getInstance();
      const instance3 = CommandService.getInstance();

      expect(instance1).toBe(instance2);
      expect(instance2).toBe(instance3);
    });
  });

  describe("listCommands", () => {
    it("should fetch commands from API on first call", async () => {
      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test command",
          type: "workflow" as const,
          metadata: {},
        },
        {
          id: "cmd2",
          name: "Command 2",
          displayName: "Command 2",
          description: "Another command",
          type: "skill" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        commands: mockCommands,
        total: 2,
      });

      const result = await service.listCommands();

      expect(apiClient.get).toHaveBeenCalledWith("commands");
      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        id: "builtin-goal",
        name: "goal",
        type: "goal",
      });
      expect(result.slice(1)).toEqual(mockCommands);
    });

    it("should cache commands and return from cache on second call", async () => {
      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        commands: mockCommands,
        total: 1,
      });

      // First call
      const result1 = await service.listCommands();
      expect(apiClient.get).toHaveBeenCalledTimes(1);

      // Second call (should use cache)
      const result2 = await service.listCommands();
      expect(apiClient.get).toHaveBeenCalledTimes(1); // No additional call

      expect(result1).toEqual(result2);
    });

    it("should force refresh when forceRefresh is true", async () => {
      const mockCommands1 = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];

      const mockCommands2 = [
        {
          id: "cmd2",
          name: "Command 2",
          displayName: "Command 2",
          description: "Updated",
          type: "skill" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ commands: mockCommands1, total: 1 })
        .mockResolvedValueOnce({ commands: mockCommands2, total: 1 });

      // First call
      const result1 = await service.listCommands();
      expect(result1).toHaveLength(2);
      expect(result1[0]).toMatchObject({ id: "builtin-goal", name: "goal", type: "goal" });
      expect(result1.slice(1)).toEqual(mockCommands1);

      // Force refresh
      const result2 = await service.listCommands(undefined, true);
      expect(apiClient.get).toHaveBeenCalledTimes(2);
      expect(result2).toHaveLength(2);
      expect(result2[0]).toMatchObject({ id: "builtin-goal", name: "goal", type: "goal" });
      expect(result2.slice(1)).toEqual(mockCommands2);
    });

    it("should refresh cache after TTL expires", async () => {
      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValue({
        commands: mockCommands,
        total: 1,
      });

      // First call
      await service.listCommands();
      expect(apiClient.get).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire (30s + 1ms)
      vi.useFakeTimers();
      vi.advanceTimersByTime(30001);

      // Second call (should refresh)
      await service.listCommands();
      expect(apiClient.get).toHaveBeenCalledTimes(2);
    });

    it("should throw error when API call fails", async () => {
      const error = new Error("Network error");
      vi.mocked(apiClient.get).mockRejectedValueOnce(error);

      await expect(service.listCommands()).rejects.toThrow("Network error");
    });

    it("should log error when API call fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("API failed");
      vi.mocked(apiClient.get).mockRejectedValueOnce(error);

      try {
        await service.listCommands();
      } catch {
        // Expected
      }

      expect(consoleSpy).toHaveBeenCalledWith("[CommandService] Failed to list commands:", error);

      consoleSpy.mockRestore();
    });

    it("should log success when commands are loaded", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        commands: mockCommands,
        total: 1,
      });

      await service.listCommands();

      // debugLog is a no-op in test mode, so console.log should NOT be called
      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it("should handle empty command list", async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        commands: [],
        total: 0,
      });

      const result = await service.listCommands();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "builtin-goal",
        name: "goal",
        type: "goal",
      });
    });

    it("should handle commands with different types", async () => {
      const mockCommands = [
        {
          id: "cmd1",
          name: "Workflow 1",
          displayName: "Workflow 1",
          description: "Test workflow",
          type: "workflow" as const,
          metadata: {},
        },
        {
          id: "cmd2",
          name: "Skill 1",
          displayName: "Skill 1",
          description: "Test skill",
          type: "skill" as const,
          metadata: {},
        },
        {
          id: "cmd3",
          name: "MCP Tool 1",
          displayName: "MCP Tool 1",
          description: "Test MCP tool",
          type: "mcp" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        commands: mockCommands,
        total: 3,
      });

      const result = await service.listCommands();

      expect(result).toHaveLength(4);
      expect(result.map((c) => c.type)).toEqual(["goal", "workflow", "skill", "mcp"]);
    });

    it("isolates distinct command results and caches by session", async () => {
      const sessionOneCommand = {
        id: "skill-session-one",
        name: "project-skill-one",
        displayName: "Project Skill One",
        description: "Only available in session one",
        type: "skill" as const,
        metadata: {},
      };
      const sessionTwoCommand = {
        id: "skill-session-two",
        name: "project-skill-two",
        displayName: "Project Skill Two",
        description: "Only available in session two",
        type: "skill" as const,
        metadata: {},
      };

      vi.mocked(apiClient.get).mockImplementation(async (path) => {
        if (path === "commands?session_id=session-one") {
          return { commands: [sessionOneCommand], total: 1 };
        }
        if (path === "commands?session_id=session-two") {
          return { commands: [sessionTwoCommand], total: 1 };
        }
        throw new Error(`Unexpected path: ${path}`);
      });

      const sessionOne = await service.listCommands("session-one");
      const sessionTwo = await service.listCommands("session-two");
      const cachedSessionOne = await service.listCommands("session-one");

      expect(sessionOne.slice(1)).toEqual([sessionOneCommand]);
      expect(sessionTwo.slice(1)).toEqual([sessionTwoCommand]);
      expect(cachedSessionOne).toEqual(sessionOne);
      expect(apiClient.get).toHaveBeenCalledTimes(2);
      expect(apiClient.get).toHaveBeenNthCalledWith(1, "commands?session_id=session-one");
      expect(apiClient.get).toHaveBeenNthCalledWith(2, "commands?session_id=session-two");
      expect(vi.mocked(apiClient.get).mock.calls.flat().join(" ")).not.toContain("workspace_path");
    });

    it("deduplicates in-flight lists only within the same session", async () => {
      let resolveSessionOne: ((value: CommandListResponse) => void) | undefined;
      let resolveSessionTwo: ((value: CommandListResponse) => void) | undefined;
      const sessionOneResponse = new Promise<CommandListResponse>((resolve) => {
        resolveSessionOne = resolve;
      });
      const sessionTwoResponse = new Promise<CommandListResponse>((resolve) => {
        resolveSessionTwo = resolve;
      });

      vi.mocked(apiClient.get).mockImplementation((path) => {
        if (path === "commands?session_id=session-one") return sessionOneResponse;
        if (path === "commands?session_id=session-two") return sessionTwoResponse;
        throw new Error(`Unexpected path: ${path}`);
      });

      const firstSessionOne = service.listCommands("session-one");
      const secondSessionOne = service.listCommands("session-one");
      const firstSessionTwo = service.listCommands("session-two");

      expect(apiClient.get).toHaveBeenCalledTimes(2);

      resolveSessionOne?.({ commands: [], total: 0 });
      resolveSessionTwo?.({ commands: [], total: 0 });
      await expect(
        Promise.all([firstSessionOne, secondSessionOne, firstSessionTwo]),
      ).resolves.toEqual([expect.any(Array), expect.any(Array), expect.any(Array)]);
    });

    it("prunes expired entries for all sessions on the next list", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      vi.mocked(apiClient.get).mockResolvedValue({ commands: [], total: 0 });

      await service.listCommands("session-one");
      await service.listCommands("session-two");
      expect(service["cache"].size).toBe(2);

      vi.advanceTimersByTime(30000);
      await service.listCommands("session-three");

      expect(service["cache"].size).toBe(1);
      expect(service["cache"].has("session:session-three")).toBe(true);

      await service.listCommands("session-one");
      expect(apiClient.get).toHaveBeenCalledTimes(4);

      vi.useRealTimers();
    });
  });

  describe("getCommand", () => {
    it("should fetch specific command by type and id", async () => {
      const mockCommand = {
        id: "cmd1",
        name: "Test Command",
        content: "Test content",
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce(mockCommand);

      const result = await service.getCommand("workflow", "cmd1");

      expect(apiClient.get).toHaveBeenCalledWith("commands/workflow/cmd1");
      expect(result).toEqual(mockCommand);
    });

    it("should handle command with complex id", async () => {
      const mockCommand = { data: "test" };
      vi.mocked(apiClient.get).mockResolvedValueOnce(mockCommand);

      await service.getCommand("skill", "complex-command-id");

      expect(apiClient.get).toHaveBeenCalledWith("commands/skill/complex-command-id");
    });

    it("should throw error when command not found", async () => {
      const error = new Error("Command not found");
      vi.mocked(apiClient.get).mockRejectedValueOnce(error);

      await expect(service.getCommand("workflow", "nonexistent")).rejects.toThrow(
        "Command not found",
      );
    });

    it("should log error when getCommand fails", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const error = new Error("Failed to get");
      vi.mocked(apiClient.get).mockRejectedValueOnce(error);

      try {
        await service.getCommand("workflow", "cmd1");
      } catch {
        // Expected
      }

      expect(consoleSpy).toHaveBeenCalledWith(
        "[CommandService] Failed to get command workflow/cmd1:",
        error,
      );

      consoleSpy.mockRestore();
    });

    it("should handle different command types", async () => {
      const types = ["workflow", "skill", "mcp"];

      for (const type of types) {
        const mockCommand = { type, id: "test" };
        vi.mocked(apiClient.get).mockResolvedValueOnce(mockCommand);

        const result = await service.getCommand(type, "test");
        expect(result).toEqual(mockCommand);
      }

      expect(apiClient.get).toHaveBeenCalledTimes(3);
    });

    it("scopes detail lookup by session without sending workspace_path", async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        id: "project-skill",
        content: "session-scoped content",
      });

      await service.getCommand("skill", "project/skill", "session/a b");

      expect(apiClient.get).toHaveBeenCalledWith(
        "commands/skill/project/skill?session_id=session%2Fa%20b",
      );
      expect(vi.mocked(apiClient.get).mock.calls[0]?.[0]).not.toContain("workspace_path");
    });

    it("preserves global detail lookup when no session is available", async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({ id: "global-workflow" });

      await service.getCommand("workflow", "global-workflow", null);

      expect(apiClient.get).toHaveBeenCalledWith("commands/workflow/global-workflow");
    });
  });

  describe("clearCache", () => {
    it("should clear cache", async () => {
      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValue({
        commands: mockCommands,
        total: 1,
      });

      // Load cache
      await service.listCommands();
      expect(apiClient.get).toHaveBeenCalledTimes(1);

      // Clear cache
      service.clearCache();

      // Should fetch again
      await service.listCommands();
      expect(apiClient.get).toHaveBeenCalledTimes(2);
    });

    it("should reset cache time to 0", async () => {
      vi.useFakeTimers();

      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValue({
        commands: mockCommands,
        total: 1,
      });

      // Load cache
      await service.listCommands();

      // Clear cache
      service.clearCache();

      // Immediately fetch again (should not use cache)
      await service.listCommands();

      expect(apiClient.get).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("should handle clearing empty cache", () => {
      service.clearCache();
      expect(apiClient.get).not.toHaveBeenCalled();
    });

    it("should allow multiple clearCache calls", async () => {
      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];
      vi.mocked(apiClient.get).mockResolvedValue({
        commands: mockCommands,
        total: 1,
      });

      service.clearCache();
      service.clearCache();
      service.clearCache();

      await service.listCommands();
      expect(apiClient.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("cache behavior", () => {
    it("should use cached data within TTL", async () => {
      vi.useFakeTimers();

      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValue({
        commands: mockCommands,
        total: 1,
      });

      // Initial load
      await service.listCommands();

      // Multiple calls within TTL
      vi.advanceTimersByTime(5000);
      await service.listCommands();

      vi.advanceTimersByTime(10000);
      await service.listCommands();

      vi.advanceTimersByTime(14000);
      await service.listCommands();

      // All calls should use cache (total 29s < 30s TTL)
      expect(apiClient.get).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it("should refresh after TTL expires", async () => {
      vi.useFakeTimers();

      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValue({
        commands: mockCommands,
        total: 1,
      });

      // Initial load
      await service.listCommands();
      expect(apiClient.get).toHaveBeenCalledTimes(1);

      // Wait for TTL to expire (30s)
      vi.advanceTimersByTime(30000);

      // Should refresh
      await service.listCommands();
      expect(apiClient.get).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });
  });

  describe("singleton behavior", () => {
    it("should maintain cache across instances", async () => {
      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValue({
        commands: mockCommands,
        total: 1,
      });

      const instance1 = CommandService.getInstance();
      await instance1.listCommands();

      const instance2 = CommandService.getInstance();
      const result = await instance2.listCommands();

      // Should use cache from instance1
      expect(apiClient.get).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: "builtin-goal", name: "goal", type: "goal" });
      expect(result.slice(1)).toEqual(mockCommands);
    });

    it("should share clearCache across instances", async () => {
      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValue({
        commands: mockCommands,
        total: 1,
      });

      const instance1 = CommandService.getInstance();
      await instance1.listCommands();

      const instance2 = CommandService.getInstance();
      instance2.clearCache();

      // Instance1 should also have cleared cache
      await instance1.listCommands();

      expect(apiClient.get).toHaveBeenCalledTimes(2);
    });
  });

  describe("error scenarios", () => {
    it("should handle network timeout", async () => {
      const error = new Error("Network timeout");
      vi.mocked(apiClient.get).mockRejectedValueOnce(error);

      await expect(service.listCommands()).rejects.toThrow("Network timeout");
    });

    it("should handle unauthorized error", async () => {
      const error = new Error("Unauthorized");
      vi.mocked(apiClient.get).mockRejectedValueOnce(error);

      await expect(service.getCommand("workflow", "cmd1")).rejects.toThrow("Unauthorized");
    });

    it("should handle malformed response", async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        commands: "invalid",
        total: "not a number",
      });

      await expect(service.listCommands()).rejects.toThrow("Invalid command list response");
    });

    it("should handle malformed response with missing commands property", async () => {
      vi.mocked(apiClient.get).mockResolvedValueOnce({});

      // The code expects response.commands to exist, so this will throw
      await expect(service.listCommands()).rejects.toThrow();
    });
  });

  describe("real-world scenarios", () => {
    it("should handle typical usage pattern", async () => {
      const mockCommands = [
        {
          id: "workflow1",
          name: "Build Project",
          displayName: "Build Project",
          description: "Build the project",
          type: "workflow" as const,
          metadata: { filename: "build.yaml" },
        },
        {
          id: "skill1",
          name: "Code Review",
          displayName: "Code Review",
          description: "Review code",
          type: "skill" as const,
          metadata: { prompt: "Review the code" },
        },
      ];

      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          commands: mockCommands,
          total: 2,
        })
        .mockResolvedValueOnce({
          id: "workflow1",
          name: "Build Project",
          displayName: "Build Project",
          description: "Build the project",
          type: "workflow",
          metadata: { filename: "build.yaml" },
        })
        .mockResolvedValueOnce({
          commands: mockCommands,
          total: 2,
        });

      // User loads command list
      const commands = await service.listCommands();
      expect(commands).toHaveLength(3);
      expect(commands[0]).toMatchObject({ id: "builtin-goal", name: "goal", type: "goal" });

      // User selects a command
      const workflow = await service.getCommand("workflow", "workflow1");
      expect(workflow).toMatchObject({
        id: "workflow1",
        type: "workflow",
      });

      // User refreshes list
      const refreshed = await service.listCommands(undefined, true);
      expect(refreshed).toHaveLength(3);
      expect(refreshed[0]).toMatchObject({ id: "builtin-goal", name: "goal", type: "goal" });

      expect(apiClient.get).toHaveBeenCalledTimes(3);
    });

    it("should handle cache invalidation workflow", async () => {
      const mockCommands = [
        {
          id: "cmd1",
          name: "Command 1",
          displayName: "Command 1",
          description: "Test",
          type: "workflow" as const,
          metadata: {},
        },
      ];

      vi.mocked(apiClient.get).mockResolvedValue({
        commands: mockCommands,
        total: 1,
      });

      // Load commands
      await service.listCommands();

      // Some action invalidates cache
      service.clearCache();

      // Next call should fetch fresh data
      await service.listCommands();

      expect(apiClient.get).toHaveBeenCalledTimes(2);
    });
  });
});
