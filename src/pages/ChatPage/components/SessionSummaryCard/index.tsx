import React, { useEffect, useMemo, useState } from "react";
import { Tag, theme, Tooltip } from "antd";
import {
  ClockCircleOutlined,
  CodeOutlined,
  DownOutlined,
  FileTextOutlined,
  FunctionOutlined,
  MessageOutlined,
  ProfileOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import InlineMetaText from "@shared/components/InlineMetaText";
import { metricsService, type SessionMetrics } from "@services/metrics";
import { selectSessionById, useAppStore } from "@shared/store/appStore";
import type {
  AssistantTextMessage,
  AssistantToolCallMessage,
  AssistantToolResultMessage,
  Message,
} from "@shared/types/chatMessages";
import { formatCompactTokenCount, formatTokenCount } from "@shared/types/tokenBudget";

import "./index.css";

/* ── types ────────────────────────────────── */

interface SessionStats {
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  fileChanges: string[];
  lastAssistantExcerpt: string;
  hasCompression: boolean;
  compressionCount: number;
  duration: string;
}

const sessionMetricsCache = new Map<string, SessionMetrics | null>();

/* ── helpers ──────────────────────────────── */

const FILE_WRITE_TOOLS = new Set(["Write", "Edit", "apply_patch", "NotebookEdit"]);

const extractFileName = (result: string): string | null => {
  // Look for file_path patterns in tool results
  const match = result.match(/(?:file_path|Wrote file|Edited file)[:\s]*["']?([^\s"',]+)/i);
  if (match) {
    const path = match[1];
    return path.split("/").pop() || path;
  }
  return null;
};

const formatDuration = (startMs: number, endMs: number): string => {
  const diff = endMs - startMs;
  if (diff < 0) return "";
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
};

const computeStats = (messages: ReadonlyArray<Message>): SessionStats => {
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let toolCallCount = 0;
  let toolErrorCount = 0;
  let hasCompression = false;
  let compressionCount = 0;
  let lastAssistantExcerpt = "";
  const fileChangeSet = new Set<string>();

  let firstTimestamp = 0;
  let lastTimestamp = 0;

  for (const msg of messages) {
    const ts = msg.createdAt ? new Date(msg.createdAt).getTime() : 0;
    if (ts > 0 && (firstTimestamp === 0 || ts < firstTimestamp)) firstTimestamp = ts;
    if (ts > lastTimestamp) lastTimestamp = ts;

    if (msg.isCompressed) {
      hasCompression = true;
      compressionCount++;
      continue;
    }

    if (msg.role === "user" && !("type" in msg && msg.type === "file_reference")) {
      userMessageCount++;
    }

    if (msg.role === "assistant") {
      if ("type" in msg && msg.type === "tool_call") {
        toolCallCount += (msg as AssistantToolCallMessage).toolCalls?.length ?? 0;
      }
      if ("type" in msg && msg.type === "tool_result") {
        const toolResult = msg as AssistantToolResultMessage;
        if (toolResult.isError) toolErrorCount++;
        if (FILE_WRITE_TOOLS.has(toolResult.toolName)) {
          const fname = extractFileName(toolResult.result?.result ?? "");
          if (fname) fileChangeSet.add(fname);
        }
      }
      if ("type" in msg && msg.type === "text") {
        assistantMessageCount++;
        const text = (msg as AssistantTextMessage).content || "";
        if (text.length > 0) {
          // Keep last substantive text (skip very short ones)
          if (text.length > 30) {
            lastAssistantExcerpt = text.slice(0, 300);
          }
        }
      }
    }
  }

  return {
    messageCount: messages.length,
    userMessageCount,
    assistantMessageCount,
    toolCallCount,
    toolErrorCount,
    fileChanges: Array.from(fileChangeSet).slice(0, 10),
    lastAssistantExcerpt,
    hasCompression,
    compressionCount,
    duration:
      firstTimestamp > 0 && lastTimestamp > firstTimestamp
        ? formatDuration(firstTimestamp, lastTimestamp)
        : "",
  };
};

/* ── component ────────────────────────────── */

export const SessionSummaryCard: React.FC<{
  sessionId: string;
  compact?: boolean;
}> = ({ sessionId, compact = false }) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [expanded, setExpanded] = useState(false);
  const [sessionMetrics, setSessionMetrics] = useState<SessionMetrics | null | undefined>(() =>
    sessionMetricsCache.get(sessionId),
  );

  const chat = useAppStore(selectSessionById(sessionId));
  const messages = chat?.messages;

  const stats = useMemo(() => {
    if (!messages || messages.length === 0) return null;
    return computeStats(messages);
  }, [messages]);

  useEffect(() => {
    let cancelled = false;

    const cached = sessionMetricsCache.get(sessionId);
    if (cached !== undefined) {
      setSessionMetrics(cached);
      return () => {
        cancelled = true;
      };
    }

    setSessionMetrics(undefined);

    void metricsService.getSessionDetail(sessionId).then(
      (detail) => {
        if (cancelled) return;
        const nextMetrics = detail?.session ?? null;
        sessionMetricsCache.set(sessionId, nextMetrics);
        setSessionMetrics(nextMetrics);
      },
      () => {
        if (cancelled) return;
        sessionMetricsCache.set(sessionId, null);
        setSessionMetrics(null);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Don't render if insufficient data
  if (!stats || stats.messageCount < 3) return null;

  const hasFileChanges = stats.fileChanges.length > 0;
  const hasConclusion = stats.lastAssistantExcerpt.length > 0;
  const compactFileChangesItems = compact && hasFileChanges ? stats.fileChanges : [];
  const lifetimeTokenUsage = sessionMetrics?.total_token_usage;
  const compactLifetimeTokens = lifetimeTokenUsage
    ? formatCompactTokenCount(lifetimeTokenUsage.total_tokens)
    : null;
  const tokenTooltip = lifetimeTokenUsage ? (
    <div style={{ minWidth: 180 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        {t("sessionSummary.totalTokens", "Total tokens")}
      </div>
      <div>
        {t("sessionSummary.promptTokens", "Prompt")}:{" "}
        {formatTokenCount(lifetimeTokenUsage.prompt_tokens)}
      </div>
      <div>
        {t("sessionSummary.completionTokens", "Completion")}:{" "}
        {formatTokenCount(lifetimeTokenUsage.completion_tokens)}
      </div>
      <div>
        {t("sessionSummary.totalTokens", "Total tokens")}:{" "}
        {formatTokenCount(lifetimeTokenUsage.total_tokens)}
      </div>
    </div>
  ) : null;

  return (
    <div
      className={`lotus-session-summary ${compact ? "lotus-session-summary--compact" : ""}`}
      style={{
        borderColor: token.colorBorderSecondary,
        background: `${token.colorBgElevated}`,
      }}
    >
      {/* header - always visible */}
      <div
        className="lotus-session-summary-header"
        onClick={() => setExpanded((prev) => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
        aria-expanded={expanded}
      >
        <span className="lotus-session-summary-header-icon" style={{ color: token.colorPrimary }}>
          <ProfileOutlined />
        </span>
        <span className="lotus-session-summary-header-title" style={{ color: token.colorText }}>
          {t("sessionSummary.title", "Session Summary")}
        </span>

        {/* Mini stats inline when collapsed */}
        {!expanded && (
          <span className="lotus-session-summary-stats">
            <span
              className="lotus-session-summary-stat"
              style={{ color: token.colorTextSecondary }}
            >
              <MessageOutlined className="lotus-session-summary-stat-icon" />
              <span className="lotus-session-summary-stat-value">{stats.messageCount}</span>
            </span>
            {stats.toolCallCount > 0 && (
              <span
                className="lotus-session-summary-stat"
                style={{ color: token.colorTextSecondary }}
              >
                <FunctionOutlined className="lotus-session-summary-stat-icon" />
                <span className="lotus-session-summary-stat-value">{stats.toolCallCount}</span>
              </span>
            )}
            {hasFileChanges && (
              <span
                className="lotus-session-summary-stat"
                style={{ color: token.colorTextSecondary }}
              >
                <FileTextOutlined className="lotus-session-summary-stat-icon" />
                <span className="lotus-session-summary-stat-value">{stats.fileChanges.length}</span>
              </span>
            )}
            {compactLifetimeTokens && (
              <Tooltip title={tokenTooltip}>
                <span
                  className="lotus-session-summary-stat"
                  style={{ color: token.colorTextSecondary }}
                >
                  <CodeOutlined className="lotus-session-summary-stat-icon" />
                  <span className="lotus-session-summary-stat-value">{compactLifetimeTokens}</span>
                </span>
              </Tooltip>
            )}
          </span>
        )}

        <span
          className={`lotus-session-summary-toggle ${expanded ? "is-expanded" : ""}`}
          style={{ color: token.colorTextTertiary }}
        >
          <DownOutlined />
        </span>
      </div>

      {/* body - expanded details */}
      {expanded && (
        <div className="lotus-session-summary-body">
          {/* Detailed stats */}
          <div className="lotus-session-summary-stats">
            <span
              className="lotus-session-summary-stat"
              style={{ color: token.colorTextSecondary }}
            >
              <MessageOutlined className="lotus-session-summary-stat-icon" />
              <span>
                <span className="lotus-session-summary-stat-value">{stats.messageCount}</span>{" "}
                {t("sessionSummary.messages", "messages")}
              </span>
            </span>
            <span
              className="lotus-session-summary-stat"
              style={{ color: token.colorTextSecondary }}
            >
              <span className="lotus-session-summary-stat-icon">👤</span>
              <span>
                <span className="lotus-session-summary-stat-value">{stats.userMessageCount}</span>{" "}
                {t("sessionSummary.userTurns", "user")}
              </span>
            </span>
            <span
              className="lotus-session-summary-stat"
              style={{ color: token.colorTextSecondary }}
            >
              <span className="lotus-session-summary-stat-icon">🤖</span>
              <span>
                <span className="lotus-session-summary-stat-value">
                  {stats.assistantMessageCount}
                </span>{" "}
                {t("sessionSummary.assistantTurns", "assistant")}
              </span>
            </span>
            {stats.toolCallCount > 0 && (
              <span
                className="lotus-session-summary-stat"
                style={{ color: token.colorTextSecondary }}
              >
                <FunctionOutlined className="lotus-session-summary-stat-icon" />
                <span>
                  <span className="lotus-session-summary-stat-value">{stats.toolCallCount}</span>{" "}
                  {t("sessionSummary.toolCalls", "tool calls")}
                </span>
              </span>
            )}
            {stats.toolErrorCount > 0 && (
              <span className="lotus-session-summary-stat" style={{ color: "#ff4d4f" }}>
                <WarningOutlined className="lotus-session-summary-stat-icon" />
                <span>
                  <span className="lotus-session-summary-stat-value">{stats.toolErrorCount}</span>{" "}
                  {t("sessionSummary.errors", "errors")}
                </span>
              </span>
            )}
            {stats.duration && (
              <span
                className="lotus-session-summary-stat"
                style={{ color: token.colorTextSecondary }}
              >
                <ClockCircleOutlined className="lotus-session-summary-stat-icon" />
                <span>{stats.duration}</span>
              </span>
            )}
            {stats.hasCompression && (
              <span
                className="lotus-session-summary-stat"
                style={{ color: token.colorTextSecondary }}
              >
                <CodeOutlined className="lotus-session-summary-stat-icon" />
                <span>
                  <span className="lotus-session-summary-stat-value">{stats.compressionCount}</span>{" "}
                  {t("sessionSummary.compressions", "compressions")}
                </span>
              </span>
            )}
            {compactLifetimeTokens && (
              <Tooltip title={tokenTooltip}>
                <span
                  className="lotus-session-summary-stat"
                  style={{ color: token.colorTextSecondary }}
                >
                  <CodeOutlined className="lotus-session-summary-stat-icon" />
                  <span>
                    <span className="lotus-session-summary-stat-value">
                      {compactLifetimeTokens}
                    </span>{" "}
                    {t("sessionSummary.totalTokens", "total tokens")}
                  </span>
                </span>
              </Tooltip>
            )}
          </div>

          {/* File changes */}
          {hasFileChanges && (
            <div>
              <div
                style={{
                  fontSize: compact ? 10 : 11,
                  fontWeight: 600,
                  color: token.colorTextSecondary,
                  marginBottom: compact ? 2 : 4,
                  textTransform: "uppercase",
                  letterSpacing: 0.3,
                }}
              >
                {t("sessionSummary.filesChanged", "Files Changed")}
              </div>
              {compact ? (
                <InlineMetaText
                  items={compactFileChangesItems}
                  style={{ lineHeight: 1.4, wordBreak: "break-word", whiteSpace: "normal" }}
                />
              ) : (
                <div className="lotus-session-summary-files">
                  {stats.fileChanges.map((fname) => (
                    <Tooltip key={fname} title={fname}>
                      <Tag bordered={false} className="lotus-session-summary-file-tag">
                        <FileTextOutlined style={{ marginRight: 4 }} />
                        {fname}
                      </Tag>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Last conclusion excerpt */}
          {hasConclusion && (
            <div>
              <div
                style={{
                  fontSize: compact ? 10 : 11,
                  fontWeight: 600,
                  color: token.colorTextSecondary,
                  marginBottom: compact ? 2 : 4,
                  textTransform: "uppercase",
                  letterSpacing: 0.3,
                }}
              >
                {t("sessionSummary.lastResponse", "Latest Response")}
              </div>
              <div
                className="lotus-session-summary-conclusion"
                style={{ color: token.colorTextSecondary }}
              >
                {stats.lastAssistantExcerpt}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SessionSummaryCard;
