import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App as AntApp, Grid, Layout, theme, Flex, Tag, Tooltip } from "antd";
import { InboxOutlined } from "@ant-design/icons";

import { selectIsBusy, selectSessionById, useAppStore } from "../store";
import type { Message } from "../types/chat";
import { ChatInputArea } from "../components/ChatView/ChatInputArea";
import { ChatMessagesList } from "../components/ChatView/ChatMessagesList";
import { TokenUsageDisplay } from "../components/TokenUsageDisplay";
import "../components/ChatView/styles.css";
import { useChatViewScroll } from "../components/ChatView/useChatViewScroll";
import type { WorkflowDraft } from "../components/InputContainer";
import {
  useChatViewMessages,
  type RenderableEntry,
} from "../components/ChatView/useChatViewMessages";
import type { SessionDiffSummary } from "../components/ChatView/ActiveToolMessageCard";
import { getMessageText } from "../components/MessageCard/messageCardParsing";
import { MessageExportService } from "../services/MessageExportService";
import { CHAT_TOGGLE_BATCH_EXPORT_SELECTION_EVENT } from "../components/ChatView/events";
import { useUILayoutStore } from "@shared/store/uiLayoutStore";
import i18next from "i18next";
import { useTranslation } from "react-i18next";
import type { DeleteMessageResult } from "../store/slices/chatSessionSlice";
import { useIsMobile } from "@shared/hooks/useMediaQuery";
import { MessageSelectionToolbar } from "./MessageSelectionToolbar";
import { ScrollCapsule } from "./ScrollCapsule";
import { ConversationMetaStrip } from "./ConversationMetaStrip";
import {
  buildConversationWorkspaceState,
  type ConversationWorkspaceState,
} from "../workspace/workspaceState";

const LazyQuestionDialog = React.lazy(() =>
  import("@components/QuestionDialog").then((m) => ({ default: m.QuestionDialog })),
);

const { useToken } = theme;
const { useBreakpoint } = Grid;

