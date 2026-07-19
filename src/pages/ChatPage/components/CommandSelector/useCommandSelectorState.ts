import { debugLog } from "@shared/utils/debugFlags";
import { useCallback, useEffect, useRef, useState } from "react";
import { CommandService } from "../../services/CommandService";
import type { CommandItem } from "@shared/types/command";

interface UseCommandSelectorStateProps {
  visible: boolean;
  sessionId?: string | null;
  searchText: string;
  onSelect: (command: { name: string; type: string; id: string }) => void;
  onCancel: () => void;
  onAutoComplete?: (commandName: string) => void;
}

const commandSearchScore = (command: CommandItem, search: string): number | null => {
  if (!search) return 0;

  const name = command.name.toLowerCase();
  const displayName = (command.displayName ?? "").toLowerCase();
  const description = command.description.toLowerCase();

  if (name === search) return 0;
  if (name.startsWith(search)) return 1;
  if (displayName === search) return 2;
  if (displayName.startsWith(search)) return 3;
  if (name.includes(search)) return 4;
  if (displayName.includes(search)) return 5;
  if (description.includes(search)) return 6;

  if (
    command.type === "mcp" &&
    [command.metadata?.serverId, command.metadata?.serverName, command.metadata?.originalName]
      .filter((value): value is string => typeof value === "string")
      .some((value) => value.toLowerCase().includes(search))
  ) {
    return 7;
  }
  if (command.category?.toLowerCase().includes(search)) return 8;
  if (command.tags?.some((tag) => tag.toLowerCase().includes(search))) return 9;
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
}: UseCommandSelectorStateProps) => {
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [filteredCommands, setFilteredCommands] = useState<CommandItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedItemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;

    const commandService = CommandService.getInstance();
    let cancelled = false;
    const fetchCommands = async () => {
      setIsLoading(true);
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
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    fetchCommands();
    return () => {
      cancelled = true;
    };
  }, [visible, sessionId]);

  useEffect(() => {
    setFilteredCommands(filterAndRankCommands(commands, searchText));
    setSelectedIndex(0);
  }, [commands, searchText]);

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
      try {
        onSelect({
          name: command.name,
          type: command.type,
          id: command.id,
        });
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
            handleCommandSelect(filteredCommands[selectedIndex]);
          }
          break;
        case " ":
        case "Tab":
          event.preventDefault();
          event.stopPropagation();
          if (filteredCommands[selectedIndex] && onAutoComplete) {
            onAutoComplete(filteredCommands[selectedIndex].name);
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
    isLoading,
    handleCommandSelect,
  };
};
