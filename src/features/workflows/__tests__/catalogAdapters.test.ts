import { ApiError } from "@services/api";
import type { CommandItem } from "@shared/types/command";
import type { WorkflowMetadata } from "@pages/ChatPage/services/WorkflowManagerService";
import { describe, expect, it, vi } from "vitest";
import {
  LegacyWorkflowCatalogAdapter,
  NegotiatedWorkflowCatalogAdapter,
  TypedWorkflowCatalogAdapter,
  type WorkflowCatalogAdapter,
} from "../catalogAdapters";
import type { WorkflowCatalogView } from "../domain";

const command = (overrides: Partial<CommandItem> = {}): CommandItem => ({
  id: "skill-review",
  name: "review",
  displayName: "Review",
  description: "Review changes against evidence.",
  type: "skill",
  metadata: {},
  ...overrides,
});

const legacyView: WorkflowCatalogView = {
  items: [],
  diagnostics: [],
  capabilities: {
    mode: "legacy",
    clone: false,
    edit: false,
    activate: false,
    run: false,
    cancel: false,
  },
};

describe("TypedWorkflowCatalogAdapter", () => {
  it("maps the typed catalog contract and scopes it to the normalized session", async () => {
    const signal = new AbortController().signal;
    const get = vi.fn(async () => ({
      revision: 41,
      entries: [
        {
          id: "review",
          name: "Review",
          description: "Review changes against evidence.",
          kind: "instruction",
          source: "builtin",
          revision: 7,
          version: "3",
          invocation_policy: { explicit: true, automatic: false },
          argument_schema: { type: "object", additionalProperties: false },
          status: "valid",
          winner: true,
          shadowed_candidates: [
            { source: "project", status: "valid" },
            { source: "user", status: "invalid", last_error: "invalid override" },
          ],
        },
        {
          id: "release-train",
          name: "Release train",
          description: "Coordinate a durable release.",
          kind: "orchestration",
          source: "plugin",
          revision: 2,
          invocation_policy: { explicit: true, automatic: true },
          argument_hint: "release version",
          status: "valid",
          winner: true,
        },
        {
          id: "legacy-review",
          name: "Legacy review",
          description: "Legacy repository review workflow.",
          kind: "instruction",
          source: "workspace",
          revision: 4,
          invocation_policy: { explicit: true, automatic: false },
          status: "valid",
          winner: true,
          legacy: true,
          migration_status: "available",
          shadowed_candidates: [
            {
              source: "plugin",
              status: "valid",
              legacy: true,
              migration_status: "available",
            },
          ],
        },
      ],
    }));

    const result = await new TypedWorkflowCatalogAdapter(get).load({
      sessionId: "  session/one  ",
      signal,
    });

    expect(get).toHaveBeenCalledWith("bamboo/workflow-catalog?session_id=session%2Fone", {
      signal,
    });
    expect(result).toEqual({
      revision: 41,
      items: [
        {
          id: "review",
          name: "Review",
          description: "Review changes against evidence.",
          kind: "instruction",
          source: "builtin",
          status: "valid",
          invocationPolicy: "manual",
          argumentHint: undefined,
          argumentSchema: { type: "object", additionalProperties: false },
          readOnly: true,
          revision: 7,
          version: "3",
          lastError: undefined,
          shadowedCandidates: [
            { source: "project", status: "valid", lastError: undefined },
            { source: "user", status: "invalid", lastError: "invalid override" },
          ],
        },
        {
          id: "release-train",
          name: "Release train",
          description: "Coordinate a durable release.",
          kind: "orchestration",
          source: "plugin",
          status: "valid",
          invocationPolicy: "both",
          argumentHint: "release version",
          argumentSchema: undefined,
          readOnly: true,
          revision: 2,
          version: undefined,
          lastError: undefined,
        },
        {
          id: "legacy-review",
          name: "Legacy review",
          description: "Legacy repository review workflow.",
          kind: "instruction",
          source: "workspace",
          status: "valid",
          legacy: true,
          migrationStatus: "available",
          invocationPolicy: "manual",
          argumentHint: undefined,
          argumentSchema: undefined,
          readOnly: false,
          revision: 4,
          version: undefined,
          lastError: undefined,
          shadowedCandidates: [
            {
              source: "plugin",
              status: "valid",
              legacy: true,
              migrationStatus: "available",
              lastError: undefined,
            },
          ],
        },
      ],
      diagnostics: [],
      capabilities: {
        mode: "typed",
        clone: false,
        edit: false,
        activate: false,
        run: false,
        cancel: false,
      },
    });
  });

  it("keeps valid entries when another typed entry is invalid", async () => {
    const adapter = new TypedWorkflowCatalogAdapter(async () => ({
      revision: 9,
      entries: [
        {
          id: "research",
          name: "Research",
          description: "Research with sources.",
          kind: "instruction",
          source: "user",
          revision: 3,
          invocation_policy: { automatic: true },
          status: "valid",
          winner: true,
        },
        {
          id: "broken",
          name: "Broken",
          description: "",
          kind: "instruction",
          source: "user",
          revision: 4,
          invocation_policy: { explicit: true },
          status: "valid",
          winner: true,
        },
        "not-an-entry",
      ],
    }));

    const result = await adapter.load();

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: "research",
      invocationPolicy: "implicit",
      readOnly: false,
    });
    expect(result.diagnostics).toEqual([
      { entryIndex: 1, itemId: "broken", message: "missing description" },
      { entryIndex: 2, itemId: undefined, message: "entry is not an object" },
    ]);
  });

  it("rejects a malformed top-level snapshot rather than presenting fake data", async () => {
    const adapter = new TypedWorkflowCatalogAdapter(async () => ({
      revision: -1,
      entries: [],
    }));

    await expect(adapter.load()).rejects.toThrow("Invalid typed workflow catalog response");
  });
});

