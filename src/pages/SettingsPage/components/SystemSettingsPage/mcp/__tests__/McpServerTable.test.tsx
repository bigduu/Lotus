import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ServerStatus, type McpServer } from "@services/mcp";
import { McpServerTable } from "../McpServerTable";

const stoppedServer: McpServer = {
  id: "offline",
  name: "Offline server",
  enabled: false,
  config: {
    id: "offline",
    name: "Offline server",
    enabled: false,
    transport: {
      type: "stdio",
      command: "npx",
      args: ["server"],
      env: {},
    },
    request_timeout_ms: 60_000,
    healthcheck_interval_ms: 30_000,
    allowed_tools: [],
    denied_tools: [],
  },
  runtime: {
    status: ServerStatus.Stopped,
    tool_count: 0,
    restart_count: 0,
  },
};

describe("McpServerTable", () => {
  it("keeps connect available but disables tool refresh for stopped servers", () => {
    render(
      <McpServerTable
        servers={[stoppedServer]}
        onConnectServer={vi.fn()}
        onRefreshTools={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Connect" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Refresh Tools" })).toBeDisabled();
  });
});
