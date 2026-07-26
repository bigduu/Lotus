import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createDefaultMcpServerConfig,
  mcpService,
  type HeaderConfig,
  type McpImportResponse,
  type McpServer,
  type McpServerConfig,
  type McpToolInfo,
} from "@services/mcp";
import type {
  ConfigSectionEnvelope,
  McpCredentialChanges,
  McpSection,
  McpServerCredentialStatus,
} from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";

export type McpServerAction = "connect" | "disconnect" | "refresh" | "delete";

type McpRuntimeServer = Pick<McpServer, "id" | "runtime">;

interface McpRuntimeService {
  getServers: () => Promise<McpRuntimeServer[]>;
  connectServer: (serverId: string) => Promise<unknown>;
  disconnectServer: (serverId: string) => Promise<unknown>;
  refreshTools: (serverId: string) => Promise<unknown>;
  getTools: (serverId?: string) => Promise<McpToolInfo[]>;
}

interface UseMcpSettingsOptions {
  service?: McpRuntimeService;
}

interface UseMcpSettingsResult {
  servers: McpServer[];
  credentialStatusByServer: Record<string, McpServerCredentialStatus>;
  selectedServerId: string | null;
  selectedServerTools: McpToolInfo[];
  isLoadingServers: boolean;
  isMutatingConfig: boolean;
  isRefreshingAll: boolean;
  isSelectedServerToolsLoading: boolean;
  error: string | null;
  setSelectedServerId: (serverId: string | null) => void;
  refreshServers: (options?: { silent?: boolean }) => Promise<void>;
  addServer: (config: McpServerConfig) => Promise<void>;
  updateServer: (serverId: string, config: McpServerConfig) => Promise<void>;
  deleteServer: (serverId: string) => Promise<void>;
  importServers: (
    servers: Record<string, unknown>,
    mode: "merge" | "replace",
  ) => Promise<McpImportResponse>;
  connectServer: (serverId: string) => Promise<void>;
  disconnectServer: (serverId: string) => Promise<void>;
  refreshServerTools: (serverId: string) => Promise<void>;
  refreshAll: () => Promise<void>;
  isServerActionLoading: (serverId: string, action: McpServerAction) => boolean;
}

interface PreparedMcpMutation {
  data: McpSection;
  credentialChanges: McpCredentialChanges;
}

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const getActionKey = (serverId: string, action: McpServerAction): string => `${serverId}:${action}`;

const assertNotMaskedSecret = (value: string): void => {
  const trimmed = value.trim();
  if (trimmed && [...trimmed].every((character) => character === "*" || character === ".")) {
    throw new Error(
      "Masked MCP credential placeholders cannot be saved. Enter a replacement value.",
    );
  }
};

const cloneServerConfig = (server: McpServerConfig): McpServerConfig => ({
  ...server,
  transport:
    server.transport.type === "stdio"
      ? {
          ...server.transport,
          args: [...server.transport.args],
          env: { ...server.transport.env },
        }
      : {
          ...server.transport,
          headers: server.transport.headers.map((header) => ({ ...header })),
        },
  reconnect: server.reconnect ? { ...server.reconnect } : undefined,
  allowed_tools: [...server.allowed_tools],
  denied_tools: [...server.denied_tools],
});

const serverSecretValues = (
  server: McpServerConfig | undefined,
): {
  env: Record<string, string>;
  headers: Record<string, string>;
} => {
  if (!server) return { env: {}, headers: {} };
  if (server.transport.type === "stdio") {
    return { env: server.transport.env, headers: {} };
  }
  return {
    env: {},
    headers: Object.fromEntries(
      server.transport.headers.map((header) => [header.name, header.value]),
    ),
  };
};

