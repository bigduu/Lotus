import React from "react";
import { Card, Switch, Tag, theme } from "antd";
import { Space } from "@/components/ui/space";
import { Typography } from "@/components/ui/typography";
import { useTranslation } from "react-i18next";
import type { SkillDefinition } from "../../pages/ChatPage/types/skill";

const { Text } = Typography;

interface SkillCardProps {
  skill: SkillDefinition;
  disabled?: boolean;
  busy?: boolean;
  onToggleDisabled?: (skillId: string, nextDisabled: boolean) => void;
}

export const SkillCard: React.FC<SkillCardProps> = ({
  skill,
  disabled = false,
  busy = false,
  onToggleDisabled,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  return (
    <Card
      title={
        <Space
          size={token.marginXS}
          wrap
          style={{ width: "100%", justifyContent: "space-between" }}
        >
          <Space size={token.marginXS} wrap>
            <span>{skill.name}</span>
            {disabled && <Tag color="default">{t("components.skillManager.disabledTag")}</Tag>}
            {skill.license && <Tag color="processing">License: {skill.license}</Tag>}
          </Space>
          {onToggleDisabled && (
            <Switch
              checked={!disabled}
              loading={busy}
              onChange={(enabled) => onToggleDisabled(skill.id, !enabled)}
              checkedChildren={t("components.skillManager.switchEnabled")}
              unCheckedChildren={t("components.skillManager.switchDisabled")}
            />
          )}
        </Space>
      }
      styles={{ body: { padding: token.paddingMD } }}
      style={{ opacity: disabled ? 0.72 : 1 }}
    >
      <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
        <Text type="secondary">{skill.description}</Text>
        {skill.compatibility && <Text type="secondary">Compatibility: {skill.compatibility}</Text>}
        {skill.tool_refs.length > 0 && (
          <Space size={token.marginXXS} wrap>
            {skill.tool_refs.map((toolRef) => (
              <Tag
                key={toolRef}
                style={{
                  background: token.colorFillSecondary,
                  borderColor: token.colorBorderSecondary,
                  color: token.colorText,
                }}
              >
                {toolRef}
              </Tag>
            ))}
          </Space>
        )}
      </Space>
    </Card>
  );
};
