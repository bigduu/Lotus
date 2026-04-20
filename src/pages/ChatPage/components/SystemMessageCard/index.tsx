import React, { memo, useCallback } from "react";
import { Button, Card, Collapse, Divider, Flex, Space, Typography, theme } from "antd";
import { CopyOutlined, EyeOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import type { ChatItem, Message } from "../../types/chat";
import { useAppStore } from "../../store";
import { SystemPromptMarkdown } from "./SystemPromptMarkdown";
import { type PromptSnapshotSection, useSystemPromptContent } from "./useSystemPromptContent";
import { copyText } from "@shared/utils/clipboard";

const { Text } = Typography;
const { useToken } = theme;

interface SystemMessageCardProps {
  currentChat: ChatItem | null;
  message: Message;
}

const getSnapshotSectionLabel = (
  t: (key: string) => string,
  key: PromptSnapshotSection["key"],
): string => {
  const map: Record<PromptSnapshotSection["key"], string> = {
    base: t("chat.prompt.systemCard.sections.base"),
    enhancement: t("chat.prompt.systemCard.sections.enhancement"),
    workspace: t("chat.prompt.systemCard.sections.workspace"),
    instruction: t("chat.prompt.systemCard.sections.instruction"),
    env: t("chat.prompt.systemCard.sections.env"),
    skills: t("chat.prompt.systemCard.sections.skills"),
    toolGuide: t("chat.prompt.systemCard.sections.toolGuide"),
    dream: t("chat.prompt.systemCard.sections.dream"),
    sessionMemory: t("chat.prompt.systemCard.sections.sessionMemory"),
    externalMemory: t("chat.prompt.systemCard.sections.externalMemory"),
    taskList: t("chat.prompt.systemCard.sections.taskList"),
    effective: t("chat.prompt.systemCard.sections.effective"),
  };

  return map[key];
};

const SystemMessageCardComponent: React.FC<SystemMessageCardProps> = ({ currentChat, message }) => {
  const { token } = useToken();
  const { t } = useTranslation();
  const systemPrompts = useAppStore((state) => state.systemPrompts);

  const {
    basePrompt,
    loadingEnhanced,
    loadEnhancedPrompt,
    promptSnapshot,
    promptToDisplay,
    showEnhanced,
    setShowEnhanced,
    snapshotSections,
  } = useSystemPromptContent({ currentChat, message, systemPrompts });

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await copyText(text);
    } catch (e) {
      console.error("Failed to copy text:", e);
    }
  }, []);

  return (
    <Card
      style={{
        width: "100%",
        maxWidth: "100%",
        background: token.colorBgContainer,
        borderRadius: token.borderRadiusLG,
        boxShadow: "none",
      }}
    >
      <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
        <Flex justify="space-between" align="center">
          <Flex align="center" gap={token.marginXS}>
            <Text type="secondary" strong style={{ fontSize: token.fontSizeSM }}>
              {t("chat.prompt.systemCard.title")}
            </Text>
          </Flex>
          <Space>
            {basePrompt && !showEnhanced ? (
              <Button
                type="text"
                size="small"
                icon={<EyeOutlined />}
                onClick={loadEnhancedPrompt}
                loading={loadingEnhanced}
              >
                {t("chat.prompt.systemCard.viewEnhanced")}
              </Button>
            ) : null}
            {basePrompt && showEnhanced ? (
              <Button type="text" size="small" onClick={() => setShowEnhanced(false)}>
                {t("chat.prompt.systemCard.viewBase")}
              </Button>
            ) : null}
            <Button
              type="text"
              size="small"
              icon={<CopyOutlined />}
              onClick={() => copyToClipboard(promptToDisplay)}
            >
              {t("chat.prompt.systemCard.copy")}
            </Button>
          </Space>
        </Flex>

        <Flex
          vertical
          style={{
            maxHeight: showEnhanced ? 400 : 300,
            overflowY: "auto",
            paddingRight: token.paddingXS,
          }}
        >
          <SystemPromptMarkdown
            content={promptToDisplay}
            token={token}
            headingColor={token.colorPrimary}
          />
        </Flex>

        {promptSnapshot && snapshotSections.length > 0 ? (
          <>
            <Divider style={{ margin: `${token.marginXS}px 0` }} />
            <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
              <Text type="secondary" strong style={{ fontSize: token.fontSizeSM }}>
                {t("chat.prompt.systemCard.snapshotTitle")}
              </Text>
              <Collapse
                defaultActiveKey={snapshotSections.map((section) => section.key)}
                items={snapshotSections.map((section) => ({
                  key: section.key,
                  label: getSnapshotSectionLabel(t, section.key),
                  children: (
                    <SystemPromptMarkdown
                      content={section.content}
                      token={token}
                      headingColor={token.colorPrimary}
                    />
                  ),
                }))}
              />
            </Space>
          </>
        ) : null}
      </Space>
    </Card>
  );
};

const SystemMessageCard = memo(SystemMessageCardComponent);
SystemMessageCard.displayName = "SystemMessageCard";
export default SystemMessageCard;
