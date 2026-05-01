import { parseMcpToolAlias } from "./mcpAlias";

/**
 * Generate a human-readable intent description from tool name and parameters.
 * Shared between ToolCallCard, ToolStepsCard, and ToolSessionCard.
 */
export function generateIntentDescription(
  toolName: string,
  params: Record<string, unknown>,
): string {
  const mcpParts = parseMcpToolAlias(toolName);
  if (mcpParts) {
    return `MCP ${mcpParts.serverId}: ${mcpParts.toolName}`;
  }

  const truncate = (value: unknown, maxLen: number) => {
    const str = typeof value === "string" ? value : String(value ?? "");
    if (!str || str.length <= maxLen) return str;
    return str.substring(0, maxLen).trimEnd() + "…";
  };

  const nameMap: Record<string, (p: typeof params) => string> = {
    file_read: (p) => `Reading: ${truncate(p.path || p.file_path || "file", 40)}`,
    file_write: (p) => `Writing to: ${truncate(p.path || p.file_path || "file", 35)}`,
    file_edit: (p) => `Editing: ${truncate(p.path || p.file_path || "file", 40)}`,
    bash: (p) => `Executing: ${truncate(p.command, 40)}`,
    grep: (p) => `Searching: "${truncate(p.pattern, 30)}"`,
    glob: (p) => `Finding files: "${p.pattern}"`,
    conclusion: (p) => `Presenting conclusion: "${truncate(p.conclusion || p.title || "", 30)}"`,
    read: (p) => `Reading: ${p.file_path || "file"}`,
    write: (p) => `Writing: ${p.file_path || "file"}`,
    edit: (p) => `Editing: ${p.file_path || "file"}`,
    search: (p) => `Searching: "${truncate(p.query || p.pattern, 30)}"`,
    default: () => `Calling ${toolName}`,
  };

  const generator = nameMap[toolName] || nameMap["default"];
  return generator(params);
}
