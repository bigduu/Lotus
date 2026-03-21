import React from "react";
import { Button, Flex } from "antd";
import { FileTextOutlined, PlusOutlined } from "@ant-design/icons";

interface MessageInputControlsLeftProps {
  allowImages: boolean;
  disabled: boolean;
  isStreaming: boolean;
  token: any;
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
            type="text"
            icon={<PlusOutlined />}
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isStreaming}
            size="small"
            style={{
              minWidth: 36,
              padding: "0 8px",
              height: 36,
              borderRadius: 18,
              color: token.colorTextSecondary,
            }}
            title="Add attachments"
          />
        </>
      )}

      {onFileReferenceButtonClick && (
        <Button
          type="text"
          icon={<FileTextOutlined />}
          onClick={onFileReferenceButtonClick}
          disabled={disabled || isStreaming}
          size="small"
          style={{
            minWidth: 36,
            padding: "0 8px",
            height: 36,
            borderRadius: 18,
            color: token.colorTextSecondary,
          }}
          title="Reference workspace files (@)"
        />
      )}

      {extraControl}
    </Flex>
  );
};

export default MessageInputControlsLeft;
