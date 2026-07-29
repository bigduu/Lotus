import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ConfigConflictError,
  type ConfigSectionEnvelope,
  type McpSection,
} from "@services/config/configSections";
import {
  ServerStatus,
  type McpServer,
  type McpServerConfig,
  type McpToolInfo,
} from "@services/mcp/types";

const storeMocks = vi.hoisted(() => ({
  loadSection: vi.fn(),
  saveMcpSettings: vi.fn(),
  snapshot: {
    envelope: null as ConfigSectionEnvelope<McpSection> | null,
    loading: false,
    error: null,
    conflict: null,
    requestId: 0,
  },
}));

vi.mock("@shared/store/configSectionStore", () => ({
  useConfigSectionStore: (selector: (state: unknown) => unknown) =>
    selector({
      sections: { mcp: storeMocks.snapshot },
      loadSection: storeMocks.loadSection,
      saveMcpSettings: storeMocks.saveMcpSettings,
    }),
}));

import { useMcpSettings } from "../useMcpSettings";

const stdioConfig = (
  id: string,
  env: Record<string, string> = {},
  overrides: Partial<McpServerConfig> = {},
): McpServerConfig => ({
  id,
  name: id,
  enabled: true,
  transport: {
    type: "stdio",
    command: "npx",
    args: ["server"],
    env,
  },
  request_timeout_ms: 60_000,
  healthcheck_interval_ms: 30_000,
  allowed_tools: [],
  denied_tools: [],
  ...overrides,
});

const sseConfig = (
  id: string,
  headers: Array<{ name: string; value: string }>,
): McpServerConfig => ({
  id,
  name: id,
  enabled: true,
  transport: {
    type: "sse",
    url: "https://mcp.example/sse",
    headers,
  },
  request_timeout_ms: 60_000,
  healthcheck_interval_ms: 30_000,
  allowed_tools: [],
  denied_tools: [],
});

const streamableHttpConfig = (
  id: string,
  headers: Array<{ name: string; value: string }>,
): McpServerConfig => ({
  id,
  name: id,
  enabled: true,
  transport: {
    type: "streamable_http",
    url: "https://mcp.example/mcp",
    headers,
    connect_timeout_ms: 24_000,
  },
  request_timeout_ms: 60_000,
  healthcheck_interval_ms: 30_000,
  allowed_tools: [],
  denied_tools: [],
});

const sectionEnvelope = (
  servers: McpServerConfig[],
  revision = 7,
  credentialStatus: McpSection["credential_status"] = {},
): ConfigSectionEnvelope<McpSection> => ({
  data: {
    version: 1,
    servers,
    credential_status: credentialStatus,
  },
  revision,
  loaded_at: "2026-07-26T00:00:00Z",
  source_path: "/tmp/mcp.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const runtimeServer = (id: string): McpServer => ({
  id,
  name: id,
  enabled: true,
  // Deliberately poisonous legacy config: the hook must never adopt it.
  config: stdioConfig(id, { TOKEN: "****...****" }),
  runtime: {
    status: ServerStatus.Ready,
    tool_count: 2,
    restart_count: 0,
  },
});

const runtimeService = (servers: McpServer[] = [runtimeServer("filesystem")]) => ({
  getServers: vi.fn().mockResolvedValue(servers),
  connectServer: vi.fn().mockResolvedValue(undefined),
  disconnectServer: vi.fn().mockResolvedValue(undefined),
  refreshTools: vi.fn().mockResolvedValue(undefined),
  getTools: vi.fn().mockResolvedValue([]),
});

const toolListFor = (serverId: string, description: string): McpToolInfo[] => [
  {
    alias: `mcp__${serverId}__read_file`,
    server_id: serverId,
    original_name: "read_file",
    description,
  },
];

const toolList = (description: string): McpToolInfo[] => toolListFor("filesystem", description);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const configuredStatus = (kind: "env" | "headers", name: string, source = "user") => ({
  filesystem: {
    env:
      kind === "env"
        ? {
            [name]: { configured: true, source, updated_at: null },
          }
        : {},
    headers:
      kind === "headers"
        ? {
            [name]: { configured: true, source, updated_at: null },
          }
        : {},
  },
});

