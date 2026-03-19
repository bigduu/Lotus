import React from "react";
import { Checkbox, Divider, Flex, Layout } from "antd";

import SystemMessageCard from "../SystemMessageCard";
import MessageCard from "../MessageCard";
import StreamingMessageCard from "../StreamingMessageCard";
import ToolSessionCard from "../ToolSessionCard";
import type { RenderableEntry, ConvertedEntry } from "./useChatViewMessages";
import type { ChatItem } from "../../types/chat";

const { Content } = Layout;

type InteractionState = {
  matches: (stateName: "IDLE" | "THINKING" | "AWAITING_APPROVAL") => boolean;
};

type ChatMessagesListProps = {
  currentChat: ChatItem | null;
  currentSessionId: string | null;
  convertRenderableEntry: (entry: RenderableEntry) => ConvertedEntry;
  handleDeleteMessage: (messageId: string) => void;
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

export const ChatMessagesList: React.FC<ChatMessagesListProps> = ({
  currentChat,
  currentSessionId,
  convertRenderableEntry,
  handleDeleteMessage,
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
  const renderMessageSelectionCheckbox = (
    messageId: string,
    align: "flex-start" | "flex-end",
  ) => {
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

  return (
    <Content
      className={`chat-view-messages-list ${
        showMessagesView ? "visible" : "hidden"
      }`}
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
      {(showMessagesView || hasSystemPrompt) &&
        renderableMessages.length > 0 && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: rowGap,
              width: "100%",
            }}
          >
            {renderableMessages.map((entry) => {
              if (!entry) {
                return null;
              }

              const convertedEntry = convertRenderableEntry(entry);
              const key =
                convertedEntry.type === "tool_session" ||
                convertedEntry.type === "compression_divider"
                  ? convertedEntry.id
                  : convertedEntry.message.id;

              return (
                <div
                  key={key}
                  data-chat-entry-id={key}
                  style={{
                    width: "100%",
                  }}
                >
                  {convertedEntry.type === "compression_divider" ? (
                    <Divider plain style={{ margin: "6px 0 10px 0" }}>
                      {convertedEntry.label}
                    </Divider>
                  ) : convertedEntry.type === "tool_session" ? (
                    <Flex
                      justify="flex-start"
                      style={{ width: "100%", maxWidth: "100%" }}
                    >
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
                        />
                      </div>
                    </Flex>
                  ) : convertedEntry.message.role === "system" ? (
                    <Flex
                      align="flex-start"
                      style={{ width: "100%", maxWidth: "100%" }}
                    >
                      {renderMessageSelectionCheckbox(
                        convertedEntry.message.id,
                        "flex-start",
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <SystemMessageCard
                          currentChat={currentChat}
                          message={convertedEntry.message}
                        />
                      </div>
                    </Flex>
                  ) : (
                    <Flex
                      justify={convertedEntry.align}
                      align="flex-start"
                      style={{ width: "100%", maxWidth: "100%" }}
                    >
                      {convertedEntry.align === "flex-start" &&
                        renderMessageSelectionCheckbox(
                          convertedEntry.message.id,
                          convertedEntry.align,
                        )}
                      <div
                        style={{
                          width:
                            convertedEntry.message.role === "user"
                              ? "85%"
                              : "100%",
                          maxWidth: screens.xs ? "100%" : "90%",
                        }}
                      >
                        <MessageCard
                          sessionId={currentSessionId}
                          message={convertedEntry.message}
                          messageType={convertedEntry.messageType}
                          onDelete={
                            convertedEntry.message.id === workflowDraftId
                              ? undefined
                              : handleDeleteMessage
                          }
                        />
                      </div>
                      {convertedEntry.align === "flex-end" &&
                        renderMessageSelectionCheckbox(
                          convertedEntry.message.id,
                          convertedEntry.align,
                        )}
                    </Flex>
                  )}
                </div>
              );
            })}
          </div>
        )}
      {interactionState.matches("THINKING") && currentSessionId && (
        <div style={{ paddingTop: rowGap }}>
          <Flex
            justify="flex-start"
            style={{ width: "100%", maxWidth: "100%" }}
          >
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
