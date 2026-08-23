import type { GlobalToken } from "antd/es/theme/interface";
import React from "react";
import { Button, Flex, Typography } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { ImageFile } from "../../utils/imageUtils";

const { Text } = Typography;

interface MessageInputImageStripProps {
  images: ImageFile[];
  token: GlobalToken;
  allowImages: boolean;
  disabled?: boolean;
  onPreview: (image: ImageFile) => void;
  onClear: () => void;
}

const MessageInputImageStrip: React.FC<MessageInputImageStripProps> = ({
  images,
  token,
  allowImages,
  disabled = false,
  onPreview,
  onClear,
}) => {
  const { t } = useTranslation();
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
        <Text type="secondary" style={{ fontSize: token.fontSizeSM, minWidth: "fit-content" }}>
          {images.length > 1
            ? t("chat.input.imageCountPlural", { count: images.length })
            : t("chat.input.imageCountSingular", { count: images.length })}
        </Text>
        {images.slice(0, 3).map((image) => (
          <div
            key={image.id}
            role="button"
            tabIndex={0}
            aria-label={t("chat.imagePreview.thumbnail", { name: image.name })}
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
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onPreview(image);
              }
            }}
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
            {t("chat.input.moreImages", { count: images.length - 3 })}
          </Text>
        )}
        <Button
          type="text"
          size="small"
          icon={<CloseOutlined />}
          onClick={onClear}
          disabled={disabled}
          style={{
            marginLeft: "auto",
            minWidth: "auto",
            padding: "0 4px",
            height: 24,
          }}
          title={t("chat.input.clearAllImages")}
          aria-label={t("chat.input.clearAllImages")}
        />
      </Flex>
    </div>
  );
};

export default MessageInputImageStrip;
