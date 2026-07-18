import type { GlobalToken } from "antd/es/theme/interface";
import React, { useEffect, useState, memo, useMemo } from "react";
import { Card, Collapse, Flex, Space, Typography, theme } from "antd";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { useTranslation } from "react-i18next";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeSanitize from "rehype-sanitize";
import { useAssistantStreamingState } from "../../streaming/useAssistantStreamingState";
import { streamingMessageBus } from "../../utils/streamingMessageBus";
import { renderCodeBlock } from "@shared/components/Markdown/MarkdownCodeBlock";
import { openExternalLink } from "@shared/utils/openExternalLink";

const { Text } = Typography;
const { useToken } = theme;

const STREAMING_BLOCK_MARGIN_PX = 8;
const STREAMING_INLINE_MARGIN_PX = 4;
const STREAMING_MERMAID_LANGUAGES = new Set([
  "mermaid",
  "graph",
  "flowchart",
  "sequencediagram",
  "classdiagram",
  "statediagram",
  "statediagram-v2",
  "erdiagram",
  "journey",
  "gantt",
  "pie",
  "gitgraph",
  "mindmap",
  "timeline",
  "quadrantchart",
  "requirementdiagram",
  "c4context",
  "c4container",
  "c4component",
  "c4dynamic",
  "c4deployment",
  "sankey",
  "sankey-beta",
  "xychart",
  "xychart-beta",
  "block",
  "block-beta",
  "packet",
  "packet-beta",
  "kanban",
  "architecture",
]);

