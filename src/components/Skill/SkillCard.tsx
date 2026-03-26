import React from "react";
import { Card, Space, Tag, Typography, theme } from "antd";
import type { SkillDefinition } from "../../pages/ChatPage/types/skill";

const { Text } = Typography;

interface SkillCardProps {
  skill: SkillDefinition;
}

export const SkillCard: React.FC<SkillCardProps> = ({ skill }) => {
  const { token } = theme.useToken();

  return (
    <Card
      title={
        <Space size={token.marginXS} wrap>
          <span>{skill.name}</span>
          {skill.license && <Tag color="processing">License: {skill.license}</Tag>}
        </Space>
      }
      styles={{ body: { padding: token.paddingMD } }}
    >
      <Space
        direction="vertical"
        size={token.marginXS}
        style={{ width: "100%" }}
      >
        <Text type="secondary">{skill.description}</Text>
        {skill.compatibility && (
          <Text type="secondary">Compatibility: {skill.compatibility}</Text>
        )}
        {skill.tool_refs.length > 0 && (
          <Space size={token.marginXXS} wrap>
            {skill.tool_refs.map((toolRef) => (
              <Tag key={toolRef}>{toolRef}</Tag>
            ))}
          </Space>
        )}
      </Space>
    </Card>
  );
};
