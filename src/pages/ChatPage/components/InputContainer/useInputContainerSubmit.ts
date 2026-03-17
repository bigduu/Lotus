import { useCallback } from "react";
import type { ImageFile } from "../../utils/imageUtils";
import {
  summarizeAttachments,
  type ProcessedFile,
} from "../../utils/fileUtils";
import type { ReasoningEffort } from "../../services/AgentService";
import type { WorkflowDraft } from "./index";
import type { WorkspaceFileEntry } from "../../types/workspace";

interface UseInputContainerSubmitProps {
  attachments: ProcessedFile[];
  referenceText: string | null;
  selectedWorkflow: WorkflowDraft | null;
  matchesWorkflowToken: (value: string, workflowName: string) => boolean;
  fileReferences: Map<string, WorkspaceFileEntry>;
  reasoningEffort: ReasoningEffort;
  sendMessage: (
    content: string,
    images?: ImageFile[],
    reasoningEffort?: ReasoningEffort,
    selectedSkillIds?: string[],
  ) => Promise<void>;
  recordEntry: (entry: string) => void;
  clearWorkflowDraft: () => void;
  setContent: (value: string) => void;
  setReferenceText: (value: string | null) => void;
  setAttachments: (value: ProcessedFile[]) => void;
  setFileReferences: (value: Map<string, WorkspaceFileEntry>) => void;
}

export const useInputContainerSubmit = ({
  attachments,
  referenceText,
  selectedWorkflow,
  matchesWorkflowToken,
  fileReferences,
  reasoningEffort,
  sendMessage,
  recordEntry,
  clearWorkflowDraft,
  setContent,
  setReferenceText,
  setAttachments,
  setFileReferences,
}: UseInputContainerSubmitProps) => {
  const handleSubmit = useCallback(
    async (message: string, images?: ImageFile[]) => {
      const trimmedInput = message.trim();
      const attachmentSummary = summarizeAttachments(attachments);
      const normalizedReferenceText = referenceText?.trim() ?? "";
      let composedInput = trimmedInput;
      let selectedSkillIds: string[] | undefined;

      // Handle different command types
      if (selectedWorkflow?.content && selectedWorkflow.type === "workflow") {
        // Workflow: replace token with workflow content
        const token = `/${selectedWorkflow.name}`;
        const hasToken = matchesWorkflowToken(
          trimmedInput,
          selectedWorkflow.name,
        );
        if (hasToken) {
          const extraInput = trimmedInput.slice(token.length).trim();
          composedInput = [selectedWorkflow.content, extraInput]
            .filter(Boolean)
            .join("\n\n");
        }
      } else if (selectedWorkflow?.type === "skill") {
        // Skill: add explicit selection hint
        const token = `/${selectedWorkflow.name}`;
        const hasToken = matchesWorkflowToken(
          trimmedInput,
          selectedWorkflow.name,
        );
        if (hasToken) {
          const extraInput = trimmedInput.slice(token.length).trim();
          const skillHint = `[User explicitly selected skill: ${selectedWorkflow.displayName || selectedWorkflow.name} (ID: ${selectedWorkflow.name})]`;
          composedInput = [skillHint, extraInput].filter(Boolean).join("\n\n");
          selectedSkillIds = [selectedWorkflow.name];
        }
      } else if (selectedWorkflow?.type === "mcp") {
        // MCP Tool: add explicit selection hint
        const token = `/${selectedWorkflow.name}`;
        const hasToken = matchesWorkflowToken(
          trimmedInput,
          selectedWorkflow.name,
        );
        if (hasToken) {
          const extraInput = trimmedInput.slice(token.length).trim();
          // Use the fully-qualified alias in the hint to disambiguate tools
          // across servers. UI will render this hint as a structured chip.
          const mcpHint = `[User explicitly selected MCP tool: ${
            selectedWorkflow.mcpAlias ||
            selectedWorkflow.displayName ||
            selectedWorkflow.name
          }]`;
          composedInput = [mcpHint, extraInput].filter(Boolean).join("\n\n");
        }
      }

      if (
        !composedInput &&
        !attachmentSummary &&
        (!images || images.length === 0)
      ) {
        return;
      }

      const composedMessage = [
        normalizedReferenceText,
        composedInput,
        attachmentSummary,
      ]
        .filter(Boolean)
        .join("\n\n");

      recordEntry(composedMessage);
      setContent("");
      clearWorkflowDraft();

      if (fileReferences.size > 0) {
        const fileRefMatches = Array.from(
          composedMessage.matchAll(/@([^\\s]+)/g),
        );

        if (fileRefMatches.length > 0) {
          const referencedFiles: WorkspaceFileEntry[] = [];
          for (const match of fileRefMatches) {
            const fileName = match[1];
            const fileEntry = fileReferences.get(fileName);
            if (fileEntry) {
              referencedFiles.push(fileEntry);
            }
          }

          if (referencedFiles.length > 0) {
            const structuredMessage = JSON.stringify({
              type: "file_reference",
              paths: referencedFiles.map((f) => f.path),
              display_text: composedMessage,
            });
            await sendMessage(
              structuredMessage,
              images,
              reasoningEffort,
              selectedSkillIds,
            );
          } else {
            await sendMessage(
              composedMessage,
              images,
              reasoningEffort,
              selectedSkillIds,
            );
          }
        } else {
          await sendMessage(
            composedMessage,
            images,
            reasoningEffort,
            selectedSkillIds,
          );
        }
      } else {
        await sendMessage(
          composedMessage,
          images,
          reasoningEffort,
          selectedSkillIds,
        );
      }

      setReferenceText(null);
      setAttachments([]);
      setFileReferences(new Map());
    },
    [
      attachments,
      clearWorkflowDraft,
      fileReferences,
      matchesWorkflowToken,
      recordEntry,
      reasoningEffort,
      selectedWorkflow,
      sendMessage,
      setAttachments,
      setContent,
      setFileReferences,
      setReferenceText,
      referenceText,
    ],
  );

  return { handleSubmit };
};
