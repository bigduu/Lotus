import React from "react";
import { Tag, Tooltip } from "antd";
import { CloudServerOutlined, ContainerOutlined, DesktopOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";

import type { SessionPlacement } from "@services/chat/AgentService";

/** Pick an icon by deployment kind: local machine, container, or remote host. */
const iconForKind = (kind: string): React.ReactNode => {
  switch (kind) {
    case "ssh":
      return <CloudServerOutlined />;
    case "docker":
      return <ContainerOutlined />;
    default:
      return <DesktopOutlined />;
  }
};

export type MachineTagProps = {
  /** Which machine the session's agent runs on. Renders nothing when absent. */
  placement?: SessionPlacement | null;
  /** Compact mode for dense lists: drop the leading "Machine" label. */
  compact?: boolean;
  className?: string;
};

/**
 * A small badge showing which machine a session runs on — its deployment kind
 * (`local` / `docker` / `ssh`) and host, e.g. "local · Mac-mini.local" or
 * "ssh · 192.168.1.5". Remote placements are tinted blue to stand out from the
 * local host. Used in the session header (ContextBar) and the sub-agents panel.
 */
export const MachineTag: React.FC<MachineTagProps> = ({ placement, compact, className }) => {
  const { t } = useTranslation();
  if (!placement || !placement.host) return null;

  const { kind, host } = placement;
  const isRemote = kind !== "local";

  return (
    <Tooltip
      title={t("chat.machine.tooltip", {
        kind,
        host,
        defaultValue: "Runs on {{kind}} · {{host}}",
      })}
    >
      <Tag
        icon={iconForKind(kind)}
        bordered={false}
        color={isRemote ? "blue" : undefined}
        className={className}
      >
        {!compact && (
          <span style={{ opacity: 0.65, marginRight: 4 }}>
            {t("chat.machine.label", { defaultValue: "Machine" })}
          </span>
        )}
        {`${kind} · ${host}`}
      </Tag>
    </Tooltip>
  );
};

export default MachineTag;
