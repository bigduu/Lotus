import React from "react";
import { Button, Space } from "antd";
import i18n from "i18next";

export interface ModalFooterButton {
  key: string;
  text: string;
  type?: "default" | "primary" | "dashed" | "link" | "text";
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
  size?: "small" | "middle" | "large";
  align?: "left" | "center" | "right";
}

export const ModalFooter: React.FC<ModalFooterProps> = ({
  buttons,
  className,
  style,
  size = "middle",
  align = "right",
}) => {
  const spaceProps = {
    className,
    style: {
      width: "100%",
      justifyContent: align === "left" ? "flex-start" : align === "center" ? "center" : "flex-end",
      ...style,
    },
  };

  return (
    <Space {...spaceProps}>
      {buttons.map((button) => (
        <Button
          key={button.key}
          type={button.type || "default"}
          disabled={button.disabled}
          loading={button.loading}
          danger={button.danger}
          onClick={button.onClick}
          size={size}
          icon={button.icon}
        >
          {button.text}
        </Button>
      ))}
    </Space>
  );
};

// Predefined common button configurations
/* eslint-disable react-refresh/only-export-components -- shared button factories used by modal dialogs */
export const createCancelButton = (onCancel: () => void, text?: string): ModalFooterButton => {
  return {
    key: "cancel",
    text: text || i18n.t("common.cancel"),
    type: "default",
    onClick: onCancel,
  };
};

export const createOkButton = (
  onOk: () => void,
  options?: {
    text?: string;
    disabled?: boolean;
    loading?: boolean;
  },
): ModalFooterButton => {
  return {
    key: "ok",
    text: options?.text || i18n.t("common.ok"),
    type: "primary",
    disabled: options?.disabled,
    loading: options?.loading,
    onClick: onOk,
  };
};

export const createApplyButton = (
  onApply: () => void,
  options?: {
    text?: string;
    disabled?: boolean;
    loading?: boolean;
  },
): ModalFooterButton => {
  return {
    key: "apply",
    text: options?.text || i18n.t("common.apply"),
    type: "primary",
    disabled: options?.disabled,
    loading: options?.loading,
    onClick: onApply,
  };
};

export const createSaveButton = (
  onSave: () => void,
  options?: {
    text?: string;
    disabled?: boolean;
    loading?: boolean;
  },
): ModalFooterButton => {
  return {
    key: "save",
    text: options?.text || i18n.t("common.save"),
    type: "primary",
    disabled: options?.disabled,
    loading: options?.loading,
    onClick: onSave,
  };
};

export const createDeleteButton = (
  onDelete: () => void,
  options?: {
    text?: string;
    disabled?: boolean;
    loading?: boolean;
  },
): ModalFooterButton => {
  return {
    key: "delete",
    text: options?.text || i18n.t("common.delete"),
    type: "primary",
    danger: true,
    disabled: options?.disabled,
    loading: options?.loading,
    onClick: onDelete,
  };
};

export default ModalFooter;
