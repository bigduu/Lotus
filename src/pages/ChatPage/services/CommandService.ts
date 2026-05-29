import { debugLog } from "@shared/utils/debugFlags";
import { apiClient } from "@services/api";
import type { CommandItem, CommandListResponse } from "../types/command";

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

export class CommandService {
  private static instance: CommandService;
  private cache: CommandItem[] | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_TTL = 30000; // 30秒缓存

  private constructor() {}

  static getInstance(): CommandService {
    if (!CommandService.instance) {
      CommandService.instance = new CommandService();
    }
    return CommandService.instance;
  }

  async listCommands(forceRefresh = false): Promise<CommandItem[]> {
    const now = Date.now();

    if (!forceRefresh && this.cache && now - this.cacheTime < this.CACHE_TTL) {
      return this.cache;
    }

    try {
      const response = await apiClient.get<CommandListResponse>("commands");
      if (!Array.isArray(response.commands)) {
        throw new Error("Invalid command list response");
      }
      this.cache = mergeBuiltinCommands(response.commands);
      this.cacheTime = now;
      debugLog("[CommandService]", "[CommandService] Loaded commands:", this.cache.length);
      return this.cache;
    } catch (error) {
      console.error("[CommandService] Failed to list commands:", error);
      throw error;
    }
  }

  async getCommand(type: string, id: string): Promise<CommandDetail> {
    try {
      return await apiClient.get<CommandDetail>(`commands/${type}/${id}`);
    } catch (error) {
      console.error(`[CommandService] Failed to get command ${type}/${id}:`, error);
      throw error;
    }
  }

  clearCache() {
    this.cache = null;
    this.cacheTime = 0;
  }
}
