import React from "react";
import { theme } from "antd";
import { Space } from "@/components/ui/space";
import { Typography } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { CloseOutlined } from "@ant-design/icons";

const { Text } = Typography;
const { useToken } = theme;

interface InputPreviewProps {
  text: string;
  onClose: () => void;
}

const InputPreview: React.FC<InputPreviewProps> = ({ text, onClose }) => {
  const { token } = useToken();

  // Limit text length for preview
  const displayText = text.length > 150 ? text.substring(0, 147) + "..." : text;

  // Remove the quote prefix from each line for display
  const cleanDisplayText = displayText.replace(/^> |^>/gm, "");

  return (
    <div
      style={{
        marginBottom: token.marginSM,
        background: token.colorFillSecondary,
        borderRadius: 999,
        border: `1px solid ${token.colorBorderSecondary}`,
        padding: `${token.paddingXXS}px ${token.paddingSM}px`,
      }}
    >
      <Space
        style={{
          width: "100%",
          justifyContent: "space-between",
          alignItems: "flex-start",
        }}
      >
        <div style={{ flex: 1 }}>
          <Text style={{ fontSize: token.fontSizeSM, color: token.colorPrimary }}>Referencing</Text>
          <Text
            style={{
              fontSize: token.fontSizeSM,
              color: token.colorTextSecondary,
              marginLeft: token.marginSM,
            }}
            ellipsis
          >
            {cleanDisplayText}
          </Text>
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon={<CloseOutlined />}
          onClick={onClose}
          style={{
            marginLeft: token.marginXS,
            color: token.colorTextSecondary,
            borderRadius: 999,
          }}
        />
      </Space>
    </div>
  );
};

export default InputPreview;
