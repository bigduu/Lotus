import React, { useEffect, useMemo, useState } from "react";
import { Empty, Modal, message, theme } from "antd";
import { Space } from "@/components/ui/space";
import { Typography } from "@/components/ui/typography";
import { ToolOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import { ModalFooter, createCancelButton, createOkButton } from "../ModalFooter";
import type { UserSystemPrompt } from "../../types/chat";
import { useAppStore } from "../../store";
import { SystemPromptListItem } from "./SystemPromptListItem";
import { copyText } from "@shared/utils/clipboard";

const { Text } = Typography;
const { useToken } = theme;

interface SystemPromptSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (prompt: UserSystemPrompt) => void;
  prompts: UserSystemPrompt[];
  title?: string;
  showCancelButton?: boolean;
}

const SystemPromptSelector: React.FC<SystemPromptSelectorProps> = ({
  open,
  onClose,
  onSelect,
  prompts,
  title,
  showCancelButton = true,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [messageApi, contextHolder] = message.useMessage();
  const lastSelectedPromptId = useAppStore((state) => state.lastSelectedPromptId);
  const setLastSelectedPromptId = useAppStore((state) => state.setLastSelectedPromptId);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedPreviewId, setExpandedPreviewId] = useState<string | null>(null);

  // Filter out prompts with empty or missing IDs - use useMemo to avoid recalculation
  const validPrompts = useMemo(() => prompts.filter((p) => p.id && p.id.trim() !== ""), [prompts]);

  const handleCopyPrompt = async (event: React.MouseEvent, prompt: UserSystemPrompt) => {
    event.stopPropagation();

    const content = prompt.content ?? "";

    try {
      await copyText(content);
      messageApi.success(t("success.promptCopied", { name: prompt.name }));
    } catch (error) {
      console.error("[SystemPromptSelector] Failed to copy prompt:", error);
      messageApi.error(t("error.copyPromptFailed"));
    }
  };

  const resolvedTitle = title ?? t("chat.prompt.selectorTitle");

  useEffect(() => {
    if (open) {
      const defaultPrompt = validPrompts.find((p) => p.isDefault);
      // Priority: last selected > default prompt > first available prompt
      const initialId =
        lastSelectedPromptId ||
        defaultPrompt?.id ||
        (validPrompts.length > 0 ? validPrompts[0].id : null);
      setSelectedId(initialId);
    }
  }, [open, lastSelectedPromptId, validPrompts.length]); // Use validPrompts.length instead of validPrompts to avoid unnecessary re-runs

  const handleSelect = (prompt: UserSystemPrompt) => {
    setSelectedId(prompt.id);
    setLastSelectedPromptId(prompt.id);
    onSelect(prompt);
    onClose();
  };

  const handleCancel = () => {
    onClose();
  };

  return (
    <>
      {contextHolder}
      <Modal
        title={
          <Space>
            <ToolOutlined />
            {resolvedTitle}
          </Space>
        }
        open={open}
        onCancel={handleCancel}
        width={700}
        footer={
          <ModalFooter
            buttons={[
              ...(showCancelButton ? [createCancelButton(handleCancel)] : []),
              createOkButton(
                () => {
                  const prompt = validPrompts.find((p) => p.id === selectedId);
                  if (prompt) {
                    handleSelect(prompt);
                  }
                },
                {
                  text: t("chat.prompt.createButton"),
                  disabled: !selectedId,
                },
              ),
            ]}
          />
        }
        styles={{
          body: {
            maxHeight: "70vh",
            overflowY: "auto",
            padding: token.paddingMD,
          },
        }}
      >
        <div style={{ marginBottom: token.marginMD }}>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {t("chat.prompt.helperText")}
          </Text>
        </div>

        {validPrompts.length === 0 ? (
          <Empty
            description={t("chat.prompt.emptyDescription")}
            style={{ margin: token.marginLG }}
          />
        ) : (
          <div>
            {validPrompts.map((prompt) => (
              <SystemPromptListItem
                key={prompt.id}
                prompt={prompt}
                token={token}
                isSelected={selectedId === prompt.id}
                isExpanded={expandedPreviewId === prompt.id}
                onSelect={(promptId) => setSelectedId(promptId)}
                onToggleExpand={(promptId) =>
                  setExpandedPreviewId(expandedPreviewId === promptId ? null : promptId)
                }
                onCopy={handleCopyPrompt}
              />
            ))}
          </div>
        )}
      </Modal>
    </>
  );
};

export default SystemPromptSelector;
