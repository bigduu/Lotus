import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { CommandService } from "../../services/CommandService";
import type { WorkflowCommandInfo } from "../../utils/inputHighlight";
import type { WorkflowDraft } from "./index";
import type { CommandItem } from "@shared/types/command";
import { parseMcpToolAlias } from "../../utils/mcpAlias";
import {
  defaultWorkflowArguments,
  isTypedWorkflowSource,
  parseWorkflowArguments,
  workflowCatalogQuery,
} from "../../../../features/workflows";

interface UseInputContainerCommandProps {
  setContent: (value: string) => void;
  onWorkflowDraftChange?: (workflow: WorkflowDraft | null) => void;
  acknowledgeManualInput: () => void;
  currentSessionId: string | null;
  textAreaRef: React.RefObject<TextAreaRef>;
  content: string;
  selectedCommand?: WorkflowDraft | null;
  setSelectedCommand?: Dispatch<SetStateAction<WorkflowDraft | null>>;
}

export const useInputContainerCommand = ({
  setContent,
  onWorkflowDraftChange,
  acknowledgeManualInput,
  currentSessionId,
  textAreaRef,
  content,
  selectedCommand: controlledSelectedCommand,
  setSelectedCommand: controlledSetSelectedCommand,
}: UseInputContainerCommandProps) => {
  const [showCommandSelector, setShowCommandSelector] = useState(false);
  const [commandSearchText, setCommandSearchText] = useState("");
  const [localSelectedCommand, setLocalSelectedCommand] = useState<WorkflowDraft | null>(null);
  const selectedCommand =
    controlledSelectedCommand === undefined ? localSelectedCommand : controlledSelectedCommand;
  const setSelectedCommand = controlledSetSelectedCommand ?? setLocalSelectedCommand;
  const selectedCommandRef = useRef<WorkflowDraft | null>(null);
  selectedCommandRef.current = selectedCommand;
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  const commitCommandDraft = useCallback(
    (draft: WorkflowDraft | null) => {
      selectedCommandRef.current = draft;
      setSelectedCommand(draft);
    },
    [setSelectedCommand],
  );

  useEffect(() => {
    onWorkflowDraftChange?.(selectedCommand);
  }, [onWorkflowDraftChange, selectedCommand]);

  useEffect(() => {
    if (controlledSelectedCommand === undefined) {
      setLocalSelectedCommand(null);
    }
  }, [controlledSelectedCommand, currentSessionId]);

  const matchesCommandToken = useCallback((value: string, commandName: string) => {
    const trimmedValue = value.trimStart();
    const token = `/${commandName}`;
    if (!trimmedValue.startsWith(token)) {
      return false;
    }
    const nextChar = trimmedValue.charAt(token.length);
    return !nextChar || /\s/.test(nextChar);
  }, []);

  const clearCommandDraft = useCallback(
    (expectedDraft?: WorkflowDraft | null) => {
      setSelectedCommand((current) => {
        if (expectedDraft !== undefined && current !== expectedDraft) return current;
        selectedCommandRef.current = null;
        return null;
      });
    },
    [setSelectedCommand],
  );

  const updateCommandDraftPreview = useCallback(
    (value: string, command: WorkflowDraft) => {
      if (!matchesCommandToken(value, command.name)) {
        return;
      }
      if (command.workflowSelection) {
        onWorkflowDraftChange?.(command);
        return;
      }
      const token = `/${command.name}`;
      const trimmedValue = value.trim();
      const extraInput = trimmedValue.slice(token.length).trim();
      const content = [command.content, extraInput].filter(Boolean).join("\n\n");
      onWorkflowDraftChange?.({ ...command, content });
    },
    [matchesCommandToken, onWorkflowDraftChange],
  );

  const handleInputChange = useCallback(
    (value: string) => {
      acknowledgeManualInput();
      if (selectedCommand && !matchesCommandToken(value, selectedCommand.name)) {
        clearCommandDraft();
      }
      if (selectedCommand && matchesCommandToken(value, selectedCommand.name)) {
        updateCommandDraftPreview(value, selectedCommand);
      }
      setContent(value);
    },
    [
      acknowledgeManualInput,
      clearCommandDraft,
      matchesCommandToken,
      selectedCommand,
      updateCommandDraftPreview,
      setContent,
    ],
  );

  const handleCommandChange = useCallback((info: WorkflowCommandInfo) => {
    setShowCommandSelector(info.isTriggerActive);
    setCommandSearchText(info.isTriggerActive ? info.searchText : "");
  }, []);

  const applyCommandDraft = useCallback(
    async (command: CommandItem) => {
      const requestSessionId = currentSessionId;
      setShowCommandSelector(false);

      const getInsertToken = (cmd: CommandItem): string => {
        if (cmd.type === "goal") return cmd.name;
        if (cmd.type !== "mcp") return cmd.name;
        // Prefer server-provided original tool name (short, user-friendly).
        const original = cmd.metadata?.originalName;
        if (typeof original === "string" && original.trim()) {
          return original.trim();
        }
        // Fallback: parse from alias (mcp__server__tool).
        const parsed = parseMcpToolAlias(cmd.name);
        if (parsed?.toolName) return parsed.toolName;
        // Last resort.
        return cmd.displayName || cmd.name;
      };

      const insertToken = getInsertToken(command);

      // Get current cursor position
      const textArea = textAreaRef.current?.resizableTextArea?.textArea;
      const cursorPosition = textArea?.selectionStart ?? content.length;

      // Smart insertion logic
      let newValue: string;
      let newCursorPos: number;

      const previousTypedCommand = selectedCommandRef.current?.workflowSelection
        ? selectedCommandRef.current
        : null;
      const trimmedStart = content.trimStart();
      const leadingWhitespace = content.slice(0, content.length - trimmedStart.length);

      if (previousTypedCommand && matchesCommandToken(content, previousTypedCommand.name)) {
        // Refresh/reselection replaces the existing leading identity in place;
        // it must not duplicate `/workflow` ahead of the user's preserved text.
        const previousToken = `/${previousTypedCommand.name}`;
        const suffix = trimmedStart.slice(previousToken.length);
        newValue = `${leadingWhitespace}/${insertToken}${suffix || " "}`;
        const tokenLengthDelta = insertToken.length - previousTypedCommand.name.length;
        newCursorPos = Math.max(
          leadingWhitespace.length + insertToken.length + 2,
          Math.min(newValue.length, cursorPosition + tokenLengthDelta),
        );
      } else {
        // Check if we're currently typing a command (e.g., "/cod" should be replaced)
        const beforeCursor = content.substring(0, cursorPosition);
        const commandMatch = beforeCursor.match(/\/([a-zA-Z0-9_-]*)$/);

        if (commandMatch) {
          // Case 1: Replacing an incomplete command
          const startIndex = cursorPosition - commandMatch[0].length;
          const before = content.substring(0, startIndex);
          const after = content.substring(cursorPosition);
          newValue = `${before}/${insertToken} ${after}`;
          newCursorPos = `${before}/${insertToken} `.length;
        } else if (content.trim() === "") {
          // Case 2: Empty input, just set the command
          newValue = `/${insertToken} `;
          newCursorPos = newValue.length;
        } else {
          // Case 3: Insert at cursor position
          const before = content.substring(0, cursorPosition);
          const after = content.substring(cursorPosition);
          newValue = `${before}/${insertToken} ${after}`;
          newCursorPos = `${before}/${insertToken} `.length;
        }
      }

      // Update content
      setContent(newValue);

      // Set cursor position in next tick to ensure DOM is updated
      setTimeout(() => {
        if (textArea) {
          textArea.selectionStart = newCursorPos;
          textArea.selectionEnd = newCursorPos;
          textArea.focus();
        }
      }, 0);

      // Typed instruction Workflows are selected by immutable identity. Never
      // fetch or expand their instruction body into the composer.
      if (command.metadata.workflowTypedActivation) {
        const source = command.metadata.workflowSource;
        const revision = command.metadata.workflowRevision;
        if (
          command.metadata.workflowKind !== "instruction" ||
          !isTypedWorkflowSource(source) ||
          !Number.isSafeInteger(revision) ||
          (revision as number) <= 0
        ) {
          clearCommandDraft();
          return;
        }
        const defaultArgs = defaultWorkflowArguments(command.metadata.workflowArgumentSchema);
        const candidateSelection = previousTypedCommand?.workflowSelection;
        const previousWorkflow =
          previousTypedCommand && candidateSelection?.id === command.name
            ? { draft: previousTypedCommand, selection: candidateSelection }
            : null;
        const argsText = previousWorkflow
          ? (previousWorkflow.draft.workflowArgumentsText ??
            JSON.stringify(previousWorkflow.selection.args, null, 2))
          : JSON.stringify(defaultArgs, null, 2);
        const initialArguments = parseWorkflowArguments(
          argsText,
          command.metadata.workflowArgumentSchema,
        );
        const args =
          initialArguments.args ??
          (previousWorkflow ? previousWorkflow.selection.args : defaultArgs);
        const draft: WorkflowDraft = {
          id: `command-draft-${command.id}`,
          name: insertToken,
          content: "",
          createdAt: new Date().toISOString(),
          type: command.type,
          displayName: command.displayName,
          workflowSelection: {
            id: command.name,
            source,
            revision: revision as number,
            args,
          },
          workflowKind: command.metadata.workflowKind,
          workflowVersion: command.metadata.workflowVersion,
          workflowArgumentHint: command.metadata.workflowArgumentHint,
          workflowArgumentSchema: command.metadata.workflowArgumentSchema,
          workflowArgumentsText: argsText,
          workflowArgumentsError: initialArguments.error,
          workflowActivationError: null,
        };
        commitCommandDraft(draft);
        return;
      }

      // Only legacy workflows need to load and preview content.
      // Skills, MCP tools, and built-in goal command only need token insertion.
      if (command.type !== "workflow") {
        const draft: WorkflowDraft = {
          id: `command-draft-${command.id}`,
          name: insertToken,
          content: "",
          createdAt: new Date().toISOString(),
          type: command.type,
          displayName: command.displayName,
          mcpAlias: command.type === "mcp" ? command.name : undefined,
          mcpServerId: command.type === "mcp" ? command.metadata?.serverId : undefined,
          mcpServerName: command.type === "mcp" ? command.metadata?.serverName : undefined,
          mcpOriginalName: command.type === "mcp" ? command.metadata?.originalName : undefined,
        };
        commitCommandDraft(draft);
        return;
      }

      // Workflow: load content for preview
      const commandService = CommandService.getInstance();

      try {
        // Extract the real ID (remove type prefix from command.id)
        // command.id format: "workflow-xxx"
        const realId = command.id.startsWith("workflow-")
          ? command.id.slice("workflow-".length)
          : command.id;

        const fullCommand = await commandService.getCommand(command.type, realId, requestSessionId);
        if (currentSessionIdRef.current !== requestSessionId) return;
        const workflowContent = fullCommand.content?.trim() || "";

        if (workflowContent) {
          const draft: WorkflowDraft = {
            id: `command-draft-${command.id}`,
            name: command.name,
            content: workflowContent,
            createdAt: new Date().toISOString(),
            type: command.type,
            displayName: command.displayName,
          };
          commitCommandDraft(draft);
        } else {
          clearCommandDraft();
        }
      } catch (error) {
        if (currentSessionIdRef.current !== requestSessionId) return;
        console.error(`[InputContainer] Failed to apply command '${command.name}':`, error);
        clearCommandDraft();
      }
    },
    [
      clearCommandDraft,
      commitCommandDraft,
      setContent,
      content,
      textAreaRef,
      currentSessionId,
      matchesCommandToken,
    ],
  );

  const handleCommandSelect = useCallback(
    async (command: CommandItem) => {
      try {
        await applyCommandDraft(command);
      } catch (error) {
        console.error(`[InputContainer] Failed to select command '${command.name}':`, error);
        setContent(`/${command.name} `);
        clearCommandDraft();
      }
    },
    [applyCommandDraft, clearCommandDraft, setContent],
  );

  const handleCommandSelectorCancel = useCallback(() => {
    setShowCommandSelector(false);
  }, []);

  const handleAutoComplete = useCallback(
    async (command: CommandItem) => {
      setShowCommandSelector(false);
      try {
        await applyCommandDraft(command);
      } catch (error) {
        console.error(`[InputContainer] Failed to apply command '${command.name}':`, error);
        setContent(`/${command.name} `);
        clearCommandDraft();
      }
    },
    [applyCommandDraft, clearCommandDraft, setContent],
  );

  const updateWorkflowArguments = useCallback(
    (raw: string) => {
      const current = selectedCommandRef.current;
      if (!current?.workflowSelection) return;
      const parsed = parseWorkflowArguments(raw, current.workflowArgumentSchema);
      commitCommandDraft({
        ...current,
        workflowArgumentsText: raw,
        workflowArgumentsError: parsed.error,
        workflowActivationError: null,
        workflowSelection: {
          ...current.workflowSelection,
          args: parsed.args ?? current.workflowSelection.args,
        },
      });
    },
    [commitCommandDraft],
  );

  const setWorkflowActivationError = useCallback(
    (error: string | null, expectedDraft?: WorkflowDraft | null) => {
      setSelectedCommand((current) => {
        if (!current?.workflowSelection) return current;
        if (expectedDraft !== undefined && current !== expectedDraft) return current;
        const next = { ...current, workflowActivationError: error };
        selectedCommandRef.current = next;
        return next;
      });
    },
    [setSelectedCommand],
  );

  const refreshWorkflowSelection = useCallback(() => {
    workflowCatalogQuery.invalidate();
    setWorkflowActivationError(null);
    setCommandSearchText(selectedCommandRef.current?.name ?? "");
    setShowCommandSelector(true);
  }, [setWorkflowActivationError]);

  const reselectWorkflow = useCallback(() => {
    const previousName = selectedCommandRef.current?.name ?? "";
    setWorkflowActivationError(null);
    setCommandSearchText(previousName);
    setShowCommandSelector(true);
  }, [setWorkflowActivationError]);

  return {
    selectedCommand,
    showCommandSelector,
    commandSearchText,
    clearCommandDraft: clearCommandDraft,
    matchesCommandToken,
    handleInputChange,
    handleCommandChange,
    handleCommandSelect,
    handleCommandSelectorCancel,
    handleAutoComplete,
    updateWorkflowArguments,
    setWorkflowActivationError,
    refreshWorkflowSelection,
    reselectWorkflow,
    setShowCommandSelector,
  };
};
