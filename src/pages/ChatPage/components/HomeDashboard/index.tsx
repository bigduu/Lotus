import React, { useCallback, useMemo } from "react";
import { Tag, theme } from "antd";
import {
  ClockCircleOutlined,
  DashboardOutlined,
  FolderOutlined,
  MessageOutlined,
  PushpinOutlined,
  RightOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { useAppStore } from "../../store";
import type { ChatItem } from "../../types/chatMessages";
import EmptyTaskLauncher from "../EmptyTaskLauncher";

import "./index.css";

/* ── helpers ──────────────────────────────── */

const MAX_RECENT = 5;
const MAX_RUNNING = 5;
const MAX_PINNED = 5;

const formatRelativeTime = (dateStr: string | undefined): string => {
  if (!dateStr) return "";
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 0) return "";
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return "";
  }
};

const getSessionStatusClass = (chat: ChatItem): string => {
  if (chat.isRunning) return "is-running";
  if (chat.lastRunStatus === "error") return "is-error";
  if (chat.pinned) return "is-pinned";
  return "is-idle";
};

/* ── session row ──────────────────────────── */

const SessionRow: React.FC<{
  chat: ChatItem;
  onOpen: (id: string) => void;
  textSecondary: string;
}> = ({ chat, onOpen, textSecondary }) => {
  const workspace = chat.config.workspacePath
    ? chat.config.workspacePath.split("/").pop() || chat.config.workspacePath
    : null;

  return (
    <button type="button" className="lotus-home-session-item" onClick={() => onOpen(chat.id)}>
      <span className={`lotus-home-session-status ${getSessionStatusClass(chat)}`} />
      <span className="lotus-home-session-content">
        <span className="lotus-home-session-title">{chat.title}</span>
        <span className="lotus-home-session-meta" style={{ color: textSecondary }}>
          <span>{formatRelativeTime(chat.updatedAt)}</span>
          {workspace ? (
            <>
              <span className="lotus-home-session-meta-sep" />
              <span>
                <FolderOutlined style={{ marginRight: 3 }} />
                {workspace}
              </span>
            </>
          ) : null}
          {chat.messageCount != null ? (
            <>
              <span className="lotus-home-session-meta-sep" />
              <span>
                <MessageOutlined style={{ marginRight: 3 }} />
                {chat.messageCount}
              </span>
            </>
          ) : null}
        </span>
      </span>
      {chat.isRunning ? (
        <Tag color="green" bordered={false} style={{ margin: 0, fontSize: 11 }}>
          Running
        </Tag>
      ) : null}
      <RightOutlined className="lotus-home-session-arrow" />
    </button>
  );
};

/* ── main component ───────────────────────── */

export const HomeDashboard: React.FC<{
  onOpenSession: (sessionId: string) => void;
  onCreateSession: () => Promise<void> | void;
}> = ({ onOpenSession }) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  const chats = useAppStore((s) => s.chats);
  const processingChats = useAppStore((s) => s.processingChats);

  /* derive session lists */
  const runningSessions = useMemo(
    () => chats.filter((c) => c.isRunning || processingChats.has(c.id)).slice(0, MAX_RUNNING),
    [chats, processingChats],
  );

  const pinnedSessions = useMemo(
    () => chats.filter((c) => c.pinned && !c.isRunning).slice(0, MAX_PINNED),
    [chats],
  );

  const recentSessions = useMemo(() => {
    const runningIds = new Set(runningSessions.map((c) => c.id));
    const pinnedIds = new Set(pinnedSessions.map((c) => c.id));
    return chats
      .filter((c) => c.kind !== "child" && !runningIds.has(c.id) && !pinnedIds.has(c.id))
      .sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : a.createdAt;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : b.createdAt;
        return bTime - aTime;
      })
      .slice(0, MAX_RECENT);
  }, [chats, runningSessions, pinnedSessions]);

  const handleOpen = useCallback(
    (id: string) => {
      onOpenSession(id);
    },
    [onOpenSession],
  );

  return (
    <div className="lotus-home-dashboard">
      <div className="lotus-home-dashboard-inner">
        {/* ── Header ──────────────────── */}
        <div className="lotus-home-header">
          <span
            className="lotus-home-header-icon"
            style={{
              background: `${token.colorPrimary}15`,
              color: token.colorPrimary,
            }}
          >
            <DashboardOutlined />
          </span>
          <div className="lotus-home-header-text">
            <h2 style={{ color: token.colorText }}>{t("home.title", "Welcome to Bodhi")}</h2>
            <p style={{ color: token.colorTextSecondary }}>
              {t("home.subtitle", "Here's an overview of your workspace.")}
            </p>
          </div>
        </div>

        <div className="lotus-home-launcher-shell">
          <EmptyTaskLauncher embedded={true} layoutMode="staggered" />
        </div>

        <div className="lotus-home-secondary-sections">
          {runningSessions.length > 0 ? (
            <div className="lotus-home-section">
              <div className="lotus-home-section-title" style={{ color: token.colorTextSecondary }}>
                <ThunderboltOutlined
                  className="lotus-home-section-icon"
                  style={{ color: "#52c41a" }}
                />
                <span>{t("home.sections.running", "Running Now")}</span>
              </div>
              <div className="lotus-home-session-list">
                {runningSessions.map((chat) => (
                  <SessionRow
                    key={chat.id}
                    chat={chat}
                    onOpen={handleOpen}
                    textSecondary={token.colorTextTertiary}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {pinnedSessions.length > 0 ? (
            <div className="lotus-home-section">
              <div className="lotus-home-section-title" style={{ color: token.colorTextSecondary }}>
                <PushpinOutlined className="lotus-home-section-icon" style={{ color: "#faad14" }} />
                <span>{t("home.sections.pinned", "Pinned")}</span>
              </div>
              <div className="lotus-home-session-list">
                {pinnedSessions.map((chat) => (
                  <SessionRow
                    key={chat.id}
                    chat={chat}
                    onOpen={handleOpen}
                    textSecondary={token.colorTextTertiary}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {recentSessions.length > 0 ? (
            <div className="lotus-home-section">
              <div className="lotus-home-section-title" style={{ color: token.colorTextSecondary }}>
                <ClockCircleOutlined className="lotus-home-section-icon" />
                <span>{t("home.sections.recent", "Recent Sessions")}</span>
              </div>
              <div className="lotus-home-session-list">
                {recentSessions.map((chat) => (
                  <SessionRow
                    key={chat.id}
                    chat={chat}
                    onOpen={handleOpen}
                    textSecondary={token.colorTextTertiary}
                  />
                ))}
              </div>
            </div>
          ) : null}

          {chats.length === 0 ? (
            <div className="lotus-home-empty-hint" style={{ color: token.colorTextTertiary }}>
              {t("home.empty", "No sessions yet. Create one to get started!")}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default HomeDashboard;
