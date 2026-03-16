import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockFetchResponse } from "@test/helpers";
import { mcpService } from "../McpService";
import { ServerStatus, type McpServerConfig } from "../types";

const SAMPLE_CONFIG: McpServerConfig = {
  id: "filesystem",
  name: "Filesystem",
  enabled: true,
  transport: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    env: {
      MCP_ROOT: "/tmp",
    },
  },
  request_timeout_ms: 45000,
  healthcheck_interval_ms: 30000,
  allowed_tools: [],
  denied_tools: [],
};

describe("mcpService", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it("loads servers and maps runtime status from the MCP list endpoint", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        servers: [
          {
            id: "filesystem",
            name: "Filesystem",
            enabled: true,
            status: "ready",
            tool_count: 3,
            restart_count: 1,
          },
        ],
      }),
    );

    const servers = await mcpService.getServers();

    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9562/api/v1/mcp/servers",
      expect.objectContaining({ method: "GET" }),
    );
    expect(servers).toHaveLength(1);
    expect(servers[0].id).toBe("filesystem");
    expect(servers[0].runtime?.status).toBe(ServerStatus.Ready);
    expect(servers[0].runtime?.tool_count).toBe(3);
  });

  it("adds and updates servers with the MCP config payload", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          message: "Server started",
          server_id: "filesystem",
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          message: "Server updated",
          server_id: "filesystem",
        }),
      );

    await mcpService.addServer(SAMPLE_CONFIG);
    await mcpService.updateServer("filesystem", {
      ...SAMPLE_CONFIG,
      request_timeout_ms: 60000,
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:9562/api/v1/mcp/servers",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(SAMPLE_CONFIG),
      }),
    );

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:9562/api/v1/mcp/servers/filesystem",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("fetches server-scoped tools and global tools", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          tools: [
            {
              alias: "mcp__filesystem__read_file",
              server_id: "filesystem",
              original_name: "read_file",
              description: "Read file contents",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({
          tools: [],
        }),
      );

    const serverTools = await mcpService.getTools("filesystem");
    const globalTools = await mcpService.getTools();

    expect(serverTools).toHaveLength(1);
    expect(serverTools[0].alias).toBe("mcp__filesystem__read_file");
    expect(serverTools[0].server_id).toBe("filesystem");
    expect(serverTools[0].original_name).toBe("read_file");
    expect(globalTools).toEqual([]);

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:9562/api/v1/mcp/servers/filesystem/tools",
      expect.objectContaining({ method: "GET" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:9562/api/v1/mcp/tools",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("normalizes MCP-style tool payloads (name + inputSchema)", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        tools: [
          {
            name: "read_file",
            description: "Read file contents",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        ],
      }),
    );

    const tools = await mcpService.getTools("filesystem");

    expect(tools).toHaveLength(1);
    expect(tools[0].server_id).toBe("filesystem");
    expect(tools[0].original_name).toBe("read_file");
    expect(tools[0].alias).toBe("mcp__filesystem__read_file");
    expect(tools[0].parameters).toEqual(
      expect.objectContaining({
        type: "object",
        required: ["path"],
      }),
    );
  });

  it("deletes a server", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        message: "Server deleted",
        server_id: "filesystem",
      }),
    );

    await mcpService.deleteServer("filesystem");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9562/api/v1/mcp/servers/filesystem",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("connects a server", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        message: "Server connected",
        server_id: "filesystem",
      }),
    );

    await mcpService.connectServer("filesystem");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9562/api/v1/mcp/servers/filesystem/connect",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("disconnects a server", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        message: "Server disconnected",
        server_id: "filesystem",
      }),
    );

    await mcpService.disconnectServer("filesystem");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9562/api/v1/mcp/servers/filesystem/disconnect",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("refreshes tools for a server", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        message: "Tools refreshed",
        server_id: "filesystem",
      }),
    );

    await mcpService.refreshTools("filesystem");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9562/api/v1/mcp/servers/filesystem/refresh",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("imports servers with merge mode", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        message: "Servers imported",
        servers_added: 2,
        servers_updated: 1,
      }),
    );

    const payload = {
      mcpServers: {
        server1: { command: "node", args: ["server1.js"] },
        server2: { command: "node", args: ["server2.js"] },
      },
      mode: "merge" as const,
    };

    const result = await mcpService.importServers(payload);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9562/api/v1/mcp/servers/import",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    expect(result.servers_added).toBe(2);
    expect(result.servers_updated).toBe(1);
  });

  it("imports servers with replace mode", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        message: "Servers replaced",
        servers_added: 3,
      }),
    );

    const payload = {
      mcpServers: {
        server1: { command: "node", args: ["server1.js"] },
      },
      mode: "replace" as const,
    };

    const result = await mcpService.importServers(payload);

    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9562/api/v1/mcp/servers/import",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(payload),
      }),
    );
    expect(result.servers_added).toBe(3);
  });

  it("handles empty server list", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        servers: [],
      }),
    );

    const servers = await mcpService.getServers();

    expect(servers).toEqual([]);
  });

  it("handles empty tools list", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        tools: null,
      }),
    );

    const tools = await mcpService.getTools("filesystem");

    expect(tools).toEqual([]);
  });

  it("normalizes tool with alternative field names", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        tools: [
          {
            serverId: "filesystem",
            originalName: "write_file",
            description: "Write file contents",
          },
        ],
      }),
    );

    const tools = await mcpService.getTools("filesystem");

    expect(tools).toHaveLength(1);
    expect(tools[0].server_id).toBe("filesystem");
    expect(tools[0].original_name).toBe("write_file");
  });
});
