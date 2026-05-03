import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { streamingMessageBus } from "../../utils/streamingMessageBus";
import type { RenderableEntry } from "./useChatViewMessages";
import { useScrollAnchorPersistence } from "./useScrollAnchorPersistence";

const SCROLL_BOTTOM_EPSILON_PX = 2;
const SCROLL_BOTTOM_MAX_FRAMES = 6;

type UseChatViewScrollArgs = {
  currentSessionId: string | null;
  isThinking: boolean;
  messagesListRef: RefObject<HTMLDivElement>;
  renderableMessages: RenderableEntry[];
};

export const useChatViewScroll = ({
  currentSessionId,
  isThinking,
  messagesListRef,
  renderableMessages,
}: UseChatViewScrollArgs) => {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const userHasScrolledUpRef = useRef(false);
  const isFirstLoadRef = useRef(true);

  // Use scroll anchor persistence
  const { handleScroll: handleScrollPersistence } = useScrollAnchorPersistence({
    currentSessionId,
    messagesListRef,
    renderableMessages,
  });

  const handleMessagesScroll = useCallback(
    (e: React.UIEvent<HTMLElement>) => {
      const el = messagesListRef.current;
      if (!el) return;
      // 没有消息时不显示滚动按钮
      if (renderableMessages.length === 0) {
        setShowScrollToBottom(false);
        setShowScrollToTop(false);
        return;
      }
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const scrollTop = el.scrollTop;
      // 使用统一的阈值：距离底部 150px 以内都视为"在底部"
      const bottomThreshold = 150;
      const topThreshold = 150;
      const atBottom = distanceFromBottom < bottomThreshold;
      const atTop = scrollTop < topThreshold;
      setShowScrollToBottom(!atBottom);
      setShowScrollToTop(!atTop && renderableMessages.length > 3);
      // 用户主动向上滚动超过阈值时，标记为已滚动
      if (distanceFromBottom > bottomThreshold * 2) {
        userHasScrolledUpRef.current = true;
      } else if (atBottom) {
        userHasScrolledUpRef.current = false;
      }

      // Save scroll position (pass event to handler)
      handleScrollPersistence(e);
    },
    [messagesListRef, renderableMessages.length, handleScrollPersistence],
  );

  const scrollToBottom = useCallback(() => {
    const el = messagesListRef.current;
    if (!el) return;
    if (renderableMessages.length === 0) return;

    let frame = 0;
    let lastKnownScrollHeight = -1;

    const step = () => {
      const scrollEl = messagesListRef.current;
      if (!scrollEl) return;

      const targetTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
      const distanceFromBottom = Math.max(
        0,
        scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight,
      );
      const heightChanged = scrollEl.scrollHeight !== lastKnownScrollHeight;
      const shouldContinue =
        distanceFromBottom > SCROLL_BOTTOM_EPSILON_PX || heightChanged || frame === 0;

      if (shouldContinue) {
        scrollEl.scrollTo({
          top: targetTop,
          behavior: frame === 0 ? "smooth" : "auto",
        });
      }

      lastKnownScrollHeight = scrollEl.scrollHeight;
      frame += 1;

      if (frame < SCROLL_BOTTOM_MAX_FRAMES && shouldContinue) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  }, [messagesListRef, renderableMessages.length]);

  const scrollToTop = useCallback(() => {
    const el = messagesListRef.current;
    if (!el) return;

    let frame = 0;

    const step = () => {
      const scrollEl = messagesListRef.current;
      if (!scrollEl) return;

      const shouldContinue = scrollEl.scrollTop > SCROLL_BOTTOM_EPSILON_PX || frame === 0;
      if (shouldContinue) {
        scrollEl.scrollTo({ top: 0, behavior: "auto" });
      }

      frame += 1;
      if (frame < SCROLL_BOTTOM_MAX_FRAMES && shouldContinue) {
        requestAnimationFrame(step);
      }
    };

    requestAnimationFrame(step);
  }, [messagesListRef]);

  const resetUserScroll = useCallback(() => {
    userHasScrolledUpRef.current = false;
  }, []);

  useEffect(() => {
    const handleMessageNavigation = (event: Event) => {
      const customEvent = event as CustomEvent<{ messageId: string }>;
      const messageId = customEvent.detail?.messageId;

      if (!messageId) {
        console.error("No messageId provided for navigation");
        return;
      }

      const targetIndex = renderableMessages.findIndex((item) => {
        if ("message" in item && item.message) {
          return item.message.id === messageId;
        }
        if ("id" in item) {
          return item.id === messageId;
        }
        return false;
      });

      if (targetIndex === -1) {
        console.warn("Message not found for navigation:", messageId);
        return;
      }

      const targetEntry = renderableMessages[targetIndex];
      const targetElementId =
        targetEntry && "message" in targetEntry
          ? targetEntry.message.id
          : targetEntry && "id" in targetEntry
            ? targetEntry.id
            : messageId;

      const messageElement = document.getElementById(`message-${targetElementId}`);
      const entryElements = Array.from(
        messagesListRef.current?.querySelectorAll<HTMLElement>("[data-chat-entry-id]") || [],
      );
      const targetElement =
        messageElement ||
        entryElements.find((node) => node.dataset.chatEntryId === targetElementId);

      if (!targetElement) {
        console.warn("Message element not found for navigation:", messageId);
        return;
      }

      targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
      targetElement.classList.add("highlight-message");
      setTimeout(() => {
        targetElement.classList.remove("highlight-message");
      }, 2000);
    };

    window.addEventListener("navigate-to-message", handleMessageNavigation as EventListener);
    return () => {
      window.removeEventListener("navigate-to-message", handleMessageNavigation as EventListener);
    };
  }, [messagesListRef, renderableMessages]);

  const wasThinkingRef = useRef(isThinking);
  useEffect(() => {
    const wasThinking = wasThinkingRef.current;

    if (!wasThinking && isThinking) {
      resetUserScroll();
      scrollToBottom();
    }

    wasThinkingRef.current = isThinking;
  }, [isThinking, resetUserScroll, scrollToBottom]);

  useEffect(() => {
    return streamingMessageBus.subscribe((update) => {
      if (update.sessionId !== currentSessionId) return;
      if (userHasScrolledUpRef.current) return;
      if (!update.content) return;
      scrollToBottom();
    });
  }, [currentSessionId, scrollToBottom]);

  useEffect(() => {
    // Only auto-scroll when streaming, not on initial load
    if (!userHasScrolledUpRef.current && renderableMessages.length > 0 && !isFirstLoadRef.current) {
      scrollToBottom();
    }
    isFirstLoadRef.current = false;
  }, [renderableMessages.length, scrollToBottom]);

  // 当消息数量变化或切换聊天时，主动检查是否应该显示滚动按钮
  // 使用 rAF + 延时确保在滚动锚点恢复和 DOM 布局完成后再检查
  useEffect(() => {
    const el = messagesListRef.current;
    if (!el) {
      setShowScrollToBottom(false);
      setShowScrollToTop(false);
      return;
    }
    if (renderableMessages.length === 0) {
      setShowScrollToBottom(false);
      setShowScrollToTop(false);
      return;
    }

    const checkPosition = () => {
      const scrollEl = messagesListRef.current;
      if (!scrollEl) return;
      const distanceFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
      const scrollTop = scrollEl.scrollTop;
      const bottomThreshold = 150;
      const topThreshold = 150;
      const atBottom = distanceFromBottom < bottomThreshold;
      const atTop = scrollTop < topThreshold;
      setShowScrollToBottom(!atBottom);
      setShowScrollToTop(!atTop && renderableMessages.length > 3);
    };

    // Check immediately
    checkPosition();

    // Re-check after layout settles (scroll anchor restore is async)
    let rafId = requestAnimationFrame(() => {
      checkPosition();
      // One more delayed check for async scroll restores
      rafId = requestAnimationFrame(checkPosition);
    });

    return () => cancelAnimationFrame(rafId);
  }, [messagesListRef, renderableMessages.length, currentSessionId]);

  // Reset first load flag when switching chats
  useEffect(() => {
    isFirstLoadRef.current = true;
    userHasScrolledUpRef.current = false;
  }, [currentSessionId]);

  return {
    handleMessagesScroll,
    resetUserScroll,
    scrollToBottom,
    scrollToTop,
    showScrollToBottom,
    showScrollToTop,
  };
};
