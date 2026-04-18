import React, { memo, useMemo, useState } from "react";
import { Alert, Card, Divider, Space, Spin, Tag, Tooltip, Typography, Flex, theme } from "antd";
import { Button } from "@/components/ui/button";
import {
  ApiOutlined,
  CopyOutlined,
  ExpandAltOutlined,
  CompressOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  formatResultContent,
  shouldCollapseContent,
  createContentPreview,
  getStatusColor,
  safeStringify,
} from "../../utils/resultFormatters";
import { ExecutionStatus } from "../../types/chat";
import { copyText } from "@shared/utils/clipboard";

const { Text } = Typography;

export interface WorkflowResultCardProps {
  content: string;
  workflowName: string;
  parameters?: unknown;
  status?: ExecutionStatus;
  timestamp?: string;
  onRetry?: () => void;
  isLoading?: boolean;
  errorMessage?: string;
}

const WorkflowResultCardComponent: React.FC<WorkflowResultCardProps> = ({
  content,
  workflowName,
  parameters,
  status = "success",
  timestamp,
  onRetry,
  isLoading,
  errorMessage,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const [expanded, setExpanded] = useState(false);

  const formattedResult = useMemo(() => formatResultContent(content), [content]);
  const derivedIsLoading = useMemo(() => {
    if (typeof isLoading === "boolean") {
      return isLoading;
    }
    return formattedResult.formattedText.trim().length === 0;
  }, [formattedResult.formattedText, isLoading]);
  const collapseByDefault = useMemo(
    () => shouldCollapseContent(formattedResult.formattedText),
    [formattedResult.formattedText],
  );

  const isCollapsible = formattedResult.isJson || collapseByDefault;
  const isExpanded = !isCollapsible || expanded;
  const preview = useMemo(
    () => createContentPreview(formattedResult.formattedText),
    [formattedResult.formattedText],
  );

  const formattedParameters = useMemo(() => {
    if (parameters === undefined || parameters === null) {
      return null;
    }

    if (typeof parameters === "string") {
      return formatResultContent(parameters);
    }

    try {
      return {
        isJson: true,
        formattedText: JSON.stringify(parameters, null, 2),
        parsedJson: parameters,
      };
    } catch (error) {
      console.error("[WorkflowResultCard] Failed to stringify parameters:", error);
      return {
        isJson: false,
        formattedText: String(parameters),
      };
    }
  }, [parameters]);

  const handleCopyContent = async () => {
    try {
      const textToCopy = formattedResult.isJson
        ? safeStringify(formattedResult.parsedJson)
        : formattedResult.formattedText;
      await copyText(textToCopy);
    } catch (error) {
      console.error("[WorkflowResultCard] Failed to copy content:", error);
    }
  };

  const handleCopyParameters = async () => {
    if (!formattedParameters) return;
    try {
      const textToCopy = formattedParameters.isJson
        ? safeStringify(formattedParameters.parsedJson)
        : formattedParameters.formattedText;
      await copyText(textToCopy);
    } catch (error) {
      console.error("[WorkflowResultCard] Failed to copy parameters:", error);
    }
  };

  return (
    <Card
      size="small"
      variant="outlined"
      style={{
        borderRadius: token.borderRadiusLG,
        borderColor: token.colorBorderSecondary,
        backgroundColor: token.colorBgContainer,
      }}
      bodyStyle={{ padding: token.paddingMD }}
    >
      <Space direction="vertical" style={{ width: "100%" }} size={token.marginSM}>
        <Flex align="center" justify="space-between">
          <Space size={token.marginXS} align="center">
            <ApiOutlined style={{ color: token.colorWarning }} />
            <Text strong>{t("components.workflowResult.userWorkflow")}</Text>
            <Tag color={token.colorWarning}>{workflowName}</Tag>
            <Tag color={getStatusColor(status)}>{status}</Tag>
          </Space>

          <Space size="small">
            <Tooltip
              title={
                expanded
                  ? t("components.workflowResult.collapseResult")
                  : t("components.workflowResult.expandResult")
              }
            >
              {isCollapsible && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={expanded ? <CompressOutlined /> : <ExpandAltOutlined />}
                  onClick={() => setExpanded((prev) => !prev)}
                />
              )}
            </Tooltip>
            <Tooltip title={t("components.workflowResult.copyResult")}>
              <Button
                variant="ghost"
                size="sm"
                icon={<CopyOutlined />}
                onClick={handleCopyContent}
                aria-label={t("components.workflowResult.copyContent")}
              />
            </Tooltip>
            {onRetry && (
              <Tooltip title={t("components.workflowResult.retryWorkflow")}>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<ReloadOutlined />}
                  onClick={onRetry}
                  aria-label={t("components.workflowResult.retryWorkflow")}
                />
              </Tooltip>
            )}
          </Space>
        </Flex>

        {timestamp && (
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {new Date(timestamp).toLocaleString()}
          </Text>
        )}

        <Divider style={{ margin: `${token.marginXS}px 0` }} />

        {errorMessage && (
          <Alert
            type="error"
            message={t("components.workflowResult.executionFailed")}
            description={errorMessage}
            showIcon
            style={{ marginBottom: token.marginXS }}
          />
        )}

        <Flex vertical style={{ width: "100%" }}>
          {derivedIsLoading ? (
            <Spin tip={t("components.workflowResult.waitingForResult")} />
          ) : formattedResult.isJson ? (
            <SyntaxHighlighter
              language="json"
              style={oneDark}
              wrapLongLines
              customStyle={{
                margin: 0,
                borderRadius: token.borderRadiusSM,
                backgroundColor: token.colorBgContainer,
                fontSize: token.fontSizeSM,
                maxHeight: isExpanded ? "none" : 280,
                overflow: isExpanded ? "auto" : "hidden",
              }}
            >
              {formattedResult.formattedText}
            </SyntaxHighlighter>
          ) : (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: token.fontSizeSM,
                maxHeight: isExpanded ? "none" : 280,
                overflow: isExpanded ? "visible" : "hidden",
                marginBottom: 0,
              }}
            >
              {isExpanded ? formattedResult.formattedText : preview.preview}
              {!isExpanded && preview.isTruncated && "\n…"}
            </pre>
          )}
        </Flex>

        {formattedParameters && (
          <Flex vertical style={{ width: "100%" }}>
            <Divider style={{ margin: `${token.marginXS}px 0` }}>
              <Space size="small">
                <Text strong>{t("common.parameters")}</Text>
                <Tooltip title={t("components.workflowResult.copyParameters")}>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<CopyOutlined />}
                    onClick={handleCopyParameters}
                    aria-label={t("components.workflowResult.copyParameters")}
                  />
                </Tooltip>
              </Space>
            </Divider>

            {formattedParameters.isJson ? (
              <SyntaxHighlighter
                language="json"
                style={oneDark}
                wrapLongLines
                customStyle={{
                  margin: 0,
                  borderRadius: token.borderRadiusSM,
                  backgroundColor: token.colorBgContainer,
                  fontSize: token.fontSizeSM,
                  maxHeight: 220,
                  overflow: "auto",
                }}
              >
                {formattedParameters.formattedText}
              </SyntaxHighlighter>
            ) : (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: token.fontSizeSM,
                  marginBottom: 0,
                }}
              >
                {formattedParameters.formattedText}
              </pre>
            )}
          </Flex>
        )}
      </Space>
    </Card>
  );
};

export const WorkflowResultCard = memo(WorkflowResultCardComponent);
WorkflowResultCard.displayName = "WorkflowResultCard";

export default WorkflowResultCard;
