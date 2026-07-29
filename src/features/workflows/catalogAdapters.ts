import { apiClient, isApiError } from "@services/api";
import type { CommandItem } from "@shared/types/command";
import { CommandService } from "@pages/ChatPage/services/CommandService";
import {
  WorkflowManagerService,
  type WorkflowMetadata,
} from "@pages/ChatPage/services/WorkflowManagerService";
import type {
  InvocationPolicy,
  WorkflowCatalogCapabilities,
  WorkflowCatalogDiagnostic,
  WorkflowCatalogItem,
  WorkflowCatalogView,
  WorkflowKind,
  WorkflowMigrationStatus,
  WorkflowShadowedCandidate,
  WorkflowSource,
  WorkflowStatus,
} from "./domain";

export interface WorkflowCatalogLoadOptions {
  sessionId?: string | null;
  signal?: AbortSignal;
}

export interface WorkflowCatalogAdapter {
  load(options?: WorkflowCatalogLoadOptions): Promise<WorkflowCatalogView>;
}

type JsonObject = Record<string, unknown>;

interface TypedWorkflowCatalogSnapshot {
  revision: number;
  entries: unknown[];
}

type CatalogGet = <T>(path: string, options?: RequestInit) => Promise<T>;

const TYPED_CAPABILITIES: WorkflowCatalogCapabilities = {
  mode: "typed",
  clone: false,
  edit: false,
  activate: false,
  run: false,
  cancel: false,
};

const LEGACY_CAPABILITIES: WorkflowCatalogCapabilities = {
  mode: "legacy",
  clone: false,
  edit: true,
  activate: false,
  run: false,
  cancel: false,
};

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`missing ${field}`);
  }
  return value.trim();
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

type RawWorkflowKind = "instruction" | WorkflowKind;

const isRawWorkflowKind = (value: unknown): value is RawWorkflowKind =>
  value === "instruction" || value === "orchestration";

const isWorkflowSource = (value: unknown): value is WorkflowSource =>
  value === "builtin" ||
  value === "project" ||
  value === "workspace" ||
  value === "user" ||
  value === "plugin" ||
  value === "legacy";

const isWorkflowStatus = (value: unknown): value is WorkflowStatus =>
  value === "valid" || value === "invalid" || value === "degraded" || value === "shadowed";

const migrationStatusFromTyped = (value: unknown): WorkflowMigrationStatus | undefined => {
  if (value === undefined || value === null) return undefined;
  if (value === "available" || value === "migrated") return value;
  throw new Error("invalid migration status");
};

const invocationPolicyFromMetadata = (value: unknown): InvocationPolicy => {
  if (!isJsonObject(value)) return "manual";
  const manual = value.explicit === true || value.manual === true;
  const implicit = value.automatic === true || value.implicit === true;
  if (manual && implicit) return "both";
  return implicit ? "implicit" : "manual";
};

const readOnlyForSource = (source: WorkflowSource): boolean =>
  source === "builtin" || source === "plugin";

const shadowedCandidateFromTyped = (raw: unknown): WorkflowShadowedCandidate => {
  if (!isJsonObject(raw)) throw new Error("shadowed candidate is not an object");
  if (!isWorkflowSource(raw.source)) throw new Error("invalid shadowed candidate source");
  if (raw.status !== "valid" && raw.status !== "invalid") {
    throw new Error("invalid shadowed candidate status");
  }
  const migrationStatus = migrationStatusFromTyped(raw.migration_status ?? raw.migrationStatus);
  return {
    source: raw.source,
    status: raw.status,
    ...(raw.legacy === true ? { legacy: true } : {}),
    ...(migrationStatus ? { migrationStatus } : {}),
    lastError: optionalString(raw.last_error ?? raw.lastError),
  };
};

