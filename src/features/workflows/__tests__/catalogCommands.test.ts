import { describe, expect, it } from "vitest";
import type { CommandItem } from "@shared/types/command";
import { sanitizeCommandForList } from "@pages/ChatPage/services/CommandService";
import {
  isCommandSelectable,
  mergeCommandsWithWorkflowCatalog,
  workflowCommandItemKey,
} from "../catalogCommands";
import type { WorkflowCatalogView } from "../domain";

const catalog: WorkflowCatalogView = {
  revision: 9,
  diagnostics: [],
  capabilities: {
    mode: "typed",
    clone: false,
    edit: false,
    activate: false,
    run: false,
    cancel: false,
  },
  items: [
    {
      id: "review",
      name: "Review",
      description: "Review a scoped change.",
      kind: "instruction",
      source: "builtin",
      status: "invalid",
      winner: true,
      lastKnownGood: true,
      invocationPolicy: "both",
      argumentHint: "<scope> [focus]",
      argumentSchema: { type: "object", properties: { scope: { type: "string" } } },
      readOnly: true,
      revision: 7,
      version: "3",
      lastError: "Using sanitized metadata",
      shadowedCandidates: [{ source: "project", status: "invalid", lastError: "Bad override" }],
    },
    {
      id: "review",
      name: "Legacy review",
      description: "Preserved legacy orchestration.",
      kind: "orchestration",
      source: "user",
      status: "valid",
      winner: true,
      legacy: true,
      invocationPolicy: "manual",
      readOnly: false,
      revision: 8,
    },
    {
      id: "deploy",
      name: "Deploy",
      description: "Deploy with a typed Workflow.",
      kind: "orchestration",
      source: "plugin",
      status: "valid",
      winner: true,
      invocationPolicy: "manual",
      readOnly: true,
      revision: 4,
    },
  ],
};

describe("Workflow catalog command projection", () => {
  it("preserves same-id namespaces, exposes safe diagnostics, and disables catalog-only activation", () => {
    const commands: CommandItem[] = [
      {
        id: "skill-review",
        name: "review",
        displayName: "Review",
        description: "Old command metadata.",
        type: "skill",
        metadata: { prompt: "PRIVATE EXPANDED INSTRUCTION", toolRefs: ["PRIVATE RESOURCE"] },
      },
      {
        id: "workflow-review",
        name: "review",
        displayName: "Legacy review",
        description: "Old legacy metadata.",
        type: "workflow",
        metadata: { filename: "/private/workflows/review.md" },
      },
    ];

    const merged = mergeCommandsWithWorkflowCatalog(commands, catalog);

    expect(merged).toHaveLength(3);
    expect(new Set(merged.map(workflowCommandItemKey)).size).toBe(3);
    expect(merged[0].metadata).toMatchObject({
      workflowKind: "instruction",
      workflowSource: "builtin",
      workflowLastKnownGood: true,
      workflowArgumentHint: "<scope> [focus]",
      workflowSelectable: true,
    });
    expect(merged[1].metadata).toMatchObject({
      workflowKind: "orchestration",
      workflowSource: "user",
      workflowLegacy: true,
      workflowSelectable: true,
    });
    expect(merged[2].displayName).toBe("Deploy");
    expect(isCommandSelectable(merged[2])).toBe(false);

    const retained = JSON.stringify(merged);
    expect(retained).not.toContain("PRIVATE EXPANDED INSTRUCTION");
    expect(retained).not.toContain("PRIVATE RESOURCE");
    expect(retained).not.toContain("/private/workflows/review.md");
    expect(retained).not.toContain("argumentSchema");
  });

  it("sanitizes command-list cache entries before catalog merging", () => {
    const sanitized = sanitizeCommandForList({
      id: "skill-review",
      name: "review",
      displayName: "Review",
      description: "Review safely.",
      type: "skill",
      metadata: {
        prompt: "PRIVATE BODY",
        toolRefs: ["/private/reference.md"],
        metadata: { dynamic_context: "PRIVATE CONTEXT" },
        license: "MIT",
      },
    });

    expect(sanitized.metadata).toEqual({ license: "MIT" });
    expect(JSON.stringify(sanitized)).not.toContain("PRIVATE");
    expect(JSON.stringify(sanitized)).not.toContain("/private/reference.md");
  });

  it("treats a loaded typed catalog as authoritative for workflow rows only", () => {
    const merged = mergeCommandsWithWorkflowCatalog(
      [
        {
          id: "skill-missing",
          name: "missing",
          displayName: "Stale skill",
          description: "No longer published by the typed catalog.",
          type: "skill",
          metadata: {},
        },
        {
          id: "mcp-read",
          name: "mcp__files__read",
          displayName: "Read",
          description: "Read a file through MCP.",
          type: "mcp",
          metadata: { serverId: "files" },
        },
      ],
      catalog,
    );

    expect(merged.some((command) => command.id === "skill-missing")).toBe(false);
    expect(merged.some((command) => command.id === "mcp-read")).toBe(true);
    expect(merged.filter((command) => command.metadata.workflowCatalog)).toHaveLength(3);
  });
});
