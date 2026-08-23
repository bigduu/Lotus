import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { ProcessedFile } from "../../utils/fileUtils";

interface UseInputContainerAttachmentsOptions {
  attachments: ProcessedFile[];
  setAttachments: Dispatch<SetStateAction<ProcessedFile[]>>;
}

export const useInputContainerAttachments = (controlled?: UseInputContainerAttachmentsOptions) => {
  const [localAttachments, setLocalAttachments] = useState<ProcessedFile[]>([]);
  const attachments = controlled?.attachments ?? localAttachments;
  const setAttachments = controlled?.setAttachments ?? setLocalAttachments;

  const handleAttachmentsAdded = useCallback(
    (files: ProcessedFile[]) => {
      setAttachments((prev) => [...prev, ...files]);
    },
    [setAttachments],
  );

  const handleAttachmentRemove = useCallback(
    (fileId: string) => {
      setAttachments((prev) => prev.filter((file) => file.id !== fileId));
    },
    [setAttachments],
  );

  const handleClearAttachments = useCallback(() => {
    setAttachments([]);
  }, [setAttachments]);

  return {
    attachments,
    setAttachments,
    handleAttachmentsAdded,
    handleAttachmentRemove,
    handleClearAttachments,
  };
};
