import React from "react";
import { Button } from "antd";

export type ScrollCapsuleProps = {
  visible: boolean;
  showScrollToTop: boolean;
  showScrollToBottom: boolean;
  hasUnreadActivity: boolean;
  unreadCount: number;
  onScrollToTop: () => void;
  onScrollToBottom: () => void;
  onResetUserScroll: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export const ScrollCapsule: React.FC<ScrollCapsuleProps> = ({
  visible,
  showScrollToTop,
  showScrollToBottom,
  hasUnreadActivity,
  unreadCount,
  onScrollToTop,
  onScrollToBottom,
  onResetUserScroll,
  t,
}) => {
  if (!visible || (!showScrollToTop && !showScrollToBottom)) {
    return null;
  }

  return (
    <div className="chat-scroll-capsule-wrapper" data-testid="chat-scroll-capsule-wrapper">
      <div className="chat-scroll-capsule" data-testid="chat-scroll-capsule">
        {showScrollToTop ? (
          <Button
            data-testid="chat-scroll-top-button"
            className="chat-scroll-capsule__button"
            type="text"
            icon={<span aria-hidden="true">↑</span>}
            size="small"
            onClick={onScrollToTop}
          >
            {t("chat.scroll.jumpToTop", { defaultValue: "Jump to top" })}
          </Button>
        ) : null}
        {showScrollToBottom ? (
          <span style={{ display: "inline-flex" }}>
            <span style={{ display: "inline-flex" }}>
              <Button
                data-testid="chat-scroll-bottom-button"
                className={`chat-scroll-capsule__button ${
                  hasUnreadActivity ? "chat-scroll-capsule__button--active" : ""
                }`}
                type={hasUnreadActivity ? "primary" : "text"}
                icon={<span aria-hidden="true">↓</span>}
                size="small"
                onClick={() => {
                  onResetUserScroll();
                  onScrollToBottom();
                }}
              >
                {hasUnreadActivity
                  ? t("chat.scroll.newMessagesWithCount", {
                      count: unreadCount,
                      defaultValue: unreadCount > 0 ? "{{count}} new messages" : "New messages",
                    })
                  : t("chat.scroll.backToLatest", { defaultValue: "Back to latest" })}
              </Button>
            </span>
            {hasUnreadActivity && unreadCount > 0 ? (
              <span className="chat-scroll-capsule__count" data-testid="chat-scroll-unread-count">
                {unreadCount}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default ScrollCapsule;