describe("LegacyWorkflowCatalogAdapter", () => {
  it("maps only workflow-shaped commands and legacy workflow metadata", async () => {
    const workflowCommand = command({
      metadata: {
        kind: "orchestration",
        source: "workspace",
        status: "degraded",
        invocationPolicy: { explicit: true, automatic: true },
        argumentHint: "target environment",
        lastError: "dependency unavailable",
      } as CommandItem["metadata"],
    });
    const promptWorkflow = command({
      id: "workflow-deploy",
      name: "deploy",
      displayName: "Deploy",
      description: "Deploy with the legacy prompt path.",
      type: "workflow",
      metadata: { source: "global" },
    });
    const mcp = command({ id: "mcp-read", name: "read", type: "mcp" });
    const workflows: WorkflowMetadata[] = [
      {
        name: "deploy",
        filename: "deploy.md",
        source: "global",
        size: 100,
      },
      {
        name: "triage",
        filename: "triage.md",
        source: "workspace",
        size: 80,
      },
    ];
    const listCommands = vi.fn(async () => [workflowCommand, promptWorkflow, mcp]);
    const listWorkflows = vi.fn(async () => workflows);

    const result = await new LegacyWorkflowCatalogAdapter({
      listCommands,
      listWorkflows,
    }).load({ sessionId: "session-9" });

    expect(listCommands).toHaveBeenCalledWith("session-9");
    expect(result.revision).toBeUndefined();
    expect(result.items).toEqual([
      {
        id: "deploy",
        name: "Deploy",
        description: "Deploy with the legacy prompt path.",
        kind: "instruction",
        source: "legacy",
        status: "valid",
        invocationPolicy: "manual",
        argumentHint: undefined,
        argumentSchema: undefined,
        readOnly: false,
        lastError: undefined,
      },
      {
        id: "review",
        name: "Review",
        description: "Review changes against evidence.",
        kind: "orchestration",
        source: "project",
        status: "degraded",
        invocationPolicy: "both",
        argumentHint: "target environment",
        argumentSchema: undefined,
        readOnly: false,
        lastError: "dependency unavailable",
      },
      {
        id: "triage",
        name: "triage",
        description: "triage.md",
        kind: "instruction",
        source: "project",
        status: "valid",
        invocationPolicy: "manual",
        readOnly: false,
      },
    ]);
    expect(result.capabilities).toMatchObject({
      mode: "legacy",
      edit: true,
      activate: false,
      run: false,
    });
  });

  it("returns a diagnostic when one legacy source is unavailable", async () => {
    const adapter = new LegacyWorkflowCatalogAdapter({
      listCommands: async () => {
        throw new Error("commands unavailable");
      },
      listWorkflows: async () => [
        { name: "review", filename: "review.md", source: "global", size: 10 },
      ],
    });

    const result = await adapter.load();

    expect(result.items).toHaveLength(1);
    expect(result.diagnostics).toEqual([{ message: "Legacy command catalog is unavailable" }]);
  });
});

describe("NegotiatedWorkflowCatalogAdapter", () => {
  it.each([404, 405])("falls back on typed endpoint availability status %s", async (status) => {
    const typed: WorkflowCatalogAdapter = {
      load: vi.fn(async () => {
        throw new ApiError("not available", status, "Not Available");
      }),
    };
    const legacy: WorkflowCatalogAdapter = { load: vi.fn(async () => legacyView) };
    const adapter = new NegotiatedWorkflowCatalogAdapter(typed, legacy);

    await expect(adapter.load({ sessionId: "session-1" })).resolves.toBe(legacyView);
    expect(legacy.load).toHaveBeenCalledWith({ sessionId: "session-1" });
  });

  it("does not hide typed contract failures behind legacy data", async () => {
    const typedError = new ApiError("server failure", 500, "Server Error");
    const typed: WorkflowCatalogAdapter = {
      load: vi.fn(async () => {
        throw typedError;
      }),
    };
    const legacy: WorkflowCatalogAdapter = { load: vi.fn(async () => legacyView) };

    await expect(new NegotiatedWorkflowCatalogAdapter(typed, legacy).load()).rejects.toBe(
      typedError,
    );
    expect(legacy.load).not.toHaveBeenCalled();
  });
});
