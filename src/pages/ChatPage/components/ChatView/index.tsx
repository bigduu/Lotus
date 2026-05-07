import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App as AntApp,
  Button,
  Grid,
  Layout,
  theme,
  Flex,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CheckSquareOutlined,
  CloseOutlined,
  DownloadOutlined,
  InboxOutlined,
} from "@ant-design/icons";

import { selectChildren, selectIsBusy, selectSessionById, useAppStore } from "../../store";
import { isAssistantToolResultMessage, type Message } from "../../types/chat";
import { ChatInputArea } from "./ChatInputArea";
import { ChatMessagesList } from "./ChatMessagesList";
import { TokenUsageDisplay } from "../TokenUsageDisplay";
import { useExperienceModeStore } from "@shared/store/experienceModeStore";
import "./styles.css";
import { useChatViewScroll } from "./useChatViewScroll";
import type { WorkflowDraft } from "../InputContainer";
import { useChatViewMessages, type RenderableEntry } from "./useChatViewMessages";
import type { SessionDiffSummary } from "./ActiveToolMessageCard";
import { getFileChangeDiffStats, parseFileChangeResultPayload } from "../../utils/resultFormatters";
import { getMessageText } from "../MessageCard/messageCardParsing";
import { MessageExportService } from "../../services/MessageExportService";
import { CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT } from "./events";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import { useTranslation } from "react-i18next";
import type { DeleteMessageResult } from "../../store/slices/chatSessionSlice";
import { useIsMobile } from "@shared/hooks/useMediaQuery";

// ── Lazy-loaded auxiliary panels ─────────────────────────────────────────
// These components are not needed for the very first paint.  Lazy-loading
// them avoids parsing & evaluating their (often heavy) dependency trees
// during the critical startup path.  They mount after an idle gate resolves.
const LazyContextBar = React.lazy(() =>
  import("../ContextBar").then((m) => ({ default: m.ContextBar })),
);
const LazySessionSummaryCard = React.lazy(() =>
  import("../SessionSummaryCard").then((m) => ({ default: m.SessionSummaryCard })),
);
const LazyTodoList = React.lazy(() =>
  import("@components/TodoList").then((m) => ({ default: m.TodoList })),
);
const LazySubAgentsPanel = React.lazy(() =>
  import("./SubAgentsPanel").then((m) => ({ default: m.SubAgentsPanel })),
);
const LazyQuestionDialog = React.lazy(() =>
  import("@components/QuestionDialog").then((m) => ({ default: m.QuestionDialog })),
);

const { useToken } = theme;
const { useBreakpoint } = Grid;
const { Text } = Typography;

const getMessageRoleLabel = (message: Message): string => {
  if (message.role === "user") return "You";
  if (message.role === "assistant") return "Assistant";
  if (message.role === "system") return "System";
  return "Message";
};

const getMessageTimeLabel = (createdAt: string): string => {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return createdAt;
  }
  return parsed.toLocaleString();
};

const buildBatchExportMarkdown = (
  selectedMessages: Array<{ message: Message; text: string }>,
): string => {
  return selectedMessages
    .map(({ message, text }, index) => {
      const roleLabel = getMessageRoleLabel(message);
      const timeLabel = getMessageTimeLabel(message.createdAt);
      return [`## ${index + 1}. ${roleLabel} · ${timeLabel}`, "", text].join("\n");
    })
    .join("\n\n---\n\n");
};

export type ChatViewProps = {
  /**
   * If omitted, falls back to the globally selected chat.
   * Multi-pane mode should always pass an explicit sessionId.
   */
  sessionId?: string | null;
  /**
   * When embedded in split panes, use full width and tighter spacing.
   */
  embedded?: boolean;
};

