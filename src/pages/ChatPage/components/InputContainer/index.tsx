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
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { MessageInput } from "../MessageInput";
import InputPreview from "./InputPreview";
import { useMessageStreaming } from "../../hooks/useChatManager/useMessageStreaming";
import { selectSessionById, useAppStore } from "../../store";
import { readPersistedInputReasoningEffort } from "../../store/slices/inputStateSlice";
import { useChatInputHistory } from "../../hooks/useChatInputHistory";
import { useInputContainerCommand } from "./useInputContainerCommand";
import { useInputContainerFileReferences } from "./useInputContainerFileReferences";
import { useInputContainerAttachments } from "./useInputContainerAttachments";
import { useInputContainerSubmit } from "./useInputContainerSubmit";
import { useInputContainerHistory } from "./useInputContainerHistory";
import { getInputContainerPlaceholder } from "./inputContainerPlaceholder";
import { useActiveModel } from "../../hooks/useActiveModel";
import { useProviderStore } from "../../store/slices/providerSlice";
import { useSettingsViewStore } from "@shared/store/settingsViewStore";
import type { ReasoningEffort } from "../../services/AgentService";
import {
  type ProviderType,
  OPENAI_MODELS,
  ANTHROPIC_MODELS,
  GEMINI_MODELS,
  COPILOT_MODELS,
} from "../../types/providerConfig";
import { settingsService } from "@services/config/SettingsService";
import { modelService } from "@services/chat/ModelService";
import { agentApiClient } from "../../../../services/api";
import type { ImageFile } from "../../utils/imageUtils";
import { CHAT_FOCUS_INPUT_EVENT, CHAT_PENDING_QUESTION_RESOLVED_EVENT } from "../ChatView/events";

const FilePreview = lazy(() => import("../FilePreview"));
const CommandSelector = lazy(() => import("../CommandSelector"));
const WorkspacePathModal = lazy(() => import("../WorkspacePathModal"));
const FileReferenceSelector = lazy(() => import("../FileReferenceSelector"));

const { useToken } = theme;
const CHAT_SEND_MESSAGE_EVENT = "chat-send-message";
const CHAT_REFERENCE_TEXT_EVENT = "reference-text";
const MODEL_OPTIONS_CACHE_PREFIX = "chat-model-options-cache-v1";
const MODEL_OPTIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];

type ModelOption = { value: string; label: string };
type ModelCachePayload = {
  timestamp: number;
  options: ModelOption[];
};

const getModelOptionsCacheKey = (provider: ProviderType) =>
  `${MODEL_OPTIONS_CACHE_PREFIX}:${provider}`;

const readModelOptionsCache = (provider: ProviderType): ModelOption[] | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getModelOptionsCacheKey(provider));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ModelCachePayload;
    if (!parsed || !Array.isArray(parsed.options)) return null;
    if (Date.now() - parsed.timestamp > MODEL_OPTIONS_CACHE_TTL_MS) return null;
    return parsed.options
      .filter(
        (item) =>
          item &&
          typeof item.value === "string" &&
          item.value.trim().length > 0 &&
          typeof item.label === "string",
      )
      .map((item) => ({ value: item.value, label: item.label }));
  } catch {
    return null;
  }
};

const writeModelOptionsCache = (provider: ProviderType, options: ModelOption[]): void => {
  if (typeof window === "undefined") return;
  try {
    const payload: ModelCachePayload = {
      timestamp: Date.now(),
      options,
    };
    localStorage.setItem(getModelOptionsCacheKey(provider), JSON.stringify(payload));
  } catch {
    // Ignore cache write failures.
  }
};

type ChatSendMessageEventDetail = {
  content: string;
  sessionId?: string | null;
  handled?: boolean;
  resolve?: () => void;
  reject?: (error: unknown) => void;
};

type ChatReferenceTextEventDetail = {
  text: string;
  sessionId?: string | null;
  handled?: boolean;
};

