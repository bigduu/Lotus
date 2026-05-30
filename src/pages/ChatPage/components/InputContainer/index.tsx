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
import {
  selectSessionById,
  selectIsStreaming,
  selectIsInputLocked,
  selectCanCancel,
  selectPendingQuestion,
  useAppStore,
} from "../../store";
import { readPersistedInputReasoningEffort } from "../../store/slices/inputStateSlice";
import { useChatInputHistory } from "../../hooks/useChatInputHistory";
import { useInputContainerCommand } from "./useInputContainerCommand";
import { useInputContainerFileReferences } from "./useInputContainerFileReferences";
import { useInputContainerAttachments } from "./useInputContainerAttachments";
import { useInputContainerSubmit } from "./useInputContainerSubmit";
import { useInputContainerHistory } from "./useInputContainerHistory";
import { getInputContainerPlaceholder } from "./inputContainerPlaceholder";
import { useActiveModel } from "../../hooks/useActiveModel";
import { useActiveModelRef } from "../../hooks/useActiveModelRef";
import { resolveProviderDefaultReasoningEffort } from "../../utils/reasoningEffort";
import { useProviderStore } from "../../store/slices/providerSlice";
import { ProviderModelPicker } from "../ProviderModelPicker";
import { useSettingsViewStore } from "@shared/store/settingsViewStore";
import { agentClient, type GoldConfig, type ReasoningEffort } from "@services/chat/AgentService";
import {
  type ProviderType,
  type OpenAIConfig,
  type AnthropicConfig,
  type GeminiConfig,
  type CopilotConfig,
  OPENAI_MODELS,
  ANTHROPIC_MODELS,
  GEMINI_MODELS,
  COPILOT_MODELS,
} from "../../types/providerConfig";
import { modelService } from "@services/chat/ModelService";
import { agentApiClient } from "../../../../services/api";
import { StorageManager } from "../../../../services/storage/StorageManager";
import type { ImageFile } from "../../utils/imageUtils";
import { CHAT_FOCUS_INPUT_EVENT, CHAT_PENDING_QUESTION_RESOLVED_EVENT } from "../ChatView/events";
import { useIsMobile } from "@shared/hooks/useMediaQuery";

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
const EMPTY_ALLOWED_TOOLS: string[] = [];
const DEFAULT_GOAL_MAX_OUTPUT_TOKENS = 1024;
const DEFAULT_GOAL_MAX_AUTO_CONTINUATIONS = 3;

type ModelOption = { value: string; label: string };

type RespondExecutionDebugSnapshot = {
  phase: string;
  generation: number;
  backendRunId: string | null;
  backendIsRunning: boolean;
  hasPendingQuestion: boolean;
  pendingQuestionToolCallId: string | null;
  tokenCount: number;
  hasTokens: boolean;
  activeReasons: string[];
};

const debugRespondFlow = (event: string, payload: Record<string, unknown>): void => {
  if (!import.meta.env.DEV) return;
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem("lotus_debug_respond") !== "1") return;
  console.warn(`[RespondFlow] ${event}`, payload);
};

type ModelCachePayload = {
  timestamp: number;
  options: ModelOption[];
};

const getModelOptionsCacheKey = (provider: ProviderType) =>
  `${MODEL_OPTIONS_CACHE_PREFIX}:${provider}`;

