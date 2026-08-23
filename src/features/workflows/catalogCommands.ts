import type { CommandItem, CommandType } from "@shared/types/command";
import type { WorkflowCatalogItem, WorkflowCatalogView } from "./domain";
import { workflowCatalogItemKey } from "./domain";

const preferredCommandType = (item: WorkflowCatalogItem): CommandType =>
  item.kind === "instruction" ? "skill" : "workflow";

const commandMatchesCatalogItem = (command: CommandItem, item: WorkflowCatalogItem): boolean => {
  const allowedTypes: CommandType[] =
    item.kind === "instruction" && item.legacy
      ? ["skill", "workflow"]
      : [preferredCommandType(item)];
  if (!allowedTypes.includes(command.type)) return false;
  return (
    command.id === item.id ||
    command.name === item.id ||
    command.id === `${command.type}-${item.id}`
  );
};

const catalogMetadata = (
  item: WorkflowCatalogItem,
  selectable: boolean,
): CommandItem["metadata"] => ({
  workflowCatalog: true,
  workflowKind: item.kind,
  workflowSource: item.source,
  workflowStatus: item.status,
  workflowInvocationPolicy: item.invocationPolicy,
  ...(item.argumentHint ? { workflowArgumentHint: item.argumentHint } : {}),
  ...(item.revision !== undefined ? { workflowRevision: item.revision } : {}),
  ...(item.version ? { workflowVersion: item.version } : {}),
  ...(item.lastError ? { workflowLastError: item.lastError } : {}),
  ...(item.lastKnownGood ? { workflowLastKnownGood: true } : {}),
  workflowWinner: item.winner !== false,
  ...(item.legacy ? { workflowLegacy: true } : {}),
  workflowReadOnly: item.readOnly,
  workflowSelectable: selectable,
  ...(item.shadowedCandidates?.length
    ? {
        workflowShadowedCandidates: item.shadowedCandidates.map((candidate) => ({
          source: candidate.source,
          status: candidate.status,
          ...(candidate.legacy ? { legacy: true } : {}),
          ...(candidate.lastError ? { lastError: candidate.lastError } : {}),
        })),
      }
    : {}),
});

const catalogOnlyCommand = (item: WorkflowCatalogItem): CommandItem => ({
  id: `workflow-catalog:${encodeURIComponent(workflowCatalogItemKey(item))}`,
  name: item.id,
  displayName: item.name,
  description: item.description,
  type: preferredCommandType(item),
  category: "workflow-catalog",
  tags: [item.kind, item.source, item.status, item.invocationPolicy],
  metadata: catalogMetadata(item, false),
});

/**
 * Enrich legacy `/commands` rows with the authoritative metadata-only catalog
 * and retain every catalog namespace. Rows without an existing command remain
 * visible but intentionally non-selectable until typed activation (#231).
 */
export const mergeCommandsWithWorkflowCatalog = (
  commands: CommandItem[],
  catalog: WorkflowCatalogView | null,
): CommandItem[] => {
  if (!catalog) return commands;

  const claimedCommandIndexes = new Set<number>();
  const projectedByCommandIndex = new Map<number, CommandItem>();
  const catalogOnly: CommandItem[] = [];

  for (const item of catalog.items) {
    const commandIndex = commands.findIndex(
      (command, index) =>
        !claimedCommandIndexes.has(index) && commandMatchesCatalogItem(command, item),
    );
    if (commandIndex < 0) {
      catalogOnly.push(catalogOnlyCommand(item));
      continue;
    }

    claimedCommandIndexes.add(commandIndex);
    const command = commands[commandIndex];
    projectedByCommandIndex.set(commandIndex, {
      id: command.id,
      name: command.name,
      displayName: item.name,
      description: item.description,
      type: command.type,
      ...(command.category ? { category: command.category } : {}),
      ...(command.tags ? { tags: [...command.tags] } : {}),
      metadata: catalogMetadata(item, true),
    });
  }

  const authoritativeCommands = commands.flatMap((command, index) => {
    const projected = projectedByCommandIndex.get(index);
    if (projected) return [projected];
    if (
      catalog.capabilities.mode === "typed" &&
      (command.type === "skill" || command.type === "workflow")
    ) {
      return [];
    }
    return [command];
  });

  return [...authoritativeCommands, ...catalogOnly];
};

export const workflowCommandItemKey = (command: CommandItem): string => {
  const metadata = command.metadata;
  if (!metadata.workflowCatalog) return `${command.type}:${command.id}`;
  return JSON.stringify([
    command.type,
    command.id,
    metadata.workflowKind,
    metadata.workflowSource,
    metadata.workflowRevision ?? null,
    metadata.workflowVersion ?? null,
    metadata.workflowLegacy === true,
  ]);
};

export const isCommandSelectable = (command: CommandItem): boolean =>
  command.metadata.workflowSelectable !== false;
