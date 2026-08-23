import React from "react";
import { Alert, Button, Flex, Input, Tag, Typography, theme } from "antd";
import { ThunderboltOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import type { WorkflowDraft } from "./types";

const { Text } = Typography;

export interface WorkflowSelectionChipProps {
  draft: WorkflowDraft;
  disabled?: boolean;
  onArgumentsChange: (raw: string) => void;
  onRefresh: () => void;
  onReselect: () => void;
}

const WorkflowSelectionChip: React.FC<WorkflowSelectionChipProps> = ({
  draft,
  disabled,
  onArgumentsChange,
  onRefresh,
  onReselect,
}) => {
  const { t } = useTranslation();
  const { token } = theme.useToken();
  const selection = draft.workflowSelection;
  if (!selection) return null;

  return (
    <div
      data-testid="workflow-selection-chip"
      style={{
        marginBottom: token.marginXS,
        padding: `${token.paddingXS}px ${token.paddingSM}px`,
        border: `1px solid ${draft.workflowActivationError ? token.colorErrorBorder : token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        background: token.colorFillQuaternary,
      }}
    >
      <Flex vertical gap={token.marginXS}>
        <Flex align="center" justify="space-between" gap={token.marginXS} wrap>
          <Flex align="center" gap={token.marginXS} wrap>
            <Tag color="green" icon={<ThunderboltOutlined />} style={{ marginInlineEnd: 0 }}>
              {draft.displayName || selection.id}
            </Tag>
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {selection.source} ·{" "}
              {t("settings.workflowsTab.revision", {
                revision: selection.revision,
              })}
              {draft.workflowVersion ? ` · ${draft.workflowVersion}` : ""}
            </Text>
          </Flex>
          <Button size="small" type="link" onClick={onReselect} disabled={disabled}>
            {t("chat.workflowSelection.reselect")}
          </Button>
        </Flex>

        <Input.TextArea
          aria-label={t("chat.workflowSelection.argumentsLabel")}
          value={draft.workflowArgumentsText ?? "{}"}
          onChange={(event) => onArgumentsChange(event.target.value)}
          disabled={disabled}
          status={draft.workflowArgumentsError ? "error" : undefined}
          autoSize={{ minRows: 1, maxRows: 5 }}
          placeholder={draft.workflowArgumentHint || "{}"}
          spellCheck={false}
        />
        {draft.workflowArgumentHint && !draft.workflowArgumentsError ? (
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {t("chat.workflowSelection.argumentsHint", { hint: draft.workflowArgumentHint })}
          </Text>
        ) : null}
        {draft.workflowArgumentsError ? (
          <Text type="danger" style={{ fontSize: token.fontSizeSM }}>
            {draft.workflowArgumentsError}
          </Text>
        ) : null}

        {draft.workflowActivationError ? (
          <Alert
            type="warning"
            showIcon
            message={t("chat.workflowSelection.selectionRejected")}
            description={draft.workflowActivationError}
            action={
              <Flex gap={token.marginXS} wrap>
                <Button size="small" onClick={onRefresh} disabled={disabled}>
                  {t("chat.workflowSelection.refreshCatalog")}
                </Button>
                <Button size="small" onClick={onReselect} disabled={disabled}>
                  {t("chat.workflowSelection.reselect")}
                </Button>
              </Flex>
            }
          />
        ) : null}
      </Flex>
    </div>
  );
};

export default WorkflowSelectionChip;