const getMessageRoleLabel = (message: Message): string => {
  const { t } = i18next;
  if (message.role === "user") return t("chat.view.roleUser");
  if (message.role === "assistant") return t("chat.view.roleAssistant");
  if (message.role === "system") return t("chat.view.roleSystem");
  return t("chat.view.roleDefault");
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

export type ConversationPaneProps = {
  /**
   * If omitted, falls back to the globally selected chat.
   * When rendering a non-root workspace leaf, always pass an explicit sessionId.
   */
  sessionId?: string | null;
  /**
   * When embedded in split panes, use full width and tighter spacing.
   */
  embedded?: boolean;
  /**
   * Legacy fallback for deriving visible-leaf workspace context when explicit workspaceState is not supplied.
   */
  paneCount?: number;
  /** Deferred auxiliary mount gate owned by workspace shell. */
  auxReady?: boolean;
  /** Optional diff summary owned by workspace shell. */
  sessionDiffSummary?: SessionDiffSummary | null;
  /** Preferred explicit workspace state. */
  workspaceState?: ConversationWorkspaceState;
  /** Whether the inspector currently has meaningful content for this session. */
  inspectorEligible?: boolean;
  /** Request the workspace shell to open/reopen the inspector. */
  onRequestOpenInspector?: () => void;
};

export const ConversationPane: React.FC<ConversationPaneProps> = ({
  sessionId: sessionIdProp,
  embedded = false,
  paneCount = 1,
  auxReady: auxReadyProp = false,
  sessionDiffSummary: sessionDiffSummaryProp = null,
  workspaceState: workspaceStateProp,
  inspectorEligible = false,
  onRequestOpenInspector,
}) => {
  const visibleLeafCount = paneCount;
  const { message: appMessage } = AntApp.useApp();
  const { t } = useTranslation();
  const sessionId = useAppStore((state) => sessionIdProp ?? state.currentSessionId);
  const currentChat = useAppStore(selectSessionById(sessionId));
  const deleteMessage = useAppStore((state) => state.deleteMessage);
  const loadChatHistory = useAppStore((state) => state.loadChatHistory);
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

  const isBusy = useAppStore(selectIsBusy(sessionId));

  useEffect(() => {
    if (!sessionId) return;
    const chat = useAppStore.getState().chats.find((c) => c.id === sessionId);
    if (chat && Array.isArray(chat.messages) && chat.messages.length > 0) {
      return;
    }
    void loadChatHistory(sessionId);
  }, [sessionId, loadChatHistory]);

  const currentMessageCount = currentChat?.messageCount ?? 0;
  const currentMessagesLength = currentChat?.messages?.length ?? 0;

  useEffect(() => {
    if (!sessionId) return;
    const messageCountDiff = currentMessageCount - currentMessagesLength;
    if (messageCountDiff > 0) {
      void loadChatHistory(sessionId, { mode: "monotonic" });
    }
  }, [sessionId, currentMessageCount, currentMessagesLength, loadChatHistory]);

  const isThinking = isBusy;

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
  const bottomAnchorRef = useRef<HTMLDivElement>(null);
  const { token } = useToken();
  const screens = useBreakpoint();
  // antd's useBreakpoint returns a fresh object each render; narrow it to the
  // only field ChatMessagesList reads so its React.memo can hit on identity.
  const screensForList = useMemo(() => ({ xs: screens.xs }), [screens.xs]);
  const isMobile = useIsMobile();
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowDraft | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const sidebarCollapsed = useUILayoutStore((s) => s.sidebar.collapsed);
  const auxReady = auxReadyProp;
  const sessionDiffSummary = sessionDiffSummaryProp;

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

  const resolvedWorkspaceState = useMemo<ConversationWorkspaceState>(() => {
    if (workspaceStateProp) {
      return workspaceStateProp;
    }

    return buildConversationWorkspaceState({
      isEmbedded: embedded,
      leafCount: visibleLeafCount,
      isMobileViewport: isMobile,
    });
  }, [embedded, isMobile, visibleLeafCount, workspaceStateProp]);

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

  // Retained as a named constant for potential future overlay offset tuning.
  const selectionToolbarRightPaddingOffset = 0;

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
      appMessage.warning(t("chat.view.noExportableMessages"));
      return;
    }
    setSelectionMode(true);
  }, [appMessage, hasSelectableMessages, t]);

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
        appMessage.warning(t("chat.view.noActiveChat"));
        return;
      }

      if (selectedMessages.length === 0) {
        appMessage.warning(t("chat.view.selectAtLeastOneMessage"));
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
        appMessage.success(t("chat.view.exportSaved", { filename: result.filename }));
        return;
      }

      if (result.error?.toLowerCase().includes("cancel")) {
        return;
      }
      appMessage.error(result.error || t("chat.view.exportFailed"));
    },
    [appMessage, sessionId, selectedMessages, t],
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
    bottomAnchorRef,
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
            (
            {t("components.tokenUsage.truncatedBadge", {
              count: currentSegmentsRemoved,
              defaultValue: "{{count}} truncated",
            })}
            )
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
        <ConversationMetaStrip
          sessionId={sessionId}
          auxReady={auxReady}
          maxWidth={getContainerMaxWidth()}
          paddingLeft={getContainerPadding()}
          paddingRight={getContainerPadding()}
          workspaceState={resolvedWorkspaceState}
          inspectorEligible={inspectorEligible}
          planMode={currentChat?.planMode ?? null}
          onRequestOpenInspector={onRequestOpenInspector}
          t={t}
        />

        <MessageSelectionToolbar
          visible={shouldShowSelectionToolbar}
          selectionMode={selectionMode}
          selectedCount={selectedMessages.length}
          totalCount={selectableMessages.length}
          paddingTop={token.paddingXS}
          paddingRight={getContainerPadding() + selectionToolbarRightPaddingOffset}
          paddingBottom={0}
          paddingLeft={getContainerPadding()}
          maxWidth={getContainerMaxWidth()}
          onToggleSelectionMode={handleToggleSelectionMode}
          onSelectAll={handleSelectAllMessages}
          onClear={handleClearSelectedMessages}
          onExportMarkdown={() => {
            void handleExportSelectedMessages("markdown");
          }}
          onExportPdf={() => {
            void handleExportSelectedMessages("pdf");
          }}
          t={t}
        />

        <ChatMessagesList
          currentChat={currentChat}
          currentSessionId={sessionId}
          convertRenderableEntry={convertRenderableEntry}
          handleDeleteMessage={handleDeleteMessage}
          handleDeleteToolMessages={handleDeleteToolMessages}
          handleMessagesScroll={handleMessagesScroll}
          hasSystemPrompt={hasSystemPrompt}
          messagesListRef={messagesListRef}
          bottomAnchorRef={bottomAnchorRef}
          renderableMessages={renderableMessagesWithDraft}
          rowGap={rowGap}
          showMessagesView={Boolean(showMessagesView)}
          screens={screensForList}
          workflowDraftId={workflowDraft?.id}
          isThinking={isThinking}
          padding={getContainerPadding()}
          selectionMode={selectionMode}
          selectedMessageIds={selectedMessageIds}
          selectableMessageIds={selectableMessageIds}
          onToggleMessageSelection={handleToggleMessageSelection}
        />
        <div className="chat-bottom-stack" data-testid="chat-bottom-stack">
          <ScrollCapsule
            visible={showMessagesView}
            showScrollToTop={showScrollToTop}
            showScrollToBottom={showScrollToBottom}
            hasUnreadActivity={hasUnreadActivity}
            unreadCount={unreadCount}
            onScrollToTop={scrollToTop}
            onScrollToBottom={scrollToBottom}
            onResetUserScroll={resetUserScroll}
            t={t}
          />

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
                <LazyQuestionDialog key={sessionId} sessionId={sessionId} />
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
            showSessionDiffCard={false}
          />
        </div>
      </Flex>
    </Layout>
  );
};
