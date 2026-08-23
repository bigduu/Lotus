import { debugLog } from "@shared/utils/debugFlags";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommandService } from "../../services/CommandService";
import type { CommandItem } from "@shared/types/command";
import {
  isCommandSelectable,
  mergeCommandsWithWorkflowCatalog,
  workflowCatalogQuery,
  type WorkflowCatalogQuerySource,
  type WorkflowCatalogView,
} from "../../../../features/workflows";

interface UseCommandSelectorStateProps {
  visible: boolean;
  sessionId?: string | null;
  searchText: string;
  onSelect: (command: CommandItem) => void;
  onCancel: () => void;
  onAutoComplete?: (command: CommandItem) => void;
  catalogQuery?: WorkflowCatalogQuerySource;
}

const commandSearchScore = (command: CommandItem, search: string): number | null => {
  if (!search) return 0;

  const name = command.name.toLowerCase();
  const displayName = (command.displayName ?? "").toLowerCase();
  const description = command.description.toLowerCase();
  const workflowMetadata = command.metadata.workflowCatalog
    ? [
        command.metadata.workflowKind,
        command.metadata.workflowSource,
        command.metadata.workflowStatus,
        command.metadata.workflowInvocationPolicy,
        command.metadata.workflowArgumentHint,
        command.metadata.workflowVersion,
        command.metadata.workflowLastError,
        ...(command.metadata.workflowShadowedCandidates ?? []).flatMap((candidate) => [
          candidate.source,
          candidate.status,
          candidate.lastError,
        ]),
      ]
        .filter((value): value is string => typeof value === "string")
        .join(" ")
        .toLowerCase()
    : "";

  if (name === search) return 0;
  if (name.startsWith(search)) return 1;
  if (displayName === search) return 2;
  if (displayName.startsWith(search)) return 3;
  if (name.includes(search)) return 4;
  if (displayName.includes(search)) return 5;
  if (description.includes(search)) return 6;
  if (workflowMetadata.includes(search)) return 7;

  if (
    command.type === "mcp" &&
    [command.metadata?.serverId, command.metadata?.serverName, command.metadata?.originalName]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLowerCase().includes(search))
  ) {
    return 8;
  }
  if (command.category?.toLowerCase().includes(search)) return 9;
  if (command.tags?.some((tag) => tag.toLowerCase().includes(search))) return 10;
  return null;
};

export const filterAndRankCommands = (
  commands: CommandItem[],
  searchText: string,
): CommandItem[] => {
  const search = searchText.trim().toLowerCase();
  return commands
    .map((command, index) => ({ command, index, score: commandSearchScore(command, search) }))
    .filter(
      (candidate): candidate is { command: CommandItem; index: number; score: number } =>
        candidate.score !== null,
    )
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map(({ command }) => command);
};

