import { debugLog } from "@shared/utils/debugFlags";
import { apiClient } from "@services/api";
import type { CommandItem, CommandListResponse } from "@shared/types/command";

const BUILTIN_COMMANDS: CommandItem[] = [
  {
    id: "builtin-goal",
    name: "goal",
    displayName: "Goal",
    description: "Set, inspect, or clear the session goal using /goal commands.",
    type: "goal",
    category: "session",
    tags: ["goal", "session", "inspector"],
    metadata: {},
  },
];

const mergeBuiltinCommands = (commands: CommandItem[]): CommandItem[] => {
  const builtins = BUILTIN_COMMANDS.filter(
    (builtin) =>
      !commands.some((command) => command.name === builtin.name && command.type === builtin.type),
  );
  return [...builtins, ...commands];
};

const optionalMetadataString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

/** Keep command-list/cache state metadata-only; full details remain GET-on-select. */
export const sanitizeCommandForList = (command: CommandItem): CommandItem => {
  const metadata = command.metadata ?? {};
  const source =
    metadata.source === "global" || metadata.source === "workspace" ? metadata.source : undefined;
  return {
    id: command.id,
    name: command.name,
    displayName: command.displayName,
    description: command.description,
    type: command.type,
    ...(command.category ? { category: command.category } : {}),
    ...(command.tags ? { tags: [...command.tags] } : {}),
    metadata: {
      ...(source ? { source } : {}),
      ...(metadata.kind ? { kind: metadata.kind } : {}),
      ...(metadata.status ? { status: metadata.status } : {}),
      ...(metadata.invocationPolicy ? { invocationPolicy: { ...metadata.invocationPolicy } } : {}),
      ...(optionalMetadataString(metadata.argumentHint)
        ? { argumentHint: metadata.argumentHint }
        : {}),
      ...(metadata.argumentSchema ? { argumentSchema: { ...metadata.argumentSchema } } : {}),
      ...(optionalMetadataString(metadata.lastError) ? { lastError: metadata.lastError } : {}),
      ...(metadata.legacy === true ? { legacy: true } : {}),
      ...(optionalMetadataString(metadata.serverId) ? { serverId: metadata.serverId } : {}),
      ...(optionalMetadataString(metadata.serverName) ? { serverName: metadata.serverName } : {}),
      ...(optionalMetadataString(metadata.originalName)
        ? { originalName: metadata.originalName }
        : {}),
      ...(optionalMetadataString(metadata.license) ? { license: metadata.license } : {}),
      ...(optionalMetadataString(metadata.compatibility)
        ? { compatibility: metadata.compatibility }
        : {}),
      ...(metadata.workflowCatalog === true ? { workflowCatalog: true as const } : {}),
      ...(metadata.workflowKind ? { workflowKind: metadata.workflowKind } : {}),
      ...(metadata.workflowSource ? { workflowSource: metadata.workflowSource } : {}),
      ...(metadata.workflowStatus ? { workflowStatus: metadata.workflowStatus } : {}),
      ...(metadata.workflowInvocationPolicy
        ? { workflowInvocationPolicy: metadata.workflowInvocationPolicy }
        : {}),
      ...(optionalMetadataString(metadata.workflowArgumentHint)
        ? { workflowArgumentHint: metadata.workflowArgumentHint }
        : {}),
      ...(typeof metadata.workflowRevision === "number"
        ? { workflowRevision: metadata.workflowRevision }
        : {}),
      ...(optionalMetadataString(metadata.workflowVersion)
        ? { workflowVersion: metadata.workflowVersion }
        : {}),
      ...(optionalMetadataString(metadata.workflowLastError)
        ? { workflowLastError: metadata.workflowLastError }
        : {}),
      ...(metadata.workflowLastKnownGood === true ? { workflowLastKnownGood: true } : {}),
      ...(typeof metadata.workflowWinner === "boolean"
        ? { workflowWinner: metadata.workflowWinner }
        : {}),
      ...(metadata.workflowLegacy === true ? { workflowLegacy: true } : {}),
      ...(typeof metadata.workflowReadOnly === "boolean"
        ? { workflowReadOnly: metadata.workflowReadOnly }
        : {}),
      ...(typeof metadata.workflowSelectable === "boolean"
        ? { workflowSelectable: metadata.workflowSelectable }
        : {}),
      ...(metadata.workflowShadowedCandidates
        ? {
            workflowShadowedCandidates: metadata.workflowShadowedCandidates.map((candidate) => ({
              source: candidate.source,
              status: candidate.status,
              ...(candidate.legacy ? { legacy: true } : {}),
              ...(candidate.lastError ? { lastError: candidate.lastError } : {}),
            })),
          }
        : {}),
    },
  };
};

type CommandDetail = Record<string, unknown> & {
  content?: string;
};

interface CommandCacheEntry {
  commands: CommandItem[];
  cachedAt: number;
}

const normalizeSessionId = (sessionId?: string | null): string | null => {
  const normalized = sessionId?.trim();
  return normalized || null;
};

const commandPath = (path: string, sessionId?: string | null): string => {
  const normalizedSessionId = normalizeSessionId(sessionId);
  return normalizedSessionId
    ? `${path}?session_id=${encodeURIComponent(normalizedSessionId)}`
    : path;
};

export class CommandService {
  private static instance: CommandService;
  private readonly cache = new Map<string, CommandCacheEntry>();
  private readonly inFlight = new Map<string, Promise<CommandItem[]>>();
  private readonly CACHE_TTL = 30000; // 30秒缓存

  private constructor() {}

  static getInstance(): CommandService {
    if (!CommandService.instance) {
      CommandService.instance = new CommandService();
    }
    return CommandService.instance;
  }

  private pruneExpiredCache(now: number): void {
    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt >= this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }

  async listCommands(sessionId?: string | null, forceRefresh = false): Promise<CommandItem[]> {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const cacheKey = normalizedSessionId ? `session:${normalizedSessionId}` : "global";
    const now = Date.now();
    this.pruneExpiredCache(now);
    const cached = this.cache.get(cacheKey);

    if (!forceRefresh && cached && now - cached.cachedAt < this.CACHE_TTL) {
      return cached.commands;
    }

    const pending = this.inFlight.get(cacheKey);
    if (pending) return pending;

    const request = (async () => {
      try {
        const response = await apiClient.get<CommandListResponse>(
          commandPath("commands", normalizedSessionId),
        );
        if (!Array.isArray(response.commands)) {
          throw new Error("Invalid command list response");
        }
        const commands = mergeBuiltinCommands(response.commands.map(sanitizeCommandForList));
        this.cache.set(cacheKey, { commands, cachedAt: Date.now() });
        debugLog("[CommandService]", "[CommandService] Loaded commands:", commands.length);
        return commands;
      } catch (error) {
        console.error("[CommandService] Failed to list commands:", error);
        throw error;
      } finally {
        this.inFlight.delete(cacheKey);
      }
    })();

    this.inFlight.set(cacheKey, request);
    return request;
  }

  async getCommand(type: string, id: string, sessionId?: string | null): Promise<CommandDetail> {
    try {
      return await apiClient.get<CommandDetail>(commandPath(`commands/${type}/${id}`, sessionId));
    } catch (error) {
      console.error(`[CommandService] Failed to get command ${type}/${id}:`, error);
      throw error;
    }
  }

  clearCache() {
    this.cache.clear();
  }
}
