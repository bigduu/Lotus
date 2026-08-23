import React, { useMemo, useEffect, useState, lazy, Suspense, useRef, useCallback } from "react";
import { App as AntApp, Space, theme, Tag, Alert, Spin, Dropdown, Button } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import {
  RobotOutlined,
  SettingOutlined,
  ExperimentOutlined,
  LoadingOutlined,
  DownOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { MessageInput } from "../MessageInput";
import InputPreview from "./InputPreview";
import { useMessageStreaming } from "../../hooks/useChatManager/useMessageStreaming";
import {
  selectSessionById,
  selectIsStreaming,
  selectIsInputLocked,
  selectCanCancel,
  selectPendingQuestion,
  useAppStore,
} from "@shared/store/appStore";
import { readPersistedInputReasoningEffort } from "@shared/store/appStore/slices/inputStateSlice";
import {
  confirmPermissionModeMutation,
  failPermissionModeMutation,
  isPermissionModeMutationPending,
  tryBeginPermissionModeMutation,
} from "@shared/store/appStore/bypassPermissionMutations";
import { useChatInputHistory } from "../../hooks/useChatInputHistory";
import { useInputContainerCommand } from "./useInputContainerCommand";
import { useInputContainerFileReferences } from "./useInputContainerFileReferences";
import { useInputContainerAttachments } from "./useInputContainerAttachments";
import { useInputContainerSubmit } from "./useInputContainerSubmit";
import { useInputContainerHistory } from "./useInputContainerHistory";
import { getInputContainerPlaceholder } from "./inputContainerPlaceholder";
import { useActiveModel } from "../../hooks/useActiveModel";
import { useActiveModelRef } from "../../hooks/useActiveModelRef";
import {
  resolveEffectiveReasoningEffort,
  resolveProviderDefaultReasoningEffort,
} from "@shared/utils/reasoningEffort";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import { ProviderModelPicker } from "../ProviderModelPicker";
import { useSettingsViewStore } from "@shared/store/settingsViewStore";
import { agentClient, type ReasoningEffort } from "@services/chat/AgentService";
import {
  type ProviderType,
  type OpenAIConfig,
  type AnthropicConfig,
  type GeminiConfig,
  type CopilotConfig,
} from "@shared/types/providerConfig";
import type { ImageFile } from "../../utils/imageUtils";
import { CHAT_FOCUS_INPUT_EVENT } from "../ChatView/events";
import { useIsMobile } from "@shared/hooks/useMediaQuery";
import {
  CHAT_SEND_MESSAGE_EVENT,
  CHAT_REFERENCE_TEXT_EVENT,
  REASONING_EFFORT_OPTIONS,
  EMPTY_ALLOWED_TOOLS,
} from "./constants";
import { useInputContainerModelOptions } from "./useInputContainerModelOptions";
import { useInputContainerRespond } from "./useInputContainerRespond";
import { useInputContainerGoalCommand } from "./useInputContainerGoalCommand";
import PermissionDecisionConfirmation from "./PermissionDecisionConfirmation";
import { preferredPermissionMatcherId } from "@shared/permissions/permissionContract";
import type {
  ChatSendMessageEventDetail,
  ChatReferenceTextEventDetail,
  WorkflowDraft,
} from "./types";
import PermissionModeControl, { type PermissionModeMutationStatus } from "./PermissionModeControl";
import type { SessionPermissionMode } from "@shared/permissions/sessionPermissionMode";
import WorkflowSelectionChip from "./WorkflowSelectionChip";
import {
  isTypedWorkflowSubmissionPending as isTypedWorkflowSubmissionPendingForSession,
  useTypedWorkflowSubmissionPending,
} from "./typedWorkflowSubmissionTracker";
import { useSessionComposerDraft } from "./sessionComposerDraftStore";

export type { WorkflowDraft } from "./types";

const FilePreview = lazy(() => import("../FilePreview"));
const CommandSelector = lazy(() => import("../CommandSelector"));
const FileReferenceSelector = lazy(() => import("../FileReferenceSelector"));
const SessionProjectModal = lazy(() => import("../SessionProjectModal"));

const { useToken } = theme;

interface InputContainerProps {
  sessionId?: string | null;
  isCenteredLayout?: boolean;
  onWorkflowDraftChange?: (workflow: WorkflowDraft | null) => void;
  statusIndicator?: React.ReactNode;
}

export const InputContainer: React.FC<InputContainerProps> = ({
  sessionId: sessionIdProp,
  onWorkflowDraftChange,
  statusIndicator,
}) => {
  const { t } = useTranslation();
  const textAreaRef = useRef<TextAreaRef>(null); // Add ref for cursor position
  const { token } = useToken();
  const isMobile = useIsMobile();
  const openSettings = useSettingsViewStore((state) => state.open);
  const sessionId = useAppStore((state) => sessionIdProp ?? state.currentSessionId);
  const composerDraft = useSessionComposerDraft(sessionId);
  const activeSessionId = useAppStore((state) => state.currentSessionId);
  const currentChat = useAppStore(selectSessionById(sessionId));
  const currentProjectId = currentChat?.config.projectId?.trim() || null;
  const currentProject = useAppStore((state) =>
    currentProjectId ? state.projects[currentProjectId] : undefined,
  );
  const effectiveWorkspacePath = currentProjectId
    ? currentProject?.status === "active" && currentProject.project_path_status === "configured"
      ? currentProject.project_path?.trim() || null
      : null
    : currentChat?.config.workspacePath?.trim() || null;
  const currentMessages = useMemo(() => currentChat?.messages || [], [currentChat?.messages]);
  const addMessage = useAppStore((state) => state.addMessage);
  const updateSession = useAppStore((state) => state.updateSession);
  const switchSessionWorkspace = useAppStore((state) => state.switchSessionWorkspace);
  const isStreaming = useAppStore(selectIsStreaming(sessionId));
  const isInputLocked = useAppStore(selectIsInputLocked(sessionId));
  const isTypedWorkflowSubmissionPending = useTypedWorkflowSubmissionPending(sessionId);
  const isComposerLocked = isInputLocked || isTypedWorkflowSubmissionPending;
  const canCancelFromExecution = useAppStore(selectCanCancel(sessionId));
  const canCancel = canCancelFromExecution || (currentChat?.isRunning === true && isInputLocked);
  const pendingQuestion = useAppStore(selectPendingQuestion(sessionId));
  const activeModel = useActiveModel(sessionId);
  const activeModelRef = useActiveModelRef(currentChat?.config?.model_ref);
  const isFlagOn = useProviderStore((s) => s.isProviderModelRefEnabled);

  // Get input state from Zustand slice (persisted per session)
  const inputState = useAppStore((state) => (sessionId ? state.inputStates[sessionId] : undefined));
  const setInputContent = useAppStore((state) => state.setInputContent);
  const setReferenceText = useAppStore((state) => state.setReferenceText);
  const setInputReasoningEffort = useAppStore((state) => state.setInputReasoningEffort);
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const providerConfig = useProviderStore((state) => state.providerConfig);
  const providerInstances = useProviderStore((state) => state.providerInstances);
  const getProviderType = useProviderStore((s) => s.getProviderType);

  // In instance mode currentProvider is an instance id; resolve to ProviderType.
  const resolvedProviderType = useMemo<ProviderType>(
    () => getProviderType(currentProvider),
    [currentProvider, getProviderType],
  );

  const [isSavingModel, setIsSavingModel] = useState(false);
  const { message: messageApi, modal } = AntApp.useApp();

  // Use persisted state or empty defaults
  const content = inputState?.content || "";
  const referenceText = inputState?.referenceText || null;
  const providerDefaultReasoningEffort = useMemo<ReasoningEffort | undefined>(
    () =>
      resolveProviderDefaultReasoningEffort(
        providerConfig,
        activeModelRef,
        currentChat?.config?.model_ref?.provider ?? currentProvider,
        providerInstances,
      ),
    [
      activeModelRef,
      currentChat?.config?.model_ref?.provider,
      providerConfig,
      currentProvider,
      providerInstances,
    ],
  );
  const persistedReasoningEffort = useMemo<ReasoningEffort | undefined>(
    () => (sessionId ? readPersistedInputReasoningEffort(sessionId) : undefined),
    [sessionId],
  );
  const reasoningEffort: ReasoningEffort = resolveEffectiveReasoningEffort({
    sessionEffort: currentChat?.config?.reasoningEffort,
    inputEffort: inputState?.reasoningEffort,
    persistedEffort: persistedReasoningEffort,
    providerDefault: providerDefaultReasoningEffort,
  });
  const setContent = useCallback(
    (newContent: string) => {
      if (sessionId) {
        setInputContent(sessionId, newContent);
      }
    },
    [sessionId, setInputContent],
  );
  const setReferenceTextPersisted = useCallback(
    (newRefText: string | null) => {
      if (sessionId) {
        setReferenceText(sessionId, newRefText);
      }
    },
    [sessionId, setReferenceText],
  );
  const clearSubmittedContent = useCallback(
    (submittedContent: string) => {
      if (!sessionId) return;
      const latestContent = useAppStore.getState().inputStates[sessionId]?.content ?? "";
      if (latestContent === submittedContent) {
        setInputContent(sessionId, "");
      }
    },
    [sessionId, setInputContent],
  );
  const clearSubmittedReferenceText = useCallback(
    (submittedReferenceText: string | null) => {
      if (!sessionId) return;
      const latestReferenceText =
        useAppStore.getState().inputStates[sessionId]?.referenceText ?? null;
      if (latestReferenceText === submittedReferenceText) {
        setReferenceText(sessionId, null);
      }
    },
    [sessionId, setReferenceText],
  );
  const setReasoningEffortPersisted = useCallback(
    async (nextEffort: ReasoningEffort) => {
      if (!sessionId) {
        return;
      }

      setInputReasoningEffort(sessionId, nextEffort);

      if (!currentChat) {
        return;
      }

      try {
        await agentClient.patchSession(sessionId, { reasoning_effort: nextEffort });
        // Backend already persisted above; this is a local-state update only.
        updateSession(
          sessionId,
          {
            config: {
              ...currentChat.config,
              reasoningEffort: nextEffort,
            },
          },
          { skipBackendPatch: true },
        );
      } catch (error) {
        console.warn("[InputContainer] Failed to persist reasoning effort:", error);
      }
    },
    [currentChat, sessionId, setInputReasoningEffort, updateSession],
  );

  const permissionMode: SessionPermissionMode =
    currentChat?.config?.permissionMode ??
    (currentChat?.config?.bypassPermissions ? "bypass" : "default");
  const permissionModeSupported = currentChat?.config?.permissionModeSupported === true;
  const [permissionModeMutationStatus, setPermissionModeMutationStatus] =
    useState<PermissionModeMutationStatus>("idle");
  const permissionModeStatusSessionRef = useRef(sessionId);
  permissionModeStatusSessionRef.current = sessionId;
  useEffect(() => setPermissionModeMutationStatus("idle"), [sessionId]);
  const isSessionPermissionModeMutationPending = sessionId
    ? isPermissionModeMutationPending(sessionId)
    : false;
  const setPermissionModePersisted = useCallback(
    async (next: SessionPermissionMode) => {
      if (
        !sessionId ||
        !currentChat ||
        permissionModeMutationStatus === "pending" ||
        isPermissionModeMutationPending(sessionId)
      ) {
        return;
      }
      if (next === "auto" && !permissionModeSupported) {
        messageApi.error(t("chat.input.permissionMode.autoUnsupported"));
        return;
      }
      // Navigation resets component-local status. The tracker provides the
      // atomic per-session fence that still prevents a second write after the
      // user leaves and returns while the first request is in flight.
      const revision = tryBeginPermissionModeMutation(sessionId, next, permissionMode);
      if (revision === null) {
        return;
      }
      setPermissionModeMutationStatus("pending");
      updateSession(
        sessionId,
        {
          config: {
            ...currentChat.config,
            permissionMode: next,
            bypassPermissions: next !== "default",
          },
        },
        { skipBackendPatch: true },
      );
      try {
        let confirmedMode = next;
        if (permissionModeSupported) {
          const confirmedSession = await agentClient.setSessionPermissionMode(sessionId, next);
          // The CAS PATCH response is authoritative even if another client or
          // a backend policy resolves the requested mode differently.
          confirmedMode = confirmedSession.permission_mode ?? next;
        } else {
          // Legacy Bamboo only understands Default/Bypass. Auto is rejected
          // above and is never approximated through this compatibility bool.
          await agentClient.patchSession(sessionId, {
            bypass_permissions: next === "bypass",
          });
        }
        if (confirmPermissionModeMutation(sessionId, revision, confirmedMode)) {
          const latestConfig =
            useAppStore.getState().chats.find((chat) => chat.id === sessionId)?.config ??
            currentChat.config;
          updateSession(
            sessionId,
            {
              config: {
                ...latestConfig,
                permissionMode: confirmedMode,
                permissionModeSupported,
                bypassPermissions: confirmedMode !== "default",
              },
            },
            { skipBackendPatch: true },
          );
          // Persist the authoritative response into the session that initiated
          // the request even if the user navigated elsewhere while it was in
          // flight. Only the transient status belongs to the visible session.
          if (permissionModeStatusSessionRef.current === sessionId) {
            setPermissionModeMutationStatus("success");
          }
        }
      } catch (error) {
        console.warn("[InputContainer] Failed to persist permission mode:", error);
        const confirmedMode = failPermissionModeMutation(sessionId, revision);
        if (confirmedMode === null) return;
        const latestConfig =
          useAppStore.getState().chats.find((chat) => chat.id === sessionId)?.config ??
          currentChat.config;
        updateSession(
          sessionId,
          {
            config: {
              ...latestConfig,
              permissionMode: confirmedMode,
              bypassPermissions: confirmedMode !== "default",
            },
          },
          { skipBackendPatch: true },
        );
        if (permissionModeStatusSessionRef.current === sessionId) {
          setPermissionModeMutationStatus("error");
          messageApi.error(t("chat.input.permissionMode.status.error"));
        }
        void useAppStore
          .getState()
          .refreshChatsNow()
          .catch(() => undefined);
      }
    },
    [
      currentChat,
      messageApi,
      permissionMode,
      permissionModeMutationStatus,
      permissionModeSupported,
      sessionId,
      t,
      updateSession,
    ],
  );

  const {
    sendMessage,
    retryLastTurn,
    cancel: cancelMessage,
  } = useMessageStreaming({
    sessionId,
    addMessage,
    updateSession,
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const shouldHandleSessionEvent = (targetSessionId?: string | null) => {
      return targetSessionId
        ? sessionId === targetSessionId
        : sessionId !== null && sessionId === activeSessionId;
    };

    const handleReferenceText = (event: Event) => {
      const customEvent = event as CustomEvent<ChatReferenceTextEventDetail>;
      if (!customEvent.detail || typeof customEvent.detail.text !== "string") {
        return;
      }

      const targetSessionId =
        typeof customEvent.detail.sessionId === "string" ? customEvent.detail.sessionId : null;
      if (!shouldHandleSessionEvent(targetSessionId)) {
        return;
      }
      if (isTypedWorkflowSubmissionPending) {
        return;
      }

      const nextReferenceText = customEvent.detail.text.trim();
      if (!nextReferenceText) {
        return;
      }

      customEvent.detail.handled = true;
      setReferenceTextPersisted(nextReferenceText);

      requestAnimationFrame(() => {
        textAreaRef.current?.focus();
      });
    };

    const handleFocusInput = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string | null; handled?: boolean }>;
      const targetSessionId =
        typeof customEvent.detail?.sessionId === "string" ? customEvent.detail.sessionId : null;
      if (!shouldHandleSessionEvent(targetSessionId)) {
        return;
      }

      if (customEvent.detail) {
        customEvent.detail.handled = true;
      }

      requestAnimationFrame(() => {
        textAreaRef.current?.focus();
      });
    };

    window.addEventListener(CHAT_REFERENCE_TEXT_EVENT, handleReferenceText as EventListener);
    window.addEventListener(CHAT_FOCUS_INPUT_EVENT, handleFocusInput as EventListener);

    return () => {
      window.removeEventListener(CHAT_REFERENCE_TEXT_EVENT, handleReferenceText as EventListener);
      window.removeEventListener(CHAT_FOCUS_INPUT_EVENT, handleFocusInput as EventListener);
    };
  }, [activeSessionId, isTypedWorkflowSubmissionPending, sessionId, setReferenceTextPersisted]);

  // Use the global Ant App context message API to avoid mounting a per-pane
  // rc-notification container (which can cause update-depth loops in some layouts).

  const isToolSpecificMode = false;
  const isRestrictConversation = false;
  const allowedTools = EMPTY_ALLOWED_TOOLS;
  const autoToolPrefix = undefined;

  const { recordEntry, navigate, acknowledgeManualInput } = useChatInputHistory(sessionId);

  const {
    attachments,
    setAttachments,
    handleAttachmentsAdded,
    handleAttachmentRemove,
    handleClearAttachments,
  } = useInputContainerAttachments({
    attachments: composerDraft.attachments,
    setAttachments: composerDraft.setAttachments,
  });
  const clearSubmittedAttachments = useCallback(
    (attachmentIds: readonly string[]) => {
      const submittedIds = new Set(attachmentIds);
      setAttachments((current) => current.filter((attachment) => !submittedIds.has(attachment.id)));
    },
    [setAttachments],
  );

  const commandState = useInputContainerCommand({
    setContent,
    onWorkflowDraftChange,
    acknowledgeManualInput,
    currentSessionId: sessionId,
    textAreaRef,
    content,
    selectedCommand: composerDraft.workflowDraft,
    setSelectedCommand: composerDraft.setWorkflowDraft,
  });

  const fileReferenceState = useInputContainerFileReferences({
    content,
    setContent,
    currentSessionId: sessionId,
    currentChat,
    effectiveWorkspacePath,
    switchSessionWorkspace,
    messageApi,
    fileReferences: composerDraft.fileReferences,
    setFileReferences: composerDraft.setFileReferences,
  });

  const { setShowFileSelector, setFileReferences: setComposerFileReferences } = fileReferenceState;

  useEffect(() => {
    if (commandState.showCommandSelector) {
      setShowFileSelector(false);
    }
  }, [commandState.showCommandSelector, setShowFileSelector]);

  const clearSubmittedFileReferences = useCallback(
    (referenceNames: readonly string[]) => {
      if (referenceNames.length === 0) return;
      const submittedNames = new Set(referenceNames);
      setComposerFileReferences((current) => {
        let changed = false;
        const next = new Map(current);
        submittedNames.forEach((name) => {
          changed = next.delete(name) || changed;
        });
        return changed ? next : current;
      });
    },
    [setComposerFileReferences],
  );

  const { handleSubmit } = useInputContainerSubmit({
    sessionId,
    attachments,
    referenceText,
    selectedWorkflow: commandState.selectedCommand,
    matchesWorkflowToken: commandState.matchesCommandToken,
    fileReferences: fileReferenceState.fileReferences,
    reasoningEffort,
    // The model this session actually sends with (resolved ref or session model).
    usedModelName: activeModelRef?.model ?? currentChat?.config?.model_ref?.model,
    sendMessage,
    recordEntry,
    clearWorkflowDraft: commandState.clearCommandDraft,
    clearContent: clearSubmittedContent,
    clearReferenceText: clearSubmittedReferenceText,
    clearAttachments: clearSubmittedAttachments,
    clearFileReferences: clearSubmittedFileReferences,
    onWorkflowSelectionError: commandState.setWorkflowActivationError,
  });

  // Respond mode: when QuestionDialog activates "Other (custom input)",
  // InputContainer submits to the respond API instead of sending a new message.
  const currentPendingRespond = pendingQuestion
    ? {
        sessionId: sessionId ?? "",
        question: pendingQuestion.question,
        options: pendingQuestion.options,
        allowCustom: pendingQuestion.allowCustom,
        toolCallId: pendingQuestion.toolCallId,
        permissionRequest: pendingQuestion.permissionRequest,
      }
    : null;
  const isRespondMode = Boolean(currentPendingRespond);
  const respondOptions = currentPendingRespond?.options || [];
  const respondAllowCustom = currentPendingRespond?.allowCustom ?? true;

  const { handleRespondSubmit, shouldUseRespondModeForSession } = useInputContainerRespond({
    sessionId,
    reasoningEffort,
    activeModelRef,
    isFlagOn,
    messageApi,
    setContent,
    pendingQuestionToolCallId: currentPendingRespond?.toolCallId ?? null,
    permissionRequest: currentPendingRespond?.permissionRequest,
    t,
  });

  const permissionDecisionLabel = useCallback(
    (decision: string) => {
      const key = decision.toLowerCase();
      const known = [
        "allow_once",
        "allow_session",
        "allow_workspace",
        "allow_global",
        "deny_once",
        "deny_session",
      ];
      return known.includes(key)
        ? t(`components.questionDialog.permissionDecisions.${key}`)
        : decision;
    },
    [t],
  );

  const submitRespondOption = useCallback(
    (decision: string) => {
      const durable = decision === "allow_workspace" || decision === "allow_global";
      if (!durable) {
        void handleRespondSubmit(decision);
        return;
      }
      const permissionRequest = currentPendingRespond?.permissionRequest;
      if (!permissionRequest) {
        void handleRespondSubmit(decision);
        return;
      }
      let selectedMatcherId = preferredPermissionMatcherId(permissionRequest);
      modal.confirm({
        title: t(`components.questionDialog.confirmScopes.${decision}.title`),
        content: (
          <PermissionDecisionConfirmation
            decision={decision}
            request={permissionRequest}
            onMatcherChange={(matcherId) => {
              selectedMatcherId = matcherId;
            }}
          />
        ),
        okText: permissionDecisionLabel(decision),
        okButtonProps: {
          danger: decision === "allow_global",
          disabled:
            !selectedMatcherId ||
            (decision === "allow_workspace" && !permissionRequest.workspacePath),
        },
        onOk: () =>
          handleRespondSubmit(decision, {
            matcherId: selectedMatcherId,
            confirmGlobal: decision === "allow_global",
          }),
      });
    },
    [
      currentPendingRespond?.permissionRequest,
      handleRespondSubmit,
      modal,
      permissionDecisionLabel,
      t,
    ],
  );

  // /goal commands are now handled server-side by Bamboo. This hook is retained
  // for local-only UI feedback (toasts) in a future iteration; `handleGoalCommand`
  // is not yet wired into the submit path.
  const { handleGoalCommand } = useInputContainerGoalCommand({
    sessionId,
    currentChat,
    updateSession,
    messageApi,
    recordEntry,
    clearCommandDraft: commandState.clearCommandDraft,
    textAreaRef,
    setContent,
  });

  // Suppress TS6133 — retained for future local UI feedback integration.
  void handleGoalCommand;

  const submitMessageWithLiveMode = useCallback(
    async (message: string, images?: ImageFile[]) => {
      if (sessionId && isTypedWorkflowSubmissionPendingForSession(sessionId)) {
        return false;
      }
      // /goal commands are now handled server-side by Bamboo.
      // They are sent as regular messages through the normal chat flow.
      const targetSessionId = sessionId;
      if (shouldUseRespondModeForSession(targetSessionId)) {
        await handleRespondSubmit(message);
        return true;
      }

      return handleSubmit(message, images);
    },
    [handleRespondSubmit, handleSubmit, sessionId, shouldUseRespondModeForSession],
  );

  // Wrap handleSubmit: check latest store state at submit time to avoid stale-mode races
  const effectiveHandleSubmit = useCallback(
    async (message: string, images?: ImageFile[]) => {
      return submitMessageWithLiveMode(message, images);
    },
    [submitMessageWithLiveMode],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleExternalSend = (event: Event) => {
      const customEvent = event as CustomEvent<ChatSendMessageEventDetail>;
      if (!customEvent.detail) {
        return;
      }

      // If a target sessionId is provided, only the matching pane should handle it.
      // Otherwise, default to the globally active chat to avoid sending from all panes.
      const targetSessionId =
        typeof customEvent.detail.sessionId === "string" ? customEvent.detail.sessionId : null;
      const shouldHandle = targetSessionId
        ? sessionId === targetSessionId
        : sessionId !== null && sessionId === activeSessionId;
      if (!shouldHandle) {
        return;
      }

      customEvent.detail.handled = true;
      const contentValue = customEvent.detail?.content;

      if (typeof contentValue !== "string" || contentValue.trim().length === 0) {
        customEvent.detail?.reject?.(new Error("External send message content is empty"));
        return;
      }

      submitMessageWithLiveMode(contentValue, undefined)
        .then((accepted) => {
          if (accepted === false) {
            customEvent.detail?.reject?.(new Error(t("chat.workflowSelection.submitting")));
            return;
          }
          customEvent.detail?.resolve?.();
        })
        .catch((error: unknown) => {
          customEvent.detail?.reject?.(error);
        });
    };

    window.addEventListener(CHAT_SEND_MESSAGE_EVENT, handleExternalSend as EventListener);

    return () => {
      window.removeEventListener(CHAT_SEND_MESSAGE_EVENT, handleExternalSend as EventListener);
    };
  }, [activeSessionId, sessionId, submitMessageWithLiveMode, t]);

  const { retryLastMessage, handleHistoryNavigate } = useInputContainerHistory({
    currentSessionId: sessionId,
    currentChat,
    currentMessages,
    reasoningEffort,
    retryLastTurn,
    navigate,
  });

  const handleCloseReferencePreview = useCallback(
    () => setReferenceTextPersisted(null),
    [setReferenceTextPersisted],
  );

  const currentProviderSettings = useMemo<
    OpenAIConfig | AnthropicConfig | GeminiConfig | CopilotConfig | undefined
  >(() => {
    // In instance mode, providerConfig.providers is keyed by instance id.
    // In legacy mode, it is keyed by ProviderType. currentProvider matches either.
    return providerConfig.providers[currentProvider as ProviderType];
  }, [providerConfig, currentProvider]);

  const isProviderConfigured = useMemo(() => {
    if (!currentProviderSettings || typeof currentProviderSettings !== "object") {
      return false;
    }

    if (resolvedProviderType === "copilot") {
      return Object.keys(currentProviderSettings).length > 0;
    }

    if (!("api_key" in currentProviderSettings)) {
      return false;
    }

    return (
      typeof currentProviderSettings.api_key === "string" &&
      currentProviderSettings.api_key.trim().length > 0
    );
  }, [resolvedProviderType, currentProviderSettings]);

  const redirectToProviderSettingsIfNeeded = useCallback(() => {
    if (isProviderConfigured) return false;
    openSettings("chat");
    messageApi.warning(t("chat.view.providerNotConfigured"));
    return true;
  }, [isProviderConfigured, messageApi, openSettings, t]);

  const getErrorMessage = useCallback(
    (error: unknown) => {
      if (error instanceof Error && error.message.trim()) return error.message;
      return t("chat.view.unknownError");
    },
    [t],
  );

  const {
    isModelOptionsLoading,
    modelOptionsError,
    resolvedModelOptions,
    handleModelDropdownVisibleChange,
  } = useInputContainerModelOptions({
    resolvedProviderType,
    currentProvider,
    activeModel,
    getErrorMessage,
    redirectToProviderSettingsIfNeeded,
  });

  const handleModelSelect = useCallback(
    async (value: string) => {
      if (!value || value === activeModel) return;
      if (isSavingModel) return;

      try {
        if (redirectToProviderSettingsIfNeeded()) return;
        setIsSavingModel(true);

        if (!sessionId || !currentChat) {
          if (sessionId) {
            updateSession(sessionId, {
              config: {
                systemPromptId: currentChat?.config?.systemPromptId || "default",
                baseSystemPrompt: currentChat?.config?.baseSystemPrompt || "",
                lastUsedEnhancedPrompt: currentChat?.config?.lastUsedEnhancedPrompt ?? null,
                ...(currentChat?.config || {}),
                model: value,
              },
            });
          }
          return;
        }

        await agentClient.patchSession(sessionId, { model: value });
        // Backend already persisted above; this is a local-state update only.
        updateSession(
          sessionId,
          {
            config: {
              ...currentChat.config,
              model: value,
            },
          },
          { skipBackendPatch: true },
        );
        messageApi.success(t("settings.providerTab.modelUpdated"));
      } catch (error) {
        messageApi.error(
          `${t("settings.providerTab.updateModelErrorPrefix")}: ${getErrorMessage(error)}`,
        );
      } finally {
        setIsSavingModel(false);
      }
    },
    [
      activeModel,
      currentChat,
      getErrorMessage,
      isSavingModel,
      messageApi,
      redirectToProviderSettingsIfNeeded,
      sessionId,
      t,
      updateSession,
    ],
  );

  const handleModelRefChange = useCallback(
    async (ref: { provider: string; model: string }) => {
      if (!sessionId || !currentChat?.config) {
        useProviderStore.getState().setSelectedModelRef(ref);
        return;
      }

      // Prevent concurrent model changes.
      if (isSavingModel) return;

      try {
        setIsSavingModel(true);

        // 1. Persist to backend first (await so restart can't race).
        await agentClient.patchSession(sessionId, {
          model: ref.model,
          model_ref: ref,
          provider: ref.provider,
        });

        // 2. Update local state only after backend confirms (step 1 already
        //    persisted these fields, so skip the store's redundant PATCH).
        useProviderStore.getState().setSelectedModelRef(ref);
        updateSession(
          sessionId,
          {
            config: {
              ...currentChat.config,
              model: ref.model,
              model_ref: ref,
            },
          },
          { skipBackendPatch: true },
        );

        messageApi.success(t("settings.providerTab.modelUpdated"));
      } catch (error) {
        messageApi.error(
          `${t("settings.providerTab.updateModelErrorPrefix")}: ${getErrorMessage(error)}`,
        );
      } finally {
        setIsSavingModel(false);
      }
    },
    [currentChat?.config, getErrorMessage, isSavingModel, messageApi, sessionId, t, updateSession],
  );

  const basePlaceholder = useMemo(() => {
    return getInputContainerPlaceholder({
      referenceText,
      isToolSpecificMode,
      isRestrictConversation,
      allowedTools,
      autoToolPrefix,
      t,
    });
  }, [referenceText, isToolSpecificMode, isRestrictConversation, allowedTools, autoToolPrefix, t]);

  // In respond mode, override placeholder to guide the user
  const placeholder =
    isRespondMode && respondAllowCustom
      ? t("chat.respond.customAnswerPlaceholder")
      : isRespondMode
        ? t("components.questionDialog.selectOptionWarning")
        : basePlaceholder;

  const submitButtonLabel = isRespondMode ? t("chat.respond.submitToolResult") : undefined;

  const reasoningEffortLabelMap = useMemo<Record<ReasoningEffort, string>>(
    () => ({
      low: t("chat.input.reasoning.low"),
      medium: t("chat.input.reasoning.medium"),
      high: t("chat.input.reasoning.high"),
      xhigh: t("chat.input.reasoning.xhigh"),
      max: t("chat.input.reasoning.max"),
    }),
    [t],
  );

  const currentReasoningLabel = useMemo(
    () => reasoningEffortLabelMap[reasoningEffort] ?? reasoningEffort,
    [reasoningEffort, reasoningEffortLabelMap],
  );

  const reasoningControl = useMemo(
    () => (
      <Dropdown
        trigger={["click"]}
        placement="topLeft"
        disabled={!activeModel || isComposerLocked}
        menu={{
          selectable: true,
          selectedKeys: [reasoningEffort],
          items: REASONING_EFFORT_OPTIONS.map((option) => ({
            key: option,
            label: reasoningEffortLabelMap[option],
          })),
          onClick: ({ key }) => {
            setReasoningEffortPersisted(key as ReasoningEffort);
          },
        }}
      >
        <Button
          type="text"
          size="small"
          disabled={!activeModel || isComposerLocked}
          style={{
            minWidth: isMobile ? 74 : 88,
            padding: isMobile ? "0 8px" : "0 12px",
            height: 36,
            borderRadius: 18,
            color: reasoningEffort === "medium" ? token.colorTextSecondary : token.colorPrimary,
          }}
          title={t("chat.input.reasoningTitle", { label: currentReasoningLabel })}
        >
          <Space size={6}>
            <ExperimentOutlined />
            <span>{currentReasoningLabel}</span>
            <DownOutlined style={{ fontSize: 10 }} />
          </Space>
        </Button>
      </Dropdown>
    ),
    [
      activeModel,
      currentReasoningLabel,
      isComposerLocked,
      isMobile,
      reasoningEffort,
      reasoningEffortLabelMap,
      setReasoningEffortPersisted,
      t,
      token.colorPrimary,
      token.colorTextSecondary,
    ],
  );

  const modelLabel =
    activeModel ||
    (isProviderConfigured ? t("chat.model.selectModel") : t("chat.model.configureProvider"));
  const modelMenuItems = useMemo(
    () =>
      resolvedModelOptions.length > 0
        ? resolvedModelOptions.map((option) => ({
            key: option.value,
            label: option.label,
          }))
        : [
            {
              key: "__no_models__",
              label: modelOptionsError || t("chat.model.noModelsAvailable"),
              disabled: true,
            },
          ],
    [resolvedModelOptions, modelOptionsError, t],
  );

  const modelButton = useMemo(
    () => (
      <Button
        type="text"
        size="small"
        disabled={isComposerLocked || isSavingModel}
        onClick={() => {
          if (!isProviderConfigured) {
            redirectToProviderSettingsIfNeeded();
          }
        }}
        style={{
          minWidth: isMobile ? 112 : 146,
          padding: isMobile ? "0 8px" : "0 12px",
          height: 36,
          borderRadius: 18,
          color: modelOptionsError ? token.colorError : token.colorTextSecondary,
        }}
        title={modelLabel}
      >
        <Space size={6}>
          {isModelOptionsLoading ? <LoadingOutlined /> : <RobotOutlined />}
          <span
            style={{
              maxWidth: isMobile ? 84 : 128,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {modelLabel}
          </span>
          <DownOutlined style={{ fontSize: 10 }} />
        </Space>
      </Button>
    ),
    [
      isComposerLocked,
      isSavingModel,
      isProviderConfigured,
      redirectToProviderSettingsIfNeeded,
      isMobile,
      modelOptionsError,
      token.colorError,
      token.colorTextSecondary,
      modelLabel,
      isModelOptionsLoading,
    ],
  );

  const modelControl = useMemo(() => {
    if (isFlagOn()) {
      return (
        <ProviderModelPicker
          value={activeModelRef}
          onChange={handleModelRefChange}
          disabled={isComposerLocked || isSavingModel}
        />
      );
    }
    if (isProviderConfigured) {
      return (
        <Dropdown
          trigger={["click"]}
          placement="topLeft"
          menu={{
            selectable: true,
            selectedKeys: activeModel ? [activeModel] : [],
            items: modelMenuItems,
            style: {
              maxHeight: "50vh",
              overflowY: "auto",
            },
            onClick: ({ key }) => {
              if (key === "__no_models__") return;
              void handleModelSelect(String(key));
            },
          }}
          onOpenChange={handleModelDropdownVisibleChange}
          disabled={isComposerLocked || isSavingModel}
        >
          {modelButton}
        </Dropdown>
      );
    }
    return modelButton;
  }, [
    isFlagOn,
    activeModelRef,
    handleModelRefChange,
    isComposerLocked,
    isSavingModel,
    isProviderConfigured,
    activeModel,
    modelMenuItems,
    handleModelSelect,
    handleModelDropdownVisibleChange,
    modelButton,
  ]);

  const permissionModeControl = useMemo(
    () => (
      <PermissionModeControl
        mode={permissionMode}
        supportsAuto={permissionModeSupported}
        mutationStatus={
          isSessionPermissionModeMutationPending ? "pending" : permissionModeMutationStatus
        }
        sessionTitle={currentChat?.title ?? ""}
        compact={isMobile}
        disabled={!sessionId || isComposerLocked}
        onChange={setPermissionModePersisted}
      />
    ),
    [
      currentChat?.title,
      isSessionPermissionModeMutationPending,
      isComposerLocked,
      isMobile,
      permissionMode,
      permissionModeMutationStatus,
      permissionModeSupported,
      sessionId,
      setPermissionModePersisted,
    ],
  );

  const leftControlsExtra = useMemo(
    () => (
      <Space size={0} wrap>
        {modelControl}
        {reasoningControl}
        {permissionModeControl}
      </Space>
    ),
    [modelControl, reasoningControl, permissionModeControl],
  );

  const validateMessage = useCallback(
    (message: string) => {
      if (isRestrictConversation && autoToolPrefix) {
        const trimmed = message.trim();
        if (!trimmed.startsWith(autoToolPrefix)) {
          return {
            isValid: false,
            errorMessage: t("chat.input.mustStartWithPrefix", {
              prefix: autoToolPrefix,
            }),
          };
        }
      }
      return { isValid: true };
    },
    [isRestrictConversation, autoToolPrefix, t],
  );

  const hasUserMessages = useMemo(
    () => currentMessages.some((m) => m.role === "user"),
    [currentMessages],
  );

  const interaction = useMemo(
    () => ({
      isStreaming,
      isInputLocked: isComposerLocked,
      canCancel,
      hasMessages: hasUserMessages,
      allowRetry: true as const,
      onRetry: retryLastMessage,
      onCancel: cancelMessage,
      onHistoryNavigate: handleHistoryNavigate,
    }),
    [
      isStreaming,
      isComposerLocked,
      canCancel,
      hasUserMessages,
      retryLastMessage,
      cancelMessage,
      handleHistoryNavigate,
    ],
  );

  return (
    <div
      style={{
        // Keep the input area compact; the inner MessageInput already enforces a sensible min-height.
        padding: `${token.paddingXXS}px ${token.paddingXS}px`,
        background: "transparent",
        borderTop: "none",
        boxShadow: "none",
        width: "100%",
        position: "relative",
        overflow: "visible",
      }}
    >
      {/* Model Configuration Alert */}
      {!activeModel && (
        <Alert
          type="warning"
          showIcon
          icon={<SettingOutlined />}
          message={
            isProviderConfigured
              ? t("chat.model.noModelSelected")
              : t("chat.model.providerNotConfigured")
          }
          description={
            isProviderConfigured
              ? t("chat.model.selectModelHint")
              : t("chat.model.configureProviderHint")
          }
          action={
            !isProviderConfigured ? (
              <Space>
                <a onClick={() => openSettings("chat")}>{t("chat.model.openSettings")}</a>
              </Space>
            ) : undefined
          }
          style={{ marginBottom: token.marginSM }}
        />
      )}

      {isToolSpecificMode && (
        <Alert
          type={isRestrictConversation ? "warning" : "info"}
          showIcon
          style={{ marginBottom: token.marginSM }}
          message={
            <Space wrap>
              <span>
                {isRestrictConversation
                  ? t("chat.input.strictToolOnlyMode")
                  : t("chat.input.toolSpecificModeLabel")}
              </span>
              {autoToolPrefix && (
                <Tag color="processing">
                  <ToolOutlined /> {t("chat.input.autoPrefixLabel", { prefix: autoToolPrefix })}
                </Tag>
              )}
            </Space>
          }
          description={
            allowedTools.length > 0 && (
              <Space wrap>
                <span>{t("chat.input.allowedTools")}</span>
                {allowedTools.map((tool: string) => (
                  <Tag key={tool} color="success">
                    /{tool}
                  </Tag>
                ))}
              </Space>
            )
          }
        />
      )}

      {commandState.selectedCommand?.workflowSelection ? (
        <WorkflowSelectionChip
          draft={commandState.selectedCommand}
          disabled={isComposerLocked}
          pending={isTypedWorkflowSubmissionPending}
          onArgumentsChange={commandState.updateWorkflowArguments}
          onRefresh={commandState.refreshWorkflowSelection}
          onReselect={commandState.reselectWorkflow}
        />
      ) : null}
      {referenceText && (
        <InputPreview
          text={referenceText}
          onClose={handleCloseReferencePreview}
          disabled={isTypedWorkflowSubmissionPending}
        />
      )}
      {attachments.length > 0 && (
        <Suspense fallback={<Spin size="small" />}>
          <FilePreview
            files={attachments}
            onRemove={handleAttachmentRemove}
            onClear={handleClearAttachments}
            disabled={isTypedWorkflowSubmissionPending}
          />
        </Suspense>
      )}
      {isRespondMode && respondOptions.length > 0 && (
        <div style={{ marginBottom: token.marginSM }}>
          <Space wrap size={[8, 8]}>
            {respondOptions.map((option) => (
              <Button
                key={option}
                size="small"
                onClick={() => {
                  submitRespondOption(option);
                }}
                disabled={isComposerLocked}
              >
                {permissionDecisionLabel(option)}
              </Button>
            ))}
          </Space>
        </div>
      )}
      <MessageInput
        value={content}
        onChange={commandState.handleInputChange}
        onSubmit={effectiveHandleSubmit}
        placeholder={placeholder}
        allowImages={true}
        images={composerDraft.images}
        onImagesChange={composerDraft.setImages}
        onClearImages={composerDraft.clearImages}
        disabled={
          !activeModel ||
          isTypedWorkflowSubmissionPending ||
          (isRespondMode && !respondAllowCustom && respondOptions.length > 0)
        }
        statusIndicator={
          isTypedWorkflowSubmissionPending ? (
            <Space size={token.marginXXS}>
              {statusIndicator}
              <Tag color="processing" icon={<LoadingOutlined spin />}>
                {t("chat.workflowSelection.submitting")}
              </Tag>
            </Space>
          ) : (
            statusIndicator
          )
        }
        submitButtonLabel={submitButtonLabel}
        isCommandSelectorVisible={commandState.showCommandSelector}
        textAreaRef={textAreaRef}
        validateMessage={validateMessage}
        onAttachmentsAdded={handleAttachmentsAdded}
        onWorkflowCommandChange={commandState.handleCommandChange}
        onFileReferenceChange={fileReferenceState.handleFileReferenceChange}
        onFileReferenceButtonClick={fileReferenceState.handleFileReferenceButtonClick}
        leftControlsExtra={leftControlsExtra}
        interaction={interaction}
      />

      <Suspense fallback={null}>
        <CommandSelector
          visible={commandState.showCommandSelector && !isTypedWorkflowSubmissionPending}
          sessionId={sessionId}
          onSelect={commandState.handleCommandSelect}
          onCancel={commandState.handleCommandSelectorCancel}
          onAutoComplete={commandState.handleAutoComplete}
          searchText={commandState.commandSearchText}
        />
      </Suspense>

      {fileReferenceState.showFileSelector && !isTypedWorkflowSubmissionPending && (
        <Suspense fallback={<Spin size="small" />}>
          <FileReferenceSelector
            visible={fileReferenceState.showFileSelector}
            files={fileReferenceState.workspaceFiles}
            searchText={fileReferenceState.fileSearchText}
            loading={fileReferenceState.isWorkspaceLoading}
            error={fileReferenceState.workspaceError}
            onSelect={fileReferenceState.handleFileReferenceSelect}
            onCancel={fileReferenceState.handleFileSelectorCancel}
            onChangeProject={fileReferenceState.openProjectModal}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <SessionProjectModal
          open={fileReferenceState.isProjectModalVisible}
          sessionId={sessionId}
          currentProjectId={currentProjectId}
          currentWorkspacePath={currentChat?.config.workspacePath}
          isChildSession={currentChat?.kind === "child"}
          onCancel={fileReferenceState.closeProjectModal}
          onAssigned={(assigned) => {
            const projectId = assigned.project_id?.trim();
            const assignedProject = projectId
              ? useAppStore.getState().projects[projectId]
              : undefined;
            const path =
              assigned.workspace_path?.trim() || assignedProject?.project_path?.trim() || null;
            if (sessionId && path) {
              void fileReferenceState.fetchWorkspaceFiles(sessionId, path).then(() => {
                fileReferenceState.setShowFileSelector(true);
              });
            }
          }}
        />
      </Suspense>
    </div>
  );
};

export default InputContainer;
