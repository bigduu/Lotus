import React from "react";
import { Typography, Button, theme, Space, Tag, Tooltip } from "antd";
import { CloseOutlined, FileTextOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { ProcessedFile } from "../../utils/fileUtils";

const { Text } = Typography;
const { useToken } = theme;

interface FilePreviewProps {
  files: ProcessedFile[];
  onRemove: (fileId: string) => void;
  onClear?: () => void;
}

const FilePreview: React.FC<FilePreviewProps> = ({ files, onRemove, onClear }) => {
  const { token } = useToken();
  const { t } = useTranslation();

  if (files.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        marginBottom: token.marginSM,
        padding: `${token.paddingXXS}px ${token.paddingXS}px`,
        borderRadius: 999,
        background: token.colorFillSecondary,
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Space
        align="center"
        size={token.marginXS}
        style={{ width: "100%", justifyContent: "space-between" }}
      >
        <Space align="center" wrap size={token.marginXS}>
          <FileTextOutlined style={{ color: token.colorTextSecondary }} />
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {t("chat.filePreview.fileCount", { count: files.length })}
          </Text>
          {files.map((file) => (
            <Tooltip
              key={file.id}
              title={`${file.type || "unknown"} • ${(file.size / 1024).toFixed(1)} KB`}
            >
              <Tag
                closable
                onClose={(event) => {
                  event.preventDefault();
                  onRemove(file.id);
                }}
                style={{
                  borderRadius: 999,
                  marginInlineEnd: 0,
                  maxWidth: 220,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {file.name}
              </Tag>
            </Tooltip>
          ))}
        </Space>

        {onClear ? (
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={onClear}
            style={{
              borderRadius: 999,
            }}
          >
            {t("common.clear")}
          </Button>
        ) : null}
      </Space>
    </div>
  );
};

export default FilePreview;
