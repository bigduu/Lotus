import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import { useThemeStore } from "@shared/store/themeStore";
import { App as AntApp, Card, Dropdown, Flex, Grid, Space, theme } from "antd";
import rehypeSanitize from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { ImageGrid } from "../ImageGrid";
import {
  ActionButtonGroup,
  createCopyButton,
  createReferenceButton,
} from "../ActionButtonGroup";
import { useAppStore } from "../../store";
import { agentClient } from "../../services/AgentService";
import {
  isTaskListMessage,
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
  const { t } = useTranslation();
  const { message: appMessage } = AntApp.useApp();
  const screens = useBreakpoint();
  const updateSession = useAppStore((state) => state.updateSession);
  const loadChatHistory = useAppStore((state) => state.loadChatHistory);
  const refreshChats = useAppStore((state) => state.refreshChats);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState<boolean>(false);
  const isDark = useThemeStore((s) => s.themeMode) === "dark";

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
          appMessage.warning(
            t("chat.messageActions.restorePartial", { count: fileErrorCount }),
          );
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
          error instanceof Error
            ? error.message
            : t("chat.messageActions.restoreFailed");
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
      createCopyButton(
        () => copyToClipboard(messageText),
        t("chat.actions.copyMessage"),
      ),
      createReferenceButton(
        referenceMessage,
        t("chat.actions.referenceMessage"),
      ),
    ],
    [messageText, copyToClipboard, referenceMessage, t],
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

  if (isTaskListMessage(message)) {
    return <TodoListDisplay taskList={message.taskList} />;
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
                ? isDark
                  ? "linear-gradient(135deg, rgba(13, 148, 136, 0.14) 0%, rgba(5, 150, 105, 0.12) 100%)"
                  : "linear-gradient(135deg, rgba(240, 253, 250, 0.98) 0%, rgba(204, 251, 241, 0.88) 100%)"
                : role === "assistant"
                  ? isDark
                    ? "linear-gradient(180deg, rgba(15, 23, 42, 0.8) 0%, rgba(11, 16, 28, 0.72) 100%)"
                    : "linear-gradient(180deg, rgba(255, 255, 255, 0.88) 0%, rgba(248, 250, 255, 0.82) 100%)"
                  : token.colorBgContainer,
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            border:
              role === "user"
                ? isDark
                  ? "1px solid rgba(45, 212, 191, 0.24)"
                  : "1px solid rgba(13, 148, 136, 0.18)"
                : `1px solid ${isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.72)"}`,
            borderRadius: token.borderRadiusLG,
            boxShadow: isHovering
              ? "0 20px 40px rgba(15, 23, 42, 0.12), 0 8px 18px rgba(13, 148, 136, 0.10)"
              : role === "user"
                ? "0 12px 28px rgba(13, 148, 136, 0.10), 0 4px 12px rgba(15, 23, 42, 0.05)"
                : "0 10px 26px rgba(15, 23, 42, 0.08), 0 3px 10px rgba(15, 23, 42, 0.04)",
            position: "relative",
            wordWrap: "break-word",
            overflowWrap: "break-word",
            transition: "all 0.26s cubic-bezier(0.16, 1, 0.3, 1)",
            transform: isHovering ? "translateY(-2px) scale(1.002)" : "none",
            overflow: "hidden",
          }}
          bodyStyle={{
            padding: token.paddingMD,
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
