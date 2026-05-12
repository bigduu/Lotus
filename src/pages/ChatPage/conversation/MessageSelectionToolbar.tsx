import React from "react";
import { Button, Flex, Space, Tooltip, Typography } from "antd";
import { CheckSquareOutlined, CloseOutlined, DownloadOutlined } from "@ant-design/icons";

const { Text } = Typography;

export type MessageSelectionToolbarProps = {
  visible: boolean;
  selectionMode: boolean;
  selectedCount: number;
  totalCount: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  maxWidth: string;
  onToggleSelectionMode: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onExportMarkdown: () => void;
  onExportPdf: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
};

export const MessageSelectionToolbar: React.FC<MessageSelectionToolbarProps> = ({
  visible,
  selectionMode,
  selectedCount,
  totalCount,
  paddingTop,
  paddingRight,
  paddingBottom,
  paddingLeft,
  maxWidth,
  onToggleSelectionMode,
  onSelectAll,
  onClear,
  onExportMarkdown,
  onExportPdf,
  t,
}) => {
  if (!visible) {
    return null;
  }

  return (
    <div
      style={{
        paddingTop,
        paddingRight,
        paddingBottom,
        paddingLeft,
        maxWidth,
        margin: "0 auto",
        width: "100%",
      }}
    >
      {!selectionMode ? (
        <Flex justify="flex-end">
          <Tooltip title={t("chat.selectionToolbar.selectMessages")}>
            <Button
              aria-label={t("chat.selectionToolbar.selectMessages")}
              icon={<CheckSquareOutlined />}
              size="small"
              onClick={onToggleSelectionMode}
            />
          </Tooltip>
        </Flex>
      ) : (
        <Flex align="center" justify="space-between" wrap="wrap" gap={8}>
          <Text type="secondary">
            {t("chat.selectionToolbar.selectedCount", {
              selected: selectedCount,
              total: totalCount,
            })}
          </Text>
          <Space size={8} wrap>
            <Button size="small" onClick={onSelectAll}>
              {t("chat.selectionToolbar.selectAll")}
            </Button>
            <Button size="small" onClick={onClear}>
              {t("chat.selectionToolbar.clear")}
            </Button>
            <Button
              size="small"
              icon={<DownloadOutlined />}
              onClick={onExportMarkdown}
              disabled={selectedCount === 0}
            >
              {t("chat.selectionToolbar.exportMarkdown")}
            </Button>
            <Button
              size="small"
              type="primary"
              icon={<DownloadOutlined />}
              onClick={onExportPdf}
              disabled={selectedCount === 0}
            >
              {t("chat.selectionToolbar.exportPdf")}
            </Button>
            <Button size="small" icon={<CloseOutlined />} onClick={onToggleSelectionMode}>
              {t("chat.selectionToolbar.done")}
            </Button>
          </Space>
        </Flex>
      )}
    </div>
  );
};

export default MessageSelectionToolbar;