const appendCredentialChanges = (
  output: McpCredentialChanges,
  serverId: string,
  priorStatus: McpServerCredentialStatus | undefined,
  candidate: McpServerConfig | undefined,
): void => {
  const values = serverSecretValues(candidate);
  const envChanges: Record<string, string | null> = {};
  const headerChanges: Record<string, string | null> = {};

  for (const name of Object.keys(priorStatus?.env ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(values.env, name)) envChanges[name] = null;
  }
  for (const name of Object.keys(priorStatus?.headers ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(values.headers, name)) headerChanges[name] = null;
  }

  for (const [name, value] of Object.entries(values.env)) {
    assertNotMaskedSecret(value);
    if (value !== "") envChanges[name] = value;
  }
  for (const [name, value] of Object.entries(values.headers)) {
    assertNotMaskedSecret(value);
    if (value !== "") headerChanges[name] = value;
  }

  if (Object.keys(envChanges).length || Object.keys(headerChanges).length) {
    output.servers ??= {};
    output.servers[serverId] = {
      ...(Object.keys(envChanges).length ? { env: envChanges } : {}),
      ...(Object.keys(headerChanges).length ? { headers: headerChanges } : {}),
    };
  }
};

const makeSecretFree = (server: McpServerConfig): McpServerConfig => {
  const clone = cloneServerConfig(server);
  if (clone.transport.type === "stdio") {
    clone.transport.env = Object.fromEntries(
      Object.keys(clone.transport.env).map((name) => [name, ""]),
    );
  } else {
    clone.transport.headers = clone.transport.headers.map((header) => ({
      ...header,
      value: "",
    }));
  }
  return clone;
};

