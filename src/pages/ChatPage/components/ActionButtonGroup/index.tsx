import React from "react";
import { Button, Flex, Tooltip, theme, Grid } from "antd";
import { CopyOutlined, BookOutlined } from "@ant-design/icons";
import i18n from "i18next";

const { useToken } = theme;
const { useBreakpoint } = Grid;

export interface ActionButton {
  key: string;
  "data-testid"?: string;
  icon: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}

export interface ActionButtonGroupProps {
  buttons: ActionButton[];
  isVisible: boolean;
  className?: string;
  style?: React.CSSProperties;
  position?: {
    bottom?: string | number;
    right?: string | number;
    top?: string | number;
    left?: string | number;
  };
}

export const ActionButtonGroup: React.FC<ActionButtonGroupProps> = ({
  buttons,
  isVisible,
  className,
  style,
  position = { bottom: "8px", right: "8px" },
}) => {
  const { token } = useToken();
  const screens = useBreakpoint();

  const getActionButtonSize = (): "small" | "middle" | "large" => {
    return screens.xs ? "small" : "small";
  };

  return (
    <Flex
      justify="flex-end"
      gap={token.marginXS}
      className={className}
      style={{
        marginTop: token.marginXS,
        position: "absolute",
        bottom: position.bottom,
        right: position.right,
        top: position.top,
        left: position.left,
        background: "transparent",
        zIndex: 1,
        opacity: isVisible ? 1 : 0,
        transition: "opacity 0.2s ease",
        pointerEvents: isVisible ? "auto" : "none",
        ...style,
      }}
    >
      {buttons.map((button) => (
        <Tooltip key={button.key} title={button.title}>
          <Button
            data-testid={button["data-testid"] || button.key}
            icon={button.icon}
            size={getActionButtonSize()}
            type="text"
            onClick={button.onClick}
            disabled={button.disabled}
            style={{
              background: token.colorBgElevated,
              borderRadius: token.borderRadiusSM,
            }}
          />
        </Tooltip>
      ))}
    </Flex>
  );
};

// Predefined common action button configurations
// eslint-disable-next-line react-refresh/only-export-components -- shared button factory used by message cards
export const createCopyButton = (onCopy: () => void, title?: string): ActionButton => {
  return {
    key: "copy",
    "data-testid": "copy-message",
    icon: <CopyOutlined />,
    title: title || i18n.t("chat.actions.copyMessage"),
    onClick: onCopy,
  };
};

// eslint-disable-next-line react-refresh/only-export-components -- shared button factory used by message cards
export const createReferenceButton = (onReference: () => void, title?: string): ActionButton => {
  return {
    key: "reference",
    icon: <BookOutlined />,
    title: title || i18n.t("chat.actions.referenceMessage"),
    onClick: onReference,
  };
};

export default ActionButtonGroup;
