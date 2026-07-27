import React, { useEffect } from "react";
import { Alert, Button, Space, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useConfigRecoveryStore } from "@shared/store/configRecoveryStore";
import type { ConfigRecoverySource } from "@services/common/ServiceFactory";

const { Text, Paragraph } = Typography;
const { useToken } = theme;

function sourceDescription(source: ConfigRecoverySource, t: TFunction): string {
  switch (source.kind) {
    case "salvaged":
      return t("configRecovery.source.salvaged", {
        defaultValue: "Salvaged {{count}} field(s) directly from the corrupt file.",
        count: source.fields.length,
      });
    case "backup":
      return t("configRecovery.source.backup", {
        defaultValue: "Restored from the last-known-good backup (generation {{generation}}).",
        generation: source.generation,
      });
    case "defaults":
    default:
      return t("configRecovery.source.defaults");
  }
}

/**
 * Blocking banner for a pending config-corruption recovery (Lotus #59,
 * consuming bamboo #153 / PR #493's `GET/POST /bamboo/config/recovery-*`
 * API).
 *
 * Mounted once, globally, in `MainLayout` so it is visible on both the chat
 * and Settings views immediately after app boot — plus `MainLayout` forces a
 * fresh check whenever Settings is opened. It self-fetches on mount and
 * renders nothing while there is no pending recovery.
 *
 * Accept persists the recovered config (server-side) and unblocks settings
 * saves. Reject is a genuine no-op on the backend — it does NOT discard the
 * recovered state or restore the corrupt original; `config.json` stays
 * exactly as it was (refused-to-write) and every settings save keeps 409ing
 * until the user either accepts later or hand-fixes `config.json` on disk
 * and restarts the backend. The copy below reflects that explicitly so
 * "Reject" doesn't read as "undo".
 */
export const ConfigRecoveryBanner: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const pending = useConfigRecoveryStore((s) => s.pending);
  const status = useConfigRecoveryStore((s) => s.status);
  const checked = useConfigRecoveryStore((s) => s.checked);
  const resolving = useConfigRecoveryStore((s) => s.resolving);
  const lastAction = useConfigRecoveryStore((s) => s.lastAction);
  const error = useConfigRecoveryStore((s) => s.error);
  const checkStatus = useConfigRecoveryStore((s) => s.checkStatus);
  const resolve = useConfigRecoveryStore((s) => s.resolve);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  if (!checked || !pending || !status) {
    return null;
  }

  return (
    <Alert
      data-testid="config-recovery-banner"
      type="warning"
      showIcon
      banner
      closable={false}
      style={{ borderRadius: 0 }}
      message={<Text strong>{t("configRecovery.title")}</Text>}
      description={
        <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
          <Paragraph style={{ marginBottom: 0 }}>{t("configRecovery.description")}</Paragraph>
          <Text data-testid="config-recovery-source">{sourceDescription(status.source, t)}</Text>
          {status.quarantine_path ? (
            <Text type="secondary" code data-testid="config-recovery-quarantine-path">
              {t("configRecovery.quarantinePath", {
                defaultValue: "Corrupt original preserved at: {{path}}",
                path: status.quarantine_path,
              })}
            </Text>
          ) : null}
          {lastAction === "reject" ? (
            <Text type="warning" data-testid="config-recovery-reject-notice">
              {t("configRecovery.rejectNotice")}
            </Text>
          ) : null}
          {error ? (
            <Text type="danger" data-testid="config-recovery-error">
              {error}
            </Text>
          ) : null}
          <Space>
            <Button
              data-testid="config-recovery-accept"
              type="primary"
              size="small"
              loading={resolving}
              onClick={() => void resolve(true)}
            >
              {t("configRecovery.accept")}
            </Button>
            <Button
              data-testid="config-recovery-reject"
              danger
              size="small"
              loading={resolving}
              onClick={() => void resolve(false)}
            >
              {t("configRecovery.reject")}
            </Button>
          </Space>
        </Space>
      }
    />
  );
};

export default ConfigRecoveryBanner;
