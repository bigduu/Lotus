import React, { useCallback, useRef } from "react";
import { Checkbox, Flex, Layout, Tag } from "antd";
import { Typography } from "@/components/ui/typography";
import { InboxOutlined } from "@ant-design/icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";

import SystemMessageCard from "../SystemMessageCard";
import MessageCard from "../MessageCard";
import StreamingMessageCard from "../StreamingMessageCard";
import ToolSessionCard from "../ToolSessionCard";
import type { RenderableEntry, ConvertedEntry } from "./useChatViewMessages";
import type { ChatItem } from "../../types/chat";

const { Content } = Layout;
const { Text } = Typography;
const VIRTUALIZATION_THRESHOLD = 24;

const getCompressionTimeLabel = (createdAt: string): string => {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return createdAt;
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

type InteractionState = {
  matches: (stateName: "IDLE" | "THINKING" | "AWAITING_APPROVAL") => boolean;
};

type ChatMessagesListProps = {
  currentChat: ChatItem | null;
  currentSessionId: string | null;
  convertRenderableEntry: (entry: RenderableEntry) => ConvertedEntry;
  handleDeleteMessage: (messageId: string) => void | Promise<unknown>;
  handleDeleteToolMessages: (messageIds: string[]) => void | Promise<void>;
  handleMessagesScroll: (e: React.UIEvent<HTMLElement>) => void;
  hasSystemPrompt: boolean;
  messagesListRef: React.RefObject<HTMLDivElement>;
  renderableMessages: RenderableEntry[];
  rowGap: number;
  showMessagesView: boolean;
  screens: { xs?: boolean };
  workflowDraftId?: string;
  interactionState: InteractionState;
  padding: number;
  selectionMode: boolean;
  selectedMessageIds: ReadonlySet<string>;
  selectableMessageIds: ReadonlySet<string>;
  onToggleMessageSelection: (messageId: string) => void;
};

/** Stable key for a renderable entry */
function entryKey(entry: RenderableEntry): string {
  if ("type" in entry && (entry.type === "tool_session" || entry.type === "compression_divider")) {
    return entry.id;
  }
  return (entry as { message: { id: string } }).message.id;
}

export const ChatMessagesList: React.FC<ChatMessagesListProps> = ({
  currentChat,
  currentSessionId,
  convertRenderableEntry,
  handleDeleteMessage,
  handleDeleteToolMessages,
  handleMessagesScroll,
  hasSystemPrompt,
  messagesListRef,
  renderableMessages,
  rowGap,
  showMessagesView,
  screens,
  workflowDraftId,
  interactionState,
  padding,
  selectionMode,
  selectedMessageIds,
  selectableMessageIds,
  onToggleMessageSelection,
}) => {
  const { t } = useTranslation();
  // Keep a ref-stable copy of the latest renderableMessages length
  // so the getItemKey callback doesn't trigger virtualizer resets.
  const messagesRef = useRef(renderableMessages);
  messagesRef.current = renderableMessages;

  const getItemKey = useCallback(
    (index: number) => {
      const entry = messagesRef.current[index];
      return entry ? entryKey(entry) : String(index);
    },
    [], // messagesRef is stable
  );

  const virtualizer = useVirtualizer({
    count: renderableMessages.length,
    getScrollElement: () => messagesListRef.current,
    estimateSize: () => 120,
    overscan: 5,
    gap: rowGap,
    getItemKey,
  });

  const renderMessageSelectionCheckbox = (messageId: string, align: "flex-start" | "flex-end") => {
    if (!selectionMode) return null;

    const isSelectable = selectableMessageIds.has(messageId);
    return (
      <Checkbox
        checked={selectedMessageIds.has(messageId)}
        disabled={!isSelectable}
        onChange={() => {
          if (isSelectable) {
            onToggleMessageSelection(messageId);
          }
        }}
        style={{
          marginTop: 8,
          marginLeft: align === "flex-end" ? 8 : 0,
          marginRight: align === "flex-start" ? 8 : 0,
        }}
      />
    );
  };

  const renderEntry = (entry: RenderableEntry) => {
    const convertedEntry = convertRenderableEntry(entry);

    if (convertedEntry.type === "compression_divider") {
      const timeLabel = getCompressionTimeLabel(convertedEntry.createdAt);
      return (
        <div
          role="note"
          aria-label={t("chat.compression.timelineAria", {
            detail: convertedEntry.label,
            time: timeLabel,
            defaultValue: "{{detail}} at {{time}}",
          })}
          style={{
            margin: "6px 0 10px 0",
            borderRadius: 10,
            border: "1px solid rgba(250, 173, 20, 0.45)",
            background: "rgba(250, 173, 20, 0.12)",
            padding: screens.xs ? "8px 10px" : "10px 12px",
          }}
        >
          <Flex align="center" justify="space-between" gap={8} wrap>
            <Flex align="center" gap={8} wrap>
              <Tag color="gold" icon={<InboxOutlined />}>
                {t("chat.compression.tag", "Context compressed")}
              </Tag>
              <Text strong style={{ fontSize: 12 }}>
                {convertedEntry.label}
              </Text>
            </Flex>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {timeLabel}
            </Text>
          </Flex>
        </div>
      );
    }

    if (convertedEntry.type === "tool_session") {
      return (
        <Flex justify="flex-start" style={{ width: "100%", maxWidth: "100%" }}>
          <div
            id={`message-${convertedEntry.id}`}
            style={{
              width: "100%",
              maxWidth: screens.xs ? "100%" : "90%",
            }}
          >
            <ToolSessionCard
              tools={convertedEntry.tools}
              sessionId={convertedEntry.sessionId}
              createdAt={convertedEntry.createdAt}
              defaultExpanded={false}
              onDeleteMessageIds={currentSessionId ? handleDeleteToolMessages : undefined}
            />
          </div>
        </Flex>
      );
    }

    if (convertedEntry.message.role === "system") {
      return (
        <Flex align="flex-start" style={{ width: "100%", maxWidth: "100%" }}>
          {renderMessageSelectionCheckbox(convertedEntry.message.id, "flex-start")}
          <div style={{ flex: 1, minWidth: 0 }}>
            <SystemMessageCard currentChat={currentChat} message={convertedEntry.message} />
          </div>
        </Flex>
      );
    }

    return (
      <Flex
        justify={convertedEntry.align}
        align="flex-start"
        style={{ width: "100%", maxWidth: "100%" }}
      >
        {convertedEntry.align === "flex-start" &&
          renderMessageSelectionCheckbox(convertedEntry.message.id, convertedEntry.align)}
        <div
          style={{
            width: convertedEntry.message.role === "user" ? "85%" : "100%",
            maxWidth: screens.xs ? "100%" : "90%",
          }}
        >
          <MessageCard
            sessionId={currentSessionId}
            message={convertedEntry.message}
            messageType={convertedEntry.messageType}
            onDelete={
              convertedEntry.message.id === workflowDraftId ? undefined : handleDeleteMessage
            }
          />
        </div>
        {convertedEntry.align === "flex-end" &&
          renderMessageSelectionCheckbox(convertedEntry.message.id, convertedEntry.align)}
      </Flex>
    );
  };

  const hasMessages = (showMessagesView || hasSystemPrompt) && renderableMessages.length > 0;
  const virtualItems = virtualizer.getVirtualItems();
  const shouldUseVirtualization = renderableMessages.length > VIRTUALIZATION_THRESHOLD;

  return (
    <Content
      role="log"
      aria-live="polite"
      aria-label="Chat messages"
      className={`chat-view-messages-list ${showMessagesView ? "visible" : "hidden"}`}
      style={{
        flex: 1,
        minHeight: 0,
        padding,
        overflowY: "auto",
        opacity: showMessagesView ? 1 : 0,
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
      ref={messagesListRef}
      onScroll={handleMessagesScroll}
    >
      {hasMessages &&
        (shouldUseVirtualization ? (
          <div
            style={{
              position: "relative",
              width: "100%",
              height: virtualizer.getTotalSize(),
            }}
          >
            {virtualItems.map((virtualItem) => {
              const entry = renderableMessages[virtualItem.index];
              if (!entry) return null;

              const key = entryKey(entry);

              return (
                <div
                  key={virtualItem.key}
                  data-chat-entry-id={key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualItem.start}px)`,
                  }}
                >
                  <div className="messageEnter">{renderEntry(entry)}</div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: rowGap,
              width: "100%",
            }}
          >
            {renderableMessages.map((entry) => {
              const key = entryKey(entry);
              return (
                <div key={key} data-chat-entry-id={key} className="messageEnter">
                  {renderEntry(entry)}
                </div>
              );
            })}
          </div>
        ))}
      {interactionState.matches("THINKING") && currentSessionId && (
        <div className="streaming-card-enter" style={{ paddingTop: rowGap }}>
          <Flex justify="flex-start" style={{ width: "100%", maxWidth: "100%" }}>
            <div
              style={{
                width: "100%",
                maxWidth: screens.xs ? "100%" : "90%",
              }}
            >
              <StreamingMessageCard sessionId={currentSessionId} />
            </div>
          </Flex>
        </div>
      )}
    </Content>
  );
};