describe("useMcpSettings canonical config controller", () => {
  beforeEach(() => {
    storeMocks.loadSection.mockReset();
    storeMocks.saveMcpSettings.mockReset();
    storeMocks.snapshot.envelope = null;
    storeMocks.snapshot.loading = false;
    storeMocks.snapshot.error = null;
  });

  const renderWithSection = (
    envelope: ConfigSectionEnvelope<McpSection>,
    service = runtimeService(),
  ) => {
    storeMocks.loadSection.mockResolvedValue(envelope);
    storeMocks.saveMcpSettings.mockImplementation(async (data: McpSection) =>
      sectionEnvelope(data.servers, envelope.revision + 1, data.credential_status),
    );
    return {
      service,
      ...renderHook(() => useMcpSettings({ service })),
    };
  };

  it("uses canonical secret-free config and only merges runtime status by id", async () => {
    const originalRuntimeError = "runtime failed with api_key=CANONICAL_SENTINEL_36";
    const canonical = sectionEnvelope(
      [stdioConfig("filesystem", { TOKEN: "" })],
      7,
      configuredStatus("env", "TOKEN"),
    );
    const runtime = {
      ...runtimeServer("filesystem"),
      runtime: {
        status: ServerStatus.Error,
        last_error: originalRuntimeError,
        tool_count: 0,
        restart_count: 1,
      },
    };
    const { result, service } = renderWithSection(canonical, runtimeService([runtime]));

    await waitFor(() => expect(result.current.servers).toHaveLength(1));

    expect(result.current.servers[0]?.config.transport).toMatchObject({
      type: "stdio",
      env: { TOKEN: "" },
    });
    expect(JSON.stringify(result.current.servers[0]?.config)).not.toContain("****...****");
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Error);
    expect(result.current.servers[0]?.runtime?.last_error).toBe(
      "MCP runtime error details are hidden.",
    );
    expect(JSON.stringify(result.current.servers)).not.toContain(originalRuntimeError);
    expect(result.current.configRevision).toBe(7);
    expect(service).not.toHaveProperty("addServer");
    expect(storeMocks.loadSection).toHaveBeenCalledWith("mcp", { force: true });
  });

  it.each([
    {
      name: "stdio env",
      config: stdioConfig("filesystem", { TOKEN: "" }),
      status: configuredStatus("env", "TOKEN"),
    },
    {
      name: "SSE header",
      config: sseConfig("filesystem", [{ name: "Authorization", value: "" }]),
      status: configuredStatus("headers", "Authorization", "environment"),
    },
    {
      name: "Streamable HTTP header",
      config: streamableHttpConfig("filesystem", [{ name: "Authorization", value: "" }]),
      status: configuredStatus("headers", "Authorization"),
    },
  ])(
    "preserves configured $name credentials during metadata-only edits",
    async ({ config, status }) => {
      const canonical = sectionEnvelope([config], 7, status);
      const { result } = renderWithSection(canonical);
      await waitFor(() => expect(result.current.servers).toHaveLength(1));

      await act(async () => {
        await result.current.updateServer("filesystem", { ...config, name: "renamed" }, 7);
      });

      expect(storeMocks.saveMcpSettings).toHaveBeenCalledTimes(1);
      const [data, changes, expectedRevision] = storeMocks.saveMcpSettings.mock.calls[0]!;
      expect(expectedRevision).toBe(7);
      expect(changes).toEqual({});
      expect(data.servers[0]?.name).toBe("renamed");
      expect(JSON.stringify(data)).not.toContain("****");
    },
  );

  it("moves a replacement secret into credential_changes and scrubs candidate data", async () => {
    const canonical = sectionEnvelope(
      [stdioConfig("filesystem", { TOKEN: "" })],
      7,
      configuredStatus("env", "TOKEN"),
    );
    const { result } = renderWithSection(canonical);
    await waitFor(() => expect(result.current.servers).toHaveLength(1));

    await act(async () => {
      await result.current.updateServer(
        "filesystem",
        stdioConfig("filesystem", { TOKEN: "new-secret" }),
        7,
      );
    });

    const [data, changes] = storeMocks.saveMcpSettings.mock.calls[0]!;
    expect(changes).toEqual({
      servers: { filesystem: { env: { TOKEN: "new-secret" } } },
    });
    expect(data.servers[0]?.transport).toMatchObject({
      type: "stdio",
      env: { TOKEN: "" },
    });
    expect(JSON.stringify(data)).not.toContain("new-secret");
  });

  it("uses explicit null when a configured credential row is removed", async () => {
    const canonical = sectionEnvelope(
      [stdioConfig("filesystem", { TOKEN: "" })],
      7,
      configuredStatus("env", "TOKEN"),
    );
    const { result } = renderWithSection(canonical);
    await waitFor(() => expect(result.current.servers).toHaveLength(1));

    await act(async () => {
      await result.current.updateServer("filesystem", stdioConfig("filesystem"), 7);
    });

    expect(storeMocks.saveMcpSettings.mock.calls[0]?.[1]).toEqual({
      servers: { filesystem: { env: { TOKEN: null } } },
    });
  });

  it("clears prior refs on transport change", async () => {
    const canonical = sectionEnvelope(
      [stdioConfig("filesystem", { TOKEN: "" })],
      7,
      configuredStatus("env", "TOKEN"),
    );
    const { result } = renderWithSection(canonical);
    await waitFor(() => expect(result.current.servers).toHaveLength(1));

    await act(async () => {
      await result.current.updateServer(
        "filesystem",
        sseConfig("filesystem", [{ name: "Authorization", value: "replacement" }]),
        7,
      );
    });
    expect(storeMocks.saveMcpSettings.mock.calls[0]?.[1]).toEqual({
      servers: {
        filesystem: {
          env: { TOKEN: null },
          headers: { Authorization: "replacement" },
        },
      },
    });
  });

  it("clears all configured refs when deleting a server", async () => {
    const canonical = sectionEnvelope(
      [stdioConfig("filesystem", { TOKEN: "" })],
      7,
      configuredStatus("env", "TOKEN"),
    );
    const { result } = renderWithSection(canonical);
    await waitFor(() => expect(result.current.servers).toHaveLength(1));

    await act(async () => {
      await result.current.deleteServer("filesystem");
    });
    expect(storeMocks.saveMcpSettings.mock.calls[0]?.[1]).toEqual({
      servers: {
        filesystem: {
          env: { TOKEN: null },
        },
      },
    });
  });

  it("imports through one canonical CAS and never sends import secrets in section data", async () => {
    const canonical = sectionEnvelope(
      [stdioConfig("filesystem", { OLD_TOKEN: "" })],
      7,
      configuredStatus("env", "OLD_TOKEN"),
    );
    const { result } = renderWithSection(canonical);
    await waitFor(() => expect(result.current.servers).toHaveLength(1));

    let response!: Awaited<ReturnType<typeof result.current.importServers>>;
    await act(async () => {
      response = await result.current.importServers(
        {
          remote: {
            command: "npx",
            args: ["remote"],
            env: { API_TOKEN: "import-secret" },
          },
        },
        "replace",
      );
    });

    expect(storeMocks.saveMcpSettings).toHaveBeenCalledTimes(1);
    const [data, changes, expectedRevision] = storeMocks.saveMcpSettings.mock.calls[0]!;
    expect(expectedRevision).toBe(7);
    expect(data.servers).toHaveLength(1);
    expect(data.servers[0]?.transport).toMatchObject({
      type: "stdio",
      env: { API_TOKEN: "" },
    });
    expect(JSON.stringify(data)).not.toContain("import-secret");
    expect(changes).toEqual({
      servers: {
        filesystem: { env: { OLD_TOKEN: null } },
        remote: { env: { API_TOKEN: "import-secret" } },
      },
    });
    expect(response).toMatchObject({ added: 1, updated: 0, removed: 1, server_ids: ["remote"] });
  });

  it("imports mainstream Streamable HTTP without losing transport kind, URL, or timeout", async () => {
    const canonical = sectionEnvelope([], 7);
    const { result } = renderWithSection(canonical);
    await waitFor(() => expect(result.current.configRevision).toBe(7));

    await act(async () => {
      await result.current.importServers(
        {
          remote: {
            url: "https://mcp.example/mcp",
            transport_kind: "streamable_http",
            headers: { Authorization: "import-secret" },
            connect_timeout_ms: 24_000,
          },
        },
        "replace",
      );
    });

    const [data, changes, expectedRevision] = storeMocks.saveMcpSettings.mock.calls[0]!;
    expect(expectedRevision).toBe(7);
    expect(data.servers[0]?.transport).toEqual({
      type: "streamable_http",
      url: "https://mcp.example/mcp",
      headers: [{ name: "Authorization", value: "" }],
      connect_timeout_ms: 24_000,
    });
    expect(changes).toEqual({
      servers: {
        remote: { headers: { Authorization: "import-secret" } },
      },
    });
    expect(JSON.stringify(data)).not.toContain("import-secret");
  });

  it("rejects mask-like values before the store write", async () => {
    const canonical = sectionEnvelope(
      [stdioConfig("filesystem", { TOKEN: "" })],
      7,
      configuredStatus("env", "TOKEN"),
    );
    const { result } = renderWithSection(canonical);
    await waitFor(() => expect(result.current.servers).toHaveLength(1));

    await act(async () => {
      await expect(
        result.current.updateServer(
          "filesystem",
          stdioConfig("filesystem", { TOKEN: "****...****" }),
          7,
        ),
      ).rejects.toThrow("Masked MCP credential placeholders");
    });
    expect(storeMocks.saveMcpSettings).not.toHaveBeenCalled();
  });

  it("rejects truncated all-star-and-dot mask variants before the store write", async () => {
    const canonical = sectionEnvelope(
      [stdioConfig("filesystem", { TOKEN: "" })],
      7,
      configuredStatus("env", "TOKEN"),
    );
    const { result } = renderWithSection(canonical);
    await waitFor(() => expect(result.current.servers).toHaveLength(1));

    await act(async () => {
      await expect(
        result.current.updateServer(
          "filesystem",
          stdioConfig("filesystem", { TOKEN: "  ***..***  " }),
          7,
        ),
      ).rejects.toThrow("Masked MCP credential placeholders");
    });
    expect(storeMocks.saveMcpSettings).not.toHaveBeenCalled();
  });

  it("still renders canonical config when runtime status loading fails", async () => {
    const service = runtimeService();
    service.getServers.mockRejectedValueOnce(new Error("runtime status offline"));
    const { result } = renderWithSection(
      sectionEnvelope([stdioConfig("filesystem", { TOKEN: "" })]),
      service,
    );

    await waitFor(() => expect(result.current.servers).toHaveLength(1));
    expect(result.current.servers[0]?.id).toBe("filesystem");
    expect(result.current.servers[0]?.runtime).toBeUndefined();
    expect(result.current.error).toBe("runtime status offline");
    expect(service.getTools).not.toHaveBeenCalled();
  });

  it("renders sanitized runtime servers and tools read-only when typed config fails", async () => {
    const service = runtimeService();
    const tools: McpToolInfo[] = [
      {
        alias: "mcp__filesystem__read_file",
        server_id: "filesystem",
        original_name: "read_file",
        description: "Read file contents",
      },
    ];
    service.getTools.mockResolvedValue(tools);
    storeMocks.loadSection.mockRejectedValue(
      new Error("typed MCP settings require the modular configuration facade"),
    );

    const { result } = renderHook(() => useMcpSettings({ service }));

    await waitFor(() => expect(result.current.servers).toHaveLength(1));
    expect(result.current.configAvailable).toBe(false);
    expect(result.current.configRevision).toBeNull();
    expect(result.current.configError).toBe(
      "typed MCP settings require the modular configuration facade",
    );
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Ready);
    expect(result.current.servers[0]?.config.transport).toMatchObject({
      type: "stdio",
      env: { TOKEN: "" },
    });
    expect(JSON.stringify(result.current.servers)).not.toContain("****...****");
    await waitFor(() => expect(result.current.selectedServerTools).toEqual(tools));

    await act(async () => {
      await expect(result.current.addServer(stdioConfig("new-server"))).rejects.toThrow(
        "runtime data is read-only",
      );
    });
    await act(async () => {
      await expect(
        result.current.updateServer("filesystem", stdioConfig("filesystem"), 7),
      ).rejects.toThrow("runtime data is read-only");
    });
    await act(async () => {
      await expect(result.current.deleteServer("filesystem")).rejects.toThrow(
        "runtime data is read-only",
      );
    });
    await act(async () => {
      await expect(
        result.current.importServers({ remote: { command: "npx", args: ["remote"] } }, "merge"),
      ).rejects.toThrow("runtime data is read-only");
    });
    expect(storeMocks.saveMcpSettings).not.toHaveBeenCalled();
  });

  it("removes every credential-shaped runtime fallback field before serialization", async () => {
    const secret = "SENTINEL_RUNTIME_SECRET_36";
    const originalRuntimeError = `Authorization failed with bearer ${secret}`;
    const service = runtimeService([
      {
        id: "remote",
        name: "remote",
        enabled: true,
        config: {
          ...sseConfig("remote", [{ name: "Authorization", value: secret }]),
          transport: {
            type: "sse",
            url: `https://${secret}:${secret}@mcp.example/sse?token=${secret}#${secret}`,
            headers: [{ name: "Authorization", value: secret }],
          },
        },
        runtime: {
          status: ServerStatus.Error,
          last_error: originalRuntimeError,
          tool_count: 0,
          restart_count: 1,
        },
      },
      {
        id: "invalid-url",
        name: "invalid-url",
        enabled: true,
        config: {
          ...streamableHttpConfig("invalid-url", [{ name: "X-Token", value: secret }]),
          transport: {
            type: "streamable_http",
            url: `not-a-url-${secret}`,
            headers: [{ name: "X-Token", value: secret }],
          },
        },
        runtime: {
          status: ServerStatus.Error,
          last_error: originalRuntimeError,
          tool_count: 0,
          restart_count: 1,
        },
      },
      {
        ...runtimeServer("stdio"),
        config: stdioConfig("stdio", { TOKEN: secret }),
        runtime: {
          status: ServerStatus.Error,
          last_error: originalRuntimeError,
          tool_count: 0,
          restart_count: 1,
        },
      },
    ]);
    storeMocks.loadSection.mockRejectedValue(new Error("typed config offline"));

    const { result } = renderHook(() => useMcpSettings({ service }));

    await waitFor(() => expect(result.current.servers).toHaveLength(3));
    const serialized = JSON.stringify(result.current.servers);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(originalRuntimeError);
    expect(result.current.servers[0]?.config.transport).toMatchObject({
      type: "sse",
      url: "https://mcp.example/sse",
      headers: [{ name: "Authorization", value: "" }],
    });
    expect(result.current.servers[0]?.runtime?.last_error).toBe(
      "MCP runtime error details are hidden.",
    );
    expect(result.current.servers[1]?.config.transport).toMatchObject({
      type: "streamable_http",
      url: "",
      headers: [{ name: "X-Token", value: "" }],
    });
    expect(result.current.servers[2]?.config.transport).toMatchObject({
      type: "stdio",
      env: { TOKEN: "" },
    });
  });

  it("keeps runtime actions decoupled from unavailable typed config", async () => {
    const service = runtimeService();
    storeMocks.loadSection.mockRejectedValue(new Error("typed config offline"));
    const { result } = renderHook(() => useMcpSettings({ service }));

    await waitFor(() => expect(result.current.servers).toHaveLength(1));
    await act(async () => {
      await expect(result.current.connectServer("filesystem")).resolves.toBeUndefined();
    });

    expect(service.connectServer).toHaveBeenCalledWith("filesystem");
    expect(service.getServers).toHaveBeenCalledTimes(2);
    expect(storeMocks.loadSection).toHaveBeenCalledTimes(1);
    expect(result.current.configAvailable).toBe(false);
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Ready);
  });

  it("adopts a committed canonical save even when the runtime status refresh fails", async () => {
    const canonical = sectionEnvelope([stdioConfig("filesystem")]);
    const service = runtimeService();
    service.getServers
      .mockResolvedValueOnce([runtimeServer("filesystem")])
      .mockRejectedValueOnce(new Error("runtime refresh offline"));
    const { result } = renderWithSection(canonical, service);
    await waitFor(() => expect(result.current.servers).toHaveLength(1));

    await act(async () => {
      await expect(
        result.current.updateServer(
          "filesystem",
          {
            ...stdioConfig("filesystem"),
            name: "saved-name",
          },
          7,
        ),
      ).resolves.toBeUndefined();
    });

    expect(storeMocks.saveMcpSettings).toHaveBeenCalledTimes(1);
    expect(result.current.servers[0]?.name).toBe("saved-name");
    expect(result.current.error).toBe("runtime refresh offline");
  });

  it("surfaces a stale CAS conflict without falling back to legacy CRUD", async () => {
    const canonical = sectionEnvelope([stdioConfig("filesystem")]);
    const conflict = new ConfigConflictError({
      expectedRevision: 7,
      currentRevision: 8,
      message: "Configuration revision conflict",
    });
    const { result } = renderWithSection(canonical);
    storeMocks.saveMcpSettings.mockRejectedValue(conflict);
    await waitFor(() => expect(result.current.servers).toHaveLength(1));

    await act(async () => {
      await expect(
        result.current.updateServer(
          "filesystem",
          {
            ...stdioConfig("filesystem"),
            name: "stale",
          },
          7,
        ),
      ).rejects.toBe(conflict);
    });
    expect(result.current.error).toBe("Configuration revision conflict");
    expect(storeMocks.saveMcpSettings.mock.calls[0]?.[2]).toBe(7);
  });

  it("uses the edit's captured revision after the canonical snapshot advances", async () => {
    const canonical = sectionEnvelope([stdioConfig("filesystem")], 7);
    const conflict = new ConfigConflictError({
      expectedRevision: 7,
      currentRevision: 8,
      message: "Configuration revision conflict",
    });
    const { result, rerender } = renderWithSection(canonical);
    await waitFor(() => expect(result.current.configRevision).toBe(7));

    storeMocks.snapshot.envelope = sectionEnvelope(
      [{ ...stdioConfig("filesystem"), name: "remote-name" }],
      8,
    );
    rerender();
    await waitFor(() => {
      expect(result.current.configRevision).toBe(8);
      expect(result.current.servers[0]?.name).toBe("remote-name");
    });

    storeMocks.saveMcpSettings.mockRejectedValueOnce(conflict);
    await act(async () => {
      await expect(
        result.current.updateServer(
          "filesystem",
          { ...stdioConfig("filesystem"), name: "local-name" },
          7,
        ),
      ).rejects.toBe(conflict);
    });

    expect(storeMocks.saveMcpSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        servers: [expect.objectContaining({ id: "filesystem", name: "local-name" })],
      }),
      {},
      7,
    );
  });

  it("keeps runtime tool loading on the runtime-only service", async () => {
    const tools: McpToolInfo[] = [
      {
        alias: "mcp__filesystem__read_file",
        server_id: "filesystem",
        original_name: "read_file",
        description: "Read file contents",
      },
    ];
    const service = runtimeService();
    service.getTools.mockResolvedValue(tools);
    const { result } = renderWithSection(sectionEnvelope([stdioConfig("filesystem")]), service);

    await waitFor(() => expect(result.current.selectedServerId).toBe("filesystem"));
    await waitFor(() => expect(result.current.selectedServerTools).toEqual(tools));
    expect(service.getTools).toHaveBeenCalledWith("filesystem");
  });

  it("does not query or refresh tools for a stopped server", async () => {
    const config = stdioConfig("offline", {}, { enabled: false });
    const stoppedServer: McpServer = {
      ...runtimeServer("offline"),
      enabled: false,
      config,
      runtime: {
        status: ServerStatus.Stopped,
        tool_count: 0,
        restart_count: 0,
      },
    };
    const service = runtimeService([stoppedServer]);
    service.getTools.mockRejectedValue(new Error("Server 'offline' not found"));
    const { result } = renderWithSection(sectionEnvelope([config]), service);

    await waitFor(() => expect(result.current.selectedServerId).toBe("offline"));
    await waitFor(() =>
      expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped),
    );
    expect(result.current.selectedServerTools).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(service.getTools).not.toHaveBeenCalled();

    service.refreshTools.mockClear();
    await act(async () => {
      await result.current.refreshAll();
      await result.current.refreshServerTools("offline");
    });

    expect(service.refreshTools).not.toHaveBeenCalled();
    expect(service.getTools).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });

  it("does not let an older refresh overwrite tools loaded by a newer reconnect", async () => {
    const staleRefresh = deferred<unknown>();
    const service = runtimeService();
    service.getTools.mockResolvedValueOnce(toolList("cached"));
    const { result } = renderWithSection(sectionEnvelope([stdioConfig("filesystem")]), service);

    await waitFor(() => expect(result.current.selectedServerTools).toEqual(toolList("cached")));
    service.refreshTools.mockReturnValueOnce(staleRefresh.promise);

    let staleRefreshPromise!: Promise<void>;
    act(() => {
      staleRefreshPromise = result.current.refreshServerTools("filesystem");
    });
    await waitFor(() => expect(service.refreshTools).toHaveBeenCalledTimes(1));

    service.getServers.mockResolvedValueOnce([runtimeServer("filesystem")]);
    service.getTools.mockResolvedValueOnce(toolList("reconnected"));
    await act(async () => {
      await result.current.connectServer("filesystem");
    });

    expect(result.current.selectedServerTools).toEqual(toolList("reconnected"));
    expect(service.getTools).toHaveBeenCalledTimes(2);

    await act(async () => {
      staleRefresh.resolve(undefined);
      await staleRefreshPromise;
    });

    expect(service.getTools).toHaveBeenCalledTimes(2);
    expect(result.current.selectedServerTools).toEqual(toolList("reconnected"));
    expect(result.current.error).toBeNull();
  });

  it("suppresses an older refresh failure after an Error-to-Ready reconnect", async () => {
    const staleRefresh = deferred<unknown>();
    const erroredServer: McpServer = {
      ...runtimeServer("filesystem"),
      runtime: {
        status: ServerStatus.Error,
        tool_count: 0,
        restart_count: 1,
      },
    };
    const service = runtimeService([erroredServer]);
    service.getTools.mockResolvedValueOnce(toolList("cached"));
    const { result } = renderWithSection(sectionEnvelope([stdioConfig("filesystem")]), service);

    await waitFor(() => expect(result.current.selectedServerTools).toEqual(toolList("cached")));
    service.refreshTools.mockReturnValueOnce(staleRefresh.promise);

    let staleRefreshPromise!: Promise<void>;
    act(() => {
      staleRefreshPromise = result.current.refreshServerTools("filesystem");
    });
    await waitFor(() => expect(service.refreshTools).toHaveBeenCalledTimes(1));

    service.getServers.mockResolvedValueOnce([runtimeServer("filesystem")]);
    service.getTools.mockResolvedValueOnce(toolList("ready"));
    await act(async () => {
      await result.current.connectServer("filesystem");
    });

    await act(async () => {
      staleRefresh.reject(new Error("stale refresh failed"));
      await staleRefreshPromise;
    });

    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Ready);
    expect(result.current.selectedServerTools).toEqual(toolList("ready"));
    expect(result.current.error).toBeNull();
  });

  it("clears a failed reconnect error and reloads tools after the next reconnect succeeds", async () => {
    const erroredServer: McpServer = {
      ...runtimeServer("filesystem"),
      runtime: {
        status: ServerStatus.Error,
        tool_count: 0,
        restart_count: 1,
      },
    };
    const service = runtimeService([erroredServer]);
    service.getTools.mockResolvedValueOnce(toolList("before-reconnect"));
    service.connectServer
      .mockRejectedValueOnce(new Error("connect failed"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderWithSection(sectionEnvelope([stdioConfig("filesystem")]), service);

    await waitFor(() =>
      expect(result.current.selectedServerTools).toEqual(toolList("before-reconnect")),
    );
    await act(async () => {
      await expect(result.current.connectServer("filesystem")).rejects.toThrow("connect failed");
    });
    expect(result.current.error).toBe("connect failed");
    expect(result.current.selectedServerTools).toEqual(toolList("before-reconnect"));

    service.getServers.mockResolvedValueOnce([runtimeServer("filesystem")]);
    service.getTools.mockResolvedValueOnce(toolList("after-reconnect"));
    await act(async () => {
      await result.current.connectServer("filesystem");
    });

    expect(result.current.error).toBeNull();
    expect(result.current.selectedServerTools).toEqual(toolList("after-reconnect"));
    expect(service.getTools).toHaveBeenCalledTimes(2);
  });

  it("lets Refresh All immediately supersede a pending per-server refresh", async () => {
    const staleRefresh = deferred<unknown>();
    const service = runtimeService();
    service.getTools.mockResolvedValueOnce(toolList("cached"));
    const { result } = renderWithSection(sectionEnvelope([stdioConfig("filesystem")]), service);

    await waitFor(() => expect(result.current.selectedServerTools).toEqual(toolList("cached")));
    service.refreshTools.mockReturnValueOnce(staleRefresh.promise).mockResolvedValueOnce(undefined);

    let staleRefreshPromise!: Promise<void>;
    act(() => {
      staleRefreshPromise = result.current.refreshServerTools("filesystem");
    });
    await waitFor(() => expect(service.refreshTools).toHaveBeenCalledTimes(1));

    service.getTools.mockResolvedValueOnce(toolList("refresh-all"));
    await act(async () => {
      await result.current.refreshAll();
    });
    expect(result.current.selectedServerTools).toEqual(toolList("refresh-all"));

    await act(async () => {
      staleRefresh.reject(new Error("stale refresh failed"));
      await staleRefreshPromise;
    });

    expect(result.current.selectedServerTools).toEqual(toolList("refresh-all"));
    expect(result.current.error).toBeNull();
  });

  it("keeps the refresh action loader owned by the newest overlapping refresh", async () => {
    const firstRefresh = deferred<unknown>();
    const secondRefresh = deferred<unknown>();
    const service = runtimeService();
    service.getTools.mockResolvedValueOnce(toolList("cached"));
    const { result } = renderWithSection(sectionEnvelope([stdioConfig("filesystem")]), service);

    await waitFor(() => expect(result.current.selectedServerTools).toEqual(toolList("cached")));
    service.refreshTools
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise);

    let firstPromise!: Promise<void>;
    act(() => {
      firstPromise = result.current.refreshServerTools("filesystem");
    });
    await waitFor(() => expect(service.refreshTools).toHaveBeenCalledTimes(1));

    let secondPromise!: Promise<void>;
    act(() => {
      secondPromise = result.current.refreshServerTools("filesystem");
    });
    await waitFor(() => expect(service.refreshTools).toHaveBeenCalledTimes(2));

    await act(async () => {
      firstRefresh.resolve(undefined);
      await firstPromise;
    });
    expect(result.current.isServerActionLoading("filesystem", "refresh")).toBe(true);

    service.getTools.mockResolvedValueOnce(toolList("current"));
    await act(async () => {
      secondRefresh.resolve(undefined);
      await secondPromise;
    });

    expect(result.current.isServerActionLoading("filesystem", "refresh")).toBe(false);
    expect(result.current.selectedServerTools).toEqual(toolList("current"));
  });

  it("does not let an older refresh on one server supersede a newer connect runtime lane", async () => {
    const alpha = runtimeServer("alpha");
    const betaStopped: McpServer = {
      ...runtimeServer("beta"),
      runtime: {
        status: ServerStatus.Stopped,
        tool_count: 0,
        restart_count: 0,
      },
    };
    const betaReady = runtimeServer("beta");
    const staleRefresh = deferred<unknown>();
    const connectRuntime = deferred<McpServer[]>();
    const service = runtimeService([alpha, betaStopped]);
    service.getTools
      .mockResolvedValueOnce(toolListFor("alpha", "alpha-cached"))
      .mockResolvedValueOnce(toolListFor("beta", "beta-connected"));
    const { result } = renderWithSection(
      sectionEnvelope([stdioConfig("alpha"), stdioConfig("beta")]),
      service,
    );

    await waitFor(() =>
      expect(result.current.selectedServerTools).toEqual(toolListFor("alpha", "alpha-cached")),
    );
    service.refreshTools.mockReturnValueOnce(staleRefresh.promise);

    let staleRefreshPromise!: Promise<void>;
    act(() => {
      staleRefreshPromise = result.current.refreshServerTools("alpha");
    });
    await waitFor(() => expect(service.refreshTools).toHaveBeenCalledWith("alpha"));

    service.getServers.mockReturnValueOnce(connectRuntime.promise);
    let connectPromise!: Promise<void>;
    act(() => {
      connectPromise = result.current.connectServer("beta");
    });
    await waitFor(() => expect(service.getServers).toHaveBeenCalledTimes(2));

    await act(async () => {
      staleRefresh.resolve(undefined);
      await staleRefreshPromise;
    });
    expect(service.getServers).toHaveBeenCalledTimes(2);
    expect(service.getTools).toHaveBeenCalledTimes(1);

    await act(async () => {
      connectRuntime.resolve([alpha, betaReady]);
      await connectPromise;
    });

    expect(result.current.servers.find((server) => server.id === "beta")?.runtime?.status).toBe(
      ServerStatus.Ready,
    );
    expect(service.getTools).toHaveBeenLastCalledWith("beta");
    expect(result.current.error).toBeNull();
  });

  it("does not let an older Refresh All supersede a newer connect runtime lane", async () => {
    const alpha = runtimeServer("alpha");
    const betaStopped: McpServer = {
      ...runtimeServer("beta"),
      runtime: {
        status: ServerStatus.Stopped,
        tool_count: 0,
        restart_count: 0,
      },
    };
    const betaReady = runtimeServer("beta");
    const staleRefreshAll = deferred<unknown>();
    const connectRuntime = deferred<McpServer[]>();
    const service = runtimeService([alpha, betaStopped]);
    service.getTools
      .mockResolvedValueOnce(toolListFor("alpha", "alpha-cached"))
      .mockResolvedValueOnce(toolListFor("beta", "beta-connected"));
    const { result } = renderWithSection(
      sectionEnvelope([stdioConfig("alpha"), stdioConfig("beta")]),
      service,
    );

    await waitFor(() =>
      expect(result.current.selectedServerTools).toEqual(toolListFor("alpha", "alpha-cached")),
    );
    service.refreshTools.mockReturnValueOnce(staleRefreshAll.promise);

    let staleRefreshAllPromise!: Promise<void>;
    act(() => {
      staleRefreshAllPromise = result.current.refreshAll();
    });
    await waitFor(() => expect(service.refreshTools).toHaveBeenCalledWith("alpha"));

    service.getServers.mockReturnValueOnce(connectRuntime.promise);
    let connectPromise!: Promise<void>;
    act(() => {
      connectPromise = result.current.connectServer("beta");
    });
    await waitFor(() => expect(service.getServers).toHaveBeenCalledTimes(2));

    await act(async () => {
      staleRefreshAll.resolve(undefined);
      await staleRefreshAllPromise;
    });
    expect(service.getServers).toHaveBeenCalledTimes(2);
    expect(service.getTools).toHaveBeenCalledTimes(1);

    await act(async () => {
      connectRuntime.resolve([alpha, betaReady]);
      await connectPromise;
    });

    expect(result.current.servers.find((server) => server.id === "beta")?.runtime?.status).toBe(
      ServerStatus.Ready,
    );
    expect(service.getTools).toHaveBeenLastCalledWith("beta");
    expect(result.current.error).toBeNull();
  });

  it("ignores an in-flight runtime response as soon as a newer action starts", async () => {
    const alpha = runtimeServer("alpha");
    const betaStopped: McpServer = {
      ...runtimeServer("beta"),
      runtime: {
        status: ServerStatus.Stopped,
        tool_count: 0,
        restart_count: 0,
      },
    };
    const betaReady = runtimeServer("beta");
    const staleRuntime = deferred<McpServer[]>();
    const connectStart = deferred<unknown>();
    const service = runtimeService([alpha, betaStopped]);
    service.getTools.mockResolvedValueOnce(toolListFor("alpha", "alpha-cached"));
    const { result } = renderWithSection(
      sectionEnvelope([stdioConfig("alpha"), stdioConfig("beta")]),
      service,
    );

    await waitFor(() =>
      expect(result.current.selectedServerTools).toEqual(toolListFor("alpha", "alpha-cached")),
    );
    service.getServers
      .mockReturnValueOnce(staleRuntime.promise)
      .mockResolvedValueOnce([alpha, betaReady]);
    service.getTools
      .mockResolvedValueOnce(toolListFor("alpha", "alpha-refreshed"))
      .mockResolvedValueOnce(toolListFor("beta", "beta-connected"));

    let staleRefreshPromise!: Promise<void>;
    act(() => {
      staleRefreshPromise = result.current.refreshServerTools("alpha");
    });
    await waitFor(() => expect(service.getServers).toHaveBeenCalledTimes(2));

    service.connectServer.mockReturnValueOnce(connectStart.promise);
    let connectPromise!: Promise<void>;
    act(() => {
      connectPromise = result.current.connectServer("beta");
    });
    await waitFor(() => expect(service.connectServer).toHaveBeenCalledWith("beta"));

    await act(async () => {
      staleRuntime.resolve([
        {
          ...alpha,
          runtime: {
            status: ServerStatus.Error,
            tool_count: 0,
            restart_count: 9,
          },
        },
        betaStopped,
      ]);
      await staleRefreshPromise;
    });
    expect(result.current.servers.find((server) => server.id === "alpha")?.runtime?.status).toBe(
      ServerStatus.Ready,
    );

    await act(async () => {
      connectStart.resolve(undefined);
      await connectPromise;
    });

    expect(result.current.servers.find((server) => server.id === "beta")?.runtime?.status).toBe(
      ServerStatus.Ready,
    );
    expect(service.getTools).toHaveBeenLastCalledWith("beta");
    expect(result.current.error).toBeNull();
  });

  it("keeps a newer tool response when an older request completes afterward", async () => {
    const staleTools = deferred<McpToolInfo[]>();
    const currentTools = deferred<McpToolInfo[]>();
    const service = runtimeService();
    service.getTools
      .mockReturnValueOnce(staleTools.promise)
      .mockReturnValueOnce(currentTools.promise);
    const { result } = renderWithSection(sectionEnvelope([stdioConfig("filesystem")]), service);

    await waitFor(() => expect(service.getTools).toHaveBeenCalledTimes(1));
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshServerTools("filesystem");
    });
    await waitFor(() => expect(service.getTools).toHaveBeenCalledTimes(2));

    await act(async () => {
      currentTools.resolve(toolList("current"));
      await currentTools.promise;
      await refreshPromise;
    });
    expect(result.current.selectedServerTools).toEqual(toolList("current"));

    await act(async () => {
      staleTools.resolve(toolList("stale"));
      await staleTools.promise;
    });
    expect(result.current.selectedServerTools).toEqual(toolList("current"));
    expect(result.current.error).toBeNull();
  });

  it("ignores an older tool rejection after a newer request succeeds", async () => {
    const staleTools = deferred<McpToolInfo[]>();
    const currentTools = deferred<McpToolInfo[]>();
    const service = runtimeService();
    service.getTools
      .mockReturnValueOnce(staleTools.promise)
      .mockReturnValueOnce(currentTools.promise);
    const { result } = renderWithSection(sectionEnvelope([stdioConfig("filesystem")]), service);

    await waitFor(() => expect(service.getTools).toHaveBeenCalledTimes(1));
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshServerTools("filesystem");
    });
    await waitFor(() => expect(service.getTools).toHaveBeenCalledTimes(2));

    await act(async () => {
      currentTools.resolve(toolList("current"));
      await currentTools.promise;
      await refreshPromise;
    });
    await act(async () => {
      staleTools.reject(new Error("stale Server not found"));
      await staleTools.promise.catch(() => undefined);
    });

    expect(result.current.selectedServerTools).toEqual(toolList("current"));
    expect(result.current.error).toBeNull();
  });

  it("does not let an older tool completion clear the newer request loader", async () => {
    const staleTools = deferred<McpToolInfo[]>();
    const currentTools = deferred<McpToolInfo[]>();
    const service = runtimeService();
    service.getTools
      .mockReturnValueOnce(staleTools.promise)
      .mockReturnValueOnce(currentTools.promise);
    const { result } = renderWithSection(sectionEnvelope([stdioConfig("filesystem")]), service);

    await waitFor(() => expect(result.current.isSelectedServerToolsLoading).toBe(true));
    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshServerTools("filesystem");
    });
    await waitFor(() => expect(service.getTools).toHaveBeenCalledTimes(2));

    await act(async () => {
      staleTools.resolve(toolList("stale"));
      await staleTools.promise;
    });
    expect(result.current.isSelectedServerToolsLoading).toBe(true);

    await act(async () => {
      currentTools.resolve(toolList("current"));
      await currentTools.promise;
      await refreshPromise;
    });
    expect(result.current.isSelectedServerToolsLoading).toBe(false);
    expect(result.current.selectedServerTools).toEqual(toolList("current"));
  });

  it("clears tool errors, cached tools, and pending ownership when runtime stops", async () => {
    const service = runtimeService();
    service.getTools.mockResolvedValueOnce(toolList("cached"));
    const { result } = renderWithSection(sectionEnvelope([stdioConfig("filesystem")]), service);

    await waitFor(() => expect(result.current.selectedServerTools).toEqual(toolList("cached")));
    service.getTools.mockRejectedValueOnce(new Error("Server 'filesystem' not found"));
    await act(async () => {
      await expect(result.current.refreshServerTools("filesystem")).rejects.toThrow(
        "Server 'filesystem' not found",
      );
    });
    expect(result.current.error).toBe("Server 'filesystem' not found");

    service.getServers.mockResolvedValueOnce([
      {
        ...runtimeServer("filesystem"),
        runtime: {
          status: ServerStatus.Stopped,
          tool_count: 0,
          restart_count: 1,
        },
      },
    ]);
    await act(async () => {
      await result.current.disconnectServer("filesystem");
    });

    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);
    expect(result.current.selectedServerTools).toEqual([]);
    expect(result.current.isSelectedServerToolsLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(service.getTools).toHaveBeenCalledTimes(2);
  });

  it("keeps server loading active until fast runtime and slow config both settle", async () => {
    const slowConfig = deferred<ConfigSectionEnvelope<McpSection>>();
    storeMocks.loadSection.mockReturnValue(slowConfig.promise);
    const service = runtimeService();
    const { result } = renderHook(() => useMcpSettings({ service }));

    await waitFor(() => {
      expect(service.getServers).toHaveBeenCalledTimes(1);
      expect(result.current.servers).toHaveLength(1);
    });
    expect(result.current.isLoadingServers).toBe(true);

    await act(async () => {
      slowConfig.resolve(sectionEnvelope([stdioConfig("filesystem")]));
      await slowConfig.promise;
    });

    await waitFor(() => expect(result.current.isLoadingServers).toBe(false));
    expect(result.current.configRevision).toBe(7);
  });

  it("does not let an older refresh completion clear the current generation loader", async () => {
    const initial = sectionEnvelope([stdioConfig("filesystem")], 7);
    storeMocks.loadSection.mockResolvedValueOnce(initial);
    const service = runtimeService();
    const { result } = renderHook(() => useMcpSettings({ service }));
    await waitFor(() => expect(result.current.configRevision).toBe(7));

    const staleRuntime = deferred<McpServer[]>();
    const staleConfig = deferred<ConfigSectionEnvelope<McpSection>>();
    const currentRuntime = deferred<McpServer[]>();
    const currentConfig = deferred<ConfigSectionEnvelope<McpSection>>();
    service.getServers
      .mockReturnValueOnce(staleRuntime.promise)
      .mockReturnValueOnce(currentRuntime.promise);
    storeMocks.loadSection
      .mockReturnValueOnce(staleConfig.promise)
      .mockReturnValueOnce(currentConfig.promise);

    let staleRefresh!: Promise<void>;
    act(() => {
      staleRefresh = result.current.refreshServers();
    });
    await waitFor(() => expect(service.getServers).toHaveBeenCalledTimes(2));

    let currentRefresh!: Promise<void>;
    act(() => {
      currentRefresh = result.current.refreshServers();
    });
    await waitFor(() => expect(service.getServers).toHaveBeenCalledTimes(3));
    expect(result.current.isLoadingServers).toBe(true);

    await act(async () => {
      staleRuntime.resolve([runtimeServer("stale")]);
      staleConfig.resolve(sectionEnvelope([stdioConfig("stale")], 8));
      await staleRefresh;
    });
    expect(result.current.isLoadingServers).toBe(true);

    await act(async () => {
      currentRuntime.resolve([runtimeServer("current")]);
      await currentRuntime.promise;
    });
    expect(result.current.isLoadingServers).toBe(true);

    await act(async () => {
      currentConfig.resolve(sectionEnvelope([stdioConfig("current")], 9));
      await currentRefresh;
    });
    expect(result.current.isLoadingServers).toBe(false);
    expect(result.current.configRevision).toBe(9);
    expect(result.current.servers[0]?.id).toBe("current");
  });

  it("lets a silent refresh supersede a hanging loader without stale early completion", async () => {
    storeMocks.loadSection.mockResolvedValueOnce(sectionEnvelope([stdioConfig("filesystem")], 7));
    const service = runtimeService();
    const { result } = renderHook(() => useMcpSettings({ service }));
    await waitFor(() => expect(result.current.configRevision).toBe(7));

    const staleRuntime = deferred<McpServer[]>();
    const staleConfig = deferred<ConfigSectionEnvelope<McpSection>>();
    const silentRuntime = deferred<McpServer[]>();
    const silentConfig = deferred<ConfigSectionEnvelope<McpSection>>();
    service.getServers
      .mockReturnValueOnce(staleRuntime.promise)
      .mockReturnValueOnce(silentRuntime.promise);
    storeMocks.loadSection
      .mockReturnValueOnce(staleConfig.promise)
      .mockReturnValueOnce(silentConfig.promise);

    let staleRefresh!: Promise<void>;
    act(() => {
      staleRefresh = result.current.refreshServers();
    });
    await waitFor(() => expect(result.current.isLoadingServers).toBe(true));

    let silentRefresh!: Promise<void>;
    act(() => {
      silentRefresh = result.current.refreshServers({ silent: true });
    });
    await waitFor(() => expect(service.getServers).toHaveBeenCalledTimes(3));

    await act(async () => {
      staleRuntime.resolve([runtimeServer("stale")]);
      staleConfig.resolve(sectionEnvelope([stdioConfig("stale")], 8));
      await staleRefresh;
    });
    expect(result.current.isLoadingServers).toBe(true);

    await act(async () => {
      silentRuntime.resolve([runtimeServer("silent")]);
      await silentRuntime.promise;
    });
    expect(result.current.isLoadingServers).toBe(true);

    await act(async () => {
      silentConfig.resolve(sectionEnvelope([stdioConfig("silent")], 9));
      await silentRefresh;
    });
    expect(result.current.isLoadingServers).toBe(false);
    expect(result.current.servers[0]?.id).toBe("silent");
  });

  it("lets an action runtime refresh take loading ownership while preserving pending config", async () => {
    storeMocks.loadSection.mockResolvedValueOnce(sectionEnvelope([stdioConfig("filesystem")], 7));
    const service = runtimeService();
    const { result } = renderHook(() => useMcpSettings({ service }));
    await waitFor(() => expect(result.current.configRevision).toBe(7));

    const staleRuntime = deferred<McpServer[]>();
    const pendingConfig = deferred<ConfigSectionEnvelope<McpSection>>();
    service.getServers.mockReturnValueOnce(staleRuntime.promise).mockResolvedValueOnce([
      {
        ...runtimeServer("filesystem"),
        runtime: {
          status: ServerStatus.Stopped,
          tool_count: 0,
          restart_count: 1,
        },
      },
    ]);
    storeMocks.loadSection.mockReturnValueOnce(pendingConfig.promise);

    let staleRefresh!: Promise<void>;
    act(() => {
      staleRefresh = result.current.refreshServers();
    });
    await waitFor(() => expect(result.current.isLoadingServers).toBe(true));

    await act(async () => {
      await result.current.connectServer("filesystem");
    });

    expect(result.current.isLoadingServers).toBe(false);
    expect(result.current.configAvailable).toBe(false);
    expect(result.current.configRevision).toBe(7);
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);

    await act(async () => {
      staleRuntime.resolve([
        {
          ...runtimeServer("filesystem"),
          runtime: {
            status: ServerStatus.Error,
            tool_count: 0,
            restart_count: 9,
          },
        },
      ]);
      pendingConfig.resolve(
        sectionEnvelope([{ ...stdioConfig("filesystem"), name: "current-config" }], 8),
      );
      await staleRefresh;
    });

    expect(result.current.isLoadingServers).toBe(false);
    expect(result.current.configAvailable).toBe(true);
    expect(result.current.configRevision).toBe(8);
    expect(result.current.servers[0]?.name).toBe("current-config");
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);
  });

  it("lets a committed save runtime refresh take ownership from a hanging full refresh", async () => {
    const revisionSeven = sectionEnvelope([stdioConfig("filesystem")], 7);
    storeMocks.loadSection.mockResolvedValueOnce(revisionSeven);
    const service = runtimeService();
    const { result } = renderHook(() => useMcpSettings({ service }));
    await waitFor(() => expect(result.current.configRevision).toBe(7));

    const saveResult = deferred<ConfigSectionEnvelope<McpSection>>();
    const staleRuntime = deferred<McpServer[]>();
    const staleConfig = deferred<ConfigSectionEnvelope<McpSection>>();
    storeMocks.saveMcpSettings.mockReturnValueOnce(saveResult.promise);
    service.getServers.mockReturnValueOnce(staleRuntime.promise).mockResolvedValueOnce([
      {
        ...runtimeServer("filesystem"),
        runtime: {
          status: ServerStatus.Stopped,
          tool_count: 0,
          restart_count: 1,
        },
      },
    ]);
    storeMocks.loadSection.mockReturnValueOnce(staleConfig.promise);

    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.updateServer(
        "filesystem",
        { ...stdioConfig("filesystem"), name: "saved-config" },
        7,
      );
    });
    await waitFor(() => expect(storeMocks.saveMcpSettings).toHaveBeenCalledTimes(1));

    let staleRefresh!: Promise<void>;
    act(() => {
      staleRefresh = result.current.refreshServers();
    });
    await waitFor(() => expect(result.current.isLoadingServers).toBe(true));

    await act(async () => {
      saveResult.resolve(
        sectionEnvelope([{ ...stdioConfig("filesystem"), name: "saved-config" }], 8),
      );
      await savePromise;
    });

    expect(result.current.isLoadingServers).toBe(false);
    expect(result.current.configAvailable).toBe(true);
    expect(result.current.configRevision).toBe(8);
    expect(result.current.servers[0]?.name).toBe("saved-config");
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);

    await act(async () => {
      staleRuntime.resolve([
        {
          ...runtimeServer("filesystem"),
          runtime: {
            status: ServerStatus.Error,
            tool_count: 0,
            restart_count: 9,
          },
        },
      ]);
      staleConfig.resolve(
        sectionEnvelope([{ ...stdioConfig("filesystem"), name: "stale-config" }], 9),
      );
      await staleRefresh;
    });

    expect(result.current.isLoadingServers).toBe(false);
    expect(result.current.configRevision).toBe(8);
    expect(result.current.servers[0]?.name).toBe("saved-config");
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);
  });

  it("lets a newer store snapshot runtime refresh take ownership from a hanging full refresh", async () => {
    storeMocks.loadSection.mockResolvedValueOnce(sectionEnvelope([stdioConfig("filesystem")], 7));
    const service = runtimeService();
    const { result, rerender } = renderHook(() => useMcpSettings({ service }));
    await waitFor(() => expect(result.current.configRevision).toBe(7));

    const staleRuntime = deferred<McpServer[]>();
    const staleConfig = deferred<ConfigSectionEnvelope<McpSection>>();
    service.getServers.mockReturnValueOnce(staleRuntime.promise).mockResolvedValueOnce([
      {
        ...runtimeServer("filesystem"),
        runtime: {
          status: ServerStatus.Stopped,
          tool_count: 0,
          restart_count: 1,
        },
      },
    ]);
    storeMocks.loadSection.mockReturnValueOnce(staleConfig.promise);

    let staleRefresh!: Promise<void>;
    act(() => {
      staleRefresh = result.current.refreshServers();
    });
    await waitFor(() => expect(result.current.isLoadingServers).toBe(true));

    storeMocks.snapshot.envelope = sectionEnvelope(
      [{ ...stdioConfig("filesystem"), name: "store-config" }],
      8,
    );
    rerender();
    await waitFor(() => {
      expect(result.current.isLoadingServers).toBe(false);
      expect(result.current.configRevision).toBe(8);
      expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);
    });

    await act(async () => {
      staleRuntime.resolve([
        {
          ...runtimeServer("filesystem"),
          runtime: {
            status: ServerStatus.Error,
            tool_count: 0,
            restart_count: 9,
          },
        },
      ]);
      staleConfig.resolve(
        sectionEnvelope([{ ...stdioConfig("filesystem"), name: "stale-config" }], 9),
      );
      await staleRefresh;
    });

    expect(result.current.isLoadingServers).toBe(false);
    expect(result.current.configRevision).toBe(8);
    expect(result.current.servers[0]?.name).toBe("store-config");
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);
  });

  it("ignores an older runtime success without clearing a newer refresh loading state", async () => {
    const staleRuntime = deferred<McpServer[]>();
    const currentRuntime = deferred<McpServer[]>();
    const revisionSeven = sectionEnvelope([stdioConfig("filesystem")], 7);
    const revisionEight = sectionEnvelope(
      [{ ...stdioConfig("filesystem"), name: "current-config" }],
      8,
    );
    storeMocks.loadSection
      .mockResolvedValueOnce(revisionSeven)
      .mockResolvedValueOnce(revisionEight);
    const service = runtimeService();
    service.getServers
      .mockResolvedValueOnce([runtimeServer("filesystem")])
      .mockReturnValueOnce(staleRuntime.promise)
      .mockReturnValueOnce(currentRuntime.promise);
    const { result } = renderHook(() => useMcpSettings({ service }));
    await waitFor(() => expect(result.current.configRevision).toBe(7));

    let connectPromise!: Promise<void>;
    act(() => {
      connectPromise = result.current.connectServer("filesystem");
    });
    await waitFor(() => expect(service.getServers).toHaveBeenCalledTimes(2));

    let refreshPromise!: Promise<void>;
    act(() => {
      refreshPromise = result.current.refreshServers();
    });
    await waitFor(() => {
      expect(service.getServers).toHaveBeenCalledTimes(3);
      expect(result.current.configRevision).toBe(8);
      expect(result.current.isLoadingServers).toBe(true);
    });

    await act(async () => {
      staleRuntime.resolve([
        {
          ...runtimeServer("filesystem"),
          runtime: {
            status: ServerStatus.Error,
            tool_count: 0,
            restart_count: 9,
          },
        },
      ]);
      await connectPromise;
    });

    expect(result.current.configRevision).toBe(8);
    expect(result.current.servers[0]?.name).toBe("current-config");
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Ready);
    expect(result.current.isLoadingServers).toBe(true);

    await act(async () => {
      currentRuntime.resolve([
        {
          ...runtimeServer("filesystem"),
          runtime: {
            status: ServerStatus.Stopped,
            tool_count: 0,
            restart_count: 1,
          },
        },
      ]);
      await refreshPromise;
    });

    expect(result.current.servers[0]?.name).toBe("current-config");
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);
    expect(result.current.isLoadingServers).toBe(false);
    expect(result.current.runtimeError).toBeNull();
  });

  it("ignores a stale store runtime failure after a newer refresh succeeds", async () => {
    const staleStoreRuntime = deferred<McpServer[]>();
    const revisionSeven = sectionEnvelope([stdioConfig("filesystem")], 7);
    const revisionEight = sectionEnvelope(
      [{ ...stdioConfig("filesystem"), name: "store-config" }],
      8,
    );
    const revisionNine = sectionEnvelope(
      [{ ...stdioConfig("filesystem"), name: "latest-config" }],
      9,
    );
    storeMocks.loadSection.mockResolvedValueOnce(revisionSeven).mockResolvedValueOnce(revisionNine);
    const service = runtimeService();
    service.getServers
      .mockResolvedValueOnce([runtimeServer("filesystem")])
      .mockReturnValueOnce(staleStoreRuntime.promise)
      .mockResolvedValueOnce([
        {
          ...runtimeServer("filesystem"),
          runtime: {
            status: ServerStatus.Stopped,
            tool_count: 0,
            restart_count: 0,
          },
        },
      ]);
    const { result, rerender } = renderHook(() => useMcpSettings({ service }));
    await waitFor(() => expect(result.current.configRevision).toBe(7));

    storeMocks.snapshot.envelope = revisionEight;
    rerender();
    await waitFor(() => {
      expect(result.current.configRevision).toBe(8);
      expect(service.getServers).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      await result.current.refreshServers();
    });
    await waitFor(() => {
      expect(result.current.configRevision).toBe(9);
      expect(result.current.servers[0]?.name).toBe("latest-config");
      expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);
    });

    await act(async () => {
      staleStoreRuntime.reject(new Error("stale store runtime failed"));
      await staleStoreRuntime.promise.catch(() => undefined);
    });

    expect(result.current.configRevision).toBe(9);
    expect(result.current.servers[0]?.name).toBe("latest-config");
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);
    expect(result.current.runtimeError).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("ignores a stale post-save runtime response after a newer refresh succeeds", async () => {
    const staleSavedRuntime = deferred<McpServer[]>();
    const revisionSeven = sectionEnvelope([stdioConfig("filesystem")], 7);
    const revisionEight = sectionEnvelope(
      [{ ...stdioConfig("filesystem"), name: "saved-config" }],
      8,
    );
    const revisionNine = sectionEnvelope(
      [{ ...stdioConfig("filesystem"), name: "latest-config" }],
      9,
    );
    storeMocks.loadSection.mockResolvedValueOnce(revisionSeven).mockResolvedValueOnce(revisionNine);
    storeMocks.saveMcpSettings.mockResolvedValue(revisionEight);
    const service = runtimeService();
    service.getServers
      .mockResolvedValueOnce([runtimeServer("filesystem")])
      .mockReturnValueOnce(staleSavedRuntime.promise)
      .mockResolvedValueOnce([
        {
          ...runtimeServer("filesystem"),
          runtime: {
            status: ServerStatus.Stopped,
            tool_count: 0,
            restart_count: 0,
          },
        },
      ]);
    const { result } = renderHook(() => useMcpSettings({ service }));
    await waitFor(() => expect(result.current.configRevision).toBe(7));

    let savePromise!: Promise<void>;
    act(() => {
      savePromise = result.current.updateServer(
        "filesystem",
        { ...stdioConfig("filesystem"), name: "saved-config" },
        7,
      );
    });
    await waitFor(() => {
      expect(result.current.configRevision).toBe(8);
      expect(service.getServers).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      await result.current.refreshServers();
    });
    await waitFor(() => {
      expect(result.current.configRevision).toBe(9);
      expect(result.current.servers[0]?.name).toBe("latest-config");
      expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);
    });

    await act(async () => {
      staleSavedRuntime.resolve([
        {
          ...runtimeServer("filesystem"),
          runtime: {
            status: ServerStatus.Error,
            tool_count: 0,
            restart_count: 11,
          },
        },
      ]);
      await savePromise;
    });

    expect(result.current.configRevision).toBe(9);
    expect(result.current.servers[0]?.name).toBe("latest-config");
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Stopped);
    expect(result.current.runtimeError).toBeNull();
  });
});