export const ChatView: React.FC<ChatViewProps> = ({
  sessionId: sessionIdProp,
  embedded = false,
}) => {
  const { message: appMessage } = AntApp.useApp();
  const { t } = useTranslation();
  const isAdvancedMode = useExperienceModeStore((state) => state.isAdvanced);
  const sessionId = useAppStore((state) => sessionIdProp ?? state.currentSessionId);
  const currentChat = useAppStore(selectSessionById(sessionId));
  const deleteMessage = useAppStore((state) => state.deleteMessage);
  const loadChatHistory = useAppStore((state) => state.loadChatHistory);
  const loadTaskList = useAppStore((state) => state.loadTaskList);
  const storeTokenUsage = useAppStore((state) =>
    sessionId ? (state.tokenUsages[sessionId] ?? null) : null,
  );
  const storeTruncation = useAppStore((state) =>
    sessionId ? (state.truncationOccurred[sessionId] ?? false) : false,
  );
  const storeSegments = useAppStore((state) =>
    sessionId ? (state.segmentsRemoved[sessionId] ?? 0) : 0,
  );
  const currentMessages = useMemo(() => currentChat?.messages || [], [currentChat]);
  const sharedTaskSessionId = useMemo(() => {
    if (!sessionId || !currentChat) return sessionId;
    if (currentChat.kind === "child") {
      return currentChat.parentSessionId || currentChat.rootSessionId || sessionId;
    }
    return sessionId;
  }, [currentChat, sessionId]);
  const hasTaskList = useAppStore((state) =>
    sharedTaskSessionId ? Boolean(state.taskLists[sharedTaskSessionId]) : false,
  );
  // selectIsBusy = any active execution (including waiting states)
  const isBusy = useAppStore(selectIsBusy(sessionId));
  const shouldShowTaskPanel = useMemo(() => {
    if (!sessionId || !currentChat) return false;
    if (hasTaskList) return true;
    if (currentChat.kind === "child") return true;
    if (isBusy) return true;
    return false;
  }, [currentChat, hasTaskList, sessionId, isBusy]);
  const hasSubAgents = useAppStore((state) => {
    if (!sessionId) return false;
    const children = selectChildren(sessionId)(state);
    if (Object.keys(children).length > 0) return true;
    return state.chats.some((c) => c.kind === "child" && c.parentSessionId === sessionId);
  });

  // Lazy-load history when switching sessions (backend is source of truth).
  useEffect(() => {
    if (!sessionId) return;
    const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
    if (chat && Array.isArray(chat.messages) && chat.messages.length > 0) {
      return;
    }
    void loadChatHistory(sessionId);
  }, [sessionId, loadChatHistory]);

  // Sync missing messages from backend summary counts (e.g. from other clients)
  const currentMessageCount = currentChat?.messageCount ?? 0;
  const currentMessagesLength = currentChat?.messages?.length ?? 0;

  useEffect(() => {
    if (!sessionId) return;

    // effectiveMessageCount is maintained monotonically by chatSessionSlice
    const messageCountDiff = currentMessageCount - currentMessagesLength;
    if (messageCountDiff > 0) {
      void loadChatHistory(sessionId, { mode: "monotonic" });
    }
  }, [sessionId, currentMessageCount, currentMessagesLength, loadChatHistory]);

  useEffect(() => {
    if (!sharedTaskSessionId || hasTaskList) return;
    if (!shouldShowTaskPanel) return;
    void loadTaskList(sharedTaskSessionId).catch((error) => {
      console.warn(`[ChatView] Failed to load task list for ${sharedTaskSessionId}:`, error);
    });
  }, [sharedTaskSessionId, hasTaskList, shouldShowTaskPanel, loadTaskList]);

  const isProcessing = isBusy;

  const sessionDiffSummary = useMemo<SessionDiffSummary | null>(() => {
    if (!currentMessages || currentMessages.length === 0) {
      return null;
    }

    const files = new Map<
      string,
      {
        added: number;
        removed: number;
        diffChunks: string[];
        truncated: boolean;
      }
    >();
    let totalAdded = 0;
    let totalRemoved = 0;
    let changedTools = 0;

    for (const msg of currentMessages) {
      if (!isAssistantToolResultMessage(msg)) continue;

      const content = msg.result?.result ?? "";
      const payload = parseFileChangeResultPayload(content);
      const diffStats = getFileChangeDiffStats(content);
      if (!payload || !diffStats) continue;

      changedTools += 1;
      totalAdded += diffStats.added;
      totalRemoved += diffStats.removed;

      const existing = files.get(payload.file_path);
      if (existing) {
        existing.added += diffStats.added;
        existing.removed += diffStats.removed;
        existing.diffChunks.push(payload.diff.unified);
        existing.truncated = existing.truncated || Boolean(payload.diff.truncated);
      } else {
        files.set(payload.file_path, {
          added: diffStats.added,
          removed: diffStats.removed,
          diffChunks: [payload.diff.unified],
          truncated: Boolean(payload.diff.truncated),
        });
      }
    }

    if (files.size === 0) {
      return null;
    }

    const fileSummaries = Array.from(files.entries())
      .map(([filePath, stats]) => ({
        filePath,
        added: stats.added,
        removed: stats.removed,
        unifiedDiff: stats.diffChunks.join("\n\n"),
        truncated: stats.truncated,
      }))
      .sort((a, b) => a.filePath.localeCompare(b.filePath));

    return {
      totalAdded,
      totalRemoved,
      files: fileSummaries,
      changedTools,
    };
  }, [currentMessages]);

  const isThinking = isProcessing;

  const formatDeleteFailureMessage = useCallback(
    (result: DeleteMessageResult) => {
      if (result.success) return null;
      switch (result.reason) {
        case "session_not_found":
        case "message_not_found":
        case "backend_not_found":
          return t("chat.messageActions.deleteNotFound");
        case "session_running":
          return t("chat.messageActions.deleteConflict");
        default:
          return result.errorMessage || t("chat.messageActions.deleteFailed");
      }
    },
    [t],
  );

  const handleDeleteMessage = useCallback(
    async (messageId: string, options?: { notify?: boolean }) => {
      if (!sessionId) {
        const result: DeleteMessageResult = {
          success: false,
          sessionId: "",
          messageId,
          reason: "session_not_found",
        };
        if (options?.notify !== false) {
          appMessage.error(formatDeleteFailureMessage(result));
        }
        return result;
      }

      const result = await deleteMessage(sessionId, messageId);
      if (!result.success && options?.notify !== false) {
        appMessage.error(formatDeleteFailureMessage(result));
      }
      return result;
    },
    [sessionId, deleteMessage, appMessage, formatDeleteFailureMessage],
  );

  const handleDeleteToolMessages = useCallback(
    async (messageIds: string[]) => {
      const uniqueMessageIds = Array.from(
        new Set(messageIds.map((id) => id.trim()).filter(Boolean)),
      );
      if (uniqueMessageIds.length === 0) return;

      const results = await Promise.all(
        uniqueMessageIds.map((id) =>
          handleDeleteMessage(id, {
            notify: false,
          }),
        ),
      );
      const failed = results.filter(
        (result): result is Exclude<typeof result, { success: true }> => !result.success,
      );
      if (failed.length === 0) return;

      if (failed.length === 1) {
        appMessage.error(formatDeleteFailureMessage(failed[0]));
        return;
      }

      appMessage.error(
        t("chat.messageActions.deleteBatchFailed", {
          failed: failed.length,
          total: uniqueMessageIds.length,
        }),
      );
    },
    [handleDeleteMessage, appMessage, formatDeleteFailureMessage, t],
  );

  const messagesListRef = useRef<HTMLDivElement>(null);
  const { token } = useToken();
  const screens = useBreakpoint();
  const isMobile = useIsMobile();
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowDraft | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const sidebarCollapsed = useUILayoutStore((s) => s.sidebar.collapsed);

  // ── Deferred auxiliary mount gate ─────────────────────────────────────
  // Auxiliary panels (ContextBar, TodoList, SubAgentsPanel, QuestionDialog,
  // SessionSummaryCard) are not required for the very first paint.
  // We defer their mount until the browser is idle (or a short timeout).
  const [auxReady, setAuxReady] = useState(false);

  useEffect(() => {
    if (typeof requestIdleCallback === "function") {
      const handle = requestIdleCallback(() => setAuxReady(true));
      return () => cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(() => setAuxReady(true), 300);
    return () => window.clearTimeout(timer);
  }, []);

  const getContainerMaxWidth = () => {
    if (embedded) return "100%";
    if (screens.xs) return "100%";
    if (screens.sm) return "100%";
    if (screens.md) return "90%";
    if (screens.lg) return "85%";
    return "1024px";
  };

  const getContainerPadding = () => {
    let basePadding: number;
    if (embedded) {
      basePadding = token.paddingSM;
    } else if (screens.xs) {
      basePadding = token.paddingXS;
    } else if (screens.sm) {
      basePadding = token.paddingSM;
    } else {
      basePadding = token.padding;
    }

    if (!embedded && sidebarCollapsed && !isMobile) {
      return basePadding + 18;
    }
    return basePadding;
  };

  useEffect(() => {
    setWorkflowDraft(null);
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
  }, [sessionId]);

  const { systemPromptMessage, renderableMessages, convertRenderableEntry } = useChatViewMessages(
    currentChat,
    currentMessages,
  );

  const hasMessages = currentMessages.length > 0;
  const hasWorkflowDraft = Boolean(workflowDraft?.content);
  const hasSystemPrompt = Boolean(systemPromptMessage);
  const showMessagesView = Boolean(sessionId) && (hasMessages || hasWorkflowDraft);

  // In split-pane mode, the PaneShell shows floating split/close buttons at the top-right.
  // Reserve some horizontal space so token usage (also top-right) isn't covered on hover.
  // On mobile widths this extra right padding causes cramped toolbars, so disable it.
  const paneActionOverlayRightPadding = embedded && !screens.xs ? 190 : 0;

  const renderableMessagesWithDraft = useMemo<RenderableEntry[]>(() => {
    if (!workflowDraft?.content) {
      return renderableMessages;
    }

    const draftEntry: RenderableEntry = {
      message: {
        id: workflowDraft.id,
        role: "user",
        content: workflowDraft.content,
        createdAt: workflowDraft.createdAt,
      } as Message,
      messageType: "text" as const,
    };

    return [...renderableMessages, draftEntry];
  }, [renderableMessages, workflowDraft]);

  const selectableMessages = useMemo<Array<{ id: string; message: Message; text: string }>>(() => {
    const result: Array<{ id: string; message: Message; text: string }> = [];
    for (const entry of renderableMessagesWithDraft) {
      if (!("message" in entry)) {
        continue;
      }

      const text = getMessageText(entry.message).trim();
      if (!text) {
        continue;
      }

      result.push({
        id: entry.message.id,
        message: entry.message,
        text,
      });
    }
    return result;
  }, [renderableMessagesWithDraft]);

  const selectableMessageIds = useMemo(
    () => new Set(selectableMessages.map((item) => item.id)),
    [selectableMessages],
  );

  useEffect(() => {
    setSelectedMessageIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (selectableMessageIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectableMessageIds]);

  const selectedMessages = useMemo(
    () => selectableMessages.filter((item) => selectedMessageIds.has(item.id)),
    [selectableMessages, selectedMessageIds],
  );

  const hasSelectableMessages = selectableMessages.length > 0;

  const handleToggleMessageSelection = useCallback((messageId: string) => {
    setSelectedMessageIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  }, []);

  const handleEnterSelectionMode = useCallback(() => {
    if (!hasSelectableMessages) {
      appMessage.warning("No exportable messages");
      return;
    }
    setSelectionMode(true);
  }, [appMessage, hasSelectableMessages]);

  const handleExitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
  }, []);

  const handleToggleSelectionMode = useCallback(() => {
    if (selectionMode) {
      handleExitSelectionMode();
      return;
    }
    handleEnterSelectionMode();
  }, [handleEnterSelectionMode, handleExitSelectionMode, selectionMode]);

  const handleSelectAllMessages = useCallback(() => {
    setSelectedMessageIds(new Set(selectableMessages.map((item) => item.id)));
  }, [selectableMessages]);

  const handleClearSelectedMessages = useCallback(() => {
    setSelectedMessageIds(new Set());
  }, []);

  const handleExportSelectedMessages = useCallback(
    async (format: "markdown" | "pdf") => {
      if (!sessionId) {
        appMessage.warning("No active chat");
        return;
      }

      if (selectedMessages.length === 0) {
        appMessage.warning("Please select at least one message");
        return;
      }

      const content = buildBatchExportMarkdown(selectedMessages);
      const result = await MessageExportService.exportMessageText({
        format,
        content,
        sessionId,
        filenamePrefix: `chat-messages-${selectedMessages.length}`,
      });

      if (result.success) {
        appMessage.success(`Saved: ${result.filename}`);
        return;
      }

      if (result.error?.toLowerCase().includes("cancel")) {
        return;
      }
      appMessage.error(result.error || "Export failed");
    },
    [appMessage, sessionId, selectedMessages],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onToggleSelectionMode = (event: Event) => {
      const customEvent = event as CustomEvent<{ sessionId?: string | null }>;
      const targetSessionId = customEvent.detail?.sessionId ?? null;
      if (!sessionId || targetSessionId !== sessionId) {
        return;
      }
      handleToggleSelectionMode();
    };

    window.addEventListener(
      CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT,
      onToggleSelectionMode as EventListener,
    );
    return () => {
      window.removeEventListener(
        CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT,
        onToggleSelectionMode as EventListener,
      );
    };
  }, [sessionId, handleToggleSelectionMode]);

  // Get token usage - prefer store (real-time), fallback to chat config (persisted)
  const configTokenUsage = currentChat?.config?.tokenUsage;
  const currentTokenUsage = storeTokenUsage || configTokenUsage || null;

  const configTruncation = currentChat?.config?.truncationOccurred;
  const currentTruncationOccurred = storeTruncation || configTruncation || false;

  const configSegments = currentChat?.config?.segmentsRemoved;
  const currentSegmentsRemoved = storeSegments || configSegments || 0;
  const latestCompressionEvent = useMemo(() => {
    const events = currentChat?.config?.compressionEvents;
    if (!events || events.length === 0) return null;

    return events.reduce((latest, event) => {
      const latestTs = Date.parse(latest.createdAt);
      const eventTs = Date.parse(event.createdAt);
      if (!Number.isFinite(latestTs)) return event;
      if (!Number.isFinite(eventTs)) return latest;
      return eventTs > latestTs ? event : latest;
    });
  }, [currentChat?.config?.compressionEvents]);

  const rowGap = token.marginMD;

  const {
    handleMessagesScroll,
    hasUnreadActivity,
    resetUserScroll,
    scrollToBottom,
    scrollToTop,
    showScrollToBottom,
    showScrollToTop,
    unreadCount,
  } = useChatViewScroll({
    currentSessionId: sessionId,
    isThinking,
    messagesListRef,
    renderableMessages: renderableMessagesWithDraft,
  });

  const shouldShowSelectionToolbar =
    Boolean(showMessagesView) && hasSelectableMessages && (!embedded || selectionMode);
  const compressionIndicator = latestCompressionEvent ? (
    <Tooltip
      title={t("chat.compression.tooltip", {
        count: latestCompressionEvent.messagesCompressed,
        time: getMessageTimeLabel(latestCompressionEvent.createdAt),
        defaultValue: "Latest compression at {{time}}: {{count}} messages archived",
      })}
    >
      <Tag
        color="gold"
        icon={<InboxOutlined />}
        style={{ marginInlineEnd: 0, whiteSpace: "nowrap" }}
      >
        {t("chat.compression.archivedShort", {
          count: latestCompressionEvent.messagesCompressed,
          defaultValue: "{{count}} archived",
        })}
      </Tag>
    </Tooltip>
  ) : null;
  const tokenUsageIndicator =
    currentTokenUsage && currentTokenUsage.budgetLimit > 0 ? (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: token.marginXS,
        }}
      >
        <TokenUsageDisplay usage={currentTokenUsage} showDetails={true} size="small" />
        {currentTruncationOccurred && (
          <span
            style={{
              fontSize: 11,
              color: token.colorTextSecondary,
              whiteSpace: "nowrap",
            }}
          >
            ({currentSegmentsRemoved} truncated)
          </span>
        )}
        {compressionIndicator}
      </div>
    ) : compressionIndicator ? (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: token.marginXS,
        }}
      >
        {compressionIndicator}
      </div>
    ) : null;

  return (
    <Layout
      role="region"
      aria-label={t("chat.view.chatRegion", "Chat conversation")}
      style={{
        flex: 1,
        minHeight: 0,
        height: "100%",
        background: token.colorBgContainer,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Flex
        vertical
        style={{
          flex: 1,
          minHeight: 0,
          height: "100%",
        }}
      >
        {/* ContextBar - persistent context overview */}
        {sessionId && auxReady && (
          <React.Suspense fallback={null}>
            <LazyContextBar sessionId={sessionId} />
          </React.Suspense>
        )}

        {/* SessionSummaryCard - collapsible session overview (advanced mode only) */}
        {isAdvancedMode && sessionId && showMessagesView && auxReady && (
          <div
            style={{
              paddingTop: token.paddingXS,
              paddingRight: getContainerPadding(),
              paddingBottom: 0,
              paddingLeft: getContainerPadding(),
              maxWidth: getContainerMaxWidth(),
              margin: "0 auto",
              width: "100%",
            }}
          >
            <React.Suspense fallback={null}>
              <LazySessionSummaryCard sessionId={sessionId} />
            </React.Suspense>
          </div>
        )}

        {/* TaskList - show when there is an active or task-capable session */}
        {sessionId && shouldShowTaskPanel && auxReady && (
          <div
            style={{
              paddingTop: getContainerPadding(),
              paddingRight: getContainerPadding(),
              paddingBottom: 0,
              paddingLeft: getContainerPadding(),
              maxWidth: getContainerMaxWidth(),
              margin: "0 auto",
              width: "100%",
            }}
          >
            <React.Suspense fallback={null}>
              <LazyTodoList sessionId={sessionId} initialCollapsed={true} />
            </React.Suspense>
          </div>
        )}

        {sessionId && hasSubAgents && auxReady && (
          <div
            style={{
              paddingTop: token.paddingXS,
              paddingRight: getContainerPadding(),
              paddingBottom: 0,
              paddingLeft: getContainerPadding(),
              maxWidth: getContainerMaxWidth(),
              margin: "0 auto",
              width: "100%",
            }}
          >
            <React.Suspense fallback={null}>
              <LazySubAgentsPanel parentSessionId={sessionId} />
            </React.Suspense>
          </div>
        )}

        {shouldShowSelectionToolbar && (
          <div
            style={{
              paddingTop: token.paddingXS,
              paddingRight: getContainerPadding() + paneActionOverlayRightPadding,
              paddingBottom: 0,
              paddingLeft: getContainerPadding(),
              maxWidth: getContainerMaxWidth(),
              margin: "0 auto",
              width: "100%",
            }}
          >
            {!selectionMode ? (
              <Flex justify="flex-end">
                <Tooltip title={t("chat.selectionToolbar.selectMessages")}>
                  <Button
                    aria-label={t("chat.selectionToolbar.selectMessages")}
                    icon={<CheckSquareOutlined />}
                    size="small"
                    onClick={handleToggleSelectionMode}
                  />
                </Tooltip>
              </Flex>
            ) : (
              <Flex align="center" justify="space-between" wrap="wrap" gap={token.marginXS}>
                <Text type="secondary">
                  {t("chat.selectionToolbar.selectedCount", {
                    selected: selectedMessages.length,
                    total: selectableMessages.length,
                  })}
                </Text>
                <Space size={token.marginXS} wrap>
                  <Button size="small" onClick={handleSelectAllMessages}>
                    {t("chat.selectionToolbar.selectAll")}
                  </Button>
                  <Button size="small" onClick={handleClearSelectedMessages}>
                    {t("chat.selectionToolbar.clear")}
                  </Button>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => {
                      void handleExportSelectedMessages("markdown");
                    }}
                    disabled={selectedMessages.length === 0}
                  >
                    {t("chat.selectionToolbar.exportMarkdown")}
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    icon={<DownloadOutlined />}
                    onClick={() => {
                      void handleExportSelectedMessages("pdf");
                    }}
                    disabled={selectedMessages.length === 0}
                  >
                    {t("chat.selectionToolbar.exportPdf")}
                  </Button>
                  <Button size="small" icon={<CloseOutlined />} onClick={handleToggleSelectionMode}>
                    {t("chat.selectionToolbar.done")}
                  </Button>
                </Space>
              </Flex>
            )}
          </div>
        )}

        <ChatMessagesList
          currentChat={currentChat}
          currentSessionId={sessionId}
          convertRenderableEntry={convertRenderableEntry}
          handleDeleteMessage={handleDeleteMessage}
          handleDeleteToolMessages={handleDeleteToolMessages}
          handleMessagesScroll={handleMessagesScroll}
          hasSystemPrompt={hasSystemPrompt}
          messagesListRef={messagesListRef}
          renderableMessages={renderableMessagesWithDraft}
          rowGap={rowGap}
          showMessagesView={Boolean(showMessagesView)}
          screens={screens}
          workflowDraftId={workflowDraft?.id}
          isThinking={isThinking}
          padding={getContainerPadding()}
          selectionMode={selectionMode}
          selectedMessageIds={selectedMessageIds}
          selectableMessageIds={selectableMessageIds}
          onToggleMessageSelection={handleToggleMessageSelection}
        />
        <div className="chat-bottom-stack" data-testid="chat-bottom-stack">
          {(showScrollToTop || showScrollToBottom) && showMessagesView && (
            <div className="chat-scroll-capsule-wrapper" data-testid="chat-scroll-capsule-wrapper">
              <div className="chat-scroll-capsule" data-testid="chat-scroll-capsule">
                {showScrollToTop && (
                  <Button
                    data-testid="chat-scroll-top-button"
                    className="chat-scroll-capsule__button"
                    type="text"
                    icon={<span aria-hidden="true">↑</span>}
                    size="small"
                    onClick={scrollToTop}
                  >
                    {t("chat.scroll.jumpToTop", "Jump to top")}
                  </Button>
                )}
                {showScrollToBottom && (
                  <span style={{ display: "inline-flex" }}>
                    <span style={{ display: "inline-flex" }}>
                      <Button
                        data-testid="chat-scroll-bottom-button"
                        className={`chat-scroll-capsule__button ${
                          hasUnreadActivity ? "chat-scroll-capsule__button--active" : ""
                        }`}
                        type={hasUnreadActivity ? "primary" : "text"}
                        icon={<span aria-hidden="true">↓</span>}
                        size="small"
                        onClick={() => {
                          resetUserScroll();
                          scrollToBottom();
                        }}
                      >
                        {hasUnreadActivity
                          ? t("chat.scroll.newMessagesWithCount", {
                              count: unreadCount,
                              defaultValue:
                                unreadCount > 0 ? "{{count}} new messages" : "New messages",
                            })
                          : t("chat.scroll.backToLatest", "Back to latest")}
                      </Button>
                    </span>
                    {hasUnreadActivity && unreadCount > 0 && (
                      <span
                        className="chat-scroll-capsule__count"
                        data-testid="chat-scroll-unread-count"
                      >
                        {unreadCount}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
          )}

          {sessionId && auxReady && (
            <div
              style={{
                paddingTop: token.paddingXS,
                paddingRight: getContainerPadding(),
                paddingBottom: 0,
                paddingLeft: getContainerPadding(),
                maxWidth: getContainerMaxWidth(),
                margin: "0 auto",
                width: "100%",
              }}
            >
              <React.Suspense fallback={null}>
                <LazyQuestionDialog sessionId={sessionId} />
              </React.Suspense>
            </div>
          )}

          <ChatInputArea
            sessionId={sessionId}
            isCenteredLayout={!showMessagesView}
            maxWidth={showMessagesView ? getContainerMaxWidth() : "100%"}
            onWorkflowDraftChange={setWorkflowDraft}
            showMessagesView={Boolean(showMessagesView)}
            sessionDiffSummary={sessionDiffSummary}
            contextUsageIndicator={tokenUsageIndicator}
          />
        </div>
      </Flex>
    </Layout>
  );
};
