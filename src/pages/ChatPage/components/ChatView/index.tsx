import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  App as AntApp,
  Button,
  FloatButton,
  Grid,
  Layout,
  theme,
  Flex,
  Space,
  Tooltip,
  Typography,
} from "antd";
import {
  CheckSquareOutlined,
  CloseOutlined,
  DownOutlined,
  DownloadOutlined,
  UpOutlined,
} from "@ant-design/icons";

import { selectSessionById, useAppStore } from "../../store";
import { isAssistantToolResultMessage, type Message } from "../../types/chat";
import { ChatInputArea } from "./ChatInputArea";
import { ChatMessagesList } from "./ChatMessagesList";
import { TodoList } from "@components/TodoList";
import { QuestionDialog } from "@components/QuestionDialog";
import { TokenUsageDisplay } from "../TokenUsageDisplay";
import { SubSessionsPanel } from "./SubSessionsPanel";
import "./styles.css";
import { useChatViewScroll } from "./useChatViewScroll";
import type { WorkflowDraft } from "../InputContainer";
import {
  useChatViewMessages,
  type RenderableEntry,
} from "./useChatViewMessages";
import type { SessionDiffSummary } from "./ActiveToolMessageCard";
import {
  getFileChangeDiffStats,
  parseFileChangeResultPayload,
} from "../../utils/resultFormatters";
import { getMessageText } from "../MessageCard/messageCardParsing";
import { MessageExportService } from "../../services/MessageExportService";
import {
  CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT,
} from "./events";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";

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
      return [`## ${index + 1}. ${roleLabel} · ${timeLabel}`, "", text].join(
        "\n",
      );
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
  const sessionId = useAppStore(
    (state) => sessionIdProp ?? state.currentSessionId,
  );
  const currentChat = useAppStore(selectSessionById(sessionId));
  const deleteMessage = useAppStore((state) => state.deleteMessage);
  const loadChatHistory = useAppStore((state) => state.loadChatHistory);
  const processingChats = useAppStore((state) => state.processingChats);
  const tokenUsages = useAppStore((state) => state.tokenUsages);
  const truncationOccurred = useAppStore((state) => state.truncationOccurred);
  const segmentsRemoved = useAppStore((state) => state.segmentsRemoved);
  const currentMessages = useMemo(
    () => currentChat?.messages || [],
    [currentChat],
  );
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
  const hasSubSessions = useAppStore((state) => {
    if (!sessionId) return false;
    const progressMap = state.subSessionsByParent[sessionId];
    if (progressMap && Object.keys(progressMap).length > 0) return true;
    return state.chats.some(
      (c) => c.kind === "child" && c.parentSessionId === sessionId,
    );
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

  const isProcessing = sessionId ? processingChats.has(sessionId) : false;

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
        existing.truncated =
          existing.truncated || Boolean(payload.diff.truncated);
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

  const interactionState = useMemo(() => {
    const value: "IDLE" | "THINKING" | "AWAITING_APPROVAL" = isProcessing
      ? "THINKING"
      : "IDLE";
    return {
      value,
      context: {
        streamingContent: null,
        toolCallRequest: null,
        parsedParameters: null,
      },
      matches: (stateName: "IDLE" | "THINKING" | "AWAITING_APPROVAL") =>
        stateName === value,
    };
  }, [isProcessing]);

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (sessionId) {
        deleteMessage(sessionId, messageId);
      }
    },
    [sessionId, deleteMessage],
  );

  const messagesListRef = useRef<HTMLDivElement>(null);
  const { token } = useToken();
  const screens = useBreakpoint();
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowDraft | null>(
    null,
  );
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(
    new Set(),
  );
  const sidebarCollapsed = useUILayoutStore((s) => s.sidebar.collapsed);

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

    if (!embedded && sidebarCollapsed) {
      return basePadding + 18;
    }
    return basePadding;
  };

  useEffect(() => {
    setWorkflowDraft(null);
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
  }, [sessionId]);

  const { systemPromptMessage, renderableMessages, convertRenderableEntry } =
    useChatViewMessages(currentChat, currentMessages);

  const hasMessages = currentMessages.length > 0;
  const hasWorkflowDraft = Boolean(workflowDraft?.content);
  const hasSystemPrompt = Boolean(systemPromptMessage);
  const showMessagesView =
    sessionId && (hasMessages || hasSystemPrompt || hasWorkflowDraft);

  // In split-pane mode, the PaneShell shows floating split/close buttons at the top-right.
  // Reserve some horizontal space so token usage (also top-right) isn't covered on hover.
  const paneActionOverlayRightPadding = embedded ? 190 : 0;

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

  const selectableMessages = useMemo<
    Array<{ id: string; message: Message; text: string }>
  >(() => {
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

  // In v2, frontend chat id === backend session id.
  const agentSessionId = currentChat?.id;

  // Get token usage - prefer store (real-time), fallback to chat config (persisted)
  const storeTokenUsage = sessionId ? tokenUsages[sessionId] : null;
  const configTokenUsage = currentChat?.config?.tokenUsage;
  const currentTokenUsage = storeTokenUsage || configTokenUsage || null;

  const storeTruncation = sessionId ? truncationOccurred[sessionId] : false;
  const configTruncation = currentChat?.config?.truncationOccurred;
  const currentTruncationOccurred =
    storeTruncation || configTruncation || false;

  const storeSegments = sessionId ? segmentsRemoved[sessionId] : 0;
  const configSegments = currentChat?.config?.segmentsRemoved;
  const currentSegmentsRemoved = storeSegments || configSegments || 0;

  const rowGap = token.marginMD;

  const {
    handleMessagesScroll,
    resetUserScroll,
    scrollToBottom,
    scrollToTop,
    showScrollToBottom,
    showScrollToTop,
  } = useChatViewScroll({
    currentSessionId: sessionId,
    interactionState,
    messagesListRef,
    renderableMessages: renderableMessagesWithDraft,
  });

  const handleQuestionAppeared = useCallback(() => {
    resetUserScroll();
    scrollToBottom();
  }, [resetUserScroll, scrollToBottom]);

  const getScrollButtonPosition = () => {
    return screens.xs ? 16 : 32;
  };

  const shouldShowSelectionToolbar =
    Boolean(showMessagesView) &&
    hasSelectableMessages &&
    (!embedded || selectionMode);
  const tokenUsageIndicator =
    currentTokenUsage && currentTokenUsage.budgetLimit > 0 ? (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: token.marginXS,
        }}
      >
        <TokenUsageDisplay
          usage={currentTokenUsage}
          showDetails={true}
          size="small"
        />
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
      </div>
    ) : null;

  return (
    <Layout
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
        {/* TaskList - show when there is an active agent session */}
        {agentSessionId && hasTaskList && (
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
            <TodoList sessionId={agentSessionId} initialCollapsed={true} />
          </div>
        )}

        {sessionId && hasSubSessions && (
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
            <SubSessionsPanel parentSessionId={sessionId} />
          </div>
        )}

        {shouldShowSelectionToolbar && (
          <div
            style={{
              paddingTop: token.paddingXS,
              paddingRight:
                getContainerPadding() + paneActionOverlayRightPadding,
              paddingBottom: 0,
              paddingLeft: getContainerPadding(),
              maxWidth: getContainerMaxWidth(),
              margin: "0 auto",
              width: "100%",
            }}
          >
            {!selectionMode ? (
              <Flex justify="flex-end">
                <Tooltip title="Select messages to export">
                  <Button
                    aria-label="Select messages to export"
                    icon={<CheckSquareOutlined />}
                    size="small"
                    onClick={handleToggleSelectionMode}
                  />
                </Tooltip>
              </Flex>
            ) : (
              <Flex
                align="center"
                justify="space-between"
                wrap="wrap"
                gap={token.marginXS}
              >
                <Text type="secondary">
                  Selected {selectedMessages.length} /{" "}
                  {selectableMessages.length}
                </Text>
                <Space size={token.marginXS} wrap>
                  <Button size="small" onClick={handleSelectAllMessages}>
                    Select all
                  </Button>
                  <Button size="small" onClick={handleClearSelectedMessages}>
                    Clear
                  </Button>
                  <Button
                    size="small"
                    icon={<DownloadOutlined />}
                    onClick={() => {
                      void handleExportSelectedMessages("markdown");
                    }}
                    disabled={selectedMessages.length === 0}
                  >
                    Export MD
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
                    Export PDF
                  </Button>
                  <Button
                    size="small"
                    icon={<CloseOutlined />}
                    onClick={handleToggleSelectionMode}
                  >
                    Done
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
          handleMessagesScroll={handleMessagesScroll}
          hasSystemPrompt={hasSystemPrompt}
          messagesListRef={messagesListRef}
          renderableMessages={renderableMessagesWithDraft}
          rowGap={rowGap}
          showMessagesView={Boolean(showMessagesView)}
          screens={screens}
          workflowDraftId={workflowDraft?.id}
          interactionState={interactionState}
          padding={getContainerPadding()}
          selectionMode={selectionMode}
          selectedMessageIds={selectedMessageIds}
          selectableMessageIds={selectableMessageIds}
          onToggleMessageSelection={handleToggleMessageSelection}
        />

        {/* 滚动按钮组 - 输入框上方右侧，使用 absolute 相对于父容器定位 */}
        {(showScrollToTop || showScrollToBottom) && (
          <div
            style={{
              position: "absolute",
              right: getScrollButtonPosition(),
              bottom: screens.xs ? 160 : 180,
              display: "flex",
              flexDirection: "column",
              gap: token.marginXS,
              zIndex: 1000,
            }}
          >
            {showScrollToTop && (
              <FloatButton
                type="default"
                icon={<UpOutlined />}
                style={{ position: "relative", inset: "unset" }}
                onClick={() => {
                  scrollToTop();
                }}
              />
            )}
            {showScrollToBottom && (
              <FloatButton
                type="primary"
                icon={<DownOutlined />}
                style={{ position: "relative", inset: "unset" }}
                onClick={() => {
                  resetUserScroll();
                  scrollToBottom();
                }}
              />
            )}
          </div>
        )}

        {/* QuestionDialog - show above input area when there's an active agent session */}
        {agentSessionId && (
          <div
            style={{
              padding: `0 ${getContainerPadding()}px`,
              maxWidth: showMessagesView ? getContainerMaxWidth() : "100%",
              margin: "0 auto",
              width: "100%",
            }}
          >
            <QuestionDialog
              sessionId={agentSessionId}
              onQuestionAppeared={handleQuestionAppeared}
            />
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
      </Flex>
    </Layout>
  );
};
