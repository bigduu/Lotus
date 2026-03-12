import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { App as AntApp, Card, Dropdown, Flex, Grid, Space, theme } from "antd";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { format } from "date-fns";
import { ImageGrid } from "../ImageGrid";
import {
  ActionButtonGroup,
  createCopyButton,
  createReferenceButton,
} from "../ActionButtonGroup";
import { useAppStore } from "../../store";
import { agentClient } from "../../services/AgentService";
import {
  isTodoListMessage,
  isUserFileReferenceMessage,
  type Message,
} from "../../types/chat";
import PlanMessageCard from "../PlanMessageCard";
import QuestionMessageCard from "../QuestionMessageCard";
import FileReferenceCard from "../FileReferenceCard";
import TodoListDisplay from "../TodoListDisplay";
import { createMarkdownComponents } from "../../../../shared/components/Markdown/markdownComponents";
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
}

const MessageCardComponent: React.FC<MessageCardProps> = ({
  sessionId,
  message,
  onDelete,
  messageType,
}) => {
  const { role, id: messageId } = message;
  const { token } = useToken();
  const { message: appMessage } = AntApp.useApp();
  const screens = useBreakpoint();
  const updateSession = useAppStore((state) => state.updateSession);
  const loadChatHistory = useAppStore((state) => state.loadChatHistory);
  const refreshChats = useAppStore((state) => state.refreshChats);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState<boolean>(false);

  // Select only the boolean we need, not the whole Set
  const isProcessing = useAppStore((state) => {
    return sessionId ? state.processingChats.has(sessionId) : false;
  });

  const sendMessage = useCallback((content: string) => {
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
  }, []);

  const formattedTimestamp = useMemo(() => {
    if (!message.createdAt) return null;
    const parsed = new Date(message.createdAt);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    try {
      return format(parsed, "MMM d, yyyy HH:mm");
    } catch (error) {
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

  const onFixMermaid = useMessageCardMermaidFix(messageId);

  const restoreSessionState = useCallback(
    async (restoreFiles: boolean) => {
      if (!sessionId || !messageId) {
        appMessage.warning("Cannot restore this message");
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
          appMessage.warning(
            `Chat restored. ${fileErrorCount} file(s) could not be restored.`,
          );
          return;
        }

        if (restoreFiles) {
          appMessage.success(
            `Files and chat restored (${result.messages_removed} message(s) removed).`,
          );
        } else {
          appMessage.success(
            `Chat restored (${result.messages_removed} message(s) removed).`,
          );
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to restore session";
        appMessage.error(message);
      }
    },
    [appMessage, sessionId, loadChatHistory, messageId, refreshChats],
  );

  const onRestoreChat = useCallback(() => {
    void restoreSessionState(false);
  }, [restoreSessionState]);

  const onRestoreFilesAndChat = useCallback(() => {
    void restoreSessionState(true);
  }, [restoreSessionState]);

  const {
    contextMenuItems,
    handleMouseUp,
    copyToClipboard,
    referenceMessage,
  } = useMessageCardActions({
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
      createMarkdownComponents(token, {
        onFixMermaid,
      }),
    [token, onFixMermaid],
  );

  const markdownPlugins = useMemo(() => [remarkGfm, remarkBreaks], []);
  const rehypePlugins = useMemo(() => [rehypeSanitize], []);

  const actionButtons = useMemo(
    () => [
      createCopyButton(() => copyToClipboard(messageText)),
      createReferenceButton(referenceMessage),
    ],
    [messageText, copyToClipboard, referenceMessage],
  );

  const { handleExecutePlan, handleRefinePlan, handleQuestionAnswer } =
    useMessageCardPlanActions({
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

  if (
    detectedMessageType === "question" &&
    parsedQuestion &&
    role === "assistant"
  ) {
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

  if (isTodoListMessage(message)) {
    return <TodoListDisplay todoList={message.todoList} />;
  }

  if (isUserFileReferenceMessage(message)) {
    console.log(
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
    <Flex
      vertical
      onContextMenu={(e) => handleMouseUp(e)}
      style={{ width: "100%" }}
    >
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
                ? token.colorPrimaryBg
                : role === "assistant"
                  ? token.colorBgLayout
                  : token.colorBgContainer,
            borderRadius: token.borderRadiusLG,
            boxShadow: token.boxShadow,
            position: "relative",
            wordWrap: "break-word",
            overflowWrap: "break-word",
          }}
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          <Space
            direction="vertical"
            size={token.marginXS}
            style={{ width: "100%", maxWidth: "100%" }}
          >
            <MessageCardHeader
              role={role}
              formattedTimestamp={formattedTimestamp}
              token={token}
            />

            {message.role === "user" && message.images && (
              <ImageGrid images={message.images} />
            )}

            <Flex vertical style={{ width: "100%", maxWidth: "100%" }}>
              <MessageCardContent
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
    </Flex>
  );
};

const MessageCard = memo(MessageCardComponent, (prevProps, nextProps) => {
  return (
    prevProps.message === nextProps.message &&
    prevProps.messageType === nextProps.messageType &&
    prevProps.onDelete === nextProps.onDelete
  );
});

MessageCard.displayName = "MessageCard";

export default MessageCard;
