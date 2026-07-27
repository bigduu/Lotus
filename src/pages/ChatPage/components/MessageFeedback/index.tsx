import React, { useCallback, useState } from "react";
import { Tag, Tooltip } from "antd";
import { DislikeOutlined, DislikeFilled, LikeOutlined, LikeFilled } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import "./index.css";

/* ── types ────────────────────────────────── */

type FeedbackRating = "like" | "dislike" | null;

interface RetryVariation {
  key: string;
  labelKey: string;
  fallbackLabel: string;
  color: string;
  prefix: string;
}

const RETRY_VARIATIONS: RetryVariation[] = [
  {
    key: "shorter",
    labelKey: "feedback.retry.shorter",
    fallbackLabel: "Shorter",
    color: "blue",
    prefix: "Please give a shorter, more concise answer:",
  },
  {
    key: "deeper",
    labelKey: "feedback.retry.deeper",
    fallbackLabel: "Deeper",
    color: "purple",
    prefix: "Please provide a more detailed, in-depth answer:",
  },
  {
    key: "actionable",
    labelKey: "feedback.retry.actionable",
    fallbackLabel: "More actionable",
    color: "green",
    prefix: "Please make your answer more actionable with specific steps:",
  },
];

/* ── component ────────────────────────────── */

export const MessageFeedback: React.FC<{
  messageId: string;
  isVisible: boolean;
  onRetryWithVariation?: (prefix: string) => void;
}> = ({ messageId, isVisible, onRetryWithVariation }) => {
  const { t } = useTranslation();
  const [rating, setRating] = useState<FeedbackRating>(null);
  const [showRetry, setShowRetry] = useState(false);

  const handleLike = useCallback(() => {
    setRating((prev) => (prev === "like" ? null : "like"));
    setShowRetry(false);
  }, []);

  const handleDislike = useCallback(() => {
    setRating((prev) => {
      const next = prev === "dislike" ? null : "dislike";
      if (next === "dislike") {
        setShowRetry(true);
      } else {
        setShowRetry(false);
      }
      return next;
    });
  }, []);

  const handleRetry = useCallback(
    (variation: RetryVariation) => {
      if (onRetryWithVariation) {
        onRetryWithVariation(variation.prefix);
      }
    },
    [onRetryWithVariation],
  );

  const hasRating = rating !== null;
  const classes = [
    "lotus-msg-feedback",
    isVisible ? "is-visible" : "",
    hasRating ? "has-rating" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-message-id={messageId}>
      {/* Like */}
      <Tooltip title={t("feedback.helpful")}>
        <button
          type="button"
          className={`lotus-msg-feedback-btn ${rating === "like" ? "is-liked" : ""}`}
          onClick={handleLike}
          aria-label={t("feedback.helpful")}
        >
          {rating === "like" ? <LikeFilled /> : <LikeOutlined />}
        </button>
      </Tooltip>

      {/* Dislike */}
      <Tooltip title={t("feedback.notHelpful")}>
        <button
          type="button"
          className={`lotus-msg-feedback-btn ${rating === "dislike" ? "is-disliked" : ""}`}
          onClick={handleDislike}
          aria-label={t("feedback.notHelpful")}
        >
          {rating === "dislike" ? <DislikeFilled /> : <DislikeOutlined />}
        </button>
      </Tooltip>

      {/* Retry variations (shown after dislike) */}
      {showRetry && onRetryWithVariation && (
        <>
          <span className="lotus-msg-feedback-sep" />
          <span className="lotus-msg-feedback-retry">
            {RETRY_VARIATIONS.map((v) => (
              <Tag
                key={v.key}
                color={v.color}
                bordered={false}
                className="lotus-msg-feedback-retry-tag"
                role="button"
                tabIndex={0}
                onClick={() => handleRetry(v)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleRetry(v);
                  }
                }}
              >
                {t(v.labelKey, v.fallbackLabel)}
              </Tag>
            ))}
          </span>
        </>
      )}
    </div>
  );
};

export default MessageFeedback;
