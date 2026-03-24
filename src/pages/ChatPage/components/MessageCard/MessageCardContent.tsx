import React, { memo } from "react";
import { Space, Typography, Button, Alert, Tag, Collapse } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import type { Components } from "react-markdown";
import type { PluggableList } from "unified";
import {
  isAssistantToolCallMessage,
  isAssistantToolResultMessage,
  isWorkflowResultMessage,
  type Message,
} from "../../types/chat";
import ToolResultCard from "../ToolResultCard";
import ToolCallCard from "../ToolCallCard";
import WorkflowResultCard from "../WorkflowResultCard";
import { parseMcpToolAlias } from "../../utils/mcpAlias";

const { Text } = Typography;

type SelectionHint =
  | { type: "mcp"; label: string; serverId?: string; toolName?: string }
  | { type: "skill"; label: string; skillId?: string };

const extractSelectionHints = (
  input: string,
): { cleanText: string; hints: SelectionHint[] } => {
  if (!input) return { cleanText: input, hints: [] };

  const lines = input.split("\n");
  const hints: SelectionHint[] = [];
  const keptLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    const mcpMatch = line.match(
      /^\[User explicitly selected MCP tool:\s*(.+?)\s*\]$/,
    );
    if (mcpMatch) {
      const label = mcpMatch[1] ?? "";
      const parsed = parseMcpToolAlias(label);
      hints.push({
        type: "mcp",
        label,
        serverId: parsed?.serverId,
        toolName: parsed?.toolName,
      });
      continue;
    }

    const skillMatch = line.match(
      /^\[User explicitly selected skill:\s*(.+?)\s*\]$/,
    );
    if (skillMatch) {
      const label = skillMatch[1] ?? "";
      const idMatch = label.match(/\(ID:\s*([^)]+)\)\s*$/i);
      const skillId = idMatch?.[1]?.trim();
      const displayLabel = idMatch
        ? label.replace(/\(ID:\s*([^)]+)\)\s*$/i, "").trim()
        : label;
      hints.push({
        type: "skill",
        label: displayLabel || label,
        skillId,
      });
      continue;
    }

    keptLines.push(rawLine);
  }

  const cleanText = keptLines.join("\n").trimStart();
  return { cleanText, hints };
};

interface MessageCardContentProps {
  message: Message;
  messageText: string;
  isUserToolCall: boolean;
  formatUserToolCall: (toolCall: string) => string;
  markdownComponents: Components;
  markdownPlugins: PluggableList;
  rehypePlugins: PluggableList;
}

