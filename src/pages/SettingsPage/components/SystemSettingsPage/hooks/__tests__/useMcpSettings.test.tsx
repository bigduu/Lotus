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
    const canonical = sectionEnvelope(
      [stdioConfig("filesystem", { TOKEN: "" })],
      7,
      configuredStatus("env", "TOKEN"),
    );
    const { result, service } = renderWithSection(canonical);

    await waitFor(() => expect(result.current.servers).toHaveLength(1));

    expect(result.current.servers[0]?.config.transport).toMatchObject({
      type: "stdio",
      env: { TOKEN: "" },
    });
    expect(JSON.stringify(result.current.servers[0]?.config)).not.toContain("****...****");
    expect(result.current.servers[0]?.runtime?.status).toBe(ServerStatus.Ready);
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
  ])(
    "preserves configured $name credentials during metadata-only edits",
    async ({ config, status }) => {
      const canonical = sectionEnvelope([config], 7, status);
      const { result } = renderWithSection(canonical);
      await waitFor(() => expect(result.current.servers).toHaveLength(1));

      await act(async () => {
        await result.current.updateServer("filesystem", { ...config, name: "renamed" });
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
      await result.current.updateServer("filesystem", stdioConfig("filesystem"));
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
        result.current.updateServer("filesystem", {
          ...stdioConfig("filesystem"),
          name: "saved-name",
        }),
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
        result.current.updateServer("filesystem", {
          ...stdioConfig("filesystem"),
          name: "stale",
        }),
      ).rejects.toBe(conflict);
    });
    expect(result.current.error).toBe("Configuration revision conflict");
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
});
