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

  async listCommands(sessionId?: string | null, forceRefresh = false): Promise<CommandItem[]> {
    const normalizedSessionId = normalizeSessionId(sessionId);
    const cacheKey = normalizedSessionId ? `session:${normalizedSessionId}` : "global";
    const now = Date.now();
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
        const commands = mergeBuiltinCommands(response.commands);
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