export const useCommandSelectorState = ({
  visible,
  sessionId,
  searchText,
  onSelect,
  onCancel,
  onAutoComplete,
  catalogQuery = workflowCatalogQuery,
}: UseCommandSelectorStateProps) => {
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [catalog, setCatalog] = useState<WorkflowCatalogView | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isCommandsLoading, setIsCommandsLoading] = useState(false);
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;

    const commandService = CommandService.getInstance();
    const controller = new AbortController();
    let cancelled = false;
    let catalogGeneration = 0;
    setCommands([]);
    setCatalog(null);
    const fetchCommands = async () => {
      setIsCommandsLoading(true);
      setCommandError(null);
      try {
        const fetchedCommands = await commandService.listCommands(sessionId);
        if (cancelled) return;
        debugLog("[CommandSelector]", "[CommandSelector] Fetched commands:", fetchedCommands);
        setCommands(fetchedCommands);
        setSelectedIndex(0);
      } catch (error) {
        if (cancelled) return;
        console.error("[CommandSelector] Failed to fetch commands:", error);
        setCommands([]);
        setCommandError(error instanceof Error ? error.message : "Command catalog unavailable");
      } finally {
        if (!cancelled) setIsCommandsLoading(false);
      }
    };

    const fetchCatalog = async (forceRefresh = false) => {
      const generation = ++catalogGeneration;
      setIsCatalogLoading(true);
      setCatalogError(null);
      try {
        const nextCatalog = await catalogQuery.load({
          sessionId,
          signal: controller.signal,
          forceRefresh,
        });
        if (cancelled || generation !== catalogGeneration) return;
        setCatalog(nextCatalog);
      } catch (error) {
        if (cancelled || controller.signal.aborted || generation !== catalogGeneration) return;
        console.error("[CommandSelector] Failed to fetch Workflow catalog:", error);
        setCatalogError(error instanceof Error ? error.message : "Workflow catalog unavailable");
      } finally {
        if (!cancelled && generation === catalogGeneration) setIsCatalogLoading(false);
      }
    };

    void fetchCommands();
    void fetchCatalog();
    const unsubscribe = catalogQuery.subscribe(() => {
      if (!cancelled) void fetchCatalog();
    });
    return () => {
      cancelled = true;
      controller.abort();
      unsubscribe();
    };
  }, [catalogQuery, visible, sessionId]);

  const mergedCommands = useMemo(
    () => mergeCommandsWithWorkflowCatalog(commands, catalog),
    [catalog, commands],
  );
  const filteredCommands = useMemo(
    () => filterAndRankCommands(mergedCommands, searchText),
    [mergedCommands, searchText],
  );

  useEffect(() => setSelectedIndex(0), [filteredCommands]);

  useEffect(() => {
    if (!selectedItemRef.current || !containerRef.current) return;
    const container = containerRef.current;
    const selectedItem = selectedItemRef.current;

    const containerRect = container.getBoundingClientRect();
    const selectedRect = selectedItem.getBoundingClientRect();

    if (selectedRect.top < containerRect.top) {
      selectedItem.scrollIntoView({ block: "start", behavior: "smooth" });
    } else if (selectedRect.bottom > containerRect.bottom) {
      selectedItem.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [selectedIndex, filteredCommands]);

  const handleCommandSelect = useCallback(
    async (command: CommandItem) => {
      if (!isCommandSelectable(command)) return;
      try {
        onSelect(command);
      } catch (error) {
        console.error(`[CommandSelector] Failed to select command '${command.name}':`, error);
      }
    },
    [onSelect],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!visible) return;

      switch (event.key) {
        case "ArrowDown":
        case "n":
          if (event.key === "n" && !event.ctrlKey) break;
          event.preventDefault();
          event.stopPropagation();
          setSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
          break;
        case "ArrowUp":
        case "p":
          if (event.key === "p" && !event.ctrlKey) break;
          event.preventDefault();
          event.stopPropagation();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
          break;
        case "Enter":
          event.preventDefault();
          event.stopPropagation();
          if (filteredCommands[selectedIndex]) {
            void handleCommandSelect(filteredCommands[selectedIndex]);
          }
          break;
        case " ":
        case "Tab":
          event.preventDefault();
          event.stopPropagation();
          if (filteredCommands[selectedIndex] && onAutoComplete) {
            if (isCommandSelectable(filteredCommands[selectedIndex])) {
              onAutoComplete(filteredCommands[selectedIndex]);
            }
          }
          break;
        case "Escape":
          event.preventDefault();
          event.stopPropagation();
          onCancel();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, filteredCommands, selectedIndex, onCancel, onAutoComplete, handleCommandSelect]);

  return {
    containerRef,
    selectedItemRef,
    filteredCommands,
    selectedIndex,
    setSelectedIndex,
    isLoading:
      (isCommandsLoading && commands.length === 0) ||
      (isCatalogLoading && catalog === null && commands.length === 0),
    loadError: [commandError, catalogError].filter(Boolean).join(" ") || null,
    catalogDiagnostics: catalog?.diagnostics ?? [],
    handleCommandSelect,
  };
};
