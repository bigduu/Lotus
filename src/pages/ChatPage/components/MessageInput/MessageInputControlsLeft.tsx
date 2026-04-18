import type { GlobalToken } from "antd/es/theme/interface";
import React from "react";
import { Flex } from "antd";
import { Button } from "@/components/ui/button";
import { FileTextOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

interface MessageInputControlsLeftProps {
  allowImages: boolean;
  disabled: boolean;
  isStreaming: boolean;
  token: GlobalToken;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onFileReferenceButtonClick?: () => void;
  extraControl?: React.ReactNode;
}

const MessageInputControlsLeft: React.FC<MessageInputControlsLeftProps> = ({
  allowImages,
  disabled,
  isStreaming,
  token,
  fileInputRef,
  onFileInputChange,
  onFileReferenceButtonClick,
  extraControl,
}) => {
  const { t } = useTranslation();

  return (
    <Flex
      align="center"
      style={{
        minWidth: 0,
        gap: 0,
      }}
    >
      {allowImages && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={onFileInputChange}
          />
          <Button
            variant="ghost"
            icon={<PlusOutlined />}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isStreaming}
            size="sm"
            style={{
              minWidth: 36,
              padding: "0 8px",
              height: 36,
              borderRadius: 18,
              color: token.colorTextSecondary,
            }}
            title={t("chat.input.addAttachments")}
            aria-label={t("chat.input.addAttachments")}
          />
        </>
      )}
      {onFileReferenceButtonClick && (
        <Button
          variant="ghost"
          icon={<FileTextOutlined />}
          onClick={onFileReferenceButtonClick}
          disabled={disabled || isStreaming}
          size="sm"
          style={{
            minWidth: 36,
            padding: "0 8px",
            height: 36,
            borderRadius: 18,
            color: token.colorTextSecondary,
          }}
          title={t("chat.input.referenceWorkspaceFiles")}
          aria-label={t("chat.input.referenceWorkspaceFiles")}
        />
      )}
      {extraControl}
    </Flex>
  );
};

export default MessageInputControlsLeft;
