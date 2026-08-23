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
    kind?: "instruction" | "orchestration";
    status?: "valid" | "invalid" | "degraded" | "shadowed";
    invocationPolicy?: Record<string, unknown>;
    argumentHint?: string;
    argumentSchema?: Record<string, unknown>;
    lastError?: string;
    legacy?: boolean;

    // Skill
    prompt?: string;
    toolRefs?: string[];
    license?: string | null;
    compatibility?: string | null;
    metadata?: unknown;

    // Metadata-only Workflow catalog projection used by the `/` palette.
    // Expanded instructions, resources, argument values, dynamic context, and
    // storage paths must never be copied into this shape.
    workflowCatalog?: true;
    workflowKind?: "instruction" | "orchestration";
    workflowSource?: "builtin" | "project" | "workspace" | "user" | "plugin" | "legacy";
    workflowStatus?: "valid" | "invalid" | "degraded" | "shadowed";
    workflowInvocationPolicy?: "manual" | "automatic" | "both" | "unavailable";
    workflowArgumentHint?: string;
    workflowRevision?: number;
    workflowVersion?: string;
    workflowLastError?: string;
    workflowLastKnownGood?: boolean;
    workflowWinner?: boolean;
    workflowLegacy?: boolean;
    workflowReadOnly?: boolean;
    workflowSelectable?: boolean;
    workflowShadowedCandidates?: Array<{
      source: "builtin" | "project" | "workspace" | "user" | "plugin" | "legacy";
      status: "valid" | "invalid";
      legacy?: boolean;
      lastError?: string;
    }>;

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
