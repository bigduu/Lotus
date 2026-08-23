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
  clearWorkflowDraft: () => void;
  setContent: (value: string) => void;
  setReferenceText: (value: string | null) => void;
  clearAttachments: (attachmentIds: readonly string[]) => void;
  setFileReferences: (value: Map<string, WorkspaceFileEntry>) => void;
  onWorkflowSelectionError?: (message: string) => void;
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
  setContent,
  setReferenceText,
  clearAttachments,
  setFileReferences,
  onWorkflowSelectionError,
}: UseInputContainerSubmitProps) => {
  const detachedTypedSubmissionInFlightRef = useRef(false);
  const currentSessionIdRef = useRef(sessionId);
  const composerContextRevisionRef = useRef(0);
  if (currentSessionIdRef.current !== sessionId) {
    currentSessionIdRef.current = sessionId;
    composerContextRevisionRef.current += 1;
  }

  const handleSubmit = useCallback(
    async (message: string, images?: ImageFile[]) => {
      const requestComposerContextRevision = composerContextRevisionRef.current;
      const trimmedInput = message.trim();
      const attachmentSummary = summarizeAttachments(attachments);
      const normalizedReferenceText = referenceText?.trim() ?? "";
      let composedInput = trimmedInput;
      let selectedSkillIds: string[] | undefined;
      let workflowSelection: WorkflowSelection | undefined;

      // Handle different command types
      if (selectedWorkflow?.workflowSelection) {
        if (selectedWorkflow.workflowArgumentsError) {
          onWorkflowSelectionError?.(selectedWorkflow.workflowArgumentsError);
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
            if (composerContextRevisionRef.current === requestComposerContextRevision) {
              onWorkflowSelectionError?.(error.message);
            }
            return false;
          }
          throw error;
        }

        recordEntry(composedMessage);
        // Discovery: remember the model actually used (select + send) so it shows
        // up in Model Limits settings. Prefer the resolved session model passed in;
        // fall back to the legacy global selection. Best-effort; never blocks send.
        recordUsedModel(usedModelName ?? useAppStore.getState().selectedModel);
        setContent("");
        setReferenceText(null);
        // The persisted text/reference setters belong to the session captured
        // by this request. Component-local draft state, however, may now belong
        // to another session after a pane switch. Never let an old continuation
        // clear that newer composer context.
        if (composerContextRevisionRef.current === requestComposerContextRevision) {
          clearWorkflowDraft();
          clearAttachments(attachments.map((attachment) => attachment.id));
          setFileReferences(new Map());
        }
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
      setContent,
      setFileReferences,
      setReferenceText,
      referenceText,
      onWorkflowSelectionError,
    ],
  );

  return { handleSubmit };
};
