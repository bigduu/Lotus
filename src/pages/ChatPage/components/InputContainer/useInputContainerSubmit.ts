import { useCallback, useRef } from "react";
import type { ImageFile } from "../../utils/imageUtils";
import { summarizeAttachments, type ProcessedFile } from "../../utils/fileUtils";
import type { ReasoningEffort } from "@services/chat/AgentService";
import type { WorkflowDraft } from "./index";
import type { WorkspaceFileEntry } from "@shared/types/workspace";
import { useAppStore } from "@shared/store/appStore";
import { recordUsedModel } from "../../utils/usedModels";
import { WorkflowSelectionError, type WorkflowSelection } from "../../../../features/workflows";
import {
  finishTypedWorkflowSubmission,
  isTypedWorkflowSubmissionPending,
  tryBeginTypedWorkflowSubmission,
} from "./typedWorkflowSubmissionTracker";

interface UseInputContainerSubmitProps {
  sessionId: string | null;
  attachments: ProcessedFile[];
  referenceText: string | null;
  selectedWorkflow: WorkflowDraft | null;
  matchesWorkflowToken: (value: string, workflowName: string) => boolean;
  fileReferences: Map<string, WorkspaceFileEntry>;
  reasoningEffort: ReasoningEffort;
  /**
   * The model actually used for this session's send (resolved ProviderModelRef
   * or session model), recorded for Model Limits discovery. Falls back to the
   * legacy global `selectedModel` when not provided.
   */
  usedModelName?: string;
  sendMessage: (
    content: string,
    images?: ImageFile[],
    reasoningEffort?: ReasoningEffort,
    selectedSkillIds?: string[],
    workflowSelection?: WorkflowSelection,
  ) => Promise<void>;
  recordEntry: (entry: string) => void;
  clearWorkflowDraft: (expectedDraft: WorkflowDraft | null) => void;
  clearContent: (submittedContent: string) => void;
  clearReferenceText: (submittedReferenceText: string | null) => void;
  clearAttachments: (attachmentIds: readonly string[]) => void;
  clearFileReferences: (referenceNames: readonly string[]) => void;
  onWorkflowSelectionError?: (message: string, expectedDraft: WorkflowDraft) => void;
}

