import { useEffect } from "react";
import { getFileReferenceInfo, getWorkflowCommandInfo } from "../../utils/inputHighlight";
import type { FileReferenceInfo, WorkflowCommandInfo } from "../../utils/inputHighlight";

interface UseMessageInputEffectsProps {
  value: string;
  debouncedValue: string;
  onWorkflowCommandChange?: (info: WorkflowCommandInfo) => void;
  onFileReferenceChange?: (info: FileReferenceInfo) => void;
  syncOverlayScroll: () => void;
}

export const useMessageInputEffects = ({
  value,
  debouncedValue,
  onWorkflowCommandChange,
  onFileReferenceChange,
  syncOverlayScroll,
}: UseMessageInputEffectsProps) => {
  useEffect(() => {
    syncOverlayScroll();
  }, [value, syncOverlayScroll]);

  useEffect(() => {
    if (onWorkflowCommandChange) {
      onWorkflowCommandChange(getWorkflowCommandInfo(debouncedValue));
    }
  }, [debouncedValue, onWorkflowCommandChange]);

  useEffect(() => {
    if (onFileReferenceChange) {
      onFileReferenceChange(getFileReferenceInfo(debouncedValue));
    }
  }, [debouncedValue, onFileReferenceChange]);
};
