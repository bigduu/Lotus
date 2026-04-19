import React, { Suspense, lazy } from "react";
import { Collapse, Input, Spin, Switch, theme } from "antd";
import { Card } from "@/components/ui/card";
import { Space } from "@/components/ui/space";
import { Flex } from "@/components/ui/flex";
import { Typography } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import MermaidSettingsTab from "./MermaidSettingsTab";
import { getCopilotConclusionWithOptionsEnhancementUserFacingText } from "../../../../shared/utils/copilotConclusionWithOptionsEnhancementUtils";

const SystemPromptManager = lazy(() => import("../SystemPromptManager"));
const { Text } = Typography;
const { useToken } = theme;

interface SystemSettingsPromptsTabProps {
  promptEnhancement: string;
  onPromptEnhancementChange: (value: string) => void;
  mermaidEnhancementEnabled: boolean;
  taskEnhancementEnabled: boolean;
  showCopilotConclusionWithOptionsEnhancement: boolean;
  copilotConclusionWithOptionsEnhancementEnabled: boolean;
  onMermaidToggle: (checked: boolean) => void;
  onTaskToggle: (checked: boolean) => void;
  onCopilotConclusionWithOptionsToggle: (checked: boolean) => void;
  onSaveEnhancement: () => void;
}

const SystemSettingsPromptsTab: React.FC<SystemSettingsPromptsTabProps> = ({
  promptEnhancement,
  onPromptEnhancementChange,
  mermaidEnhancementEnabled,
  taskEnhancementEnabled,
  showCopilotConclusionWithOptionsEnhancement,
  copilotConclusionWithOptionsEnhancementEnabled,
  onMermaidToggle,
  onTaskToggle,
  onCopilotConclusionWithOptionsToggle,
  onSaveEnhancement,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const tabGap = token.marginLG;

  return (
    <Flex vertical gap={tabGap}>
      <Card size="small" className="lotus-settings-card">
        <Suspense fallback={<Spin size="small" />}>
          <SystemPromptManager />
        </Suspense>
      </Card>
      <Card size="small" className="lotus-settings-card">
        <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
          <Text strong>{t("settings.promptsTab.title")}</Text>
          <Flex align="center" gap={token.marginSM}>
            <Text strong>{t("settings.promptsTab.mermaidEnhancement")}</Text>
            <Switch checked={mermaidEnhancementEnabled} onChange={onMermaidToggle} />
          </Flex>
          <Flex align="center" gap={token.marginSM}>
            <Text strong>{t("settings.promptsTab.taskListRules")}</Text>
            <Switch checked={taskEnhancementEnabled} onChange={onTaskToggle} />
          </Flex>
          {showCopilotConclusionWithOptionsEnhancement && (
            <Space direction="vertical" size={token.marginXXS} style={{ width: "100%" }}>
              <Flex align="center" gap={token.marginSM}>
                <Text strong>{t("settings.promptsTab.copilotConclusionWithOptionsBeforeFinish")}</Text>
                <Switch
                  checked={copilotConclusionWithOptionsEnhancementEnabled}
                  onChange={onCopilotConclusionWithOptionsToggle}
                />
              </Flex>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {t("settings.promptsTab.copilotConclusionWithOptionsBeforeFinishDescription", {
                  defaultValue: getCopilotConclusionWithOptionsEnhancementUserFacingText(),
                })}
              </Text>
            </Space>
          )}
          <Input.TextArea
            rows={6}
            placeholder={t("settings.promptsTab.enhancementPlaceholder")}
            value={promptEnhancement}
            onChange={(event) => onPromptEnhancementChange(event.target.value)}
          />
          <Flex justify="flex-end">
            <Button variant="default" onClick={onSaveEnhancement}>
              {t("settings.promptsTab.saveEnhancement")}
            </Button>
          </Flex>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {t("settings.promptsTab.description")}
          </Text>
        </Space>
      </Card>
      {mermaidEnhancementEnabled && (
        <Collapse
          size="small"
          items={[
            {
              key: "mermaid",
              label: <Text strong>{t("settings.mermaidTab.title")}</Text>,
              children: <MermaidSettingsTab />,
            },
          ]}
        />
      )}
    </Flex>
  );
};

export default SystemSettingsPromptsTab;
