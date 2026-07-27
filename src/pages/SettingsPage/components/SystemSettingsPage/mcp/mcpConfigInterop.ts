import type { McpServer } from "@services/mcp";

export type MainstreamMcpServersChunk = {
  mcpServers: Record<string, unknown>;
};

export const toMainstreamMcpServersChunk = (servers: McpServer[]): MainstreamMcpServersChunk => {
  const mcpServers: Record<string, unknown> = {};

  for (const server of servers) {
    const id = server.id?.trim();
    if (!id) continue;

    const enabled = server.enabled ?? server.config.enabled;
    const disabled = !enabled;

    const transport = server.config.transport;
    if (transport.type === "sse" || transport.type === "streamable_http") {
      const headers: Record<string, string> = {};
      for (const header of transport.headers ?? []) {
        const name = header.name?.trim();
        if (!name) continue;
        headers[name] = header.value ?? "";
      }

      const entry: Record<string, unknown> = {
        url: transport.url,
      };
      if (disabled) entry.disabled = true;
      if (transport.type === "streamable_http") {
        entry.transport_kind = "streamable_http";
      }
      if (transport.connect_timeout_ms !== undefined) {
        entry.connect_timeout_ms = transport.connect_timeout_ms;
      }
      if (Object.keys(headers).length) entry.headers = headers;
      mcpServers[id] = entry;
      continue;
    }

    const entry: Record<string, unknown> = {
      command: transport.command,
    };
    if (disabled) entry.disabled = true;
    if (transport.args?.length) entry.args = transport.args;
    if (transport.cwd) entry.cwd = transport.cwd;
    if (transport.env && Object.keys(transport.env).length) entry.env = transport.env;
    mcpServers[id] = entry;
  }

  return { mcpServers };
};
