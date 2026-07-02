import React, { useMemo } from "react";
import { Flex, Tag, Tooltip, theme } from "antd";
import {
  CodeOutlined,
  FileOutlined,
  FolderOutlined,
  InboxOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { formatCompactTokenCount, formatTokenCount } from "@shared/types/tokenBudget";
import { selectSessionById, useAppStore } from "@shared/store/appStore";
import { MachineTag } from "@shared/components/MachineTag";

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

  const workspacePath = currentChat?.config.workspacePath;
  const systemPromptId = currentChat?.config.systemPromptId;
  const tokenUsage = currentChat?.config.tokenUsage;
  const compressionEvents = currentChat?.config.compressionEvents ?? [];
  const placement = currentChat?.placement ?? null;

  const systemPromptName = useMemo(() => {
    if (!systemPromptId) return null;
    const prompt = systemPrompts.find((p) => p.id === systemPromptId);
    return prompt?.name || systemPromptId;
  }, [systemPromptId, systemPrompts]);

  const fileRefCount = useMemo(() => {
    if (!currentChat?.messages) return 0;
    return currentChat.messages.filter(
      (msg) => msg.role === "user" && "type" in msg && msg.type === "file_reference",
    ).length;
  }, [currentChat?.messages]);

  if (!currentChat) return null;

  const summaryTokens = tokenUsage?.summaryTokens ?? 0;
  const compressionCount = compressionEvents.length;
  const promptCachedToolOutputs = tokenUsage?.promptCachedToolOutputs ?? 0;
  const promptCachedToolTokensSaved = tokenUsage?.promptCachedToolTokensSaved ?? 0;
  const hasSummaryContext = summaryTokens > 0 || compressionCount > 0;
  const hasPromptCache = promptCachedToolOutputs > 0 || promptCachedToolTokensSaved > 0;

  const hasContext =
    placement ||
    workspacePath ||
    systemPromptName ||
    fileRefCount > 0 ||
    hasSummaryContext ||
    hasPromptCache;
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
        <MachineTag placement={placement} />

        {workspacePath && (
          <Tooltip
            title={t("chat.contextBar.workspaceTooltip", {
              path: workspacePath,
              defaultValue: "Workspace context: {{path}}",
            })}
          >
            <Tag className="lotus-context-bar__tag" icon={<FolderOutlined />} bordered={false}>
              <span className="lotus-context-bar__tag-label">
                {t("chat.contextBar.workspace", { defaultValue: "Workspace" })}
              </span>
              {shortenPath(workspacePath)}
            </Tag>
          </Tooltip>
        )}

        {fileRefCount > 0 && (
          <Tooltip
            title={t("chat.contextBar.fileRefsTooltip", {
              count: fileRefCount,
              defaultValue: "{{count}} file reference(s) in this session",
            })}
          >
            <Tag className="lotus-context-bar__tag" icon={<FileOutlined />} bordered={false}>
              <span className="lotus-context-bar__tag-label">
                {t("chat.contextBar.files", { defaultValue: "Files" })}
              </span>
              {fileRefCount}
            </Tag>
          </Tooltip>
        )}

        {systemPromptName && (
          <Tooltip
            title={t("chat.contextBar.promptTooltip", {
              name: systemPromptName,
              defaultValue: "System prompt: {{name}}",
            })}
          >
            <Tag className="lotus-context-bar__tag" icon={<CodeOutlined />} bordered={false}>
              <span className="lotus-context-bar__tag-label">
                {t("chat.contextBar.prompt", { defaultValue: "Prompt" })}
              </span>
              {systemPromptName}
            </Tag>
          </Tooltip>
        )}

        {hasSummaryContext && (
          <Tooltip
            title={t("chat.contextBar.summaryTooltip", {
              tokens: formatTokenCount(summaryTokens),
              count: compressionCount,
              defaultValue:
                "Conversation summary contributes {{tokens}} tokens. {{count}} compression event(s) archived older messages.",
            })}
          >
            <Tag
              className="lotus-context-bar__tag lotus-context-bar__tag--signal"
              icon={<InboxOutlined />}
              bordered={false}
              color="gold"
            >
              {t("chat.contextBar.summary", { defaultValue: "Summary" })}
            </Tag>
          </Tooltip>
        )}

        {hasPromptCache && (
          <Tooltip
            title={t("chat.contextBar.promptCacheTooltip", {
              count: promptCachedToolOutputs,
              tokens: formatTokenCount(promptCachedToolTokensSaved),
              defaultValue:
                "{{count}} tool output(s) were compacted into prompt-side cache notes, saving {{tokens}} tokens.",
            })}
          >
            <Tag
              className="lotus-context-bar__tag lotus-context-bar__tag--signal"
              icon={<ThunderboltOutlined />}
              bordered={false}
              color="green"
            >
              <span className="lotus-context-bar__tag-label">
                {t("chat.contextBar.promptCache", { defaultValue: "Prompt cache" })}
              </span>
              {promptCachedToolTokensSaved > 0
                ? formatCompactTokenCount(promptCachedToolTokensSaved)
                : promptCachedToolOutputs}
            </Tag>
          </Tooltip>
        )}
      </Flex>
    </div>
  );
};

export default ContextBar;
