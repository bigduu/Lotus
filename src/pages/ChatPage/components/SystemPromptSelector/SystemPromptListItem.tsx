import type { GlobalToken } from "antd/es/theme/interface";
import React, { useMemo } from "react";
import { List, Radio } from "antd";
import { Tag } from "@/components/ui/tag";
import { Space } from "@/components/ui/space";
import { Typography } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { CopyOutlined, EyeInvisibleOutlined, EyeOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import type { UserSystemPrompt } from "../../types/chat";
import { SystemPromptPreview } from "./SystemPromptPreview";

const { Text, Paragraph } = Typography;

type SystemPromptListItemProps = {
  prompt: UserSystemPrompt;
  token: GlobalToken;
  isSelected: boolean;
  isExpanded: boolean;
  onSelect: (promptId: string) => void;
  onToggleExpand: (promptId: string) => void;
  onCopy: (event: React.MouseEvent, prompt: UserSystemPrompt) => void;
};

export const SystemPromptListItem: React.FC<SystemPromptListItemProps> = ({
  prompt,
  token,
  isSelected,
  isExpanded,
  onSelect,
  onToggleExpand,
  onCopy,
}) => {
  const { t } = useTranslation();
  const content = prompt.content || "";
  const { nonEmptyLineCount, wordCount, characterCount, showGradient } = useMemo(() => {
    const lines = content ? content.split(/\r?\n/) : [];
    const nonEmpty = lines.filter((line) => line.trim().length > 0).length;
    const words = content.trim() ? content.trim().split(/\s+/).filter(Boolean).length : 0;
    const chars = content.length;
    return {
      nonEmptyLineCount: nonEmpty,
      wordCount: words,
      characterCount: chars,
      showGradient: !isExpanded && chars > 600,
    };
  }, [content, isExpanded]);

  return (
    <List.Item
      key={prompt.id}
      style={{
        cursor: "pointer",
        padding: token.paddingMD,
        borderRadius: token.borderRadius,
        border: isSelected
          ? `2px solid ${token.colorPrimary}`
          : `1px solid ${token.colorBorderSecondary}`,
        marginBottom: token.marginXS,
        backgroundColor: isSelected ? token.colorPrimaryBg : token.colorBgContainer,
        transition: "all 0.2s ease",
      }}
      onClick={() => onSelect(prompt.id)}
    >
      <Space direction="vertical" style={{ width: "100%" }} size={token.marginSM}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            width: "100%",
            gap: token.marginSM,
          }}
        >
          <Space align="start">
            <Radio
              checked={isSelected}
              onChange={() => onSelect(prompt.id)}
              onClick={(e) => e.stopPropagation()}
            />
            <div>
              <Text strong>{prompt.name || prompt.id}</Text>
              <div>
                <Text
                  code
                  style={{
                    fontSize: token.fontSizeSM,
                    color: token.colorTextSecondary,
                  }}
                >
                  {prompt.id}
                </Text>
              </div>
            </div>
            {prompt.isDefault ? (
              <Tag color="warning">{t("chat.systemPromptSelector.defaultTag")}</Tag>
            ) : null}
          </Space>

          <Space size="small">
            <Button
              variant="ghost"
              size="sm"
              icon={isExpanded ? <EyeInvisibleOutlined /> : <EyeOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpand(prompt.id);
              }}
            >
              {isExpanded
                ? t("chat.systemPromptSelector.hide")
                : t("chat.systemPromptSelector.preview")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<CopyOutlined />}
              onClick={(event) => onCopy(event, prompt)}
            >
              {t("chat.systemPromptSelector.copy")}
            </Button>
          </Space>
        </div>

        {prompt.description ? (
          <Text
            type="secondary"
            style={{
              marginLeft: token.marginLG,
              fontSize: token.fontSizeSM,
            }}
          >
            {prompt.description}
          </Text>
        ) : null}

        <Space size="small" wrap style={{ marginLeft: token.marginLG }}>
          <Tag color="processing">
            {t("chat.systemPromptSelector.lines", { count: nonEmptyLineCount })}
          </Tag>
          <Tag color="purple">{t("chat.systemPromptSelector.words", { count: wordCount })}</Tag>
          <Tag color="success">
            {t("chat.systemPromptSelector.chars", { count: characterCount })}
          </Tag>
        </Space>

        {!isExpanded ? (
          <Paragraph
            type="secondary"
            ellipsis={{ rows: 3 }}
            style={{
              marginLeft: token.marginLG,
              marginBottom: 0,
              color: token.colorTextSecondary,
            }}
          >
            {content || t("chat.systemPromptSelector.noContent")}
          </Paragraph>
        ) : (
          <SystemPromptPreview
            content={content}
            token={token}
            showGradient={showGradient}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </Space>
    </List.Item>
  );
};