const typedEntryToCatalogItem = (raw: unknown): WorkflowCatalogItem | null => {
  if (!isJsonObject(raw)) throw new Error("entry is not an object");

  const id = requiredString(raw.id, "id");
  const kind = raw.kind;
  const source = raw.source;
  const rawStatus = raw.winner === false ? "shadowed" : raw.status;
  if (!isRawWorkflowKind(kind)) throw new Error("invalid kind");
  if (!isWorkflowSource(source)) throw new Error("invalid source");
  if (!isWorkflowStatus(rawStatus)) throw new Error("invalid status");
  if (typeof raw.revision !== "number" || !Number.isSafeInteger(raw.revision) || raw.revision < 0) {
    throw new Error("invalid revision");
  }

  const invocationPolicy = raw.invocation_policy ?? raw.invocationPolicy;
  const argumentSchema = raw.argument_schema ?? raw.argumentSchema;
  const argumentHint = raw.argument_hint ?? raw.argumentHint;
  const shadowedCandidates = raw.shadowed_candidates ?? raw.shadowedCandidates ?? [];
  if (!Array.isArray(shadowedCandidates)) throw new Error("invalid shadowed candidates");
  const mappedShadowedCandidates = shadowedCandidates.map(shadowedCandidateFromTyped);
  const migrationStatus = migrationStatusFromTyped(raw.migration_status ?? raw.migrationStatus);
  const isLegacyWorkflow =
    raw.legacy === true || source === "legacy" || migrationStatus !== undefined;

  // Older Bamboo releases exposed every SKILL.md bundle through this endpoint
  // as an "instruction" workflow. Keep compatibility for explicitly identified
  // legacy Workflows, but never relabel an ordinary Skill as a Workflow.
  if (kind !== "orchestration" && !isLegacyWorkflow) return null;

  return {
    id,
    name: requiredString(raw.name, "name"),
    description: requiredString(raw.description, "description"),
    kind: "orchestration",
    source,
    status: rawStatus,
    ...(isLegacyWorkflow ? { legacy: true } : {}),
    ...(migrationStatus ? { migrationStatus } : {}),
    invocationPolicy: invocationPolicyFromMetadata(invocationPolicy),
    argumentHint: optionalString(argumentHint),
    argumentSchema: isJsonObject(argumentSchema) ? argumentSchema : undefined,
    readOnly: readOnlyForSource(source),
    revision: raw.revision,
    version: optionalString(raw.version),
    lastError: optionalString(raw.last_error ?? raw.lastError),
    ...(mappedShadowedCandidates.length > 0
      ? { shadowedCandidates: mappedShadowedCandidates }
      : {}),
  };
};

const typedCatalogPath = (sessionId?: string | null): string => {
  const normalized = sessionId?.trim();
  return normalized
    ? `bamboo/workflow-catalog?session_id=${encodeURIComponent(normalized)}`
    : "bamboo/workflow-catalog";
};

export class TypedWorkflowCatalogAdapter implements WorkflowCatalogAdapter {
  constructor(private readonly get: CatalogGet = (path, options) => apiClient.get(path, options)) {}

  async load(options: WorkflowCatalogLoadOptions = {}): Promise<WorkflowCatalogView> {
    const snapshot = await this.get<TypedWorkflowCatalogSnapshot>(
      typedCatalogPath(options.sessionId),
      { signal: options.signal },
    );
    if (
      !isJsonObject(snapshot) ||
      typeof snapshot.revision !== "number" ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0 ||
      !Array.isArray(snapshot.entries)
    ) {
      throw new Error("Invalid typed workflow catalog response");
    }

    const items: WorkflowCatalogItem[] = [];
    const diagnostics: WorkflowCatalogDiagnostic[] = [];
    snapshot.entries.forEach((entry, entryIndex) => {
      try {
        const item = typedEntryToCatalogItem(entry);
        if (item) items.push(item);
      } catch (error) {
        diagnostics.push({
          entryIndex,
          itemId: isJsonObject(entry) ? optionalString(entry.id) : undefined,
          message: error instanceof Error ? error.message : "invalid catalog entry",
        });
      }
    });

    return {
      revision: snapshot.revision,
      items,
      diagnostics,
      capabilities: { ...TYPED_CAPABILITIES },
    };
  }
}

interface LegacyWorkflowCatalogDependencies {
  listCommands: (sessionId?: string | null) => Promise<CommandItem[]>;
  listWorkflows: () => Promise<WorkflowMetadata[]>;
}

const legacySource = (value: unknown): WorkflowSource => {
  if (value === "workspace" || value === "project") return "project";
  if (value === "builtin" || value === "user" || value === "plugin") return value;
  return "legacy";
};

