import React, {
  useMemo,
  useEffect,
  useState,
  lazy,
  Suspense,
  useRef,
  useCallback,
} from "react";
import {
  App as AntApp,
  Space,
  theme,
  Tag,
  Alert,
  Spin,
  Dropdown,
  Button,
} from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import {
  ToolOutlined,
  RobotOutlined,
  SettingOutlined,
  ExperimentOutlined,
  LoadingOutlined,
  DownOutlined,
} from "@ant-design/icons";
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

const FilePreview = lazy(() => import("../FilePreview"));
const CommandSelector = lazy(() => import("../CommandSelector"));
const WorkspacePathModal = lazy(() => import("../WorkspacePathModal"));
const FileReferenceSelector = lazy(() => import("../FileReferenceSelector"));

const { useToken } = theme;
const CHAT_SEND_MESSAGE_EVENT = "chat-send-message";
const CHAT_REFERENCE_TEXT_EVENT = "reference-text";
const MODEL_OPTIONS_CACHE_PREFIX = "chat-model-options-cache-v1";
const MODEL_OPTIONS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REASONING_EFFORT_OPTIONS: Array<{
  value: ReasoningEffort;
  label: string;
}> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
];

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

const writeModelOptionsCache = (
  provider: ProviderType,
  options: ModelOption[],
): void => {
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
  const pendingQuestionRespond = useAppStore(
    (state) => state.pendingQuestionRespond,
  );
  const setPendingQuestionRespond = useAppStore(
    (state) => state.setPendingQuestionRespond,
  );
  const activeModel = useActiveModel();

  // Get input state from Zustand slice (persisted per session)
  const inputState = useAppStore((state) =>
    sessionId ? state.inputStates[sessionId] : undefined,
  );
  const setInputContent = useAppStore((state) => state.setInputContent);
  const setReferenceText = useAppStore((state) => state.setReferenceText);
  const setInputReasoningEffort = useAppStore(
    (state) => state.setInputReasoningEffort,
  );
  const currentProvider = useProviderStore((state) => state.currentProvider);
  const providerConfig = useProviderStore((state) => state.providerConfig);
  const [modelOptions, setModelOptions] = useState<
    ModelOption[]
  >([]);
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

    const handleExternalSend = (event: Event) => {
      const customEvent = event as CustomEvent<ChatSendMessageEventDetail>;
      if (!customEvent.detail) {
        return;
      }

      // If a target sessionId is provided, only the matching pane should handle it.
      // Otherwise, default to the globally active chat to avoid sending from all panes.
      const targetSessionId =
        typeof customEvent.detail.sessionId === "string"
          ? customEvent.detail.sessionId
          : null;
      const shouldHandle = targetSessionId
        ? sessionId === targetSessionId
        : sessionId !== null && sessionId === activeSessionId;
      if (!shouldHandle) {
        return;
      }

      customEvent.detail.handled = true;
      const contentValue = customEvent.detail?.content;

      if (
        typeof contentValue !== "string" ||
        contentValue.trim().length === 0
      ) {
        customEvent.detail?.reject?.(
          new Error("External send message content is empty"),
        );
        return;
      }

      sendMessage(contentValue, undefined, reasoningEffort)
        .then(() => {
          customEvent.detail?.resolve?.();
        })
        .catch((error: unknown) => {
          customEvent.detail?.reject?.(error);
        });
    };

    window.addEventListener(
      CHAT_SEND_MESSAGE_EVENT,
      handleExternalSend as EventListener,
    );

    return () => {
      window.removeEventListener(
        CHAT_SEND_MESSAGE_EVENT,
        handleExternalSend as EventListener,
      );
    };
  }, [activeSessionId, sessionId, sendMessage, reasoningEffort]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleReferenceText = (event: Event) => {
      const customEvent = event as CustomEvent<ChatReferenceTextEventDetail>;
      if (!customEvent.detail || typeof customEvent.detail.text !== "string") {
        return;
      }

      const targetSessionId =
        typeof customEvent.detail.sessionId === "string"
          ? customEvent.detail.sessionId
          : null;
      const shouldHandle = targetSessionId
        ? sessionId === targetSessionId
        : sessionId !== null && sessionId === activeSessionId;
      if (!shouldHandle) {
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

    window.addEventListener(
      CHAT_REFERENCE_TEXT_EVENT,
      handleReferenceText as EventListener,
    );

    return () => {
      window.removeEventListener(
        CHAT_REFERENCE_TEXT_EVENT,
        handleReferenceText as EventListener,
      );
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

  const { recordEntry, navigate, acknowledgeManualInput } =
    useChatInputHistory(sessionId);

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
  const isRespondMode = Boolean(
    pendingQuestionRespond && pendingQuestionRespond.sessionId === sessionId,
  );

  const handleRespondSubmit = useCallback(
    async (responseText: string) => {
      const trimmed = responseText.trim();
      if (!trimmed || !sessionId) return;

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

        messageApi.success("Response submitted, AI will continue processing");
        setContent("");
        setPendingQuestionRespond(null);

        const resumeStatus = result?.auto_resume_status;
        if (
          resumeStatus &&
          ["started", "already_running"].includes(resumeStatus)
        ) {
          setSessionProcessing(sessionId, true);
        }
      } catch (err) {
        console.error("[InputContainer] Failed to submit respond:", err);
        messageApi.error(
          err instanceof Error ? err.message : "Submission failed",
        );
      }
    },
    [
      sessionId,
      activeModel,
      reasoningEffort,
      messageApi,
      setContent,
      setPendingQuestionRespond,
      setSessionProcessing,
    ],
  );

  // Wrap handleSubmit: in respond mode, redirect to respond API
  const effectiveHandleSubmit = useCallback(
    async (message: string, images?: ImageFile[]) => {
      if (isRespondMode) {
        await handleRespondSubmit(message);
      } else {
        await handleSubmit(message, images);
      }
    },
    [isRespondMode, handleRespondSubmit, handleSubmit],
  );

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
    return (providerConfig.providers as Partial<Record<ProviderType, any>>)?.[
      currentProvider
    ];
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
        messageApi.success("Model updated");
      } catch (error) {
        messageApi.error(`Failed to update model: ${getErrorMessage(error)}`);
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
    ],
  );

  const basePlaceholder = useMemo(() => {
    return getInputContainerPlaceholder({
      referenceText,
      isToolSpecificMode,
      isRestrictConversation,
      allowedTools,
      autoToolPrefix,
    });
  }, [
    referenceText,
    isToolSpecificMode,
    isRestrictConversation,
    allowedTools,
    autoToolPrefix,
  ]);

  // In respond mode, override placeholder to guide the user
  const placeholder = isRespondMode
    ? "Type your custom answer here, press Enter to submit..."
    : basePlaceholder;

  const currentReasoningLabel = useMemo(
    () =>
      REASONING_EFFORT_OPTIONS.find((option) => option.value === reasoningEffort)
        ?.label ?? reasoningEffort,
    [reasoningEffort],
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
          key: option.value,
          label: option.label,
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
          color:
            reasoningEffort === "medium"
              ? token.colorTextSecondary
              : token.colorPrimary,
        }}
        title={`Reasoning: ${currentReasoningLabel}`}
      >
        <Space size={6}>
          <ExperimentOutlined />
          <span>{currentReasoningLabel}</span>
          <DownOutlined style={{ fontSize: 10 }} />
        </Space>
      </Button>
    </Dropdown>
  );

  const modelLabel = activeModel || (isProviderConfigured ? "Select Model" : "Configure Provider");
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
              label: modelOptionsError || "No models available",
              disabled: true,
            },
          ],
    [resolvedModelOptions, modelOptionsError],
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
          message={isProviderConfigured ? "No model selected" : "Provider not configured"}
          description={
            isProviderConfigured
              ? "Select a model from the dropdown in the input toolbar."
              : "Open settings and configure a provider before selecting a model."
          }
          action={
            !isProviderConfigured ? (
              <Space>
                <a onClick={() => openSettings("chat")}>Open Settings</a>
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
                  ? "Strict Mode: Tool calls only"
                  : "Tool-specific Mode"}
              </span>
              {autoToolPrefix && (
                <Tag color="blue">
                  <ToolOutlined /> Auto-prefix: {autoToolPrefix}
                </Tag>
              )}
            </Space>
          }
          description={
            allowedTools.length > 0 && (
              <Space wrap>
                <span>Allowed tools:</span>
                {allowedTools.map((tool: string) => (
                  <Tag key={tool} color="green">
                    /{tool}
                  </Tag>
                ))}
              </Space>
            )
          }
        />
      )}

      {referenceText && (
        <InputPreview
          text={referenceText}
          onClose={handleCloseReferencePreview}
        />
      )}
      {attachments.length > 0 && (
        <Suspense fallback={<Spin size="small" />}>
          <FilePreview
            files={attachments}
            onRemove={handleAttachmentRemove}
            onClear={handleClearAttachments}
          />
        </Suspense>
      )}
      <MessageInput
        value={content}
        onChange={commandState.handleInputChange}
        onSubmit={effectiveHandleSubmit}
        placeholder={placeholder}
        allowImages={true}
        disabled={!activeModel}
        statusIndicator={statusIndicator ?? null}
        isWorkflowSelectorVisible={commandState.showCommandSelector}
        textAreaRef={textAreaRef}
        validateMessage={(message) => {
          if (isRestrictConversation && autoToolPrefix) {
            const trimmed = message.trim();
            if (!trimmed.startsWith(autoToolPrefix)) {
              return {
                isValid: false,
                errorMessage: `Messages must start with '${autoToolPrefix}'.`,
              };
            }
          }
          return { isValid: true };
        }}
        onAttachmentsAdded={handleAttachmentsAdded}
        onWorkflowCommandChange={commandState.handleCommandChange}
        onFileReferenceChange={fileReferenceState.handleFileReferenceChange}
        onFileReferenceButtonClick={
          fileReferenceState.handleFileReferenceButtonClick
        }
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
              fileReferenceState.setWorkspacePathInput(
                currentChat?.config.workspacePath ?? "",
              );
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
