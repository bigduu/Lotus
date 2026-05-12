import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { streamingMessageBus } from "../../utils/streamingMessageBus";
import type { RenderableEntry } from "./useChatViewMessages";
import { useScrollAnchorPersistence } from "./useScrollAnchorPersistence";

const SCROLL_BOTTOM_EPSILON_PX = 2;
const SCROLL_BOTTOM_MAX_FRAMES = 6;
const SCROLL_POSITION_THRESHOLD_PX = 150;
const STREAMING_MESSAGE_PREFIX = "streaming-";
const STREAMING_REASONING_MESSAGE_PREFIX = "streaming-reasoning-";
const STREAMING_STATUS_MESSAGE_PREFIX = "streaming-status-";
const STREAMING_SCROLL_MIN_INTERVAL_MS = 100;

type UseChatViewScrollArgs = {
  currentSessionId: string | null;
  isThinking: boolean;
  messagesListRef: RefObject<HTMLDivElement>;
  bottomAnchorRef: RefObject<HTMLDivElement>;
  renderableMessages: RenderableEntry[];
};

type ScrollToBottomOptions = {
  behavior?: ScrollBehavior;
};

type ScrollIndicatorState = {
  atBottom: boolean;
  distanceFromBottom: number;
};

const isPrimaryStreamingMessageId = (messageId: string): boolean => {
  return (
    messageId.startsWith(STREAMING_MESSAGE_PREFIX) &&
    !messageId.startsWith(STREAMING_REASONING_MESSAGE_PREFIX) &&
    !messageId.startsWith(STREAMING_STATUS_MESSAGE_PREFIX)
  );
};

