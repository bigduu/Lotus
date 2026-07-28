import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageInstance } from "antd/es/message/interface";
import i18n from "i18next";
import type { FileReferenceInfo } from "../../utils/inputHighlight";
import type { WorkspaceFileEntry } from "@shared/types/workspace";
import type { ChatItem } from "@shared/types/chat";
import type { SessionSummary } from "@services/chat";
import { workspaceService } from "@services/workspace";
import { getWorkspaceSwitchErrorMessage } from "./workspaceSwitchErrors";

interface UseInputContainerFileReferencesProps {
  content: string;
  setContent: (value: string) => void;
  currentSessionId: string | null;
  currentChat: ChatItem | null;
  switchSessionWorkspace: (sessionId: string, workspacePath: string) => Promise<SessionSummary>;
  messageApi: MessageInstance;
}

export const useInputContainerFileReferences = ({
  content,
  setContent,
  currentSessionId,
  currentChat,
  switchSessionWorkspace,
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
  const [workspaceSubmitError, setWorkspaceSubmitError] = useState<string | null>(null);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const lastWorkspacePathRef = useRef<string | null>(null);
  const modalSessionIdRef = useRef<string | null>(null);
  const modalHydrationSessionIdRef = useRef<string | null>(null);
  const workspaceSubmitIdRef = useRef(0);
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  // A session change while the modal is open starts a new modal context. Keep
  // later completion from the previous session from closing or rewriting it.
  useEffect(() => {
    if (!isWorkspaceModalVisible) return;
    const matchingChat = currentChat?.id === currentSessionId ? currentChat : null;

    if (modalSessionIdRef.current !== currentSessionId) {
      workspaceSubmitIdRef.current += 1;
      modalSessionIdRef.current = currentSessionId;
      modalHydrationSessionIdRef.current = matchingChat ? null : currentSessionId;
      setWorkspacePathInput(matchingChat?.config.workspacePath ?? "");
      setWorkspaceSubmitError(null);
      setIsSavingWorkspace(false);
      return;
    }

    // The pane id can render one frame before its ChatItem arrives. Hydrate
    // exactly once from the matching record; later same-session server updates
    // must not erase a user's attempted path after a failed submit.
    if (
      currentSessionId &&
      modalHydrationSessionIdRef.current === currentSessionId &&
      matchingChat
    ) {
      modalHydrationSessionIdRef.current = null;
      setWorkspacePathInput(matchingChat.config.workspacePath ?? "");
    }
  }, [
    currentChat,
    currentChat?.config.workspacePath,
    currentChat?.id,
    currentSessionId,
    isWorkspaceModalVisible,
  ]);

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
        workspaceSubmitIdRef.current += 1;
        modalSessionIdRef.current = currentSessionId;
        modalHydrationSessionIdRef.current = null;
        setWorkspacePathInput("");
        setWorkspaceSubmitError(null);
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
      workspaceSubmitIdRef.current += 1;
      modalSessionIdRef.current = currentSessionId;
      modalHydrationSessionIdRef.current = null;
      setWorkspacePathInput("");
      setWorkspaceSubmitError(null);
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

  const openWorkspaceModal = useCallback(() => {
    workspaceSubmitIdRef.current += 1;
    modalSessionIdRef.current = currentSessionId;
    modalHydrationSessionIdRef.current = null;
    setWorkspacePathInput(currentChat?.config.workspacePath ?? "");
    setWorkspaceSubmitError(null);
    setIsWorkspaceModalVisible(true);
  }, [currentChat?.config.workspacePath, currentSessionId]);

  const handleWorkspaceModalCancel = useCallback(() => {
    workspaceSubmitIdRef.current += 1;
    modalSessionIdRef.current = null;
    modalHydrationSessionIdRef.current = null;
    setIsWorkspaceModalVisible(false);
    setWorkspacePathInput("");
    setWorkspaceSubmitError(null);
    setIsSavingWorkspace(false);
  }, []);

  const handleWorkspaceModalSubmit = useCallback(
    async (path: string): Promise<boolean> => {
      const targetSessionId = modalSessionIdRef.current ?? currentSessionId;
      if (
        !currentChat ||
        currentChat.id !== targetSessionId ||
        !targetSessionId ||
        targetSessionId !== currentSessionId
      ) {
        return false;
      }
      const trimmedPath = path.trim();
      if (!trimmedPath) {
        messageApi.error(i18n.t("chat.view.workspacePathEmpty"));
        return false;
      }

      const submitId = workspaceSubmitIdRef.current + 1;
      workspaceSubmitIdRef.current = submitId;
      setWorkspacePathInput(trimmedPath);
      setWorkspaceSubmitError(null);
      setIsSavingWorkspace(true);
      try {
        await switchSessionWorkspace(targetSessionId, trimmedPath);
        if (
          workspaceSubmitIdRef.current !== submitId ||
          currentSessionIdRef.current !== targetSessionId
        ) {
          return false;
        }

        modalSessionIdRef.current = null;
        modalHydrationSessionIdRef.current = null;
        setIsWorkspaceModalVisible(false);
        setWorkspacePathInput("");
        setShowFileSelector(false);
        setWorkspaceError(null);
        setWorkspaceSubmitError(null);
        return true;
      } catch (error) {
        if (
          workspaceSubmitIdRef.current !== submitId ||
          currentSessionIdRef.current !== targetSessionId
        ) {
          return false;
        }
        const errorMessage = getWorkspaceSwitchErrorMessage(error);
        setWorkspaceSubmitError(errorMessage);
        messageApi.error(errorMessage);
        return false;
      } finally {
        if (workspaceSubmitIdRef.current === submitId) {
          setIsSavingWorkspace(false);
        }
      }
    },
    [currentChat, currentSessionId, messageApi, switchSessionWorkspace],
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
    workspaceSubmitError,
    isWorkspaceModalVisible,
    workspacePathInput,
    isSavingWorkspace,
    openWorkspaceModal,
    handleFileReferenceChange,
    handleFileReferenceSelect,
    handleFileSelectorCancel,
    handleFileReferenceButtonClick,
    handleWorkspaceModalCancel,
    handleWorkspaceModalSubmit,
    fetchWorkspaceFiles,
  };
};
