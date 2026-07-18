import { debugLog } from "@shared/utils/debugFlags";
import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { App as AntApp, Card, Dropdown, Flex, Grid, Space, theme } from "antd";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { ImageGrid } from "../ImageGrid";
import { ActionButtonGroup, createCopyButton, createReferenceButton } from "../ActionButtonGroup";
import { useAppStore } from "@shared/store/appStore";
import { agentClient } from "@services/chat/AgentService";
import { isTaskListMessage, isUserFileReferenceMessage, type Message } from "@shared/types/chat";
import PlanMessageCard from "../PlanMessageCard";
import QuestionMessageCard from "../QuestionMessageCard";
import FileReferenceCard from "../FileReferenceCard";
import TodoListDisplay from "../TodoListDisplay";
import { createMarkdownComponents } from "@shared/components/Markdown/markdownComponents";
import MessageCardContent from "./MessageCardContent";
import MessageCardHeader from "./MessageCardHeader";
import {
  detectMessageType,
  getMessageText,
  parsePlanMessage,
  parseQuestionMessage,
} from "./messageCardParsing";
import { formatUserToolCall } from "./messageCardFormatters";
import { useMessageCardActions } from "./useMessageCardActions";
import { useMessageCardPlanActions } from "./useMessageCardPlanActions";
import { useMessageCardMermaidFix } from "./useMessageCardMermaidFix";
import { getMessageCardMaxWidth } from "./messageCardLayout";
import { MessageFeedback } from "../MessageFeedback";

const { useToken } = theme;
const { useBreakpoint } = Grid;
const CHAT_SEND_MESSAGE_EVENT = "chat-send-message";

type ChatSendMessageEventDetail = {
  content: string;
  sessionId?: string | null;
  handled?: boolean;
  resolve?: () => void;
  reject?: (error: unknown) => void;
};

interface MessageCardProps {
  sessionId: string | null;
  message: Message;
  onDelete?: (messageId: string) => void;
  messageType?: "text" | "plan" | "question" | "tool_call" | "tool_result";
  /**
   * Whether the owning session currently has an active execution
   * (`selectIsBusy(sessionId)`). Resolved ONCE by the list/pane and passed
   * down as a prop instead of each card subscribing to the store itself —
   * see issue #18 (O(n) `useAppStore` subscriptions, one per visible card).
   * Only the "question" card branch actually consumes this value; the
   * memo comparator below skips re-renders for every other card type.
   */
  isProcessing?: boolean;
}