export type WorkflowDraft = {
  id: string;
  name: string;
  content: string;
  createdAt: string;
  type?: "workflow" | "skill" | "mcp"; // Add command type
  displayName?: string; // Add display name for better prompts
  // For non-workflow commands (skill/mcp), keep additional identifiers.
  // `name` is the token shown in the input (e.g. "read_file"), while `mcpAlias`
  // can be the fully-qualified MCP tool name (e.g. "mcp__filesystem__read_file").
  mcpAlias?: string;
  mcpServerId?: string;
  mcpServerName?: string;
  mcpOriginalName?: string;
};

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
  const openSettings = useSettingsViewStore((state) => state.open);
  const sessionId = useAppStore((state) => sessionIdProp ?? state.currentSessionId);
  const activeSessionId = useAppStore((state) => state.currentSessionId);
  const currentChat = useAppStore(selectSessionById(sessionId));
  const currentMessages = currentChat?.messages || [];
  const addMessage = useAppStore((state) => state.addMessage);
  const updateSession = useAppStore((state) => state.updateSession);
  const processingChats = useAppStore((state) => state.processingChats);
  const setSessionProcessing = useAppStore((state) => state.setSessionProcessing);
  const pendingQuestionRespond = useAppStore((state) => state.pendingQuestionRespond);
  const clearPendingQuestionRespondForSession = useAppStore(
    (state) => state.clearPendingQuestionRespondForSession,
  );
  const activeModel = useActiveModel();

  // Get input state from Zustand slice (persisted per session)
  const inputState = useAppStore((state) => (sessionId ? state.inputStates[sessionId] : undefined));
  const setInputContent = useAppStore((state) => state.setInputContent);
  const setReferenceText = useAppStore((state) => state.setReferenceText);
  const setInputReasoningEffort = useAppStore((state) => state.setInputReasoningEffort);
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const providerConfig = useProviderStore((state) => state.providerConfig);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [isModelOptionsLoading, setIsModelOptionsLoading] = useState(false);
  const [modelOptionsError, setModelOptionsError] = useState<string | null>(null);
  const [isSavingModel, setIsSavingModel] = useState(false);

  // Use persisted state or empty defaults
  const content = inputState?.content || "";
  const referenceText = inputState?.referenceText || null;
  const providerDefaultReasoningEffort = useMemo<ReasoningEffort | undefined>(
    () => providerConfig.providers[currentProvider]?.reasoning_effort,
    [providerConfig, currentProvider],
  );
  const persistedReasoningEffort = useMemo<ReasoningEffort | undefined>(
    () => (sessionId ? readPersistedInputReasoningEffort(sessionId) : undefined),
    [sessionId],
  );
  const reasoningEffort: ReasoningEffort =
    inputState?.reasoningEffort ??
    persistedReasoningEffort ??
    providerDefaultReasoningEffort ??
    "medium";
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
    (nextEffort: ReasoningEffort) => {
      if (sessionId) {
        setInputReasoningEffort(sessionId, nextEffort);
      }
    },
    [sessionId, setInputReasoningEffort],
  );

  const isProcessing = sessionId ? processingChats.has(sessionId) : false;

  const {
    sendMessage,
    retryLastTurn,
    cancel: cancelMessage,
  } = useMessageStreaming({
    sessionId,
    addMessage,
    setSessionProcessing,
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

  const isStreaming = isProcessing;
  // Use the global Ant App context message API to avoid mounting a per-pane
  // rc-notification container (which can cause update-depth loops in some layouts).
  const { message: messageApi } = AntApp.useApp();

  const isToolSpecificMode = false;
  const isRestrictConversation = false;
  const allowedTools: string[] = [];
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
  const currentPendingRespond =
    pendingQuestionRespond && pendingQuestionRespond.sessionId === sessionId
      ? pendingQuestionRespond
      : null;
  const isRespondMode = Boolean(currentPendingRespond);
  const respondOptions = currentPendingRespond?.options || [];
  const respondAllowCustom = currentPendingRespond?.allowCustom ?? true;

  const shouldUseRespondModeForSession = useCallback((targetSessionId?: string | null): boolean => {
    if (!targetSessionId) {
      return false;
    }
    const latestPendingRespond = useAppStore.getState().pendingQuestionRespond;
    return latestPendingRespond?.sessionId === targetSessionId;
  }, []);

  const handleRespondSubmit = useCallback(
    async (responseText: string) => {
      const trimmed = responseText.trim();
      if (!trimmed || !sessionId) return;

      const latestPendingRespond = useAppStore.getState().pendingQuestionRespond;
      const currentRespondPayload =
        latestPendingRespond?.sessionId === sessionId ? latestPendingRespond : null;
      if (
        currentRespondPayload &&
        !currentRespondPayload.allowCustom &&
        currentRespondPayload.options.length > 0 &&
        !currentRespondPayload.options.includes(trimmed)
      ) {
        messageApi.warning(t("components.questionDialog.selectOptionWarning"));
        return;
      }

      try {
        const modelToUse = activeModel?.trim();
        const result = await agentApiClient.post<{ auto_resume_status?: string }>(
          `respond/${sessionId}`,
          {
            response: trimmed,
            model: modelToUse || undefined,
            reasoning_effort: reasoningEffort,
          },
        );

        messageApi.success(t("components.questionDialog.responseSubmittedContinue"));
        setContent("");
        clearPendingQuestionRespondForSession(sessionId);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(CHAT_PENDING_QUESTION_RESOLVED_EVENT, {
              detail: { sessionId },
            }),
          );
        }

        const resumeStatus = result?.auto_resume_status;
        if (resumeStatus && ["started", "already_running"].includes(resumeStatus)) {
          setSessionProcessing(sessionId, true);
        }
      } catch (err) {
        console.error("[InputContainer] Failed to submit respond:", err);
        messageApi.error(
          err instanceof Error ? err.message : t("components.questionDialog.submitFailed"),
        );
      }
    },
    [
      sessionId,
      activeModel,
      reasoningEffort,
      messageApi,
      setContent,
      clearPendingQuestionRespondForSession,
      setSessionProcessing,
      t,
    ],
  );

  const submitMessageWithLiveMode = useCallback(
    async (message: string, images?: ImageFile[]) => {
      const targetSessionId = sessionId;
      if (shouldUseRespondModeForSession(targetSessionId)) {
        await handleRespondSubmit(message);
        return;
      }

      await handleSubmit(message, images);
    },
    [sessionId, shouldUseRespondModeForSession, handleRespondSubmit, handleSubmit],
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

  const handleCloseReferencePreview = () => setReferenceTextPersisted(null);

  const currentProviderSettings = useMemo(() => {
    return (providerConfig.providers as Partial<Record<ProviderType, any>>)?.[currentProvider];
  }, [providerConfig, currentProvider]);

  const isProviderConfigured = useMemo(() => {
    if (!currentProviderSettings || typeof currentProviderSettings !== "object") {
      return false;
    }

    if (currentProvider === "copilot") {
      return Object.keys(currentProviderSettings).length > 0;
    }

    return (
      typeof currentProviderSettings.api_key === "string" &&
      currentProviderSettings.api_key.trim().length > 0
    );
  }, [currentProvider, currentProviderSettings]);

  const redirectToProviderSettingsIfNeeded = useCallback(() => {
    if (isProviderConfigured) return false;
    openSettings("chat");
    messageApi.warning("Please configure provider first");
    return true;
  }, [isProviderConfigured, messageApi, openSettings]);

  useEffect(() => {
    const cached = readModelOptionsCache(currentProvider);
    setModelOptions(cached ?? []);
    setModelOptionsError(null);
  }, [currentProvider]);

  const getErrorMessage = useCallback((error: unknown) => {
    if (error instanceof Error && error.message.trim()) return error.message;
    return "Unknown error";
  }, []);

  const fallbackModelOptions = useMemo(() => {
    const byProvider: Record<ProviderType, ModelOption[]> = {
      openai: [...OPENAI_MODELS],
      anthropic: [...ANTHROPIC_MODELS],
      gemini: [...GEMINI_MODELS],
      copilot: [...COPILOT_MODELS],
    };
    return byProvider[currentProvider] || [];
  }, [currentProvider]);

  const resolvedModelOptions = useMemo(() => {
    const base = modelOptions.length > 0 ? modelOptions : fallbackModelOptions;
    const normalized = [...base];
    if (activeModel && !normalized.some((item) => item.value === activeModel)) {
      normalized.unshift({ value: activeModel, label: activeModel });
    }
    return normalized;
  }, [modelOptions, fallbackModelOptions, activeModel]);

  const fetchProviderModels = useCallback(
    async (provider: ProviderType, options?: { force?: boolean }) => {
      if (!options?.force && modelOptions.length > 0) return;
      try {
        setIsModelOptionsLoading(true);
        setModelOptionsError(null);

        const models =
          provider === "copilot"
            ? await modelService.getModels()
            : await settingsService.fetchProviderModels(provider);
        const options = models.map((model) => ({
          value: model,
          label: model,
        }));
        setModelOptions(options);
        writeModelOptionsCache(provider, options);
      } catch (error) {
        setModelOptionsError(getErrorMessage(error));
      } finally {
        setIsModelOptionsLoading(false);
      }
    },
    [getErrorMessage, modelOptions.length],
  );

  const handleModelDropdownVisibleChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      if (redirectToProviderSettingsIfNeeded()) return;
      if (isModelOptionsLoading) return;
      if (modelOptions.length > 0) return;
      void fetchProviderModels(currentProvider);
    },
    [
      currentProvider,
      fetchProviderModels,
      isModelOptionsLoading,
      modelOptions.length,
      redirectToProviderSettingsIfNeeded,
    ],
  );

  const handleModelSelect = useCallback(
    async (value: string) => {
      if (!value || value === activeModel) return;
      if (isSavingModel) return;

      try {
        if (redirectToProviderSettingsIfNeeded()) return;
        setIsSavingModel(true);
        const providerStore = useProviderStore.getState();
        const nextProviders = { ...(providerStore.providerConfig.providers || {}) } as any;
        nextProviders[currentProvider] = {
          ...(nextProviders[currentProvider] || {}),
          model: value,
        };

        await settingsService.saveProviderConfig({
          provider: currentProvider,
          providers: nextProviders,
        });
        await providerStore.loadProviderConfig();
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
      currentProvider,
      getErrorMessage,
      isSavingModel,
      messageApi,
      redirectToProviderSettingsIfNeeded,
      t,
    ],
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

  const respondModeIndicator = useMemo(() => {
    if (!isRespondMode) {
      return null;
    }

    return (
      <Tag color="processing" style={{ marginInlineEnd: 0 }}>
        {t("chat.respond.modeLabel", "Tool response mode")}
      </Tag>
    );
  }, [isRespondMode, t]);

  const resolvedStatusIndicator = useMemo(() => {
    if (!respondModeIndicator) {
      return statusIndicator ?? null;
    }
    if (!statusIndicator) {
      return respondModeIndicator;
    }
    return (
      <Space size={6} align="center">
        {respondModeIndicator}
        {statusIndicator}
      </Space>
    );
  }, [respondModeIndicator, statusIndicator]);

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

  const reasoningControl = (
    <Dropdown
      trigger={["click"]}
      placement="topLeft"
      disabled={!activeModel || isStreaming}
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
          minWidth: 88,
          padding: "0 12px",
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

  const modelButton = (
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
        minWidth: 146,
        padding: "0 12px",
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
            maxWidth: 128,
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
  );

  const modelControl = isProviderConfigured ? (
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
      disabled={isStreaming || isSavingModel}
    >
      {modelButton}
    </Dropdown>
  ) : (
    modelButton
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
                disabled={isStreaming}
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
        disabled={!activeModel || (isRespondMode && !respondAllowCustom && respondOptions.length > 0)}
        statusIndicator={resolvedStatusIndicator}
        submitButtonLabel={submitButtonLabel}
        isWorkflowSelectorVisible={commandState.showCommandSelector}
        textAreaRef={textAreaRef}
        validateMessage={(message) => {
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
        }}
        onAttachmentsAdded={handleAttachmentsAdded}
        onWorkflowCommandChange={commandState.handleCommandChange}
        onFileReferenceChange={fileReferenceState.handleFileReferenceChange}
        onFileReferenceButtonClick={fileReferenceState.handleFileReferenceButtonClick}
        leftControlsExtra={
          <Space size={0} wrap>
            {modelControl}
            {reasoningControl}
          </Space>
        }
        interaction={{
          isStreaming,
          hasMessages: currentMessages.some((m) => m.role === "user"),
          allowRetry: true,
          onRetry: retryLastMessage,
          onCancel: cancelMessage,
          onHistoryNavigate: handleHistoryNavigate,
        }}
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
