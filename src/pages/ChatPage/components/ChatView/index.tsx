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
import { useVirtualizer } from "@tanstack/react-virtual";

import { selectChatById, useAppStore } from "../../store";
import {
  isAssistantToolResultMessage,
  type Message,
} from "../../types/chat";
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
import { CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT } from "./events";

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
      return [
        `## ${index + 1}. ${roleLabel} · ${timeLabel}`,
        "",
        text,
      ].join("\n");
    })
    .join("\n\n---\n\n");
};

export type ChatViewProps = {
  /**
   * If omitted, falls back to the globally selected chat.
   * Multi-pane mode should always pass an explicit chatId.
   */
  chatId?: string | null;
  /**
   * When embedded in split panes, use full width and tighter spacing.
   */
  embedded?: boolean;
};

export const ChatView: React.FC<ChatViewProps> = ({
  chatId: chatIdProp,
  embedded = false,
}) => {
  const { message: appMessage } = AntApp.useApp();
  const chatId = useAppStore((state) => chatIdProp ?? state.currentChatId);
  const currentChat = useAppStore(selectChatById(chatId));
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
  const hasTodoList = useAppStore((state) =>
    chatId ? Boolean(state.todoLists[chatId]) : false,
  );
  const hasSubSessions = useAppStore((state) => {
    if (!chatId) return false;
    const progressMap = state.subSessionsByParent[chatId];
    if (progressMap && Object.keys(progressMap).length > 0) return true;
    return state.chats.some(
      (c) => c.kind === "child" && c.parentSessionId === chatId,
    );
  });

  // Lazy-load history when switching sessions (backend is source of truth).
  useEffect(() => {
    if (!chatId) return;
    const chat = useAppStore.getState().chats.find((c) => c.id === chatId);
    if (chat && Array.isArray(chat.messages) && chat.messages.length > 0) {
      return;
    }
    void loadChatHistory(chatId);
  }, [chatId, loadChatHistory]);

  const isProcessing = chatId
    ? processingChats.has(chatId)
    : false;

  const sessionDiffSummary = useMemo<SessionDiffSummary | null>(() => {
    if (!currentMessages || currentMessages.length === 0) {
      return null;
    }

    const files = new Map<
      string,
      { added: number; removed: number; diffChunks: string[]; truncated: boolean }
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
      if (chatId) {
        deleteMessage(chatId, messageId);
      }
    },
    [chatId, deleteMessage],
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

  const getContainerMaxWidth = () => {
    if (embedded) return "100%";
    if (screens.xs) return "100%";
    if (screens.sm) return "100%";
    if (screens.md) return "90%";
    if (screens.lg) return "85%";
    return "1024px";
  };

  const getContainerPadding = () => {
    if (embedded) return token.paddingSM;
    if (screens.xs) return token.paddingXS;
    if (screens.sm) return token.paddingSM;
    return token.padding;
  };

  useEffect(() => {
    setWorkflowDraft(null);
    setSelectionMode(false);
    setSelectedMessageIds(new Set());
  }, [chatId]);

  const { systemPromptMessage, renderableMessages, convertRenderableEntry } =
    useChatViewMessages(currentChat, currentMessages);

  const hasMessages = currentMessages.length > 0;
  const hasWorkflowDraft = Boolean(workflowDraft?.content);
  const hasSystemPrompt = Boolean(systemPromptMessage);
  const showMessagesView =
    chatId && (hasMessages || hasSystemPrompt || hasWorkflowDraft);

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
      if (!chatId) {
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
        chatId,
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
    [appMessage, chatId, selectedMessages],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onToggleSelectionMode = (
      event: Event,
    ) => {
      const customEvent = event as CustomEvent<{ chatId?: string | null }>;
      const targetChatId = customEvent.detail?.chatId ?? null;
      if (!chatId || targetChatId !== chatId) {
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
  }, [chatId, handleToggleSelectionMode]);

  // In v2, frontend chat id === backend session id.
  const agentSessionId = currentChat?.id;

  // Get token usage - prefer store (real-time), fallback to chat config (persisted)
  const storeTokenUsage = chatId ? tokenUsages[chatId] : null;
  const configTokenUsage = currentChat?.config?.tokenUsage;
  const currentTokenUsage = storeTokenUsage || configTokenUsage || null;

  const storeTruncation = chatId
    ? truncationOccurred[chatId]
    : false;
  const configTruncation = currentChat?.config?.truncationOccurred;
  const currentTruncationOccurred =
    storeTruncation || configTruncation || false;

  const storeSegments = chatId ? segmentsRemoved[chatId] : 0;
  const configSegments = currentChat?.config?.segmentsRemoved;
  const currentSegmentsRemoved = storeSegments || configSegments || 0;

  // IMPORTANT: keep virtualizer option callbacks stable.
  // If these functions change on every render, react-virtual can repeatedly update
  // internal state during effect flushes and trigger "Maximum update depth exceeded".
  const estimateRowSize = useCallback(() => 320, []);
  const getScrollElement = useCallback(() => messagesListRef.current, []);
  const getItemKey = useCallback(
    (index: number) => {
      const entry = renderableMessagesWithDraft[index];
      if (!entry) return index;

      // stable key: matches React row key logic
      if ("type" in entry && entry.type === "tool_session") return entry.id;
      if ("message" in entry && entry.message) return entry.message.id;
      return index;
    },
    [renderableMessagesWithDraft],
  );

  const virtualizerOptions = useMemo(
    () => ({
      count: renderableMessagesWithDraft.length,
      getScrollElement,
      estimateSize: estimateRowSize,
      overscan: 2,
      getItemKey,
    }),
    [
      estimateRowSize,
      getItemKey,
      getScrollElement,
      renderableMessagesWithDraft.length,
    ],
  );

  const rowVirtualizer = useVirtualizer(virtualizerOptions);

  const rowGap = token.marginMD;

  const {
    handleMessagesScroll,
    resetUserScroll,
    scrollToBottom,
    scrollToTop,
    showScrollToBottom,
    showScrollToTop,
  } = useChatViewScroll({
    currentChatId: chatId,
    interactionState,
    messagesListRef,
    renderableMessages: renderableMessagesWithDraft,
    rowVirtualizer,
  });

  const getScrollButtonPosition = () => {
    return screens.xs ? 16 : 32;
  };

  const shouldShowSelectionToolbar =
    Boolean(showMessagesView) &&
    hasSelectableMessages &&
    (!embedded || selectionMode);

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
        {/* TodoList - show when there is an active agent session */}
        {agentSessionId && hasTodoList && (
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

        {/* Token Usage Display - show when there's token usage data */}
        {currentTokenUsage && currentTokenUsage.budgetLimit > 0 && (
          <div
            style={{
              paddingTop: 0,
              paddingRight:
                getContainerPadding() + paneActionOverlayRightPadding,
              paddingBottom: 0,
              paddingLeft: 6,
              maxWidth: getContainerMaxWidth(),
              margin: "0 auto",
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-start",
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
                  }}
                >
                  ({currentSegmentsRemoved} truncated)
                </span>
              )}
            </div>
          </div>
        )}

        {chatId && hasSubSessions && (
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
            <SubSessionsPanel parentSessionId={chatId} />
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
                  Selected {selectedMessages.length} / {selectableMessages.length}
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
          currentChatId={chatId}
          convertRenderableEntry={convertRenderableEntry}
          handleDeleteMessage={handleDeleteMessage}
          handleMessagesScroll={handleMessagesScroll}
          hasSystemPrompt={hasSystemPrompt}
          messagesListRef={messagesListRef}
          renderableMessages={renderableMessagesWithDraft}
          rowGap={rowGap}
          rowVirtualizer={rowVirtualizer}
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

        {/* 滚动按钮组 - 都在右下角 */}
        {!embedded && (showScrollToTop || showScrollToBottom) && (
          <FloatButton.Group
            style={{
              right: getScrollButtonPosition(),
              bottom: screens.xs ? 160 : 180,
              gap: token.marginSM,
              zIndex: 1000,
            }}
          >
            {showScrollToTop && (
              <FloatButton
                type="default"
                icon={<UpOutlined />}
                onClick={() => {
                  scrollToTop();
                }}
              />
            )}
            {showScrollToBottom && (
              <FloatButton
                type="primary"
                icon={<DownOutlined />}
                onClick={() => {
                  resetUserScroll();
                  scrollToBottom();
                }}
              />
            )}
          </FloatButton.Group>
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
            <QuestionDialog sessionId={agentSessionId} />
          </div>
        )}

        <ChatInputArea
          chatId={chatId}
          isCenteredLayout={!showMessagesView}
          maxWidth={showMessagesView ? getContainerMaxWidth() : "100%"}
          onWorkflowDraftChange={setWorkflowDraft}
          showMessagesView={Boolean(showMessagesView)}
          sessionDiffSummary={sessionDiffSummary}
        />
      </Flex>
    </Layout>
  );
};