const MessageCardComponent: React.FC<MessageCardProps> = ({
  sessionId,
  message,
  onDelete,
  messageType,
  isProcessing = false,
}) => {
  const { role, id: messageId } = message;
  const { token } = useToken();
  const { t } = useTranslation();
  const { message: appMessage } = AntApp.useApp();
  const screens = useBreakpoint();
  const updateSession = useAppStore((state) => state.updateSession);
  const loadChatHistory = useAppStore((state) => state.loadChatHistory);
  const refreshChats = useAppStore((state) => state.refreshChats);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState<boolean>(false);

  const sendMessage = useCallback(
    (content: string) => {
      if (typeof window === "undefined") {
        return Promise.reject(new Error("window is unavailable"));
      }

      return new Promise<void>((resolve, reject) => {
        const detail: ChatSendMessageEventDetail = {
          content,
          sessionId,
          handled: false,
          resolve,
          reject,
        };

        window.dispatchEvent(
          new CustomEvent<ChatSendMessageEventDetail>(CHAT_SEND_MESSAGE_EVENT, {
            detail,
          }),
        );

        if (!detail.handled) {
          reject(new Error("No chat message dispatcher available"));
        }
      });
    },
    [sessionId],
  );

  const formattedTimestamp = useMemo(() => {
    if (!message.createdAt) return null;
    const parsed = new Date(message.createdAt);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    try {
      return format(parsed, "MMM d, yyyy HH:mm");
    } catch {
      return parsed.toLocaleString();
    }
  }, [message.createdAt]);

  const detectedMessageType = useMemo(
    () => detectMessageType(message, messageType),
    [message, messageType],
  );

  const parsedPlan = useMemo(
    () => parsePlanMessage(message, detectedMessageType),
    [message, detectedMessageType],
  );

  const parsedQuestion = useMemo(
    () => parseQuestionMessage(message, detectedMessageType),
    [message, detectedMessageType],
  );

  const messageText = useMemo(() => getMessageText(message), [message]);

  const onFixMermaid = useMessageCardMermaidFix(messageId, sessionId);

  const restoreSessionState = useCallback(
    async (restoreFiles: boolean) => {
      if (!sessionId || !messageId) {
        appMessage.warning(t("chat.messageActions.cannotRestore"));
        return;
      }

      try {
        const result = await agentClient.restoreSessionState(sessionId, {
          target_message_id: messageId,
          restore_files: restoreFiles,
        });

        await loadChatHistory(sessionId, { mode: "replace" });
        await refreshChats();

        const fileErrorCount = result.file_errors?.length ?? 0;
        if (fileErrorCount > 0) {
          appMessage.warning(t("chat.messageActions.restorePartial", { count: fileErrorCount }));
          return;
        }

        if (restoreFiles) {
          appMessage.success(
            t("chat.messageActions.restoreFilesSuccess", {
              count: result.messages_removed,
            }),
          );
        } else {
          appMessage.success(
            t("chat.messageActions.restoreSuccess", {
              count: result.messages_removed,
            }),
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("chat.messageActions.restoreFailed");
        appMessage.error(message);
      }
    },
    [appMessage, sessionId, loadChatHistory, messageId, refreshChats, t],
  );

  const onRestoreChat = useCallback(() => {
    void restoreSessionState(false);
  }, [restoreSessionState]);

  const onRestoreFilesAndChat = useCallback(() => {
    void restoreSessionState(true);
  }, [restoreSessionState]);

  const { contextMenuItems, handleMouseUp, copyToClipboard, referenceMessage } =
    useMessageCardActions({
      messageText,
      messageId,
      currentSessionId: sessionId,
      onDelete,
      onRestoreChat,
      onRestoreFilesAndChat,
      cardRef,
    });

  const isUserToolCall = useMemo(
    () => role === "user" && messageText.startsWith("/"),
    [role, messageText],
  );

  const markdownComponents = useMemo(
    () =>
      createMarkdownComponents(undefined, {
        onFixMermaid,
      }),
    [onFixMermaid],
  );

  const markdownPlugins = useMemo(() => [remarkGfm, remarkBreaks], []);
  const rehypePlugins = useMemo(() => [rehypeSanitize], []);

  const actionButtons = useMemo(
    () => [
      createCopyButton(() => copyToClipboard(messageText), t("chat.actions.copyMessage")),
      createReferenceButton(referenceMessage, t("chat.actions.referenceMessage")),
    ],
    [messageText, copyToClipboard, referenceMessage, t],
  );

  const { handleExecutePlan, handleRefinePlan, handleQuestionAnswer } = useMessageCardPlanActions({
    currentSessionId: sessionId,
    updateSession,
    sendMessage,
  });

  if (detectedMessageType === "plan" && parsedPlan && role === "assistant") {
    return (
      <PlanMessageCard
        plan={parsedPlan}
        contextId={sessionId || ""}
        onExecute={handleExecutePlan}
        onRefine={handleRefinePlan}
        timestamp={formattedTimestamp ?? undefined}
      />
    );
  }

  if (detectedMessageType === "question" && parsedQuestion && role === "assistant") {
    return (
      <QuestionMessageCard
        question={parsedQuestion}
        contextId={sessionId || ""}
        onAnswer={handleQuestionAnswer}
        disabled={isProcessing || false}
        timestamp={formattedTimestamp ?? undefined}
      />
    );
  }

  if (isTaskListMessage(message)) {
    return <TodoListDisplay taskList={message.taskList} />;
  }

  if (isUserFileReferenceMessage(message)) {
    debugLog(
      "[MessageCard]",
      "[MessageCard] Rendering FileReferenceCard for message:",
      message.id,
      "paths:",
      message.paths,
    );
    return (
      <Flex justify="flex-end" style={{ width: "100%" }}>
        <FileReferenceCard
          paths={message.paths}
          displayText={message.displayText}
          timestamp={formattedTimestamp ?? undefined}
        />
      </Flex>
    );
  }

  return (
    <Flex vertical onContextMenu={(e) => handleMouseUp(e)} style={{ width: "100%" }}>
      <Dropdown menu={{ items: contextMenuItems }} trigger={["contextMenu"]}>
        <Card
          data-testid={role === "assistant" ? "assistant-message" : "user-message"}
          id={messageId ? `message-${messageId}` : undefined}
          ref={cardRef}
          style={{
            width: "100%",
            minWidth: "100%",
            maxWidth: getMessageCardMaxWidth(screens),
            margin: "0 auto",
            background:
              role === "user"
                ? "var(--lotus-message-user-bg)"
                : role === "assistant"
                  ? "var(--lotus-message-assistant-bg)"
                  : token.colorBgContainer,
            border:
              role === "user"
                ? `1px solid var(--lotus-message-user-border)`
                : `1px solid var(--lotus-message-assistant-border)`,
            borderRadius: token.borderRadiusLG,
            boxShadow: isHovering
              ? "var(--lotus-card-hover-shadow)"
              : role === "user"
                ? "var(--lotus-shadow-soft)"
                : "var(--lotus-shadow-soft)",
            position: "relative",
            wordWrap: "break-word",
            overflowWrap: "break-word",
            transition: "all 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
            transform: isHovering ? "translateY(-2px) scale(1.002)" : "none",
            overflow: "hidden",
          }}
          styles={{
            body: {
              padding: token.paddingMD,
            },
          }}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          <Space
            direction="vertical"
            size={token.marginXS}
            style={{ width: "100%", maxWidth: "100%" }}
          >
            <MessageCardHeader role={role} formattedTimestamp={formattedTimestamp} token={token} />

            {message.role === "user" && message.images && <ImageGrid images={message.images} />}

            <Flex vertical style={{ width: "100%", maxWidth: "100%" }}>
              <MessageCardContent
                sessionId={sessionId}
                message={message}
                messageText={messageText}
                isUserToolCall={isUserToolCall}
                formatUserToolCall={formatUserToolCall}
                markdownComponents={markdownComponents}
                markdownPlugins={markdownPlugins}
                rehypePlugins={rehypePlugins}
              />
            </Flex>

            <ActionButtonGroup
              isVisible={isHovering}
              position={{ bottom: token.paddingXS, right: token.paddingXS }}
              buttons={actionButtons}
            />
          </Space>
        </Card>
      </Dropdown>

      {/* Feedback buttons for assistant text messages */}
      {role === "assistant" && detectedMessageType === "text" && messageId && (
        <MessageFeedback messageId={messageId} isVisible={isHovering} />
      )}
    </Flex>
  );
};

const MessageCard = memo(MessageCardComponent, (prevProps, nextProps) => {
  if (
    prevProps.message !== nextProps.message ||
    prevProps.messageType !== nextProps.messageType ||
    prevProps.onDelete !== nextProps.onDelete ||
    // sessionId drives state-restore, mermaid fix and child contextId —
    // skipping a render when it changes would leave a stale binding.
    prevProps.sessionId !== nextProps.sessionId
  ) {
    return false;
  }

  if (prevProps.isProcessing === nextProps.isProcessing) {
    return true;
  }

  // `isProcessing` only affects the "question" branch (it disables the
  // answer buttons while the session is busy) — every other card type
  // ignores it, so most visible cards skip the re-render entirely when
  // execution state flips (see issue #18).
  const usesIsProcessing =
    nextProps.message.role === "assistant" &&
    detectMessageType(nextProps.message, nextProps.messageType) === "question";
  return !usesIsProcessing;
});

MessageCard.displayName = "MessageCard";

export default MessageCard;
