import React, { useCallback, useEffect, useRef, useState } from "react";
import { Checkbox, Flex, Layout, Tag, Typography } from "antd";
import { InboxOutlined } from "@ant-design/icons";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslation } from "react-i18next";

import SystemMessageCard from "../SystemMessageCard";
import MessageCard from "../MessageCard";
import StreamingMessageCard from "../StreamingMessageCard";
import ToolSessionCard from "../ToolSessionCard";
import type { RenderableEntry, ConvertedEntry } from "./useChatViewMessages";
import type { ChatItem } from "@shared/types/chat";

const { Content } = Layout;
const { Text } = Typography;

const DEFAULT_ENTRY_ESTIMATE_PX = 120;
// Must match the `messageSlideIn` duration in styles.css (#170).
const ENTRANCE_ANIMATION_MS = 300;
const USER_MESSAGE_ESTIMATE_PX = 140;
const ASSISTANT_MESSAGE_ESTIMATE_PX = 220;
const SYSTEM_MESSAGE_ESTIMATE_PX = 140;
const COMPRESSION_DIVIDER_ESTIMATE_PX = 72;
const COLLAPSED_TOOL_SESSION_ESTIMATE_PX = 68;
const TOOL_STEP_ESTIMATE_PX = 84;
const MAX_TOOL_SESSION_ESTIMATE_PX = 720;

