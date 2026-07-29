import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ServerStatus, type McpServer } from "@services/mcp";
import SystemSettingsMcpTab from "../SystemSettingsMcpTab";
import { toMainstreamMcpServersChunk } from "../mcp/mcpConfigInterop";

const mocks = vi.hoisted(() => ({
  importServers: vi.fn(),
  legacyImportServers: vi.fn(),
  updateServer: vi.fn(),
  hookResult: {} as Record<string, unknown>,
}));

vi.mock("@services/mcp", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@services/mcp")>();
  return {
    ...actual,
    mcpService: {
      ...actual.mcpService,
      importServers: mocks.legacyImportServers,
    },
  };
});

vi.mock("../hooks/useMcpSettings", () => ({
  useMcpSettings: () => mocks.hookResult,
}));

vi.mock("../mcp/McpServerTable", () => ({
  McpServerTable: ({
    servers,
    onEditServer,
    configReadOnly,
  }: {
    servers: McpServer[];
    onEditServer: (server: McpServer) => void;
    configReadOnly?: boolean;
  }) => (
    <div>
      <span>{servers[0]?.name}</span>
      <button type="button" disabled={configReadOnly} onClick={() => onEditServer(servers[0]!)}>
        Edit first server
      </button>
      <button type="button" disabled={configReadOnly}>
        Delete first server
      </button>
    </div>
  ),
}));

vi.mock("../mcp/McpToolList", () => ({
  McpToolList: () => <div>MCP tools</div>,
}));

const server = (name: string): McpServer => ({
  id: "filesystem",
  name,
  enabled: true,
  config: {
    id: "filesystem",
    name,
    enabled: true,
    transport: {
      type: "stdio",
      command: "npx",
      args: ["server"],
      env: { TOKEN: "" },
    },
    request_timeout_ms: 60_000,
    healthcheck_interval_ms: 30_000,
    allowed_tools: [],
    denied_tools: [],
  },
  runtime: {
    status: ServerStatus.Ready,
    tool_count: 1,
    restart_count: 0,
  },
});

const resetHookResult = () => {
  mocks.hookResult = {
    servers: [server("Base server")],
    credentialStatusByServer: {
      filesystem: {
        env: {
          TOKEN: {
            configured: true,
            source: "user",
            updated_at: null,
          },
        },
        headers: {},
      },
    },
    configRevision: 7,
    selectedServerId: "filesystem",
    selectedServerTools: [],
    isLoadingServers: false,
    isMutatingConfig: false,
    isRefreshingAll: false,
    isSelectedServerToolsLoading: false,
    configAvailable: true,
    configError: null,
    runtimeError: null,
    error: null,
    setSelectedServerId: vi.fn(),
    addServer: vi.fn(),
    updateServer: mocks.updateServer,
    deleteServer: vi.fn(),
    importServers: mocks.importServers,
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    refreshServerTools: vi.fn(),
    refreshAll: vi.fn(),
    isServerActionLoading: vi.fn().mockReturnValue(false),
  };
};

const renderTab = () =>
  render(
    <AntdApp>
      <SystemSettingsMcpTab />
    </AntdApp>,
  );

