import React, { Suspense, lazy } from "react";
import {
  Button,
  Card,
  Flex,
  Input,
  Space,
  Spin,
  Switch,
  Typography,
  theme,
} from "antd";
import { useTranslation } from "react-i18next";

const SystemPromptManager = lazy(() => import("../SystemPromptManager"));
const { Text } = Typography;
const { useToken } = theme;

interface SystemSettingsPromptsTabProps {
  promptEnhancement: string;
  onPromptEnhancementChange: (value: string) => void;
  mermaidEnhancementEnabled: boolean;
  todoEnhancementEnabled: boolean;
  showCopilotAskUserEnhancement: boolean;
  copilotAskUserEnhancementEnabled: boolean;
  onMermaidToggle: (checked: boolean) => void;
  onTodoToggle: (checked: boolean) => void;
  onCopilotAskUserToggle: (checked: boolean) => void;
  onSaveEnhancement: () => void;
}

const SystemSettingsPromptsTab: React.FC<SystemSettingsPromptsTabProps> = ({
  promptEnhancement,
  onPromptEnhancementChange,
  mermaidEnhancementEnabled,
  todoEnhancementEnabled,
  showCopilotAskUserEnhancement,
  copilotAskUserEnhancementEnabled,
  onMermaidToggle,
  onTodoToggle,
  onCopilotAskUserToggle,
  onSaveEnhancement,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const tabGap = token.marginLG;

  return (
    <Flex vertical gap={tabGap}>
      <Card size="small">
        <Suspense fallback={<Spin size="small" />}>
          <SystemPromptManager />
        </Suspense>
      </Card>
      <Card size="small">
        <Space
          direction="vertical"
          size={token.marginXS}
          style={{ width: "100%" }}
        >
          <Text strong>{t("settings.promptsTab.title")}</Text>
          <Flex align="center" gap={token.marginSM}>
            <Text strong>{t("settings.promptsTab.mermaidEnhancement")}</Text>
            <Switch
              checked={mermaidEnhancementEnabled}
              onChange={onMermaidToggle}
            />
          </Flex>
          <Flex align="center" gap={token.marginSM}>
            <Text strong>{t("settings.promptsTab.todoListGeneration")}</Text>
            <Switch
              checked={todoEnhancementEnabled}
              onChange={onTodoToggle}
            />
          </Flex>
          {showCopilotAskUserEnhancement && (
            <Flex align="center" gap={token.marginSM}>
              <Text strong>{t("settings.promptsTab.copilotAskUserBeforeFinish")}</Text>
              <Switch
                checked={copilotAskUserEnhancementEnabled}
                onChange={onCopilotAskUserToggle}
              />
            </Flex>
          )}
          <Input.TextArea
            rows={6}
            placeholder={t("settings.promptsTab.enhancementPlaceholder")}
            value={promptEnhancement}
            onChange={(event) => onPromptEnhancementChange(event.target.value)}
          />
          <Flex justify="flex-end">
            <Button type="primary" onClick={onSaveEnhancement}>
              {t("settings.promptsTab.saveEnhancement")}
            </Button>
          </Flex>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {t("settings.promptsTab.description")}
          </Text>
        </Space>
      </Card>
    </Flex>
  );
};

export default SystemSettingsPromptsTab;