const MessageCardContent: React.FC<MessageCardContentProps> = ({
  message,
  messageText,
  isUserToolCall,
  formatUserToolCall,
  markdownComponents,
  markdownPlugins,
  rehypePlugins,
}) => {
  const { t } = useTranslation();
  if (isAssistantToolResultMessage(message)) {
    const toolResultContent = message.result.result ?? "";
    const toolResultErrorMessage = message.isError
      ? toolResultContent || t("components.toolResult.executionFailed")
      : undefined;
    const toolResultIsLoading =
      !toolResultErrorMessage && toolResultContent.trim().length === 0;

    if (message.result.display_preference === "Hidden") {
      return null;
    }

    return (
      <ToolResultCard
        content={toolResultContent}
        toolName={message.toolName}
        status={
          message.isError
            ? "error"
            : toolResultIsLoading
              ? "warning"
              : "success"
        }
        timestamp={message.createdAt}
        defaultCollapsed={true}
        isLoading={toolResultIsLoading}
        errorMessage={toolResultErrorMessage}
      />
    );
  }

  if (isWorkflowResultMessage(message)) {
    const workflowContent = message.content ?? "";
    const workflowErrorMessage =
      message.status === "error"
        ? workflowContent || t("components.workflowResult.executionFailed")
        : undefined;
    const workflowIsLoading =
      !workflowErrorMessage && workflowContent.trim().length === 0;

    return (
      <WorkflowResultCard
        content={workflowContent}
        workflowName={message.workflowName}
        parameters={message.parameters}
        status={workflowIsLoading ? "warning" : (message.status ?? "success")}
        timestamp={message.createdAt}
        isLoading={workflowIsLoading}
        errorMessage={workflowErrorMessage}
      />
    );
  }

  if (isAssistantToolCallMessage(message)) {
    return (
      <Space direction="vertical" style={{ width: "100%" }}>
        {message.toolCalls.map((call) => (
          <ToolCallCard
            key={call.toolCallId}
            toolName={call.toolName}
            parameters={call.parameters}
            toolCallId={call.toolCallId}
            streamingOutput={call.streamingOutput}
            defaultExpanded={false}
          />
        ))}
      </Space>
    );
  }

  // Check if this is an authentication error message
  if (message.isAuthError) {
    return (
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Alert
          message={t("chat.messageCard.authRequired")}
          description={
            <ReactMarkdown
              remarkPlugins={markdownPlugins}
              rehypePlugins={rehypePlugins}
              components={markdownComponents}
            >
              {messageText}
            </ReactMarkdown>
          }
          type="error"
          showIcon
        />
        <Button
          type="primary"
          icon={<SettingOutlined />}
          onClick={() => {
            // Navigate to settings - assuming there's a way to do this
            // In Tauri/Electron, we might need to use IPC to switch tabs
            window.location.hash = "/settings";
          }}
        >
          {t("chat.messageCard.goToSettings")}
        </Button>
      </Space>
    );
  }

  const { cleanText, hints } =
    message.role === "user"
      ? extractSelectionHints(messageText)
      : { cleanText: messageText, hints: [] };
  const assistantReasoning =
    message.role === "assistant" &&
    (message as any).type === "text" &&
    typeof (message as any).metadata?.reasoning === "string"
      ? ((message as any).metadata.reasoning as string)
      : "";
  const hasAssistantReasoning = assistantReasoning.trim().length > 0;

  if (message.role === "assistant" && !messageText && !hasAssistantReasoning) {
    return <Text italic>{t("chat.messageCard.assistantThinking")}</Text>;
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="small">
      {hasAssistantReasoning ? (
        <Collapse
          size="small"
          defaultActiveKey={["reasoning"]}
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
                  {assistantReasoning}
                </ReactMarkdown>
              ),
            },
          ]}
        />
      ) : null}

      {hints.map((hint, idx) => {
        if (hint.type === "mcp") {
          return (
            <Alert
              key={`hint-mcp-${idx}`}
              type="info"
              showIcon={false}
              message={
                <Space wrap size="small">
                  <Tag color="purple">MCP</Tag>
                  <Text strong>{t("chat.messageCard.selectedTool")}</Text>
                  {hint.serverId && (
                    <Text type="secondary">
                      <Text code>{hint.serverId}</Text>
                    </Text>
                  )}
                  {hint.toolName && (
                    <Text type="secondary">
                      <Text code>{hint.toolName}</Text>
                    </Text>
                  )}
                </Space>
              }
              style={{ marginBottom: 0 }}
            />
          );
        }

        return (
          <Alert
            key={`hint-skill-${idx}`}
            type="success"
            showIcon={false}
            message={
              <Space wrap size="small">
                <Tag color="green">Skill</Tag>
                <Text strong>{t("chat.messageCard.selected")}</Text>
                {hint.label && <Text>{hint.label}</Text>}
                {hint.skillId && (
                  <Text type="secondary">
                    <Text code>{hint.skillId}</Text>
                  </Text>
                )}
              </Space>
            }
            style={{ marginBottom: 0 }}
          />
        );
      })}

      {cleanText ? (
        <ReactMarkdown
          remarkPlugins={markdownPlugins}
          rehypePlugins={rehypePlugins}
          components={markdownComponents}
        >
          {isUserToolCall ? formatUserToolCall(cleanText) : cleanText}
        </ReactMarkdown>
      ) : null}
    </Space>
  );
};

export default memo(MessageCardContent);