const commandToCatalogItem = (command: CommandItem): WorkflowCatalogItem | null => {
  const metadata = command.metadata as JsonObject;
  if (command.type !== "workflow") return null;
  const source = legacySource(metadata.source);
  const status = isWorkflowStatus(metadata.status) ? metadata.status : "valid";
  const isLegacyWorkflow = metadata.legacy === true || metadata.kind !== "orchestration";
  return {
    id: command.name,
    name: command.displayName || command.name,
    description: command.description || command.name,
    kind: "orchestration",
    source,
    status,
    ...(isLegacyWorkflow ? { legacy: true } : {}),
    invocationPolicy: invocationPolicyFromMetadata(metadata.invocationPolicy),
    argumentHint: optionalString(metadata.argumentHint),
    argumentSchema: isJsonObject(metadata.argumentSchema) ? metadata.argumentSchema : undefined,
    readOnly: readOnlyForSource(source),
    lastError: optionalString(metadata.lastError),
  };
};

const workflowMetadataToCatalogItem = (workflow: WorkflowMetadata): WorkflowCatalogItem => ({
  id: workflow.name,
  name: workflow.name,
  description: workflow.filename,
  kind: "orchestration",
  source: workflow.source === "workspace" ? "project" : "legacy",
  status: "valid",
  legacy: true,
  invocationPolicy: "manual",
  readOnly: false,
});

export class LegacyWorkflowCatalogAdapter implements WorkflowCatalogAdapter {
  private readonly dependencies: LegacyWorkflowCatalogDependencies;

  constructor(dependencies?: Partial<LegacyWorkflowCatalogDependencies>) {
    this.dependencies = {
      listCommands: (sessionId) => CommandService.getInstance().listCommands(sessionId),
      listWorkflows: () => WorkflowManagerService.getInstance().listWorkflows(),
      ...dependencies,
    };
  }

  async load(options: WorkflowCatalogLoadOptions = {}): Promise<WorkflowCatalogView> {
    const [commandsResult, workflowsResult] = await Promise.allSettled([
      this.dependencies.listCommands(options.sessionId),
      this.dependencies.listWorkflows(),
    ]);
    if (commandsResult.status === "rejected" && workflowsResult.status === "rejected") {
      throw commandsResult.reason;
    }

    const diagnostics: WorkflowCatalogDiagnostic[] = [];
    if (commandsResult.status === "rejected") {
      diagnostics.push({ message: "Legacy command catalog is unavailable" });
    }
    if (workflowsResult.status === "rejected") {
      diagnostics.push({ message: "Legacy workflow catalog is unavailable" });
    }

    const itemsById = new Map<string, WorkflowCatalogItem>();
    if (commandsResult.status === "fulfilled") {
      for (const command of commandsResult.value) {
        const item = commandToCatalogItem(command);
        if (item) itemsById.set(item.id, item);
      }
    }
    if (workflowsResult.status === "fulfilled") {
      for (const workflow of workflowsResult.value) {
        const item = workflowMetadataToCatalogItem(workflow);
        if (!itemsById.has(item.id)) itemsById.set(item.id, item);
      }
    }

    return {
      items: [...itemsById.values()].sort((left, right) => left.name.localeCompare(right.name)),
      diagnostics,
      capabilities: { ...LEGACY_CAPABILITIES },
    };
  }
}

export const isTypedCatalogUnavailable = (error: unknown): boolean =>
  isApiError(error) && (error.status === 404 || error.status === 405);

export class NegotiatedWorkflowCatalogAdapter implements WorkflowCatalogAdapter {
  constructor(
    private readonly typed: WorkflowCatalogAdapter = new TypedWorkflowCatalogAdapter(),
    private readonly legacy: WorkflowCatalogAdapter = new LegacyWorkflowCatalogAdapter(),
  ) {}

  async load(options: WorkflowCatalogLoadOptions = {}): Promise<WorkflowCatalogView> {
    try {
      return await this.typed.load(options);
    } catch (error) {
      if (!isTypedCatalogUnavailable(error)) throw error;
      return this.legacy.load(options);
    }
  }
}