const renderStreamingMermaidFallback = (codeString: string, token: GlobalToken) => (
  <Card
    size="small"
    styles={{ body: { padding: 0 } }}
    style={{
      position: "relative",
      maxWidth: "100%",
      overflow: "auto",
      marginBottom: STREAMING_BLOCK_MARGIN_PX,
      background: token.colorBgContainer,
      borderColor: token.colorBorder,
    }}
  >
    <pre
      style={{
        margin: 0,
        padding: token.paddingSM,
        background: token.colorBgContainer,
        color: token.colorText,
        borderRadius: token.borderRadiusSM,
        fontSize: token.fontSizeSM,
        overflowX: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      <code style={{ color: token.colorText }}>{codeString}</code>
    </pre>
  </Card>
);

/**
 * 创建流式阶段专用的 Markdown 组件
 * 与完整版的区别：
 * 1. 不渲染 Mermaid 图表（避免流式内容不完整导致的错误）
 * 2. Mermaid 代码块显示为普通代码
 */
const createStreamingMarkdownComponents = (token: GlobalToken): Components => ({
  p: ({ children }) => (
    <Text
      style={{
        marginBottom: STREAMING_BLOCK_MARGIN_PX,
        display: "block",
      }}
    >
      {children}
    </Text>
  ),

  ol: ({ children }) => (
    <ol
      style={{
        marginBottom: STREAMING_BLOCK_MARGIN_PX,
        paddingLeft: 20,
      }}
    >
      {children}
    </ol>
  ),

  ul: ({ children }) => (
    <ul
      style={{
        marginBottom: STREAMING_BLOCK_MARGIN_PX,
        paddingLeft: 20,
      }}
    >
      {children}
    </ul>
  ),

  li: ({ children }) => (
    <li
      style={{
        marginBottom: STREAMING_INLINE_MARGIN_PX,
      }}
    >
      {children}
    </li>
  ),

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- react-markdown component signature
  code({ className, children, inline, ...props }: any) {
    const match = /language-([^\s]+)/i.exec(className || "");
    const language = match ? match[1] : "";
    const isInline = inline ?? (!match && !className);

    const codeString = children ? String(children).replace(/\n$/, "") : "";

    if (isInline) {
      return (
        <Text code className={className} {...props}>
          {children}
        </Text>
      );
    }

    if (!codeString.trim()) {
      return null;
    }

    const normalizedLanguage = language.toLowerCase();

    // 流式阶段：跳过 Mermaid 渲染，显示为普通代码
    if (STREAMING_MERMAID_LANGUAGES.has(normalizedLanguage)) {
      return renderStreamingMermaidFallback(codeString, token);
    }

    // 其他代码块正常渲染（带语法高亮）
    return renderCodeBlock(language, codeString, undefined, undefined);
  },

  pre: ({ children }) => <>{children}</>,

  blockquote: ({ children }) => (
    <Card
      size="small"
      styles={{ body: { padding: "4px 8px" } }}
      style={{
        borderLeft: "3px solid var(--ant-color-primary, #0d9488)",
        background: "var(--ant-color-primary-bg, rgba(13, 148, 136, 0.08))",
        margin: `${STREAMING_INLINE_MARGIN_PX}px 0`,
        color: "var(--ant-color-text-secondary, #64748b)",
        fontStyle: "italic",
      }}
    >
      {children}
    </Card>
  ),

  a: ({ children, href }) => {
    const link = typeof href === "string" ? href.trim() : "";
    if (!link) {
      return <>{children}</>;
    }

    return (
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          event.preventDefault();
          void openExternalLink(link);
        }}
        style={{
          color: "var(--ant-color-link, #0d9488)",
          textDecoration: "underline",
          overflowWrap: "anywhere",
        }}
      >
        {children}
      </a>
    );
  },

  table: ({ children }) => (
    <Card
      size="small"
      styles={{ body: { padding: 0 } }}
      style={{ overflow: "auto", margin: `${STREAMING_BLOCK_MARGIN_PX}px 0` }}
    >
      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          border: `1px solid ${token.colorBorder}`,
        }}
      >
        {children}
      </table>
    </Card>
  ),

  thead: ({ children }) => (
    <thead style={{ backgroundColor: token.colorFillTertiary, color: token.colorText }}>
      {children}
    </thead>
  ),

  tbody: ({ children }) => <tbody>{children}</tbody>,

  tr: ({ children }) => (
    <tr style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}>{children}</tr>
  ),

  th: ({ children }) => (
    <th
      style={{
        padding: "4px 8px",
        textAlign: "left",
        fontWeight: "bold",
        color: token.colorText,
        borderRight: `1px solid ${token.colorBorder}`,
      }}
    >
      {children}
    </th>
  ),

  td: ({ children }) => (
    <td
      style={{
        padding: "4px 8px",
        borderRight: `1px solid ${token.colorBorder}`,
      }}
    >
      {children}
    </td>
  ),

  input: ({ type, checked, disabled }) => {
    if (type === "checkbox") {
      return (
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          style={{
            marginRight: STREAMING_INLINE_MARGIN_PX,
            accentColor: "var(--ant-color-primary, #0d9488)",
          }}
          readOnly
        />
      );
    }
    return <input type={type} checked={checked} disabled={disabled} />;
  },
});

interface StreamingMessageCardProps {
  sessionId: string;
}

