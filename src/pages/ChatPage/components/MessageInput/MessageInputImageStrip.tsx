import React from "react";
import { Button, Flex, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import type { ImageFile } from "../../utils/imageUtils";

const { Text } = Typography;

interface MessageInputImageStripProps {
  images: ImageFile[];
  token: any;
  allowImages: boolean;
  onPreview: (image: ImageFile) => void;
  onClear: () => void;
}

const MessageInputImageStrip: React.FC<MessageInputImageStripProps> = ({
  images,
  token,
  allowImages,
  onPreview,
  onClear,
}) => {
  if (!allowImages || images.length === 0) return null;

  return (
    <div
      style={{
        marginBottom: token.marginSM,
        padding: `${token.paddingXXS}px ${token.paddingXS}px`,
        borderRadius: 999,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorFillSecondary,
      }}
    >
      <Flex align="center" wrap="wrap" gap={token.marginXS}>
        <Text
          type="secondary"
          style={{ fontSize: token.fontSizeSM, minWidth: "fit-content" }}
        >
          {images.length} image{images.length > 1 ? "s" : ""}:
        </Text>
        {images.slice(0, 3).map((image) => (
          <div
            key={image.id}
            style={{
              position: "relative",
              width: 32,
              height: 32,
              borderRadius: 999,
              overflow: "hidden",
              border: `1px solid ${token.colorBorderSecondary}`,
              cursor: "pointer",
            }}
            onClick={() => onPreview(image)}
          >
            <img
              src={image.preview}
              alt={image.name}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          </div>
        ))}
        {images.length > 3 && (
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            +{images.length - 3} more
          </Text>
        )}
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onClear}
          style={{
            marginLeft: "auto",
            minWidth: "auto",
            padding: "0 4px",
            height: 24,
          }}
          title="Clear all images"
        />
      </Flex>
    </div>
  );
};

export default MessageInputImageStrip;
