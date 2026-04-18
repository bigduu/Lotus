import React from "react";
import { Space } from "antd";

import { Button } from "@/components/ui/button";

type AntdButtonType = "default" | "primary" | "dashed" | "link" | "text";
type AntdSize = "small" | "middle" | "large";
type ShadcnVariant = "default" | "outline" | "ghost" | "link" | "secondary" | "destructive";
type ShadcnSize = "default" | "sm" | "lg" | "icon" | "icon-sm";

const TYPE_TO_VARIANT: Record<AntdButtonType, ShadcnVariant> = {
  primary: "default",
  default: "outline",
  dashed: "outline",
  text: "ghost",
  link: "link",
};

const SIZE_MAP: Record<AntdSize, ShadcnSize> = {
  small: "sm",
  middle: "default",
  large: "lg",
};

export interface ModalFooterButton {
  key: string;
  text: string;
  type?: AntdButtonType;
  disabled?: boolean;
  loading?: boolean;
  danger?: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}

export interface ModalFooterProps {
  buttons: ModalFooterButton[];
  className?: string;
  style?: React.CSSProperties;
  size?: AntdSize;
  align?: "left" | "center" | "right";
}

export const ModalFooter: React.FC<ModalFooterProps> = ({
  buttons,
  className,
  style,
  size = "middle",
  align = "right",
}) => {
  return (
    <Space
      className={className}
      style={{
        width: "100%",
        justifyContent: align === "left" ? "flex-start" : align === "center" ? "center" : "flex-end",
        ...style,
      }}
    >
      {buttons.map((button) => {
        const variant: ShadcnVariant = button.danger
          ? "destructive"
          : TYPE_TO_VARIANT[button.type ?? "default"];
        return (
          <Button
            key={button.key}
            variant={variant}
            disabled={button.disabled}
            loading={button.loading}
            onClick={button.onClick}
            size={SIZE_MAP[size]}
            icon={button.icon}
          >
            {button.text}
          </Button>
        );
      })}
    </Space>
  );
};

// Predefined common button configurations
export const createCancelButton = (onCancel: () => void, text?: string): ModalFooterButton => ({
  key: "cancel",
  text: text || "Cancel",
  type: "default",
  onClick: onCancel,
});

export const createOkButton = (
  onOk: () => void,
  options?: { text?: string; disabled?: boolean; loading?: boolean },
): ModalFooterButton => ({
  key: "ok",
  text: options?.text || "OK",
  type: "primary",
  disabled: options?.disabled,
  loading: options?.loading,
  onClick: onOk,
});

export const createApplyButton = (
  onApply: () => void,
  options?: { text?: string; disabled?: boolean; loading?: boolean },
): ModalFooterButton => ({
  key: "apply",
  text: options?.text || "Apply",
  type: "primary",
  disabled: options?.disabled,
  loading: options?.loading,
  onClick: onApply,
});

export const createSaveButton = (
  onSave: () => void,
  options?: { text?: string; disabled?: boolean; loading?: boolean },
): ModalFooterButton => ({
  key: "save",
  text: options?.text || "Save",
  type: "primary",
  disabled: options?.disabled,
  loading: options?.loading,
  onClick: onSave,
});

export const createDeleteButton = (
  onDelete: () => void,
  options?: { text?: string; disabled?: boolean; loading?: boolean },
): ModalFooterButton => ({
  key: "delete",
  text: options?.text || "Delete",
  type: "primary",
  danger: true,
  disabled: options?.disabled,
  loading: options?.loading,
  onClick: onDelete,
});

export default ModalFooter;
