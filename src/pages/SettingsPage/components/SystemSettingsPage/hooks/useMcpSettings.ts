import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ServerStatus,
  createDefaultMcpServerConfig,
  mcpService,
  type HeaderConfig,
  type McpImportResponse,
  type McpServer,
  type McpServerConfig,
  type McpToolInfo,
  type RuntimeInfo,
} from "@services/mcp";
import type {
  ConfigSectionEnvelope,
  McpCredentialChanges,
  McpSection,
  McpServerCredentialStatus,
} from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { configErrorMessage } from "@shared/utils/configErrors";

export type McpServerAction = "connect" | "disconnect" | "refresh" | "delete";

type McpRuntimeServer = McpServer;

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
  configRevision: number | null;
  selectedServerId: string | null;
  selectedServerTools: McpToolInfo[];
  isLoadingServers: boolean;
  isMutatingConfig: boolean;
  isRefreshingAll: boolean;
  isSelectedServerToolsLoading: boolean;
  configAvailable: boolean;
  configError: string | null;
  runtimeError: string | null;
  error: string | null;
  setSelectedServerId: (serverId: string | null) => void;
  refreshServers: (options?: { silent?: boolean }) => Promise<void>;
  addServer: (config: McpServerConfig) => Promise<void>;
  updateServer: (
    serverId: string,
    config: McpServerConfig,
    expectedRevision: number,
  ) => Promise<void>;
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

const toErrorMessage = (error: unknown, fallback: string): string =>
  configErrorMessage(error, fallback);

const getActionKey = (serverId: string, action: McpServerAction): string => `${serverId}:${action}`;

const canQueryServerTools = (server: McpServer | undefined): boolean =>
  Boolean(server?.runtime && server.runtime.status !== ServerStatus.Stopped);

const omitRecordKeys = <T>(
  record: Record<string, T>,
  keys: ReadonlySet<string>,
): Record<string, T> => {
  if (![...keys].some((key) => key in record)) return record;
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key))) as Record<
    string,
    T
  >;
};

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

const REDACTED_RUNTIME_ERROR = "MCP runtime error details are hidden.";

const sanitizeRuntimeUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
};

const sanitizeRuntimeConfig = (server: McpServerConfig): McpServerConfig => {
  const sanitized = makeSecretFree(server);
  if (sanitized.transport.type !== "stdio") {
    sanitized.transport.url = sanitizeRuntimeUrl(sanitized.transport.url);
  }
  return sanitized;
};

const sanitizeRuntimeInfo = (runtime: RuntimeInfo | undefined): RuntimeInfo | undefined => {
  if (!runtime) return undefined;
  return {
    ...runtime,
    ...(runtime.last_error ? { last_error: REDACTED_RUNTIME_ERROR } : {}),
  };
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
      : typeof source.transport_kind === "string"
        ? source.transport_kind
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
  } else if (type === "sse" || type === "streamable_http") {
    if (typeof source.url !== "string" || !source.url.trim()) {
      throw new Error(
        `MCP server '${id}' requires a ${type === "streamable_http" ? "Streamable HTTP" : "SSE"} URL.`,
      );
    }
    const httpTransport = {
      url: source.url,
      headers: headerList(source.headers),
      connect_timeout_ms:
        typeof source.connect_timeout_ms === "number" ? source.connect_timeout_ms : 10_000,
    };
    transport =
      type === "streamable_http"
        ? { type: "streamable_http", ...httpTransport }
        : { type: "sse", ...httpTransport };
  } else {
    throw new Error(
      `MCP server '${id}' must define a supported stdio, SSE, or Streamable HTTP transport.`,
    );
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
    runtime: sanitizeRuntimeInfo(runtimeById.get(config.id)),
  }));
};

const sanitizeRuntimeServers = (runtimeServers: McpRuntimeServer[]): McpServer[] =>
  runtimeServers.map((server) => ({
    id: server.id,
    name: server.name || server.id,
    enabled: server.enabled,
    config: sanitizeRuntimeConfig(server.config),
    runtime: sanitizeRuntimeInfo(server.runtime),
  }));

