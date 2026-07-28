import React, { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { Button, Card, Collapse, Divider, Flex, Space, Typography, theme } from "antd";
import { CopyOutlined, EyeOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import type { ChatItem, Message } from "@shared/types/chat";
import { useAppStore } from "@shared/store/appStore";
import { SystemPromptMarkdown } from "./SystemPromptMarkdown";
import {
  buildPromptInspectorContextDetails,
  type PromptSnapshotSection,
  useSystemPromptContent,
} from "./useSystemPromptContent";
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
    project: t("chat.prompt.systemCard.sections.project"),
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
  const projectId = currentChat?.config.projectId?.trim() || null;
  const project = useAppStore((state) => (projectId ? state.projects[projectId] : undefined));
  const projectResources = useAppStore((state) =>
    projectId ? state.projectResources[projectId] : undefined,
  );
  const ensureProject = useAppStore((state) => state.ensureProject);
  const loadProjectResources = useAppStore((state) => state.loadProjectResources);

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

  const lastResourceLoadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!promptSnapshot || !projectId) {
      lastResourceLoadKeyRef.current = null;
      return;
    }

    void ensureProject(projectId).catch(() => {
      // Missing/invisible Projects are represented explicitly by ProjectStore.
    });

    const expectedRevision =
      typeof project?.resource_revision === "number" ? project.resource_revision : null;
    if (
      projectResources &&
      (expectedRevision === null || projectResources.resource_revision === expectedRevision)
    ) {
      return;
    }
    const loadKey = `${projectId}:${expectedRevision ?? "unknown"}`;
    if (lastResourceLoadKeyRef.current === loadKey) {
      return;
    }
    lastResourceLoadKeyRef.current = loadKey;
    void loadProjectResources(projectId).catch(() => {
      // The Project manager/store surfaces the fetch error. Keep the prompt
      // snapshot usable even when the resource summary endpoint is unavailable.
    });
  }, [
    ensureProject,
    loadProjectResources,
    project?.resource_revision,
    projectId,
    projectResources,
    promptSnapshot,
  ]);

  const contextDetails = useMemo(
    () =>
      buildPromptInspectorContextDetails({
        projectPath: project?.project_path,
        sessionWorkspacePath: currentChat?.config.workspacePath,
        // ProjectSummary is authoritative; the resources response is only
        // used above to detect and refresh a stale resource summary.
        resourceRevision: project?.resource_revision,
      }),
    [currentChat?.config.workspacePath, project?.project_path, project?.resource_revision],
  );

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
              <Flex align="center" gap={token.marginXS}>
                <Text type="secondary" strong style={{ fontSize: token.fontSizeSM }}>
                  {t("chat.prompt.systemCard.snapshotTitle")}
                </Text>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("chat.prompt.systemCard.bambooSource")}
                </Text>
              </Flex>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {t("chat.prompt.systemCard.contextModelHint")}
              </Text>
              <Flex
                vertical
                gap={token.marginXS}
                data-testid="prompt-context-details"
                style={{
                  padding: token.paddingXS,
                  borderRadius: token.borderRadiusLG,
                  background: token.colorFillAlter,
                }}
              >
                <Flex gap={token.marginXS} wrap="wrap">
                  <Text strong>{t("chat.prompt.systemCard.projectPath")}</Text>
                  {contextDetails.projectPath ? (
                    <Text code data-testid="prompt-project-path">
                      {contextDetails.projectPath}
                    </Text>
                  ) : (
                    <Text type="secondary" data-testid="prompt-project-path">
                      {t("chat.prompt.systemCard.unavailable")}
                    </Text>
                  )}
                </Flex>
                <Flex gap={token.marginXS} wrap="wrap">
                  <Text strong>{t("chat.prompt.systemCard.sessionWorkspace")}</Text>
                  {contextDetails.sessionWorkspacePath ? (
                    <Text code data-testid="prompt-session-workspace">
                      {contextDetails.sessionWorkspacePath}
                    </Text>
                  ) : (
                    <Text type="secondary" data-testid="prompt-session-workspace">
                      {t("chat.prompt.systemCard.notSet")}
                    </Text>
                  )}
                </Flex>
                <Flex gap={token.marginXS} wrap="wrap">
                  <Text strong>{t("chat.prompt.systemCard.effectiveWorkspace")}</Text>
                  {contextDetails.effectiveWorkspacePath ? (
                    <Text code data-testid="prompt-effective-workspace">
                      {contextDetails.effectiveWorkspacePath}
                    </Text>
                  ) : (
                    <Text type="secondary" data-testid="prompt-effective-workspace">
                      {t("chat.prompt.systemCard.unavailable")}
                    </Text>
                  )}
                </Flex>
                {contextDetails.usesProjectPathFallback ? (
                  <Text type="secondary" data-testid="prompt-workspace-fallback">
                    {t("chat.prompt.systemCard.projectPathFallback")}
                  </Text>
                ) : null}
                <Flex gap={token.marginXS} wrap="wrap">
                  <Text strong>{t("chat.prompt.systemCard.resourceRevision")}</Text>
                  {contextDetails.resourceRevision !== null ? (
                    <Text code data-testid="prompt-resource-revision">
                      {contextDetails.resourceRevision}
                    </Text>
                  ) : (
                    <Text type="secondary" data-testid="prompt-resource-revision">
                      {t("chat.prompt.systemCard.unavailable")}
                    </Text>
                  )}
                </Flex>
              </Flex>
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