describe("SystemSettingsMcpTab canonical MCP writes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHookResult();
    mocks.importServers.mockResolvedValue({
      message: "MCP servers imported",
      mode: "merge",
      added: 1,
      updated: 0,
      removed: 0,
      server_ids: ["remote"],
      start_errors: [],
    });
    mocks.updateServer.mockResolvedValue(undefined);
  });

  it("imports through the hook's one canonical CAS and never calls legacy import", async () => {
    renderTab();

    fireEvent.click(screen.getByRole("button", { name: /Import$/ }));
    await screen.findByText("Import MCP Servers");
    const textarea = screen.getByPlaceholderText(
      '{"mcpServers": { "filesystem": { "command": "...", "args": [], "env": {} } }}',
    );
    fireEvent.change(textarea, {
      target: {
        value: JSON.stringify({
          mcpServers: {
            remote: {
              command: "npx",
              args: ["remote"],
              env: { TOKEN: "replacement" },
            },
          },
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await waitFor(() =>
      expect(mocks.importServers).toHaveBeenCalledWith(
        {
          remote: {
            command: "npx",
            args: ["remote"],
            env: { TOKEN: "replacement" },
          },
        },
        "merge",
      ),
    );
    expect(mocks.importServers).toHaveBeenCalledTimes(1);
    expect(mocks.legacyImportServers).not.toHaveBeenCalled();
    expect(mocks.hookResult.refreshAll).not.toHaveBeenCalled();
  });

  it("exports Streamable HTTP with its wire discriminator, URL, headers, and timeout", () => {
    const httpServer: McpServer = {
      ...server("Remote HTTP"),
      id: "remote-http",
      config: {
        ...server("Remote HTTP").config,
        id: "remote-http",
        transport: {
          type: "streamable_http",
          url: "https://mcp.example.test/mcp",
          headers: [{ name: "Authorization", value: "" }],
          connect_timeout_ms: 24_000,
        },
      },
    };

    expect(toMainstreamMcpServersChunk([httpServer])).toEqual({
      mcpServers: {
        "remote-http": {
          url: "https://mcp.example.test/mcp",
          transport_kind: "streamable_http",
          headers: { Authorization: "" },
          connect_timeout_ms: 24_000,
        },
      },
    });
  });

  it("submits an open edit against its captured revision after a newer snapshot arrives", async () => {
    const view = renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Edit first server" }));

    const nameInput = (await screen.findByPlaceholderText("Filesystem MCP")) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Local draft" } });

    mocks.hookResult.configRevision = 8;
    mocks.hookResult.servers = [server("Remote server")];
    view.rerender(
      <AntdApp>
        <SystemSettingsMcpTab />
      </AntdApp>,
    );

    expect(await screen.findByText("MCP settings changed externally")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.updateServer).toHaveBeenCalledWith(
        "filesystem",
        expect.objectContaining({ id: "filesystem", name: "Local draft" }),
        7,
      ),
    );
  });

  it("keeps runtime data visible while typed-config mutations are disabled", () => {
    mocks.hookResult.configAvailable = false;
    mocks.hookResult.configError = "typed MCP settings require the modular configuration facade";
    mocks.hookResult.error = mocks.hookResult.configError;

    renderTab();

    expect(screen.getByText("Base server")).toBeInTheDocument();
    expect(screen.getByText("MCP tools")).toBeInTheDocument();
    expect(
      screen.getByText(
        "MCP configuration is unavailable. Runtime servers and tools remain visible in read-only mode.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("typed MCP settings require the modular configuration facade"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Server" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Import$/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Edit first server" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Delete first server" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Refresh All$/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Export$/ })).toBeEnabled();
  });

  it("disables Save when an open edit becomes read-only", async () => {
    const view = renderTab();
    fireEvent.click(screen.getByRole("button", { name: "Edit first server" }));
    await screen.findByPlaceholderText("Filesystem MCP");

    mocks.hookResult.configAvailable = false;
    mocks.hookResult.configError = "typed config offline";
    mocks.hookResult.error = "typed config offline";
    view.rerender(
      <AntdApp>
        <SystemSettingsMcpTab />
      </AntdApp>,
    );

    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(mocks.updateServer).not.toHaveBeenCalled();
  });

  it("disables Import confirmation when an open import becomes read-only", async () => {
    const view = renderTab();
    fireEvent.click(screen.getByRole("button", { name: /Import$/ }));
    await screen.findByText("Import MCP Servers");

    mocks.hookResult.configAvailable = false;
    mocks.hookResult.configError = "typed config offline";
    mocks.hookResult.error = "typed config offline";
    view.rerender(
      <AntdApp>
        <SystemSettingsMcpTab />
      </AntdApp>,
    );

    const importButtons = screen.getAllByRole("button", { name: /Import$/ });
    expect(importButtons.length).toBeGreaterThanOrEqual(2);
    importButtons.forEach((button) => expect(button).toBeDisabled());
    expect(mocks.importServers).not.toHaveBeenCalled();
  });
});