export const useInputContainerSubmit = ({
  sessionId,
  attachments,
  referenceText,
  selectedWorkflow,
  matchesWorkflowToken,
  fileReferences,
  reasoningEffort,
  usedModelName,
  sendMessage,
  recordEntry,
  clearWorkflowDraft,
  clearContent,
  clearReferenceText,
  clearAttachments,
  clearFileReferences,
  onWorkflowSelectionError,
}: UseInputContainerSubmitProps) => {
  const detachedTypedSubmissionInFlightRef = useRef(false);

  const handleSubmit = useCallback(
    async (message: string, images?: ImageFile[]) => {
      // Fence the entire session submission boundary. A remounted composer may
      // temporarily lack its typed selection, and external-send actions do not
      // consult disabled form controls, but neither may bypass an accepted
      // request that is still pending.
      if (sessionId && isTypedWorkflowSubmissionPending(sessionId)) return false;

      const trimmedInput = message.trim();
      const attachmentSummary = summarizeAttachments(attachments);
      const normalizedReferenceText = referenceText?.trim() ?? "";
      let composedInput = trimmedInput;
      let selectedSkillIds: string[] | undefined;
      let workflowSelection: WorkflowSelection | undefined;

      // Handle different command types
      if (selectedWorkflow?.workflowSelection) {
        if (selectedWorkflow.workflowArgumentsError) {
          onWorkflowSelectionError?.(selectedWorkflow.workflowArgumentsError, selectedWorkflow);
          return false;
        }
        const token = `/${selectedWorkflow.name}`;
        const hasToken = matchesWorkflowToken(trimmedInput, selectedWorkflow.name);
        if (!hasToken) return false;
        composedInput = trimmedInput.slice(token.length).trim();
        workflowSelection = selectedWorkflow.workflowSelection;
      } else if (selectedWorkflow?.content && selectedWorkflow.type === "workflow") {
        // Workflow: replace token with workflow content
        const token = `/${selectedWorkflow.name}`;
        const hasToken = matchesWorkflowToken(trimmedInput, selectedWorkflow.name);
        if (hasToken) {
          const extraInput = trimmedInput.slice(token.length).trim();
          composedInput = [selectedWorkflow.content, extraInput].filter(Boolean).join("\n\n");
        }
      } else if (selectedWorkflow?.type === "skill") {
        // Skill: add explicit selection hint
        const token = `/${selectedWorkflow.name}`;
        const hasToken = matchesWorkflowToken(trimmedInput, selectedWorkflow.name);
        if (hasToken) {
          const extraInput = trimmedInput.slice(token.length).trim();
          const skillHint = `[User explicitly selected skill: ${selectedWorkflow.displayName || selectedWorkflow.name} (ID: ${selectedWorkflow.name})]`;
          composedInput = [skillHint, extraInput].filter(Boolean).join("\n\n");
          selectedSkillIds = [selectedWorkflow.name];
        }
      } else if (selectedWorkflow?.type === "mcp") {
        // MCP Tool: add explicit selection hint
        const token = `/${selectedWorkflow.name}`;
        const hasToken = matchesWorkflowToken(trimmedInput, selectedWorkflow.name);
        if (hasToken) {
          const extraInput = trimmedInput.slice(token.length).trim();
          // Use the fully-qualified alias in the hint to disambiguate tools
          // across servers. UI will render this hint as a structured chip.
          const mcpHint = `[User explicitly selected MCP tool: ${
            selectedWorkflow.mcpAlias || selectedWorkflow.displayName || selectedWorkflow.name
          }]`;
          composedInput = [mcpHint, extraInput].filter(Boolean).join("\n\n");
        }
      }

      if (
        !workflowSelection &&
        !composedInput &&
        !attachmentSummary &&
        (!images || images.length === 0)
      ) {
        return false;
      }

      const composedMessage = [normalizedReferenceText, composedInput, attachmentSummary]
        .filter(Boolean)
        .join("\n\n");

      let outboundMessage = composedMessage;
      if (fileReferences.size > 0) {
        const fileRefMatches = Array.from(composedMessage.matchAll(/@([^\\s]+)/g));

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
            outboundMessage = JSON.stringify({
              type: "file_reference",
              paths: referencedFiles.map((f) => f.path),
              display_text: composedMessage,
            });
          }
        }
      }

      const isTypedWorkflowSubmission = workflowSelection !== undefined;
      let typedSubmissionRevision: number | null = null;
      let usesDetachedTypedSubmissionFence = false;
      if (isTypedWorkflowSubmission) {
        if (sessionId) {
          typedSubmissionRevision = tryBeginTypedWorkflowSubmission(sessionId);
          if (typedSubmissionRevision === null) return false;
        } else {
          // A detached composer has no stable session identity to share across
          // mounts. Retain an instance-local fence for the pre-session edge.
          if (detachedTypedSubmissionInFlightRef.current) return false;
          detachedTypedSubmissionInFlightRef.current = true;
          usesDetachedTypedSubmissionFence = true;
        }
      }

      try {
        try {
          if (workflowSelection) {
            await sendMessage(
              outboundMessage,
              images,
              reasoningEffort,
              selectedSkillIds,
              workflowSelection,
            );
          } else {
            await sendMessage(outboundMessage, images, reasoningEffort, selectedSkillIds);
          }
        } catch (error) {
          if (error instanceof WorkflowSelectionError) {
            if (selectedWorkflow?.workflowSelection) {
              onWorkflowSelectionError?.(error.message, selectedWorkflow);
              return false;
            }
          }
          throw error;
        }

        recordEntry(composedMessage);
        // Discovery: remember the model actually used (select + send) so it shows
        // up in Model Limits settings. Prefer the resolved session model passed in;
        // fall back to the legacy global selection. Best-effort; never blocks send.
        recordUsedModel(usedModelName ?? useAppStore.getState().selectedModel);
        clearContent(message);
        clearReferenceText(referenceText);
        clearWorkflowDraft(selectedWorkflow);
        clearAttachments(attachments.map((attachment) => attachment.id));
        clearFileReferences(Array.from(fileReferences.keys()));
        return true;
      } finally {
        if (isTypedWorkflowSubmission && sessionId && typedSubmissionRevision !== null) {
          finishTypedWorkflowSubmission(sessionId, typedSubmissionRevision);
        } else if (usesDetachedTypedSubmissionFence) {
          detachedTypedSubmissionInFlightRef.current = false;
        }
      }
    },
    [
      attachments,
      clearWorkflowDraft,
      fileReferences,
      matchesWorkflowToken,
      recordEntry,
      reasoningEffort,
      sessionId,
      selectedWorkflow,
      sendMessage,
      usedModelName,
      clearAttachments,
      clearContent,
      clearFileReferences,
      clearReferenceText,
      referenceText,
      onWorkflowSelectionError,
    ],
  );

  return { handleSubmit };
};
