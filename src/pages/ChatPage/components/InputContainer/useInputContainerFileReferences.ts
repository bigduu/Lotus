import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import i18n from "i18next";
import type { FileReferenceInfo } from "../../utils/inputHighlight";
import type { WorkspaceFileEntry } from "../../types/workspace";
import type { ChatItem } from "../../types/chat";
import { workspaceService } from "@services/workspace";

interface UseInputContainerFileReferencesProps {
  content: string;
  setContent: (value: string) => void;
  currentSessionId: string | null;
  currentChat: ChatItem | null;
  updateSession: (sessionId: string, update: Partial<ChatItem>) => void;
  messageApi: MessageInstance;
}

export const useInputContainerFileReferences = ({
  content,
  setContent,
  currentSessionId,
  currentChat,
  updateSession,
  messageApi,
}: UseInputContainerFileReferencesProps) => {
  const [fileReferences, setFileReferences] = useState<Map<string, WorkspaceFileEntry>>(new Map());
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([]);
  const [showFileSelector, setShowFileSelector] = useState(false);
  const [fileSearchText, setFileSearchText] = useState("");
  const [isWorkspaceModalVisible, setIsWorkspaceModalVisible] = useState(false);
  const [workspacePathInput, setWorkspacePathInput] = useState("");
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const lastWorkspacePathRef = useRef<string | null>(null);

  useEffect(() => {
    if (isWorkspaceModalVisible) {
      setWorkspacePathInput(currentChat?.config.workspacePath ?? "");
    }
  }, [isWorkspaceModalVisible, currentChat?.config.workspacePath]);

  useEffect(() => {
    setShowFileSelector(false);
    setFileSearchText("");
    setWorkspaceFiles([]);
    setFileReferences(new Map());
    lastWorkspacePathRef.current = currentChat?.config.workspacePath ?? null;
  }, [currentSessionId, currentChat?.config.workspacePath]);

  const fetchWorkspaceFiles = useCallback(async (_sessionId: string, workspacePath: string) => {
    setIsWorkspaceLoading(true);
    setWorkspaceFiles([]);
    setWorkspaceError(null);
    try {
      const files = await workspaceService.listWorkspaceFiles(workspacePath);
      setWorkspaceFiles(files);
      lastWorkspacePathRef.current = workspacePath;
    } catch (error) {
      console.error("Failed to load workspace files:", error);
      setWorkspaceError(
        error instanceof Error ? error.message : "Workspace file browsing is unavailable.",
      );
    } finally {
      setIsWorkspaceLoading(false);
    }
  }, []);

  const handleFileReferenceChange = useCallback(
    (info: FileReferenceInfo) => {
      setFileSearchText(info.searchText);

      if (!info.isTriggerActive) {
        setShowFileSelector(false);
        return;
      }

      if (!currentSessionId || !currentChat) {
        setShowFileSelector(false);
        return;
      }

      const workspacePath = currentChat.config.workspacePath;

      if (!workspacePath) {
        setWorkspacePathInput("");
        setIsWorkspaceModalVisible(true);
        setShowFileSelector(false);
        return;
      }

      setShowFileSelector(true);

      if (lastWorkspacePathRef.current !== workspacePath || workspaceFiles.length === 0) {
        fetchWorkspaceFiles(currentSessionId, workspacePath);
      }
    },
    [currentChat, currentSessionId, fetchWorkspaceFiles, workspaceFiles.length],
  );

  const handleFileReferenceSelect = useCallback(
    (file: WorkspaceFileEntry) => {
      const atIndex = content.lastIndexOf("@");
      let newContent: string;

      if (atIndex >= 0 && content.substring(atIndex).match(/^@[a-zA-Z0-9._\\-\\/\\\\]*$/)) {
        const before = content.slice(0, atIndex);
        newContent = `${before}@${file.name} `;
      } else {
        newContent = content.trim() ? `${content.trim()} @${file.name} ` : `@${file.name} `;
      }

      setContent(newContent);

      setFileReferences((prev) => {
        const newMap = new Map(prev);
        newMap.set(file.name, file);
        return newMap;
      });

      setShowFileSelector(false);
      setFileSearchText("");
    },
    [content, setContent],
  );

  const handleFileSelectorCancel = useCallback(() => {
    setShowFileSelector(false);
  }, []);

  const handleFileReferenceButtonClick = useCallback(() => {
    if (!currentSessionId || !currentChat) {
      return;
    }

    const workspacePath = currentChat.config.workspacePath;

    if (!workspacePath) {
      setWorkspacePathInput("");
      setIsWorkspaceModalVisible(true);
      setShowFileSelector(false);
      return;
    }

    setFileSearchText("");
    setShowFileSelector(true);

    if (lastWorkspacePathRef.current !== workspacePath || workspaceFiles.length === 0) {
      fetchWorkspaceFiles(currentSessionId, workspacePath);
    }
  }, [currentChat, currentSessionId, fetchWorkspaceFiles, workspaceFiles.length]);

  const handleWorkspaceModalCancel = useCallback(() => {
    setIsWorkspaceModalVisible(false);
    setWorkspacePathInput("");
  }, []);

  const handleWorkspaceModalSubmit = useCallback(
    async (path: string) => {
      if (!currentChat || !currentSessionId) return;
      const trimmedPath = path.trim();
      if (!trimmedPath) {
        messageApi.error(i18n.t("chat.view.workspacePathEmpty"));
        return;
      }

      setIsSavingWorkspace(true);
      try {
        updateSession(currentSessionId, {
          config: {
            ...currentChat.config,
            workspacePath: trimmedPath,
          },
        });

        setIsWorkspaceModalVisible(false);
        setWorkspacePathInput("");
        setShowFileSelector(false);
        setWorkspaceError(null);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unable to save workspace path";
        messageApi.error(errorMessage);
      } finally {
        setIsSavingWorkspace(false);
      }
    },
    [currentChat, currentSessionId, messageApi, updateSession],
  );

  return {
    fileReferences,
    setFileReferences,
    workspaceFiles,
    showFileSelector,
    setShowFileSelector,
    fileSearchText,
    isWorkspaceLoading,
    workspaceError,
    isWorkspaceModalVisible,
    workspacePathInput,
    isSavingWorkspace,
    setWorkspacePathInput,
    setIsWorkspaceModalVisible,
    handleFileReferenceChange,
    handleFileReferenceSelect,
    handleFileSelectorCancel,
    handleFileReferenceButtonClick,
    handleWorkspaceModalCancel,
    handleWorkspaceModalSubmit,
    fetchWorkspaceFiles,
  };
};
