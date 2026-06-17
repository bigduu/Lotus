import React, { useMemo, useEffect, useState, lazy, Suspense, useRef, useCallback } from "react";
import { App as AntApp, Space, theme, Tag, Alert, Spin, Dropdown, Button } from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import {
  ToolOutlined,
  RobotOutlined,
  SettingOutlined,
  ExperimentOutlined,
  LoadingOutlined,
  DownOutlined,
  ThunderboltOutlined,
  ThunderboltFilled,
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
import type {
  ChatSendMessageEventDetail,
  ChatReferenceTextEventDetail,
  WorkflowDraft,
} from "./types";

export type { WorkflowDraft } from "./types";

const FilePreview = lazy(() => import("../FilePreview"));
const CommandSelector = lazy(() => import("../CommandSelector"));
const WorkspacePathModal = lazy(() => import("../WorkspacePathModal"));
const FileReferenceSelector = lazy(() => import("../FileReferenceSelector"));

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
  const activeSessionId = useAppStore((state) => state.currentSessionId);
  const currentChat = useAppStore(selectSessionById(sessionId));
  const currentMessages = useMemo(() => currentChat?.messages || [], [currentChat?.messages]);
  const addMessage = useAppStore((state) => state.addMessage);
  const updateSession = useAppStore((state) => state.updateSession);
  const isStreaming = useAppStore(selectIsStreaming(sessionId));
  const isInputLocked = useAppStore(selectIsInputLocked(sessionId));
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

  const bypassPermissions = currentChat?.config?.bypassPermissions ?? false;
  const setBypassPermissionsPersisted = useCallback(
    async (next: boolean) => {
      if (!sessionId || !currentChat) {
        return;
      }
      // Optimistic local update; backend already persists to runtime.json.
      updateSession(
        sessionId,
        {
          config: {
            ...currentChat.config,
            bypassPermissions: next,
          },
        },
        { skipBackendPatch: true },
      );
      try {
        await agentClient.patchSession(sessionId, { bypass_permissions: next });
      } catch (error) {
        console.warn("[InputContainer] Failed to persist bypass permissions:", error);
        // Roll back the optimistic update on failure.
        updateSession(
          sessionId,
          {
            config: {
              ...currentChat.config,
              bypassPermissions: !next,
            },
          },
          { skipBackendPatch: true },
        );
      }
    },
    [currentChat, sessionId, updateSession],
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
  }, [activeSessionId, sessionId, setReferenceTextPersisted]);

  // Use the global Ant App context message API to avoid mounting a per-pane
  // rc-notification container (which can cause update-depth loops in some layouts).
  const { message: messageApi } = AntApp.useApp();

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
  } = useInputContainerAttachments();

  const commandState = useInputContainerCommand({
    setContent,
    onWorkflowDraftChange,
    acknowledgeManualInput,
    currentSessionId: sessionId,
    textAreaRef,
    content,
  });

  const fileReferenceState = useInputContainerFileReferences({
    content,
    setContent,
    currentSessionId: sessionId,
    currentChat,
    updateSession,
    messageApi,
  });

  const { setShowFileSelector } = fileReferenceState;

  useEffect(() => {
    if (commandState.showCommandSelector) {
      setShowFileSelector(false);
    }
  }, [commandState.showCommandSelector, setShowFileSelector]);

  const { handleSubmit } = useInputContainerSubmit({
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
    setContent,
    setReferenceText: setReferenceTextPersisted,
    setAttachments,
    setFileReferences: fileReferenceState.setFileReferences,
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
    t,
  });

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
      // /goal commands are now handled server-side by Bamboo.
      // They are sent as regular messages through the normal chat flow.
      const targetSessionId = sessionId;
      if (shouldUseRespondModeForSession(targetSessionId)) {
        await handleRespondSubmit(message);
        return;
      }

      await handleSubmit(message, images);
    },
    [handleRespondSubmit, handleSubmit, sessionId, shouldUseRespondModeForSession],
  );

  // Wrap handleSubmit: check latest store state at submit time to avoid stale-mode races
  const effectiveHandleSubmit = useCallback(
    async (message: string, images?: ImageFile[]) => {
      await submitMessageWithLiveMode(message, images);
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
        .then(() => {
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
  }, [activeSessionId, sessionId, submitMessageWithLiveMode]);

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

  const submitButtonLabel = isRespondMode
    ? t("chat.respond.submitToolResult", "Submit tool result")
    : undefined;

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
        disabled={!activeModel || isInputLocked}
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
          disabled={!activeModel || isStreaming}
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
      isInputLocked,
      isMobile,
      isStreaming,
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
        disabled={isStreaming || isSavingModel}
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
      isStreaming,
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
          disabled={isStreaming || isSavingModel}
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
          disabled={isInputLocked || isSavingModel}
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
    isStreaming,
    isSavingModel,
    isProviderConfigured,
    activeModel,
    modelMenuItems,
    handleModelSelect,
    handleModelDropdownVisibleChange,
    isInputLocked,
    modelButton,
  ]);

  const bypassControl = useMemo(
    () => (
      <Button
        type="text"
        size="small"
        disabled={isInputLocked}
        onClick={() => setBypassPermissionsPersisted(!bypassPermissions)}
        aria-pressed={bypassPermissions}
        style={{
          minWidth: isMobile ? 40 : undefined,
          padding: isMobile ? "0 8px" : "0 12px",
          height: 36,
          borderRadius: 18,
          color: bypassPermissions ? token.colorError : token.colorTextSecondary,
        }}
        title={
          bypassPermissions
            ? t("chat.input.bypassPermissions.onTitle")
            : t("chat.input.bypassPermissions.offTitle")
        }
      >
        <Space size={6}>
          {bypassPermissions ? <ThunderboltFilled /> : <ThunderboltOutlined />}
          {!isMobile && <span>{t("chat.input.bypassPermissions.label")}</span>}
        </Space>
      </Button>
    ),
    [
      bypassPermissions,
      isInputLocked,
      isMobile,
      setBypassPermissionsPersisted,
      t,
      token.colorError,
      token.colorTextSecondary,
    ],
  );

  const leftControlsExtra = useMemo(
    () => (
      <Space size={0} wrap>
        {modelControl}
        {reasoningControl}
        {bypassControl}
      </Space>
    ),
    [modelControl, reasoningControl, bypassControl],
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
      isInputLocked,
      canCancel,
      hasMessages: hasUserMessages,
      allowRetry: true as const,
      onRetry: retryLastMessage,
      onCancel: cancelMessage,
      onHistoryNavigate: handleHistoryNavigate,
    }),
    [
      isStreaming,
      isInputLocked,
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

      {referenceText && <InputPreview text={referenceText} onClose={handleCloseReferencePreview} />}
      {attachments.length > 0 && (
        <Suspense fallback={<Spin size="small" />}>
          <FilePreview
            files={attachments}
            onRemove={handleAttachmentRemove}
            onClear={handleClearAttachments}
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
                  void handleRespondSubmit(option);
                }}
                disabled={isInputLocked}
              >
                {option}
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
        disabled={
          !activeModel || (isRespondMode && !respondAllowCustom && respondOptions.length > 0)
        }
        statusIndicator={statusIndicator}
        submitButtonLabel={submitButtonLabel}
        isWorkflowSelectorVisible={commandState.showCommandSelector}
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
          visible={commandState.showCommandSelector}
          onSelect={commandState.handleCommandSelect}
          onCancel={commandState.handleCommandSelectorCancel}
          onAutoComplete={commandState.handleAutoComplete}
          searchText={commandState.commandSearchText}
        />
      </Suspense>

      {fileReferenceState.showFileSelector && (
        <Suspense fallback={<Spin size="small" />}>
          <FileReferenceSelector
            visible={fileReferenceState.showFileSelector}
            files={fileReferenceState.workspaceFiles}
            searchText={fileReferenceState.fileSearchText}
            loading={fileReferenceState.isWorkspaceLoading}
            error={fileReferenceState.workspaceError}
            onSelect={fileReferenceState.handleFileReferenceSelect}
            onCancel={fileReferenceState.handleFileSelectorCancel}
            onChangeWorkspace={() => {
              fileReferenceState.setWorkspacePathInput(currentChat?.config.workspacePath ?? "");
              fileReferenceState.setIsWorkspaceModalVisible(true);
            }}
          />
        </Suspense>
      )}

      <Suspense fallback={null}>
        <WorkspacePathModal
          open={fileReferenceState.isWorkspaceModalVisible}
          initialPath={fileReferenceState.workspacePathInput}
          loading={fileReferenceState.isSavingWorkspace}
          onSubmit={fileReferenceState.handleWorkspaceModalSubmit}
          onCancel={fileReferenceState.handleWorkspaceModalCancel}
        />
      </Suspense>
    </div>
  );
};

export default InputContainer;
