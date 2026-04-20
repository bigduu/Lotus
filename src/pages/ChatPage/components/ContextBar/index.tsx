import React, { useMemo } from "react";
import { Flex, Tag, Tooltip, theme } from "antd";
import {
  CodeOutlined,
  FileOutlined,
  FolderOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { selectSessionById, useAppStore } from "../../store";

import "./index.css";

const { useToken } = theme;

/** Shorten a file system path for display: keep basename or last two segments. */
const shortenPath = (path: string): string => {
  const segments = path.replace(/\/$/, "").split("/").filter(Boolean);
  if (segments.length <= 2) return path;
  return `~/${segments.slice(-2).join("/")}`;
};

export type ContextBarProps = {
  sessionId: string;
};

export const ContextBar: React.FC<ContextBarProps> = ({ sessionId }) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const currentChat = useAppStore(selectSessionById(sessionId));
  const systemPrompts = useAppStore((state) => state.systemPrompts);

  // Derive context info from session and store
  const workspacePath = currentChat?.config.workspacePath;
  const systemPromptId = currentChat?.config.systemPromptId;

  const systemPromptName = useMemo(() => {
    if (!systemPromptId) return null;
    const prompt = systemPrompts.find((p) => p.id === systemPromptId);
    return prompt?.name || systemPromptId;
  }, [systemPromptId, systemPrompts]);

  // Count file reference messages in current session
  const fileRefCount = useMemo(() => {
    if (!currentChat?.messages) return 0;
    return currentChat.messages.filter(
      (msg) => msg.role === "user" && "type" in msg && msg.type === "file_reference",
    ).length;
  }, [currentChat?.messages]);

  // Don't render if session not loaded
  if (!currentChat) return null;

  // Check if there's any meaningful context to show
  // (model & reasoning are already shown in InputContainer's interactive dropdowns)
  const hasContext = workspacePath || systemPromptName || fileRefCount > 0;
  if (!hasContext) return null;

  return (
    <div
      className="lotus-context-bar"
      style={{
        borderBottomColor: token.colorBorderSecondary,
        backgroundColor: token.colorBgContainer,
      }}
    >
      <Flex align="center" gap={6} wrap="wrap" className="lotus-context-bar__content">
        {/* Workspace */}
        {workspacePath && (
          <Tooltip title={workspacePath}>
            <Tag
              className="lotus-context-bar__tag"
              icon={<FolderOutlined />}
              bordered={false}
            >
              {shortenPath(workspacePath)}
            </Tag>
          </Tooltip>
        )}

        {/* File references */}
        {fileRefCount > 0 && (
          <Tooltip
            title={t("chat.contextBar.fileRefsTooltip", {
              count: fileRefCount,
              defaultValue: "{{count}} file reference(s) in this session",
            })}
          >
            <Tag
              className="lotus-context-bar__tag"
              icon={<FileOutlined />}
              bordered={false}
            >
              {fileRefCount} {t("chat.contextBar.files", "files")}
            </Tag>
          </Tooltip>
        )}

        {/* System prompt */}
        {systemPromptName && (
          <Tooltip
            title={t("chat.contextBar.promptTooltip", {
              name: systemPromptName,
              defaultValue: "System prompt: {{name}}",
            })}
          >
            <Tag
              className="lotus-context-bar__tag"
              icon={<CodeOutlined />}
              bordered={false}
            >
              {systemPromptName}
            </Tag>
          </Tooltip>
        )}
      </Flex>
    </div>
  );
};

export default ContextBar;