export const useMcpSettings = (options: UseMcpSettingsOptions = {}): UseMcpSettingsResult => {
  const { service = mcpService } = options;
  const mcpSnapshot = useConfigSectionStore((state) => state.sections.mcp);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const saveMcpSettings = useConfigSectionStore((state) => state.saveMcpSettings);

  const [servers, setServers] = useState<McpServer[]>([]);
  const [credentialStatusByServer, setCredentialStatusByServer] = useState<
    Record<string, McpServerCredentialStatus>
  >({});
  const [configRevision, setConfigRevision] = useState<number | null>(null);
  const [selectedServerId, setSelectedServerIdState] = useState<string | null>(null);
  const [toolsByServer, setToolsByServer] = useState<Record<string, McpToolInfo[]>>({});
  const [toolLoadingByServer, setToolLoadingByServer] = useState<Record<string, boolean>>({});
  const [toolErrorByServer, setToolErrorByServer] = useState<Record<string, string>>({});
  const [actionLoadingMap, setActionLoadingMap] = useState<Record<string, boolean>>({});
  const [isLoadingServers, setIsLoadingServers] = useState(false);
  const [isMutatingConfig, setIsMutatingConfig] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configAvailable, setConfigAvailable] = useState(false);
  const [configLoadError, setConfigLoadError] = useState<string | null>(null);
  const [runtimeStatusError, setRuntimeStatusError] = useState<string | null>(null);
  const envelopeRef = useRef<ConfigSectionEnvelope<McpSection> | null>(null);
  const runtimeServersRef = useRef<McpRuntimeServer[]>([]);
  const toolsByServerRef = useRef<Record<string, McpToolInfo[]>>({});
  const configAvailableRef = useRef(false);
  const refreshSequence = useRef(0);
  const runtimeSequence = useRef(0);
  const loadingOwnerSequence = useRef(0);
  const toolRequestGeneration = useRef<Record<string, number>>({});
  const serverActionGeneration = useRef<Record<string, number>>({});
  const runtimeActionGeneration = useRef(0);
  const refreshAllGeneration = useRef(0);

  const claimLoadingOwnership = useCallback((showLoader = false): number => {
    const generation = ++loadingOwnerSequence.current;
    if (showLoader) setIsLoadingServers(true);
    return generation;
  }, []);

  const releaseLoadingOwnership = useCallback((generation: number): void => {
    if (generation === loadingOwnerSequence.current) {
      setIsLoadingServers(false);
    }
  }, []);

  const claimToolRequestGeneration = useCallback((serverId: string): number => {
    const generation = (toolRequestGeneration.current[serverId] ?? 0) + 1;
    toolRequestGeneration.current[serverId] = generation;
    return generation;
  }, []);

  const clearServerToolState = useCallback((serverId: string): void => {
    const keys = new Set([serverId]);
    const tools = omitRecordKeys(toolsByServerRef.current, keys);
    if (tools !== toolsByServerRef.current) {
      toolsByServerRef.current = tools;
      setToolsByServer(tools);
    }
    setToolLoadingByServer((current) => omitRecordKeys(current, keys));
    setToolErrorByServer((current) => omitRecordKeys(current, keys));
  }, []);

  const invalidateUnavailableToolState = useCallback((nextServers: McpServer[]): void => {
    const queryableIds = new Set(
      nextServers.filter(canQueryServerTools).map((server) => server.id),
    );
    const invalidIds = new Set(
      [
        ...Object.keys(toolRequestGeneration.current),
        ...nextServers.filter((server) => !canQueryServerTools(server)).map((server) => server.id),
      ].filter((serverId) => !queryableIds.has(serverId)),
    );
    if (!invalidIds.size) return;
    invalidIds.forEach((serverId) => {
      toolRequestGeneration.current[serverId] = (toolRequestGeneration.current[serverId] ?? 0) + 1;
    });
    const tools = omitRecordKeys(toolsByServerRef.current, invalidIds);
    if (tools !== toolsByServerRef.current) {
      toolsByServerRef.current = tools;
      setToolsByServer(tools);
    }
    setToolLoadingByServer((current) => omitRecordKeys(current, invalidIds));
    setToolErrorByServer((current) => omitRecordKeys(current, invalidIds));
  }, []);

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
      setConfigRevision(envelope.revision);
      const merged = mergeCanonicalWithRuntime(envelope.data, runtimeServers);
      invalidateUnavailableToolState(merged);
      setServers(merged);
      setCredentialStatusByServer(envelope.data.credential_status);
      setSelectedServerIdState((current) => {
        if (current && merged.some((server) => server.id === current)) return current;
        return merged[0]?.id ?? null;
      });
    },
    [invalidateUnavailableToolState],
  );

  const adoptRuntimeOnly = useCallback(
    (runtimeServers: McpRuntimeServer[], sequence?: number) => {
      if (sequence !== undefined && sequence !== refreshSequence.current) return;
      runtimeServersRef.current = runtimeServers;
      const sanitized = sanitizeRuntimeServers(runtimeServers);
      invalidateUnavailableToolState(sanitized);
      setConfigRevision(null);
      setCredentialStatusByServer({});
      setServers(sanitized);
      setSelectedServerIdState((current) => {
        if (current && sanitized.some((server) => server.id === current)) return current;
        return sanitized[0]?.id ?? null;
      });
    },
    [invalidateUnavailableToolState],
  );

  const refreshServers = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      const sequence = ++refreshSequence.current;
      const runtimeGeneration = ++runtimeSequence.current;
      const loadingGeneration = claimLoadingOwnership(!silent);
      configAvailableRef.current = false;
      setConfigAvailable(false);
      setError(null);

      const runtimeTask = service
        .getServers()
        .then((runtimeServers) => {
          if (
            sequence !== refreshSequence.current ||
            runtimeGeneration !== runtimeSequence.current
          ) {
            return;
          }
          setRuntimeStatusError(null);
          if (configAvailableRef.current && envelopeRef.current) {
            adoptSection(envelopeRef.current, runtimeServers, sequence);
          } else {
            adoptRuntimeOnly(runtimeServers, sequence);
          }
        })
        .catch((loadError: unknown) => {
          if (
            sequence !== refreshSequence.current ||
            runtimeGeneration !== runtimeSequence.current
          ) {
            return;
          }
          setRuntimeStatusError(toErrorMessage(loadError, "Failed to load MCP runtime servers"));
        });

      const configTask = loadSection("mcp", { force: true })
        .then((envelope) => {
          if (sequence !== refreshSequence.current) return;
          const healthy = envelope.status === "healthy";
          configAvailableRef.current = healthy;
          setConfigAvailable(healthy);
          setConfigLoadError(
            healthy ? null : (envelope.last_error ?? "MCP configuration is not healthy"),
          );
          adoptSection(envelope, runtimeServersRef.current, sequence);
        })
        .catch((loadError: unknown) => {
          if (sequence !== refreshSequence.current) return;
          configAvailableRef.current = false;
          envelopeRef.current = null;
          setConfigAvailable(false);
          setConfigRevision(null);
          setCredentialStatusByServer({});
          setConfigLoadError(toErrorMessage(loadError, "MCP configuration is unavailable"));
          adoptRuntimeOnly(runtimeServersRef.current, sequence);
        });

      await Promise.allSettled([runtimeTask, configTask]);
      releaseLoadingOwnership(loadingGeneration);
    },
    [
      adoptRuntimeOnly,
      adoptSection,
      claimLoadingOwnership,
      loadSection,
      releaseLoadingOwnership,
      service,
    ],
  );

  const refreshRuntime = useCallback(
    async (operationGeneration: number) => {
      // Runtime actions take over the runtime lane and the visible loading owner,
      // but a pending config load in the same refresh generation remains valid.
      const sequence = refreshSequence.current;
      const runtimeGeneration = ++runtimeSequence.current;
      const loadingGeneration = claimLoadingOwnership();
      try {
        const runtimeServers = await service.getServers();
        if (
          sequence !== refreshSequence.current ||
          runtimeGeneration !== runtimeSequence.current ||
          operationGeneration !== runtimeActionGeneration.current
        ) {
          return;
        }
        const current = envelopeRef.current;
        if (current) {
          adoptSection(current, runtimeServers, sequence);
        } else {
          adoptRuntimeOnly(runtimeServers, sequence);
        }
        setRuntimeStatusError(null);
      } catch (runtimeError) {
        if (
          sequence !== refreshSequence.current ||
          runtimeGeneration !== runtimeSequence.current ||
          operationGeneration !== runtimeActionGeneration.current
        ) {
          return;
        }
        throw runtimeError;
      } finally {
        releaseLoadingOwnership(loadingGeneration);
      }
    },
    [adoptRuntimeOnly, adoptSection, claimLoadingOwnership, releaseLoadingOwnership, service],
  );

  const loadServerTools = useCallback(
    async (serverId: string, force = false, ownerGeneration?: number) => {
      if (!serverId) return [] as McpToolInfo[];
      const currentRuntimeServer = runtimeServersRef.current.find(
        (server) => server.id === serverId,
      );
      if (!canQueryServerTools(currentRuntimeServer)) {
        invalidateUnavailableToolState(
          runtimeServersRef.current.filter((server) => server.id !== serverId),
        );
        return [] as McpToolInfo[];
      }
      if (
        ownerGeneration !== undefined &&
        ownerGeneration !== toolRequestGeneration.current[serverId]
      ) {
        return [] as McpToolInfo[];
      }
      if (!force && toolsByServerRef.current[serverId]) {
        return toolsByServerRef.current[serverId];
      }
      const requestGeneration = ownerGeneration ?? claimToolRequestGeneration(serverId);
      setToolLoadingByServer((prev) => ({ ...prev, [serverId]: true }));
      setToolErrorByServer((prev) => omitRecordKeys(prev, new Set([serverId])));
      try {
        const tools = await service.getTools(serverId);
        const latestRuntimeServer = runtimeServersRef.current.find(
          (server) => server.id === serverId,
        );
        if (
          requestGeneration !== toolRequestGeneration.current[serverId] ||
          !canQueryServerTools(latestRuntimeServer)
        ) {
          return [] as McpToolInfo[];
        }
        const nextTools = { ...toolsByServerRef.current, [serverId]: tools };
        toolsByServerRef.current = nextTools;
        setToolsByServer(nextTools);
        setToolErrorByServer((prev) => omitRecordKeys(prev, new Set([serverId])));
        return tools;
      } catch (toolsError) {
        const latestRuntimeServer = runtimeServersRef.current.find(
          (server) => server.id === serverId,
        );
        if (
          requestGeneration !== toolRequestGeneration.current[serverId] ||
          !canQueryServerTools(latestRuntimeServer)
        ) {
          return [] as McpToolInfo[];
        }
        setToolErrorByServer((prev) => ({
          ...prev,
          [serverId]: toErrorMessage(toolsError, "Failed to load MCP tools"),
        }));
        throw toolsError;
      } finally {
        if (requestGeneration === toolRequestGeneration.current[serverId]) {
          setToolLoadingByServer((prev) => ({ ...prev, [serverId]: false }));
        }
      }
    },
    [claimToolRequestGeneration, invalidateUnavailableToolState, service],
  );

  const mutateServers = useCallback(
    async (candidateServers: McpServerConfig[], expectedRevision?: number) => {
      const current = envelopeRef.current;
      if (!configAvailableRef.current || !current) {
        throw new Error("MCP configuration is unavailable; runtime data is read-only.");
      }
      const mutation = prepareMcpMutation(current.data, candidateServers);
      const saved = await saveMcpSettings(
        mutation.data,
        mutation.credentialChanges,
        expectedRevision ?? current.revision,
      );
      // The canonical mutation has already committed at this point. Adopt it
      // immediately and treat runtime-status refresh as best effort so a
      // transient status endpoint failure never makes a durable save appear
      // to have failed (and tempt the user to submit it twice).
      const sequence = ++refreshSequence.current;
      const runtimeGeneration = ++runtimeSequence.current;
      const loadingGeneration = claimLoadingOwnership();
      const healthy = saved.status === "healthy";
      configAvailableRef.current = healthy;
      setConfigAvailable(healthy);
      setConfigLoadError(healthy ? null : (saved.last_error ?? "MCP configuration is not healthy"));
      try {
        adoptSection(saved, runtimeServersRef.current, sequence);
        try {
          const runtimeServers = await service.getServers();
          if (
            sequence === refreshSequence.current &&
            runtimeGeneration === runtimeSequence.current
          ) {
            setRuntimeStatusError(null);
            adoptSection(saved, runtimeServers, sequence);
          }
        } catch (runtimeError) {
          if (
            sequence === refreshSequence.current &&
            runtimeGeneration === runtimeSequence.current
          ) {
            setRuntimeStatusError(
              toErrorMessage(
                runtimeError,
                "Configuration saved, but MCP runtime status could not be refreshed",
              ),
            );
          }
        }
        return saved;
      } finally {
        releaseLoadingOwnership(loadingGeneration);
      }
    },
    [adoptSection, claimLoadingOwnership, releaseLoadingOwnership, saveMcpSettings, service],
  );

  const addServer = useCallback(
    async (config: McpServerConfig) => {
      setIsMutatingConfig(true);
      try {
        const current = envelopeRef.current;
        if (!configAvailableRef.current || !current) {
          throw new Error("MCP configuration is unavailable; runtime data is read-only.");
        }
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
    [mutateServers],
  );

  const updateServer = useCallback(
    async (serverId: string, config: McpServerConfig, expectedRevision: number) => {
      setIsMutatingConfig(true);
      try {
        const current = envelopeRef.current;
        if (!configAvailableRef.current || !current) {
          throw new Error("MCP configuration is unavailable; runtime data is read-only.");
        }
        if (!current.data.servers.some((server) => server.id === serverId)) {
          throw new Error(`MCP server '${serverId}' no longer exists.`);
        }
        const normalized = { ...config, id: serverId };
        await mutateServers(
          current.data.servers.map((server) => (server.id === serverId ? normalized : server)),
          expectedRevision,
        );
        setError(null);
      } catch (updateError) {
        setError(toErrorMessage(updateError, "Failed to update MCP server"));
        throw updateError;
      } finally {
        setIsMutatingConfig(false);
      }
    },
    [mutateServers],
  );

  const deleteServer = useCallback(
    async (serverId: string) => {
      setActionLoadingMap((prev) => ({ ...prev, [getActionKey(serverId, "delete")]: true }));
      try {
        const current = envelopeRef.current;
        if (!configAvailableRef.current || !current) {
          throw new Error("MCP configuration is unavailable; runtime data is read-only.");
        }
        await mutateServers(current.data.servers.filter((server) => server.id !== serverId));
        clearServerToolState(serverId);
        setError(null);
      } catch (deleteError) {
        setError(toErrorMessage(deleteError, "Failed to delete MCP server"));
        throw deleteError;
      } finally {
        setActionLoadingMap((prev) => ({ ...prev, [getActionKey(serverId, "delete")]: false }));
      }
    },
    [clearServerToolState, mutateServers],
  );

  const importServers = useCallback(
    async (
      imported: Record<string, unknown>,
      mode: "merge" | "replace",
    ): Promise<McpImportResponse> => {
      setIsMutatingConfig(true);
      try {
        const incoming = parseImportedServers(imported);
        const current = envelopeRef.current;
        if (!configAvailableRef.current || !current) {
          throw new Error("MCP configuration is unavailable; runtime data is read-only.");
        }
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
    [mutateServers],
  );

  const claimServerAction = useCallback((serverId: string, action: McpServerAction): number => {
    const key = getActionKey(serverId, action);
    const generation = (serverActionGeneration.current[key] ?? 0) + 1;
    serverActionGeneration.current[key] = generation;
    setActionLoadingMap((prev) => ({ ...prev, [key]: true }));
    return generation;
  }, []);

  const releaseServerAction = useCallback(
    (serverId: string, action: McpServerAction, generation: number): void => {
      const key = getActionKey(serverId, action);
      if (serverActionGeneration.current[key] === generation) {
        setActionLoadingMap((prev) => ({ ...prev, [key]: false }));
      }
    },
    [],
  );

  const connectServer = useCallback(
    async (serverId: string) => {
      const operationGeneration = ++runtimeActionGeneration.current;
      const actionGeneration = claimToolRequestGeneration(serverId);
      const loadingGeneration = claimServerAction(serverId, "connect");
      setError(null);
      setToolErrorByServer((current) => omitRecordKeys(current, new Set([serverId])));
      try {
        try {
          await service.connectServer(serverId);
        } catch (connectError) {
          if (
            actionGeneration !== toolRequestGeneration.current[serverId] ||
            operationGeneration !== runtimeActionGeneration.current
          ) {
            return;
          }
          setError(toErrorMessage(connectError, "Failed to connect MCP server"));
          throw connectError;
        }
        if (
          actionGeneration !== toolRequestGeneration.current[serverId] ||
          operationGeneration !== runtimeActionGeneration.current
        ) {
          return;
        }
        clearServerToolState(serverId);
        try {
          await refreshRuntime(operationGeneration);
        } catch (runtimeError) {
          if (
            actionGeneration !== toolRequestGeneration.current[serverId] ||
            operationGeneration !== runtimeActionGeneration.current
          ) {
            return;
          }
          setError(toErrorMessage(runtimeError, "Failed to refresh MCP status"));
          throw runtimeError;
        }
        if (
          actionGeneration !== toolRequestGeneration.current[serverId] ||
          operationGeneration !== runtimeActionGeneration.current
        ) {
          return;
        }
        await loadServerTools(serverId, true, actionGeneration).catch(() => undefined);
      } finally {
        releaseServerAction(serverId, "connect", loadingGeneration);
      }
    },
    [
      claimServerAction,
      claimToolRequestGeneration,
      clearServerToolState,
      loadServerTools,
      releaseServerAction,
      refreshRuntime,
      service,
    ],
  );

  const disconnectServer = useCallback(
    async (serverId: string) => {
      const operationGeneration = ++runtimeActionGeneration.current;
      const actionGeneration = claimToolRequestGeneration(serverId);
      const loadingGeneration = claimServerAction(serverId, "disconnect");
      setError(null);
      setToolErrorByServer((current) => omitRecordKeys(current, new Set([serverId])));
      try {
        try {
          await service.disconnectServer(serverId);
        } catch (disconnectError) {
          if (
            actionGeneration !== toolRequestGeneration.current[serverId] ||
            operationGeneration !== runtimeActionGeneration.current
          ) {
            return;
          }
          setError(toErrorMessage(disconnectError, "Failed to disconnect MCP server"));
          throw disconnectError;
        }
        if (
          actionGeneration !== toolRequestGeneration.current[serverId] ||
          operationGeneration !== runtimeActionGeneration.current
        ) {
          return;
        }
        clearServerToolState(serverId);
        try {
          await refreshRuntime(operationGeneration);
        } catch (runtimeError) {
          if (
            actionGeneration !== toolRequestGeneration.current[serverId] ||
            operationGeneration !== runtimeActionGeneration.current
          ) {
            return;
          }
          setError(toErrorMessage(runtimeError, "Failed to refresh MCP status"));
          throw runtimeError;
        }
      } finally {
        releaseServerAction(serverId, "disconnect", loadingGeneration);
      }
    },
    [
      claimServerAction,
      claimToolRequestGeneration,
      clearServerToolState,
      releaseServerAction,
      refreshRuntime,
      service,
    ],
  );

  const refreshServerTools = useCallback(
    async (serverId: string) => {
      const runtimeServer = runtimeServersRef.current.find((server) => server.id === serverId);
      if (!canQueryServerTools(runtimeServer)) return;
      const operationGeneration = ++runtimeActionGeneration.current;
      const refreshGeneration = claimToolRequestGeneration(serverId);
      const loadingGeneration = claimServerAction(serverId, "refresh");
      setError(null);
      setToolErrorByServer((prev) => omitRecordKeys(prev, new Set([serverId])));
      try {
        try {
          await service.refreshTools(serverId);
        } catch (refreshError) {
          const latestRuntimeServer = runtimeServersRef.current.find(
            (server) => server.id === serverId,
          );
          if (
            refreshGeneration !== toolRequestGeneration.current[serverId] ||
            operationGeneration !== runtimeActionGeneration.current ||
            !canQueryServerTools(latestRuntimeServer)
          ) {
            return;
          }
          setToolErrorByServer((prev) => ({
            ...prev,
            [serverId]: toErrorMessage(refreshError, "Failed to refresh MCP tools"),
          }));
          throw refreshError;
        }
        if (
          refreshGeneration !== toolRequestGeneration.current[serverId] ||
          operationGeneration !== runtimeActionGeneration.current
        ) {
          return;
        }
        await loadServerTools(serverId, true, refreshGeneration);
        if (
          refreshGeneration !== toolRequestGeneration.current[serverId] ||
          operationGeneration !== runtimeActionGeneration.current
        ) {
          return;
        }
        try {
          await refreshRuntime(operationGeneration);
        } catch (runtimeError) {
          if (
            refreshGeneration !== toolRequestGeneration.current[serverId] ||
            operationGeneration !== runtimeActionGeneration.current
          ) {
            return;
          }
          setError(toErrorMessage(runtimeError, "Failed to refresh MCP status"));
          throw runtimeError;
        }
      } finally {
        releaseServerAction(serverId, "refresh", loadingGeneration);
      }
    },
    [
      claimServerAction,
      claimToolRequestGeneration,
      loadServerTools,
      releaseServerAction,
      refreshRuntime,
      service,
    ],
  );

  const refreshAll = useCallback(async () => {
    const operationGeneration = ++runtimeActionGeneration.current;
    const actionGeneration = ++refreshAllGeneration.current;
    const toolOwners = new Map(
      servers
        .filter(canQueryServerTools)
        .map((server) => [server.id, claimToolRequestGeneration(server.id)]),
    );
    setIsRefreshingAll(true);
    setError(null);
    setToolErrorByServer((current) => omitRecordKeys(current, new Set(toolOwners.keys())));
    try {
      await Promise.all(
        servers.filter(canQueryServerTools).map(async (server) => {
          try {
            await service.refreshTools(server.id);
          } catch {
            // Continue; individual runtime errors appear in the status refresh.
          }
        }),
      );
      if (
        operationGeneration !== runtimeActionGeneration.current ||
        [...toolOwners].some(
          ([serverId, generation]) => generation !== toolRequestGeneration.current[serverId],
        )
      ) {
        return;
      }
      try {
        await refreshRuntime(operationGeneration);
      } catch (runtimeError) {
        if (
          operationGeneration !== runtimeActionGeneration.current ||
          [...toolOwners].some(
            ([serverId, generation]) => generation !== toolRequestGeneration.current[serverId],
          )
        ) {
          return;
        }
        setError(toErrorMessage(runtimeError, "Failed to refresh MCP status"));
        throw runtimeError;
      }
      const selectedOwner = selectedServerId ? toolOwners.get(selectedServerId) : undefined;
      if (
        operationGeneration !== runtimeActionGeneration.current ||
        (selectedServerId &&
          selectedOwner !== undefined &&
          selectedOwner !== toolRequestGeneration.current[selectedServerId])
      ) {
        return;
      }
      if (selectedServerId && selectedOwner !== undefined) {
        await loadServerTools(selectedServerId, true, selectedOwner);
      }
    } finally {
      if (actionGeneration === refreshAllGeneration.current) {
        setIsRefreshingAll(false);
      }
    }
  }, [
    claimToolRequestGeneration,
    loadServerTools,
    refreshRuntime,
    selectedServerId,
    servers,
    service,
  ]);

  const setSelectedServerId = useCallback((serverId: string | null) => {
    setSelectedServerIdState(serverId);
  }, []);

  const isServerActionLoading = useCallback(
    (serverId: string, action: McpServerAction): boolean =>
      Boolean(actionLoadingMap[getActionKey(serverId, action)]),
    [actionLoadingMap],
  );

  const selectedServerTools = useMemo(() => {
    if (!selectedServerId) return [];
    const selectedServer = servers.find((server) => server.id === selectedServerId);
    return canQueryServerTools(selectedServer) ? (toolsByServer[selectedServerId] ?? []) : [];
  }, [selectedServerId, servers, toolsByServer]);
  const selectedServerCanQueryTools = useMemo(() => {
    if (!selectedServerId) return false;
    return canQueryServerTools(servers.find((server) => server.id === selectedServerId));
  }, [selectedServerId, servers]);
  const selectedServerToolError = useMemo(() => {
    if (!selectedServerCanQueryTools || !selectedServerId) return null;
    return toolErrorByServer[selectedServerId] ?? null;
  }, [selectedServerCanQueryTools, selectedServerId, toolErrorByServer]);
  const isSelectedServerToolsLoading = useMemo(
    () =>
      Boolean(
        selectedServerCanQueryTools && selectedServerId && toolLoadingByServer[selectedServerId],
      ),
    [selectedServerCanQueryTools, selectedServerId, toolLoadingByServer],
  );

  useEffect(() => {
    void refreshServers().catch(() => undefined);
  }, [refreshServers]);

  useEffect(() => {
    const envelope = mcpSnapshot.envelope;
    if (mcpSnapshot.loading) {
      configAvailableRef.current = false;
      setConfigAvailable(false);
      return;
    }
    if (mcpSnapshot.error) {
      configAvailableRef.current = false;
      setConfigAvailable(false);
      setConfigLoadError(mcpSnapshot.error);
      return;
    }
    if (!envelope) {
      configAvailableRef.current = false;
      setConfigAvailable(false);
      return;
    }
    const healthy = envelope.status === "healthy";
    configAvailableRef.current = healthy;
    setConfigAvailable(healthy);
    setConfigLoadError(
      healthy ? null : (envelope.last_error ?? "MCP configuration is not healthy"),
    );
    if (envelope.revision <= (envelopeRef.current?.revision ?? -1)) return;
    const sequence = ++refreshSequence.current;
    const runtimeGeneration = ++runtimeSequence.current;
    const loadingGeneration = claimLoadingOwnership();
    adoptSection(envelope, runtimeServersRef.current, sequence);
    void service
      .getServers()
      .then((runtimeServers) => {
        if (sequence !== refreshSequence.current || runtimeGeneration !== runtimeSequence.current) {
          return;
        }
        setRuntimeStatusError(null);
        adoptSection(envelope, runtimeServers, sequence);
      })
      .catch((runtimeError: unknown) => {
        if (sequence !== refreshSequence.current || runtimeGeneration !== runtimeSequence.current) {
          return;
        }
        setRuntimeStatusError(
          toErrorMessage(
            runtimeError,
            "Configuration refreshed, but MCP runtime status is unavailable",
          ),
        );
      })
      .finally(() => {
        releaseLoadingOwnership(loadingGeneration);
      });
  }, [
    adoptSection,
    claimLoadingOwnership,
    mcpSnapshot.envelope,
    mcpSnapshot.error,
    mcpSnapshot.loading,
    releaseLoadingOwnership,
    service,
  ]);

  useEffect(() => {
    if (selectedServerId && selectedServerCanQueryTools) {
      void loadServerTools(selectedServerId).catch(() => undefined);
    }
  }, [loadServerTools, selectedServerCanQueryTools, selectedServerId]);

  return {
    servers,
    credentialStatusByServer,
    configRevision,
    selectedServerId,
    selectedServerTools,
    isLoadingServers,
    isMutatingConfig,
    isRefreshingAll,
    isSelectedServerToolsLoading,
    configAvailable,
    configError: configLoadError,
    runtimeError: runtimeStatusError,
    error: error ?? selectedServerToolError ?? configLoadError ?? runtimeStatusError,
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
