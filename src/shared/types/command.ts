export type CommandType = "workflow" | "skill" | "mcp" | "goal";

export interface CommandItem {
  id: string;
  name: string;
  displayName: string;
  description: string;
  type: CommandType;
  category?: string;
  tags?: string[];

  metadata: {
    // Workflow
    filename?: string;
    size?: number;
    source?: "global" | "workspace";

    // Skill
    prompt?: string;
    toolRefs?: string[];
    license?: string | null;
    compatibility?: string | null;
    metadata?: unknown;

    // MCP
    serverId?: string;
    serverName?: string;
    originalName?: string;
  };
}

export interface CommandListResponse {
  commands: CommandItem[];
  total: number;
}
