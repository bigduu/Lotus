import React, { useMemo } from "react";
import { App as AntApp, Alert, Button, Dropdown, Space, theme, Typography } from "antd";
import {
  DownOutlined,
  SafetyCertificateOutlined,
  ThunderboltFilled,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import type { SessionPermissionMode } from "@shared/permissions/sessionPermissionMode";

export type PermissionModeMutationStatus = "idle" | "pending" | "success" | "error";

type PermissionModeControlProps = {
  mode: SessionPermissionMode;
  supportsAuto: boolean;
  mutationStatus: PermissionModeMutationStatus;
  sessionTitle: string;
  compact?: boolean;
  disabled?: boolean;
  onChange: (mode: SessionPermissionMode) => void | Promise<void>;
};

const modeIcon = (mode: SessionPermissionMode): React.ReactNode => {
  if (mode === "auto") return <ThunderboltFilled />;
  if (mode === "bypass") return <ThunderboltOutlined />;
  return <SafetyCertificateOutlined />;
};

export const PermissionModeControl: React.FC<PermissionModeControlProps> = ({
  mode,
  supportsAuto,
  mutationStatus,
  sessionTitle,
  compact = false,
  disabled = false,
  onChange,
}) => {
  const { t } = useTranslation();
  const { modal } = AntApp.useApp();
  const { token } = theme.useToken();
  const modeLabel = t(`chat.input.permissionMode.modes.${mode}.label`);

  const items = useMemo(
    () =>
      (["default", "bypass", "auto"] as const).map((candidate) => ({
        key: candidate,
        icon: modeIcon(candidate),
        disabled: candidate === "auto" && !supportsAuto,
        label: (
          <Space direction="vertical" size={0} style={{ maxWidth: 320 }}>
            <Typography.Text strong>
              {t(`chat.input.permissionMode.modes.${candidate}.label`)}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ whiteSpace: "normal", fontSize: 12 }}>
              {candidate === "auto" && !supportsAuto
                ? t("chat.input.permissionMode.autoUnsupported")
                : t(`chat.input.permissionMode.modes.${candidate}.description`)}
            </Typography.Text>
          </Space>
        ),
      })),
    [supportsAuto, t],
  );

  const requestChange = (next: SessionPermissionMode) => {
    if (next === mode || mutationStatus === "pending") return;
    if (next === "auto") {
      if (!supportsAuto) return;
      modal.confirm({
        title: t("chat.input.permissionMode.autoConfirm.title"),
        icon: <ThunderboltFilled style={{ color: token.colorError }} />,
        content: (
          <Space direction="vertical" size="middle">
            <Alert
              type="error"
              showIcon
              message={t("chat.input.permissionMode.autoConfirm.warning")}
            />
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {t("chat.input.permissionMode.autoConfirm.scope", { session: sessionTitle })}
            </Typography.Paragraph>
            <Typography.Text type="secondary">
              {t("chat.input.permissionMode.autoConfirm.boundaries")}
            </Typography.Text>
          </Space>
        ),
        okText: t("chat.input.permissionMode.autoConfirm.enable"),
        okButtonProps: { danger: true },
        cancelText: t("chat.input.permissionMode.autoConfirm.cancel"),
        centered: true,
        onOk: () => onChange("auto"),
      });
      return;
    }
    void onChange(next);
  };

  const statusText =
    mutationStatus === "idle" ? "" : t(`chat.input.permissionMode.status.${mutationStatus}`);
  const activeDescription = t(`chat.input.permissionMode.modes.${mode}.description`);

  return (
    <Dropdown
      trigger={["click"]}
      placement="topLeft"
      menu={{
        items,
        selectable: true,
        selectedKeys: [mode],
        onClick: ({ key }) => requestChange(key as SessionPermissionMode),
      }}
      disabled={disabled || mutationStatus === "pending"}
    >
      <Button
        type="text"
        size="small"
        loading={mutationStatus === "pending"}
        aria-label={t("chat.input.permissionMode.ariaLabel", { mode: modeLabel })}
        aria-haspopup="menu"
        data-testid="permission-mode-control"
        data-permission-mode={mode}
        title={activeDescription}
        style={{
          minWidth: compact ? 72 : undefined,
          padding: compact ? "0 8px" : "0 12px",
          height: 36,
          borderRadius: 18,
          color:
            mode === "auto"
              ? token.colorError
              : mode === "bypass"
                ? token.colorWarning
                : token.colorTextSecondary,
        }}
      >
        <Space size={5} wrap>
          {modeIcon(mode)}
          {/* Keep the exact mode visible on narrow layouts; icon-only Auto is unsafe. */}
          <span>{modeLabel}</span>
          <DownOutlined style={{ fontSize: 10 }} />
          <span aria-live="polite" data-testid="permission-mode-status" style={{ fontSize: 11 }}>
            {statusText}
          </span>
        </Space>
      </Button>
    </Dropdown>
  );
};

export default PermissionModeControl;