export const prepareMcpMutation = (
  current: McpSection,
  candidateServers: McpServerConfig[],
): PreparedMcpMutation => {
  const ids = new Set<string>();
  for (const server of candidateServers) {
    if (!server.id.trim()) throw new Error("MCP server id is required.");
    if (ids.has(server.id)) throw new Error(`Duplicate MCP server id '${server.id}'.`);
    ids.add(server.id);
  }

  const credentialChanges: McpCredentialChanges = {};
  const candidatesById = new Map(candidateServers.map((server) => [server.id, server]));
  const statusIds = new Set([
    ...Object.keys(current.credential_status),
    ...candidateServers.map((server) => server.id),
  ]);
  for (const serverId of statusIds) {
    appendCredentialChanges(
      credentialChanges,
      serverId,
      current.credential_status[serverId],
      candidatesById.get(serverId),
    );
  }

  return {
    data: {
      version: current.version,
      servers: candidateServers.map(makeSecretFree),
      credential_status: current.credential_status,
    },
    credentialChanges,
  };
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const stringRecord = (value: unknown, field: string): Record<string, string> => {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object of string values.`);
  }
  const result: Record<string, string> = {};
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string") throw new Error(`${field}.${name} must be a string.`);
    result[name] = entry;
  }
  return result;
};

const headerList = (value: unknown): HeaderConfig[] => {
  if (value === undefined) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (!entry || typeof entry !== "object") throw new Error("MCP header must be an object.");
      const record = entry as Record<string, unknown>;
      if (typeof record.name !== "string" || typeof record.value !== "string") {
        throw new Error("MCP header name and value must be strings.");
      }
      return { name: record.name, value: record.value };
    });
  }
  return Object.entries(stringRecord(value, "headers")).map(([name, headerValue]) => ({
    name,
    value: headerValue,
  }));
};

const importedServerConfig = (id: string, value: unknown): McpServerConfig => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`MCP server '${id}' must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const defaults = createDefaultMcpServerConfig(id);
  const enabled =
    typeof record.enabled === "boolean"
      ? record.enabled
      : typeof record.disabled === "boolean"
        ? !record.disabled
        : true;
  const nestedTransport =
    record.transport && typeof record.transport === "object" && !Array.isArray(record.transport)
      ? (record.transport as Record<string, unknown>)
      : null;
  const source = nestedTransport ?? record;
  const type =
    typeof source.type === "string"
      ? source.type
      : typeof source.command === "string"
        ? "stdio"
        : typeof source.url === "string"
          ? "sse"
          : "";

  let transport: McpServerConfig["transport"];
  if (type === "stdio") {
    if (typeof source.command !== "string" || !source.command.trim()) {
      throw new Error(`MCP server '${id}' requires a stdio command.`);
    }
    transport = {
      type: "stdio",
      command: source.command,
      args: stringArray(source.args),
      cwd: typeof source.cwd === "string" ? source.cwd : undefined,
      env: stringRecord(source.env, `mcpServers.${id}.env`),
      startup_timeout_ms:
        typeof source.startup_timeout_ms === "number"
          ? source.startup_timeout_ms
          : defaults.transport.type === "stdio"
            ? defaults.transport.startup_timeout_ms
            : undefined,
    };
  } else if (type === "sse") {
    if (typeof source.url !== "string" || !source.url.trim()) {
      throw new Error(`MCP server '${id}' requires an SSE URL.`);
    }
    transport = {
      type: "sse",
      url: source.url,
      headers: headerList(source.headers),
      connect_timeout_ms:
        typeof source.connect_timeout_ms === "number" ? source.connect_timeout_ms : 10_000,
    };
  } else {
    throw new Error(`MCP server '${id}' must define a supported stdio or SSE transport.`);
  }

  return {
    id,
    name: typeof record.name === "string" ? record.name : undefined,
    enabled,
    transport,
    request_timeout_ms:
      typeof record.request_timeout_ms === "number"
        ? record.request_timeout_ms
        : defaults.request_timeout_ms,
    healthcheck_interval_ms:
      typeof record.healthcheck_interval_ms === "number"
        ? record.healthcheck_interval_ms
        : defaults.healthcheck_interval_ms,
    reconnect:
      record.reconnect && typeof record.reconnect === "object"
        ? (record.reconnect as McpServerConfig["reconnect"])
        : defaults.reconnect,
    allowed_tools: stringArray(record.allowed_tools),
    denied_tools: stringArray(record.denied_tools),
  };
};

const parseImportedServers = (servers: Record<string, unknown>): McpServerConfig[] => {
  const entries = Object.entries(servers);
  if (!entries.length) throw new Error("No MCP servers were provided.");
  return entries.map(([id, value]) => importedServerConfig(id, value));
};

const mergeCanonicalWithRuntime = (
  section: McpSection,
  runtimeServers: McpRuntimeServer[],
): McpServer[] => {
  const runtimeById = new Map(runtimeServers.map((server) => [server.id, server.runtime]));
  return section.servers.map((config) => ({
    id: config.id,
    name: config.name ?? config.id,
    enabled: config.enabled,
    config: cloneServerConfig(config),
    runtime: runtimeById.get(config.id),
  }));
};

export const useMcpSettings = (options: UseMcpSettingsOptions = {}): UseMcpSettingsResult => {
  const { service = mcpService } = options;
  const mcpSnapshot = useConfigSectionStore((state) => state.sections.mcp);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const saveMcpSettings = useConfigSectionStore((state) => state.saveMcpSettings);

  const [servers, setServers] = useState<McpServer[]>([]);
  const [credentialStatusByServer, setCredentialStatusByServer] = useState<
    Record<string, McpServerCredentialStatus>
  >({});
  const [selectedServerId, setSelectedServerIdState] = useState<string | null>(null);
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpToolInfo[]>>({});
  const [toolLoadingByServer, setToolLoadingByServer] = useState<Record<string, boolean>>({});
  const [actionLoadingMap, setActionLoadingMap] = useState<Record<string, boolean>>({});
  const [isLoadingServers, setIsLoadingServers] = useState(false);
  const [isMutatingConfig, setIsMutatingConfig] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runtimeStatusError, setRuntimeStatusError] = useState<string | null>(null);
  const envelopeRef = useRef<ConfigSectionEnvelope<McpSection> | null>(null);
  const runtimeServersRef = useRef<McpRuntimeServer[]>([]);
  const refreshSequence = useRef(0);

  const adoptSection = useCallback(
    (
      envelope: ConfigSectionEnvelope<McpSection>,
      runtimeServers: McpRuntimeServer[],
      sequence?: number,
    ) => {
      if (sequence !== undefined && sequence !== refreshSequence.current) return;
      if ((envelopeRef.current?.revision ?? -1) > envelope.revision) return;
      envelopeRef.current = envelope;
      runtimeServersRef.current = runtimeServers;
      const merged = mergeCanonicalWithRuntime(envelope.data, runtimeServers);
      setServers(merged);
      setCredentialStatusByServer(envelope.data.credential_status);
      setSelectedServerIdState((current) => {
        if (current && merged.some((server) => server.id === current)) return current;
        return merged[0]?.id ?? null;
      });
    },
    [],
  );

  const refreshServers = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const sequence = ++refreshSequence.current;
      if (!silent) setIsLoadingServers(true);
      try {
        const envelopePromise = loadSection("mcp", { force: true });
        let runtimeError: unknown = null;
        const runtimePromise = service.getServers().catch((loadError: unknown) => {
          runtimeError = loadError;
          return runtimeServersRef.current;
        });
        const [envelope, runtimeServers] = await Promise.all([envelopePromise, runtimePromise]);
        adoptSection(envelope, runtimeServers, sequence);
        setError(null);
        setRuntimeStatusError(
          runtimeError
            ? toErrorMessage(
                runtimeError,
                "Configuration loaded, but MCP runtime status is unavailable",
              )
            : null,
        );
      } catch (loadError) {
        setError(toErrorMessage(loadError, "Failed to load MCP servers"));
        throw loadError;
      } finally {
        if (!silent && sequence === refreshSequence.current) setIsLoadingServers(false);
      }
    },
    [adoptSection, loadSection, service],
  );

  const refreshRuntime = useCallback(async () => {
    const current = envelopeRef.current;
    if (!current) {
      await refreshServers({ silent: true });
      return;
    }
    const runtimeServers = await service.getServers();
    adoptSection(current, runtimeServers);
    setRuntimeStatusError(null);
  }, [adoptSection, refreshServers, service]);

  const loadServerTools = useCallback(
    async (serverId: string, force = false) => {
      if (!serverId) return [] as McpToolInfo[];
      if (!force && toolsByServer[serverId]) return toolsByServer[serverId];
      setToolLoadingByServer((prev) => ({ ...prev, [serverId]: true }));
      try {
        const tools = await service.getTools(serverId);
        setToolsByServer((prev) => ({ ...prev, [serverId]: tools }));
        setError(null);
        return tools;
      } catch (toolsError) {
        setError(toErrorMessage(toolsError, "Failed to load MCP tools"));
        throw toolsError;
      } finally {
        setToolLoadingByServer((prev) => ({ ...prev, [serverId]: false }));
      }
    },
    [service, toolsByServer],
  );

  const mutateServers = useCallback(
    async (candidateServers: McpServerConfig[]) => {
      const current = envelopeRef.current ?? (await loadSection("mcp", { force: true }));
      const mutation = prepareMcpMutation(current.data, candidateServers);
      const saved = await saveMcpSettings(
        mutation.data,
        mutation.credentialChanges,
        current.revision,
      );
      // The canonical mutation has already committed at this point. Adopt it
      // immediately and treat runtime-status refresh as best effort so a
      // transient status endpoint failure never makes a durable save appear
      // to have failed (and tempt the user to submit it twice).
      adoptSection(saved, runtimeServersRef.current);
      try {
        const runtimeServers = await service.getServers();
        adoptSection(saved, runtimeServers);
      } catch (runtimeError) {
        setRuntimeStatusError(
          toErrorMessage(
            runtimeError,
            "Configuration saved, but MCP runtime status could not be refreshed",
          ),
        );
      }
      return saved;
    },
    [adoptSection, loadSection, saveMcpSettings, service],
  );

  const addServer = useCallback(
    async (config: McpServerConfig) => {
      setIsMutatingConfig(true);
      try {
        const current = envelopeRef.current ?? (await loadSection("mcp", { force: true }));
        if (current.data.servers.some((server) => server.id === config.id)) {
          throw new Error(`MCP server '${config.id}' already exists.`);
        }
        await mutateServers([...current.data.servers, config]);
        setError(null);
      } catch (saveError) {
        setError(toErrorMessage(saveError, "Failed to add MCP server"));
        throw saveError;
      } finally {
        setIsMutatingConfig(false);
      }
    },
    [loadSection, mutateServers],
  );

  const updateServer = useCallback(
    async (serverId: string, config: McpServerConfig) => {
      setIsMutatingConfig(true);
      try {
        const current = envelopeRef.current ?? (await loadSection("mcp", { force: true }));
        if (!current.data.servers.some((server) => server.id === serverId)) {
          throw new Error(`MCP server '${serverId}' no longer exists.`);
        }
        const normalized = { ...config, id: serverId };
        await mutateServers(
          current.data.servers.map((server) => (server.id === serverId ? normalized : server)),
        );
        setError(null);
      } catch (updateError) {
        setError(toErrorMessage(updateError, "Failed to update MCP server"));
        throw updateError;
      } finally {
        setIsMutatingConfig(false);
      }
    },
    [loadSection, mutateServers],
  );

  const deleteServer = useCallback(
    async (serverId: string) => {
      setActionLoadingMap((prev) => ({ ...prev, [getActionKey(serverId, "delete")]: true }));
      try {
        const current = envelopeRef.current ?? (await loadSection("mcp", { force: true }));
        await mutateServers(current.data.servers.filter((server) => server.id !== serverId));
        setToolsByServer((prev) => {
          const next = { ...prev };
          delete next[serverId];
          return next;
        });
        setError(null);
      } catch (deleteError) {
        setError(toErrorMessage(deleteError, "Failed to delete MCP server"));
        throw deleteError;
      } finally {
        setActionLoadingMap((prev) => ({ ...prev, [getActionKey(serverId, "delete")]: false }));
      }
    },
    [loadSection, mutateServers],
  );

  const importServers = useCallback(
    async (
      imported: Record<string, unknown>,
      mode: "merge" | "replace",
    ): Promise<McpImportResponse> => {
      setIsMutatingConfig(true);
      try {
        const incoming = parseImportedServers(imported);
        const current = envelopeRef.current ?? (await loadSection("mcp", { force: true }));
        const currentIds = new Set(current.data.servers.map((server) => server.id));
        const incomingIds = new Set(incoming.map((server) => server.id));
        const candidate =
          mode === "replace"
            ? incoming
            : [
                ...current.data.servers.map(
                  (server) => incoming.find((entry) => entry.id === server.id) ?? server,
                ),
                ...incoming.filter((server) => !currentIds.has(server.id)),
              ];
        await mutateServers(candidate);
        setError(null);
        return {
          message: "MCP servers imported",
          mode,
          added: incoming.filter((server) => !currentIds.has(server.id)).length,
          updated: incoming.filter((server) => currentIds.has(server.id)).length,
          removed:
            mode === "replace"
              ? current.data.servers.filter((server) => !incomingIds.has(server.id)).length
              : 0,
          server_ids: incoming.map((server) => server.id).sort(),
          start_errors: [],
        };
      } catch (importError) {
        setError(toErrorMessage(importError, "Failed to import MCP servers"));
        throw importError;
      } finally {
        setIsMutatingConfig(false);
      }
    },
    [loadSection, mutateServers],
  );

  const setServerActionLoading = useCallback(
    (serverId: string, action: McpServerAction, loading: boolean) => {
      setActionLoadingMap((prev) => ({ ...prev, [getActionKey(serverId, action)]: loading }));
    },
    [],
  );

  const connectServer = useCallback(
    async (serverId: string) => {
      setServerActionLoading(serverId, "connect", true);
      try {
        await service.connectServer(serverId);
        await refreshRuntime();
      } catch (connectError) {
        setError(toErrorMessage(connectError, "Failed to connect MCP server"));
        throw connectError;
      } finally {
        setServerActionLoading(serverId, "connect", false);
      }
    },
    [refreshRuntime, service, setServerActionLoading],
  );

  const disconnectServer = useCallback(
    async (serverId: string) => {
      setServerActionLoading(serverId, "disconnect", true);
      try {
        await service.disconnectServer(serverId);
        await refreshRuntime();
      } catch (disconnectError) {
        setError(toErrorMessage(disconnectError, "Failed to disconnect MCP server"));
        throw disconnectError;
      } finally {
        setServerActionLoading(serverId, "disconnect", false);
      }
    },
    [refreshRuntime, service, setServerActionLoading],
  );

  const refreshServerTools = useCallback(
    async (serverId: string) => {
      setServerActionLoading(serverId, "refresh", true);
      try {
        await service.refreshTools(serverId);
        await loadServerTools(serverId, true);
        await refreshRuntime();
      } catch (refreshError) {
        setError(toErrorMessage(refreshError, "Failed to refresh MCP tools"));
        throw refreshError;
      } finally {
        setServerActionLoading(serverId, "refresh", false);
      }
    },
    [loadServerTools, refreshRuntime, service, setServerActionLoading],
  );

  const refreshAll = useCallback(async () => {
    setIsRefreshingAll(true);
    try {
      await Promise.all(
        servers.map(async (server) => {
          try {
            await service.refreshTools(server.id);
          } catch {
            // Continue; individual runtime errors appear in the status refresh.
          }
        }),
      );
      await refreshRuntime();
      if (selectedServerId) await loadServerTools(selectedServerId, true);
    } catch (refreshError) {
      setError(toErrorMessage(refreshError, "Failed to refresh MCP status"));
      throw refreshError;
    } finally {
      setIsRefreshingAll(false);
    }
  }, [loadServerTools, refreshRuntime, selectedServerId, servers, service]);

  const setSelectedServerId = useCallback((serverId: string | null) => {
    setSelectedServerIdState(serverId);
  }, []);

  const isServerActionLoading = useCallback(
    (serverId: string, action: McpServerAction): boolean =>
      Boolean(actionLoadingMap[getActionKey(serverId, action)]),
    [actionLoadingMap],
  );

  const selectedServerTools = useMemo(
    () => (selectedServerId ? (toolsByServer[selectedServerId] ?? []) : []),
    [selectedServerId, toolsByServer],
  );
  const isSelectedServerToolsLoading = useMemo(
    () => Boolean(selectedServerId && toolLoadingByServer[selectedServerId]),
    [selectedServerId, toolLoadingByServer],
  );

  useEffect(() => {
    void refreshServers().catch(() => undefined);
  }, [refreshServers]);

  useEffect(() => {
    const envelope = mcpSnapshot.envelope;
    if (!envelope || envelope.revision <= (envelopeRef.current?.revision ?? -1)) return;
    void service
      .getServers()
      .then((runtimeServers) => adoptSection(envelope, runtimeServers))
      .catch(() => undefined);
  }, [adoptSection, mcpSnapshot.envelope, service]);

  useEffect(() => {
    if (selectedServerId) void loadServerTools(selectedServerId).catch(() => undefined);
  }, [loadServerTools, selectedServerId]);

  return {
    servers,
    credentialStatusByServer,
    selectedServerId,
    selectedServerTools,
    isLoadingServers,
    isMutatingConfig,
    isRefreshingAll,
    isSelectedServerToolsLoading,
    error: error ?? runtimeStatusError,
    setSelectedServerId,
    refreshServers,
    addServer,
    updateServer,
    deleteServer,
    importServers,
    connectServer,
    disconnectServer,
    refreshServerTools,
    refreshAll,
    isServerActionLoading,
  };
};