export const useChatViewScroll = ({
  currentSessionId,
  isThinking,
  messagesListRef,
  bottomAnchorRef,
  renderableMessages,
}: UseChatViewScrollArgs) => {
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const [hasUnreadActivity, setHasUnreadActivity] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const userHasScrolledUpRef = useRef(false);
  const stickToBottomRef = useRef(false);
  const isFirstLoadRef = useRef(true);
  const previousRenderableCountRef = useRef(renderableMessages.length);
  const countedStreamingUnreadIdsRef = useRef<Set<string>>(new Set());
  const scrollAnimationIdRef = useRef(0);

  // Use scroll anchor persistence
  const { handleScroll: handleScrollPersistence } = useScrollAnchorPersistence({
    currentSessionId,
    messagesListRef,
    renderableMessages,
  });

  const clearUnreadState = useCallback(() => {
    countedStreamingUnreadIdsRef.current.clear();
    setHasUnreadActivity(false);
    setUnreadCount(0);
  }, []);

  const consumePendingStreamingUnread = useCallback((newEntriesCount: number): number => {
    if (newEntriesCount <= 0) return 0;

    const pendingIds = countedStreamingUnreadIdsRef.current;
    if (pendingIds.size === 0) return newEntriesCount;

    let remaining = newEntriesCount;
    for (const messageId of Array.from(pendingIds)) {
      if (remaining <= 0) break;
      pendingIds.delete(messageId);
      remaining -= 1;
    }

    return remaining;
  }, []);

  const refreshScrollIndicators = useCallback((): ScrollIndicatorState | null => {
    const el = messagesListRef.current;
    if (!el || renderableMessages.length === 0) {
      setShowScrollToBottom(false);
      setShowScrollToTop(false);
      clearUnreadState();
      return null;
    }

    const distanceFromBottom = Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
    const atBottom = distanceFromBottom <= SCROLL_POSITION_THRESHOLD_PX;
    const atTop = el.scrollTop <= SCROLL_POSITION_THRESHOLD_PX;

    setShowScrollToBottom(!atBottom);
    setShowScrollToTop(!atTop && renderableMessages.length > 3);

    if (atBottom) {
      stickToBottomRef.current = true;
      clearUnreadState();
    }

    return {
      atBottom,
      distanceFromBottom,
    };
  }, [clearUnreadState, messagesListRef, renderableMessages.length]);

  const handleMessagesScroll = useCallback(
    (e: React.UIEvent<HTMLElement>) => {
      const indicatorState = refreshScrollIndicators();
      if (!indicatorState) return;

      if (indicatorState.distanceFromBottom > SCROLL_POSITION_THRESHOLD_PX) {
        userHasScrolledUpRef.current = true;
        stickToBottomRef.current = false;
      } else if (indicatorState.atBottom) {
        userHasScrolledUpRef.current = false;
        stickToBottomRef.current = true;
        clearUnreadState();
      }

      // Save scroll position (pass event to handler)
      handleScrollPersistence(e);
    },
    [clearUnreadState, refreshScrollIndicators, handleScrollPersistence],
  );

  const scrollToBottom = useCallback(
    (options?: ScrollToBottomOptions) => {
      cancelAnimationFrame(scrollAnimationIdRef.current);

      const el = messagesListRef.current;
      const anchorEl = bottomAnchorRef.current;
      if (!el || !anchorEl) return;
      if (renderableMessages.length === 0) return;

      const initialBehavior = options?.behavior ?? "smooth";
      let frame = 0;
      let lastAnchorTop = Number.NaN;

      const finishScroll = () => {
        scrollAnimationIdRef.current = 0;
        userHasScrolledUpRef.current = false;
        stickToBottomRef.current = true;
        clearUnreadState();
        refreshScrollIndicators();
      };

      const step = () => {
        const scrollEl = messagesListRef.current;
        const currentAnchorEl = bottomAnchorRef.current;
        if (!scrollEl || !currentAnchorEl) return;

        const distanceFromBottom = Math.max(
          0,
          scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight,
        );
        const anchorRect = currentAnchorEl.getBoundingClientRect();
        const containerRect = scrollEl.getBoundingClientRect();
        const anchorTop = anchorRect.top - containerRect.top;
        const anchorMoved =
          !Number.isFinite(lastAnchorTop) || Math.abs(anchorTop - lastAnchorTop) > 0.5;
        const shouldContinue =
          distanceFromBottom > SCROLL_BOTTOM_EPSILON_PX || anchorMoved || frame === 0;

        if (shouldContinue) {
          currentAnchorEl.scrollIntoView({
            block: "end",
            behavior: frame === 0 ? initialBehavior : "auto",
          });
        }

        lastAnchorTop = anchorTop;
        frame += 1;

        if (frame < SCROLL_BOTTOM_MAX_FRAMES && shouldContinue) {
          scrollAnimationIdRef.current = requestAnimationFrame(step);
          return;
        }

        finishScroll();
      };

      scrollAnimationIdRef.current = requestAnimationFrame(step);
    },
    [
      bottomAnchorRef,
      clearUnreadState,
      messagesListRef,
      refreshScrollIndicators,
      renderableMessages.length,
    ],
  );

  const scrollToTop = useCallback(() => {
    const el = messagesListRef.current;
    if (!el) return;

    let frame = 0;

    const finishScroll = () => {
      refreshScrollIndicators();
    };

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
        return;
      }

      finishScroll();
    };

    requestAnimationFrame(step);
  }, [messagesListRef, refreshScrollIndicators]);

  const resetUserScroll = useCallback(() => {
    userHasScrolledUpRef.current = false;
    stickToBottomRef.current = true;
    clearUnreadState();
  }, [clearUnreadState]);

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
    let lastStreamingScrollAt = 0;
    let pendingScrollRaf: number | null = null;

    const unsubscribe = streamingMessageBus.subscribe((update) => {
      if (update.sessionId !== currentSessionId) return;

      if (userHasScrolledUpRef.current) {
        const normalizedContent = update.content?.trim() ?? "";
        if (normalizedContent && isPrimaryStreamingMessageId(update.messageId)) {
          if (!countedStreamingUnreadIdsRef.current.has(update.messageId)) {
            countedStreamingUnreadIdsRef.current.add(update.messageId);
            setUnreadCount((current) => current + 1);
          }
          setHasUnreadActivity(true);
        }
        refreshScrollIndicators();
        return;
      }

      if (!update.content) {
        refreshScrollIndicators();
        return;
      }

      const now = performance.now();
      if (now - lastStreamingScrollAt >= STREAMING_SCROLL_MIN_INTERVAL_MS) {
        lastStreamingScrollAt = now;
        if (pendingScrollRaf !== null) {
          cancelAnimationFrame(pendingScrollRaf);
          pendingScrollRaf = null;
        }
        scrollToBottom();
      } else if (pendingScrollRaf === null) {
        pendingScrollRaf = requestAnimationFrame(() => {
          pendingScrollRaf = null;
          lastStreamingScrollAt = performance.now();
          scrollToBottom();
        });
      }

      return () => {
        unsubscribe();
        if (pendingScrollRaf !== null) {
          cancelAnimationFrame(pendingScrollRaf);
        }
      };
    });
  }, [currentSessionId, refreshScrollIndicators, scrollToBottom]);

  useEffect(() => {
    const currentCount = renderableMessages.length;
    const previousCount = previousRenderableCountRef.current;
    const hasNewEntries = currentCount > previousCount;

    if (currentCount === 0) {
      clearUnreadState();
      refreshScrollIndicators();
      previousRenderableCountRef.current = currentCount;
      return;
    }

    if (isFirstLoadRef.current) {
      refreshScrollIndicators();
      isFirstLoadRef.current = false;
      previousRenderableCountRef.current = currentCount;
      return;
    }

    if (hasNewEntries && userHasScrolledUpRef.current) {
      const unreadDelta = consumePendingStreamingUnread(currentCount - previousCount);
      setHasUnreadActivity(true);
      if (unreadDelta > 0) {
        setUnreadCount((current) => current + unreadDelta);
      }
    }

    if (!userHasScrolledUpRef.current && hasNewEntries) {
      scrollToBottom();
    } else {
      refreshScrollIndicators();
    }

    previousRenderableCountRef.current = currentCount;
  }, [
    clearUnreadState,
    consumePendingStreamingUnread,
    refreshScrollIndicators,
    renderableMessages.length,
    scrollToBottom,
  ]);

  useEffect(() => {
    const el = messagesListRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    let rafId = 0;
    let didObserveResize = false;
    const scheduleRefresh = () => {
      cancelAnimationFrame(rafId);
      const shouldStickToBottom = stickToBottomRef.current;

      rafId = requestAnimationFrame(() => {
        if (didObserveResize && shouldStickToBottom && !userHasScrolledUpRef.current) {
          scrollToBottom({ behavior: "auto" });
          return;
        }
        refreshScrollIndicators();
      });
    };

    const observer = new ResizeObserver(() => {
      didObserveResize = true;
      scheduleRefresh();
    });

    observer.observe(el);

    const contentEl = el.firstElementChild;
    if (contentEl instanceof HTMLElement) {
      observer.observe(contentEl);
    }

    const anchorEl = bottomAnchorRef.current;
    if (anchorEl instanceof HTMLElement) {
      observer.observe(anchorEl);
    }

    scheduleRefresh();

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [
    bottomAnchorRef,
    currentSessionId,
    messagesListRef,
    refreshScrollIndicators,
    renderableMessages.length,
    scrollToBottom,
  ]);

  // 当消息数量变化或切换聊天时，主动检查是否应该显示滚动按钮
  // 使用 rAF + 延时确保在滚动锚点恢复和 DOM 布局完成后再检查
  useEffect(() => {
    const el = messagesListRef.current;
    if (!el || renderableMessages.length === 0) {
      refreshScrollIndicators();
      return;
    }

    refreshScrollIndicators();

    let nestedRafId = 0;
    const rafId = requestAnimationFrame(() => {
      refreshScrollIndicators();
      nestedRafId = requestAnimationFrame(() => {
        refreshScrollIndicators();
      });
    });

    return () => {
      cancelAnimationFrame(rafId);
      cancelAnimationFrame(nestedRafId);
    };
  }, [messagesListRef, renderableMessages.length, currentSessionId, refreshScrollIndicators]);

  // Reset first load flag when switching chats
  useEffect(() => {
    isFirstLoadRef.current = true;
    userHasScrolledUpRef.current = false;
    stickToBottomRef.current = false;
    previousRenderableCountRef.current = 0;
    clearUnreadState();
  }, [clearUnreadState, currentSessionId]);

  return {
    handleMessagesScroll,
    hasUnreadActivity,
    resetUserScroll,
    scrollToBottom,
    scrollToTop,
    showScrollToBottom,
    showScrollToTop,
    unreadCount,
  };
};