// localStorage helpers for model options cache
const readModelOptionsCacheFromLocalStorage = (provider: ProviderType): ModelOption[] | null => {
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

const writeModelOptionsCacheToLocalStorage = (
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

const readModelOptionsCache = async (provider: ProviderType): Promise<ModelOption[] | null> => {
  const manager = StorageManager.getInstance();
  try {
    const cached = await manager.loadModelOptionsCache(provider);
    if (cached) {
      if (Date.now() - cached.timestamp > MODEL_OPTIONS_CACHE_TTL_MS) return null;
      return cached.options.filter(
        (item) =>
          item &&
          typeof item.value === "string" &&
          item.value.trim().length > 0 &&
          typeof item.label === "string",
      );
    }
  } catch {
    // Fall through to localStorage
  }
  // Fallback to localStorage if IndexedDB is unavailable
  return readModelOptionsCacheFromLocalStorage(provider);
};

const writeModelOptionsCache = async (
  provider: ProviderType,
  options: ModelOption[],
): Promise<void> => {
  const manager = StorageManager.getInstance();
  try {
    await manager.saveModelOptionsCache(provider, options, Date.now());
  } catch {
    // Ignore IndexedDB write failures
  }
  // Also keep writing to localStorage for backward compatibility
  writeModelOptionsCacheToLocalStorage(provider, options);
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
  type?: "workflow" | "skill" | "mcp" | "goal"; // Add command type
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
  const markRespondStart = useAppStore((state) => state.markRespondStart);
  const markSettleTimeout = useAppStore((state) => state.markSettleTimeout);
  const applyExecutionStarted = useAppStore((state) => state.applyExecutionStarted);
  const pendingQuestion = useAppStore(selectPendingQuestion(sessionId));
  const clearPendingQuestion = useAppStore((state) => state.clearPendingQuestion);
  const getRespondExecutionDebugSnapshot = useCallback((): RespondExecutionDebugSnapshot | null => {
    if (!sessionId) return null;
    const entry = useAppStore.getState().executionBySession?.[sessionId];
    if (!entry) return null;
    return {
      phase: entry.phase,
      generation: entry.generation,
      backendRunId: entry.backendRunId ?? null,
      backendIsRunning: entry.backend.isRunning,
      hasPendingQuestion: entry.interaction.pendingQuestion != null,
      pendingQuestionToolCallId: entry.interaction.pendingQuestion?.toolCallId ?? null,
      tokenCount: entry.stream.tokenCount,
      hasTokens: entry.stream.hasTokens,
      activeReasons: entry.activeReasons,
    };
  }, [sessionId]);
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
  const getProviderType = useProviderStore((s) => s.getProviderType);

  // In instance mode currentProvider is an instance id; resolve to ProviderType.
  const resolvedProviderType = useMemo<ProviderType>(
    () => getProviderType(currentProvider),
    [currentProvider, getProviderType],
  );

  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [isModelOptionsLoading, setIsModelOptionsLoading] = useState(false);
  const [modelOptionsError, setModelOptionsError] = useState<string | null>(null);
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
      ),
    [activeModelRef, currentChat?.config?.model_ref?.provider, providerConfig, currentProvider],
  );
  const persistedReasoningEffort = useMemo<ReasoningEffort | undefined>(
    () => (sessionId ? readPersistedInputReasoningEffort(sessionId) : undefined),
    [sessionId],
  );
  const reasoningEffort: ReasoningEffort =
    currentChat?.config?.reasoningEffort ??
    inputState?.reasoningEffort ??
    persistedReasoningEffort ??
    providerDefaultReasoningEffort ??
    "medium";
  const sessionGoldConfig = currentChat?.config?.goldConfig ?? null;
  const isGoalEnabled = sessionGoldConfig?.enabled === true;
  const goalPrompt = sessionGoldConfig?.goal ?? sessionGoldConfig?.evaluation_prompt ?? "";
  const buildSessionGoalConfig = useCallback(
    (enabled: boolean, prompt: string): GoldConfig => ({
      ...(sessionGoldConfig ?? {}),
      enabled,
      auto_answer_enabled: enabled,
      auto_continue_enabled: enabled,
      goal: prompt.trim() || undefined,
      max_output_tokens: sessionGoldConfig?.max_output_tokens ?? DEFAULT_GOAL_MAX_OUTPUT_TOKENS,
      max_auto_continuations:
        sessionGoldConfig?.max_auto_continuations ?? DEFAULT_GOAL_MAX_AUTO_CONTINUATIONS,
    }),
    [sessionGoldConfig],
  );
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
  const persistGoalConfig = useCallback(
    (nextConfig: GoldConfig) => {
      if (!sessionId || !currentChat) return;
      updateSession(sessionId, {
        config: {
          ...currentChat.config,
          goldConfig: nextConfig,
        },
      });
    },
    [currentChat, sessionId, updateSession],
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
        updateSession(sessionId, {
          config: {
            ...currentChat.config,
            reasoningEffort: nextEffort,
          },
        });
      } catch (error) {
        console.warn("[InputContainer] Failed to persist reasoning effort:", error);
      }
    },
    [currentChat, sessionId, setInputReasoningEffort, updateSession],
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

  const shouldUseRespondModeForSession = useCallback((targetSessionId?: string | null): boolean => {
    if (!targetSessionId) {
      return false;
    }
    const latestPendingQuestion = selectPendingQuestion(targetSessionId)(useAppStore.getState());
    return Boolean(latestPendingQuestion);
  }, []);

  const handleRespondSubmit = useCallback(
    async (responseText: string) => {
      const trimmed = responseText.trim();
      if (!trimmed || !sessionId) return;

      const latestPendingQuestion = selectPendingQuestion(sessionId)(useAppStore.getState());
      const currentRespondPayload = latestPendingQuestion;
      if (
        currentRespondPayload &&
        !currentRespondPayload.allowCustom &&
        currentRespondPayload.options.length > 0 &&
        !currentRespondPayload.options.includes(trimmed)
      ) {
        messageApi.warning(t("components.questionDialog.selectOptionWarning"));
        return;
      }

      debugRespondFlow("input.respond:start", {
        sessionId,
        trimmedLength: trimmed.length,
        pendingQuestionToolCallId: currentPendingRespond?.toolCallId ?? null,
        executionBefore: getRespondExecutionDebugSnapshot(),
      });

      // Set processing state immediately so the UI shows feedback while the
      // outbound respond request is still in-flight.  This mirrors the send-path
      // fix that sets processing before the network call.
      // CRITICAL: This increases generation and returns the new generation value.
      const newGeneration = markRespondStart(sessionId, currentPendingRespond?.toolCallId ?? null);
      debugRespondFlow("input.respond:afterMarkRespondStart", {
        sessionId,
        newGeneration,
        executionAfterMarkRespondStart: getRespondExecutionDebugSnapshot(),
      });
      // Yield so React can flush the processing-state render before we block
      // the microtask queue with network I/O.
      await new Promise((resolve) => setTimeout(resolve, 0));

      try {
        const respondPayload: Record<string, unknown> = {
          response: trimmed,
          reasoning_effort: reasoningEffort,
        };
        if (isFlagOn() && activeModelRef) {
          respondPayload.model_ref = activeModelRef;
          respondPayload.provider = activeModelRef.provider;
        }

        const result = await agentApiClient.post<{
          auto_resume_status?: string;
          run_id?: string;
        }>(`respond/${sessionId}`, respondPayload);
        debugRespondFlow("input.respond:response", {
          sessionId,
          result,
          executionAfterResponse: getRespondExecutionDebugSnapshot(),
        });

        messageApi.success(t("components.questionDialog.responseSubmittedContinue"));
        setContent("");
        clearPendingQuestion(sessionId);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(CHAT_PENDING_QUESTION_RESOLVED_EVENT, {
              detail: { sessionId },
            }),
          );
        }

        // Processing was already set to true before the POST.  If the server
        // started/resumed execution, immediately advance the phase to running
        // so the UI shows feedback without waiting for the SSE event (which may
        // be delayed by network jitter or reconnect backoff).
        const resumeStatus = result?.auto_resume_status;
        const runId = result?.run_id;
        debugRespondFlow("input.respond:resumeDecision", {
          sessionId,
          resumeStatus,
          runId: runId ?? null,
          newGeneration,
          executionBeforeResumeDecision: getRespondExecutionDebugSnapshot(),
        });
        if (resumeStatus === "started" || resumeStatus === "already_running") {
          // Use the newGeneration returned by markRespondStart to ensure SSE events
          // will match. This is critical because markRespondStart increased generation,
          // and all subsequent SSE events must use the matching generation.
          applyExecutionStarted(sessionId, runId ?? "", newGeneration);
          debugRespondFlow("input.respond:afterApplyExecutionStarted", {
            sessionId,
            resumeStatus,
            runId: runId ?? null,
            newGeneration,
            executionAfterApplyExecutionStarted: getRespondExecutionDebugSnapshot(),
          });
        } else if (resumeStatus === "error" || !resumeStatus) {
          console.error("[InputContainer] Failed to auto-resume agent execution");
          markSettleTimeout(sessionId);
        }
      } catch (err) {
        console.error("[InputContainer] Failed to submit respond:", err);
        messageApi.error(
          err instanceof Error ? err.message : t("components.questionDialog.submitFailed"),
        );
        // Clear processing on error to avoid stuck spinner.
        markSettleTimeout(sessionId);
      }
    },
    [
      sessionId,
      reasoningEffort,
      activeModelRef,
      isFlagOn,
      messageApi,
      setContent,
      clearPendingQuestion,
      markRespondStart,
      markSettleTimeout,
      applyExecutionStarted,
      getRespondExecutionDebugSnapshot,
      currentPendingRespond?.toolCallId,
      t,
    ],
  );

  const clearGoalCommandInput = useCallback(() => {
    setContent("");
    commandState.clearCommandDraft();
    requestAnimationFrame(() => {
      textAreaRef.current?.focus();
    });
  }, [commandState, setContent]);

  // NOTE: /goal commands are now handled server-side by Bamboo. This handler is
  // retained for local-only UI feedback (toasts) in a future iteration.

  const _handleGoalCommand = useCallback(
    async (rawMessage: string): Promise<boolean> => {
      const trimmed = rawMessage.trim();
      if (!/^\/goal(?:\s|$)/i.test(trimmed)) {
        return false;
      }

      if (!sessionId || !currentChat) {
        messageApi.warning("Create or select a session before using /goal.");
        return true;
      }

      const commandArg = trimmed.replace(/^\/goal(?:\s+)?/i, "").trim();
      const normalizedArg = commandArg.toLowerCase();
      recordEntry(trimmed);

      if (!commandArg || normalizedArg === "status") {
        const previewPrompt = goalPrompt.trim();
        const clippedPrompt =
          previewPrompt.length > 120 ? `${previewPrompt.slice(0, 120)}…` : previewPrompt;
        messageApi.info(
          isGoalEnabled
            ? `Goal is enabled for this session${clippedPrompt ? `: ${clippedPrompt}` : "."}`
            : "Goal is disabled for this session. Use /goal <prompt> to enable it.",
        );
        clearGoalCommandInput();
        return true;
      }

      if (["off", "disable", "disabled"].includes(normalizedArg)) {
        const nextPrompt = goalPrompt;
        persistGoalConfig(buildSessionGoalConfig(false, nextPrompt));
        messageApi.success("Goal disabled for this session.");
        clearGoalCommandInput();
        return true;
      }

      if (["clear", "reset"].includes(normalizedArg)) {
        persistGoalConfig(buildSessionGoalConfig(false, ""));
        messageApi.success("Goal cleared for this session.");
        clearGoalCommandInput();
        return true;
      }

      if (["on", "enable", "enabled"].includes(normalizedArg)) {
        const nextPrompt = goalPrompt.trim();
        if (!nextPrompt) {
          messageApi.warning("Usage: /goal <prompt> to enable Goal for this session.");
          return true;
        }
        persistGoalConfig(buildSessionGoalConfig(true, nextPrompt));
        messageApi.success("Goal enabled for this session.");
        clearGoalCommandInput();
        return true;
      }

      persistGoalConfig(buildSessionGoalConfig(true, commandArg));
      messageApi.success("Goal enabled for this session.");
      clearGoalCommandInput();
      return true;
    },
    [
      buildSessionGoalConfig,
      clearGoalCommandInput,
      currentChat,
      goalPrompt,
      isGoalEnabled,
      messageApi,
      persistGoalConfig,
      recordEntry,
      sessionId,
    ],
  );

  // Suppress TS6133 — retained for future local UI feedback integration.
  void _handleGoalCommand;

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

  useEffect(() => {
    void (async () => {
      const cached = await readModelOptionsCache(resolvedProviderType);
      setModelOptions(cached ?? []);
      setModelOptionsError(null);
    })();
  }, [resolvedProviderType]);

  const getErrorMessage = useCallback(
    (error: unknown) => {
      if (error instanceof Error && error.message.trim()) return error.message;
      return t("chat.view.unknownError");
    },
    [t],
  );

  const fallbackModelOptions = useMemo(() => {
    const byProvider: Record<ProviderType, ModelOption[]> = {
      openai: [...OPENAI_MODELS],
      anthropic: [...ANTHROPIC_MODELS],
      gemini: [...GEMINI_MODELS],
      copilot: [...COPILOT_MODELS],
      bodhi: [],
    };
    return byProvider[resolvedProviderType] || [];
  }, [resolvedProviderType]);

  const resolvedModelOptions = useMemo(() => {
    const base = modelOptions.length > 0 ? modelOptions : fallbackModelOptions;
    const normalized = [...base];
    if (activeModel && !normalized.some((item) => item.value === activeModel)) {
      normalized.unshift({ value: activeModel, label: activeModel });
    }
    return normalized;
  }, [modelOptions, fallbackModelOptions, activeModel]);

  const fetchProviderModels = useCallback(
    async (providerId: string, providerType: ProviderType, options?: { force?: boolean }) => {
      if (!options?.force && modelOptions.length > 0) return;
      try {
        setIsModelOptionsLoading(true);
        setModelOptionsError(null);

        const models =
          providerType === "copilot"
            ? await modelService.getModels(providerId)
            : fallbackModelOptions;
        const options = models.map((model: string | { value: string; label: string }) => ({
          value: typeof model === "string" ? model : model.value,
          label: typeof model === "string" ? model : model.label,
        }));
        setModelOptions(options);
        await writeModelOptionsCache(providerType, options);
      } catch (error) {
        setModelOptionsError(getErrorMessage(error));
      } finally {
        setIsModelOptionsLoading(false);
      }
    },
    [fallbackModelOptions, getErrorMessage, modelOptions.length],
  );

  const handleModelDropdownVisibleChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      if (redirectToProviderSettingsIfNeeded()) return;
      if (isModelOptionsLoading) return;
      if (modelOptions.length > 0) return;
      void fetchProviderModels(currentProvider, resolvedProviderType);
    },
    [
      currentProvider,
      resolvedProviderType,
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
        updateSession(sessionId, {
          config: {
            ...currentChat.config,
            model: value,
          },
        });
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

        // 2. Update local state only after backend confirms.
        useProviderStore.getState().setSelectedModelRef(ref);
        updateSession(sessionId, {
          config: {
            ...currentChat.config,
            model: ref.model,
            model_ref: ref,
          },
        });

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

  const leftControlsExtra = useMemo(
    () => (
      <Space size={0} wrap>
        {modelControl}
        {reasoningControl}
      </Space>
    ),
    [modelControl, reasoningControl],
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