const getCompressionTimeLabel = (createdAt: string): string => {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) {
    return createdAt;
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
  bottomAnchorRef: React.RefObject<HTMLDivElement>;
  renderableMessages: RenderableEntry[];
  rowGap: number;
  showMessagesView: boolean;
  screens: { xs?: boolean };
  workflowDraftId?: string;
  isThinking: boolean;
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

// eslint-disable-next-line react-refresh/only-export-components -- utility used by virtualizer options
export function estimateChatEntrySize(entries: readonly RenderableEntry[], index: number): number {
  const entry = entries[index];
  if (!entry) return DEFAULT_ENTRY_ESTIMATE_PX;

  if ("type" in entry) {
    if (entry.type === "compression_divider") {
      return COMPRESSION_DIVIDER_ESTIMATE_PX;
    }

    if (entry.type === "tool_session") {
      const isLastEntry = index === entries.length - 1;
      if (!isLastEntry) {
        return COLLAPSED_TOOL_SESSION_ESTIMATE_PX;
      }

      const estimatedExpandedHeight =
        COLLAPSED_TOOL_SESSION_ESTIMATE_PX +
        Math.min(entry.tools.length, 8) * TOOL_STEP_ESTIMATE_PX;
      return Math.min(MAX_TOOL_SESSION_ESTIMATE_PX, estimatedExpandedHeight);
    }
  }

  const message = "message" in entry ? entry.message : undefined;
  if (!message) return DEFAULT_ENTRY_ESTIMATE_PX;
  if (message.role === "system") return SYSTEM_MESSAGE_ESTIMATE_PX;
  if (message.role === "user") return USER_MESSAGE_ESTIMATE_PX;
  return ASSISTANT_MESSAGE_ESTIMATE_PX;
}

// eslint-disable-next-line react-refresh/only-export-components -- utility used by virtualizer options
export function getVirtualizationWeight(entries: readonly RenderableEntry[]): number {
  return entries.reduce((total, entry) => {
    if ("type" in entry) {
      if (entry.type === "tool_session") {
        return total + Math.max(4, entry.tools.length * 2);
      }

      if (entry.type === "compression_divider") {
        return total + 1;
      }
    }

    return total + 1;
  }, 0);
}

const ChatMessagesListComponent: React.FC<ChatMessagesListProps> = ({
  currentChat,
  currentSessionId,
  convertRenderableEntry,
  handleDeleteMessage,
  handleDeleteToolMessages,
  handleMessagesScroll,
  hasSystemPrompt,
  messagesListRef,
  bottomAnchorRef,
  renderableMessages,
  rowGap,
  showMessagesView,
  screens,
  workflowDraftId,
  isThinking,
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

  // Entrance animations (#170): the virtualizer unmounts rows outside the
  // overscan, and class-based CSS animations replay on every remount —
  // making old messages "slide in" again on each scroll. Each entry gets
  // the animation class only until its first animation completes; after
  // that the key is recorded in `animatedEntryKeysRef` and later mounts
  // (scroll out/in) render without it.
  const animatedEntryKeysRef = useRef<Set<string>>(new Set());
  const animatedSessionRef = useRef<string | null>(null);
  if (animatedSessionRef.current !== currentSessionId) {
    animatedSessionRef.current = currentSessionId ?? null;
    animatedEntryKeysRef.current = new Set();
  }
  // Bumping this re-renders rows once their animation window has elapsed,
  // stripping the class after it has played.
  const [animationTick, setAnimationTick] = useState(0);

  const getItemKey = useCallback(
    (index: number) => {
      const entry = messagesRef.current[index];
      return entry ? entryKey(entry) : String(index);
    },
    [], // messagesRef is stable
  );

  const estimateSize = useCallback(
    (index: number) => estimateChatEntrySize(messagesRef.current, index),
    [],
  );

  const virtualizer = useVirtualizer({
    count: renderableMessages.length,
    getScrollElement: () => messagesListRef.current,
    estimateSize,
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

  const renderEntry = (entry: RenderableEntry, indexInList?: number) => {
    const convertedEntry = convertRenderableEntry(entry);
    const isLastEntry = indexInList === undefined || indexInList === renderableMessages.length - 1;

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
                {t("chat.compression.tag")}
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
              defaultExpanded={isLastEntry}
              autoCollapseWhenStale={!isLastEntry}
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
            // Same value ConversationPane already computed via
            // `selectIsBusy(sessionId)` for `isThinking` — reused here instead
            // of letting every card open its own store subscription (#18).
            isProcessing={isThinking}
          />
        </div>
        {convertedEntry.align === "flex-end" &&
          renderMessageSelectionCheckbox(convertedEntry.message.id, convertedEntry.align)}
      </Flex>
    );
  };

  const hasMessages = (showMessagesView || hasSystemPrompt) && renderableMessages.length > 0;
  const virtualItems = virtualizer.getVirtualItems();
  // Stable signature of the currently visible entry keys — lets the
  // animation-marking effect above re-run when scrolling reveals new rows.
  const visibleKeysSignature = virtualItems
    .map((item) => {
      const entry = messagesRef.current[item.index];
      return entry ? entryKey(entry) : "";
    })
    .join(" ");

  // Mark currently-rendered entries as animated once their animation
  // window has elapsed (#170) — see the comment above animatedEntryKeysRef.
  useEffect(() => {
    const pending: string[] = [];
    for (const item of virtualizer.getVirtualItems()) {
      const entry = messagesRef.current[item.index];
      if (entry) {
        const key = entryKey(entry);
        if (!animatedEntryKeysRef.current.has(key)) {
          pending.push(key);
        }
      }
    }
    if (pending.length === 0) return;
    const timer = setTimeout(() => {
      for (const key of pending) {
        animatedEntryKeysRef.current.add(key);
      }
      setAnimationTick((tick: number) => tick + 1);
    }, ENTRANCE_ANIMATION_MS + 100);
    return () => clearTimeout(timer);
    // visibleKeysSignature covers rows revealed by scrolling (#170):
    // `renderableMessages` identity doesn't change on scroll, so without
    // the visible-set dependency a row first mounted by scrolling would
    // never be marked and would replay the animation on every revisit.
  }, [renderableMessages, visibleKeysSignature, animationTick, virtualizer]);

  return (
    <Content
      role="log"
      aria-live="polite"
      aria-label={t("chat.view.chatMessagesAria")}
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: rowGap,
          width: "100%",
          minHeight: "100%",
        }}
      >
        {hasMessages && (
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
              const shouldAnimate = !animatedEntryKeysRef.current.has(key);

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
                  <div className={shouldAnimate ? "messageEnter" : undefined}>
                    {renderEntry(entry, virtualItem.index)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {isThinking && currentSessionId && (
          <div className="streaming-card-enter">
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
        <div
          ref={bottomAnchorRef}
          data-chat-bottom-anchor="true"
          aria-hidden="true"
          style={{ width: "100%", height: 1, flexShrink: 0 }}
        />
      </div>
    </Content>
  );
};

/**
 * Memoized so it skips re-renders driven by parent state it does not consume
 * (scroll indicators, unread counts, hover, token-usage ticks). All props from
 * ConversationPane are referentially stable (useCallback/useMemo/refs); the one
 * exception, `screens`, is stabilized at the call site. Default shallow compare
 * is intentional — a custom comparator that missed a prop would render stale UI.
 */
export const ChatMessagesList = React.memo(ChatMessagesListComponent);