const StreamingMessageCard: React.FC<StreamingMessageCardProps> = memo(({ sessionId }) => {
  const { token } = useToken();
  const { t } = useTranslation();
  const statusMessageId = `streaming-status-${sessionId}`;
  const liveAssistantState = useAssistantStreamingState(sessionId);
  const content = liveAssistantState.content;
  const reasoningContent = liveAssistantState.reasoningContent;
  const [statusContent, setStatusContent] = useState<string>(
    () => streamingMessageBus.getLatest(statusMessageId) ?? "",
  );

  useEffect(() => {
    let animationFrameId: number | null = null;
    let latestStatus: string | null = null;

    const unsubscribe = streamingMessageBus.subscribeMessage(statusMessageId, (next) => {
      latestStatus = next;
      if (animationFrameId === null) {
        animationFrameId = requestAnimationFrame(() => {
          setStatusContent(latestStatus ?? "");
          animationFrameId = null;
        });
      }
    });

    return () => {
      unsubscribe();
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [statusMessageId]);

  const pendingStatusText = useMemo(() => {
    const normalizedStatus = statusContent.trim().toLowerCase();
    if (!normalizedStatus) {
      return t("chat.messageCard.assistantThinking");
    }

    if (normalizedStatus === "context_compacting") {
      return t("chat.messageCard.assistantCompactingContext");
    }
    if (normalizedStatus === "context_compaction_degraded") {
      return t("chat.messageCard.assistantCompactingContextDegraded");
    }
    if (normalizedStatus === "context_compaction_failed") {
      return t("chat.messageCard.assistantCompactingContextFailed");
    }
    if (normalizedStatus === "memory_updating") {
      return t("chat.messageCard.assistantUpdatingMemory");
    }
    if (normalizedStatus.startsWith("tool_running:")) {
      const rawToolName = normalizedStatus.slice("tool_running:".length).trim() || "tool";
      const displayToolName = rawToolName.replace(/[_-]+/g, " ");
      return t("chat.messageCard.assistantRunningTool", { tool: displayToolName });
    }

    return t("chat.messageCard.assistantThinking");
  }, [statusContent, t]);

  // 准备 Markdown 渲染配置
  // 流式阶段使用简化版配置（不渲染 Mermaid 图表，避免内容不完整导致的错误）
  const markdownPlugins = useMemo(() => [remarkGfm, remarkBreaks], []);
  const rehypePlugins = useMemo(() => [rehypeSanitize], []);
  const markdownComponents = useMemo(() => createStreamingMarkdownComponents(token), [token]);

  return (
    <Card
      data-testid="streaming-indicator"
      role="status"
      aria-live="polite"
      aria-busy={true}
      aria-label={t("chat.view.aiRespondingAria")}
      style={{
        width: "100%",
        minWidth: "100%",
        maxWidth: "800px",
        margin: "0 auto",
        background: "var(--lotus-message-streaming-bg)",
        borderRadius: token.borderRadiusLG,
        boxShadow: "none",
        position: "relative",
        wordWrap: "break-word",
        overflowWrap: "break-word",
      }}
    >
      <Space direction="vertical" size={token.marginXS} style={{ width: "100%", maxWidth: "100%" }}>
        <Flex align="baseline" justify="space-between" gap={token.marginXS}>
          <Text type="secondary" strong style={{ fontSize: token.fontSizeSM }}>
            {t("chat.streaming.assistant")}
          </Text>
        </Flex>
        <Flex vertical style={{ width: "100%", maxWidth: "100%" }}>
          {reasoningContent ? (
            <Collapse
              size="small"
              defaultActiveKey={["reasoning"]}
              style={{
                marginBottom: token.marginSM,
                background: token.colorBgContainer,
                borderColor: token.colorBorderSecondary,
              }}
              items={[
                {
                  key: "reasoning",
                  label: <Text strong>{t("chat.messageCard.reasoning")}</Text>,
                  children: (
                    <ReactMarkdown
                      remarkPlugins={markdownPlugins}
                      rehypePlugins={rehypePlugins}
                      components={markdownComponents}
                    >
                      {reasoningContent}
                    </ReactMarkdown>
                  ),
                },
              ]}
            />
          ) : null}

          {!content || statusContent ? (
            <Text italic className="thinking-shimmer">
              {pendingStatusText}
            </Text>
          ) : null}

          {content ? (
            <ReactMarkdown
              remarkPlugins={markdownPlugins}
              rehypePlugins={rehypePlugins}
              components={markdownComponents}
            >
              {content}
            </ReactMarkdown>
          ) : null}
          <span
            className="blinking-cursor"
            style={{
              display: "inline-block",
              marginLeft: "0.2em",
              color: token.colorText,
            }}
          />
        </Flex>
      </Space>
    </Card>
  );
});

StreamingMessageCard.displayName = "StreamingMessageCard";

export default StreamingMessageCard;
