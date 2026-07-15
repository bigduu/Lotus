import React, { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Divider, Flex, Input, Select, Switch, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@services/api";
import {
  serviceFactory,
  type ConnectConfig,
  type ConnectPlatformConfig,
} from "@services/common/ServiceFactory";
import { isMaskedSecret } from "@shared/utils/secrets";

const { Text } = Typography;
const { useToken } = theme;

interface ConnectDraft {
  telegramEnabled: boolean;
  telegramToken: string;
  telegramAllowFrom: string[];
  feishuEnabled: boolean;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuDomain: string;
  feishuAllowFrom: string[];
}

const findPlatform = (
  platforms: ConnectPlatformConfig[] | undefined,
  type: string,
): ConnectPlatformConfig | undefined => platforms?.find((p) => p.type === type);

function draftFromConfig(connect: ConnectConfig | undefined): ConnectDraft {
  const telegram = findPlatform(connect?.platforms, "telegram");
  const feishu = findPlatform(connect?.platforms, "feishu");
  return {
    telegramEnabled: Boolean(telegram),
    // Never prefill a masked secret — see isMaskedSecret contract.
    telegramToken: isMaskedSecret(telegram?.token) ? "" : (telegram?.token ?? ""),
    telegramAllowFrom: telegram?.allow_from ?? [],
    feishuEnabled: Boolean(feishu),
    feishuAppId: feishu?.app_id ?? "",
    feishuAppSecret: isMaskedSecret(feishu?.app_secret) ? "" : (feishu?.app_secret ?? ""),
    feishuDomain: feishu?.domain ?? "",
    feishuAllowFrom: feishu?.allow_from ?? [],
  };
}

const MASK_PLACEHOLDER = "****...****";

/**
 * Connect / IM-bridge settings: drive Bamboo sessions from Telegram or
 * Feishu/Lark (bamboo epic #447, closes Lotus #49).
 *
 * Reads/writes the `connect` sub-tree of the bamboo config via whole-document
 * `GET`/partial-patch `POST bamboo/config`, the same surface
 * `NotificationChannelsSection` uses. `connect.platforms` is at most one
 * entry per platform `type` in this UI (the backend only ever starts the
 * first configured entry per type — `multi_bot_guard`, bamboo #462) so the
 * form presents one fixed Telegram slot and one fixed Feishu slot rather
 * than a freeform list.
 *
 * Secret handling (`token` for Telegram, `app_secret` for Feishu) follows
 * the `isMaskedSecret` contract, with one important difference from
 * `NotificationChannelsSection`: because `connect.platforms` is an ARRAY,
 * the backend's `preserve_masked_connect_secrets` resolves a kept secret
 * POSITIONALLY — it needs the literal `****...****` placeholder echoed back
 * in the patch (cross-checked against `type` at that index), not an omitted
 * key. So an unedited, already-configured secret is sent back as the mask
 * placeholder rather than left out of the payload. A genuinely new value
 * typed by the user is always sent as-is. See bamboo
 * crates/infra/bamboo-config/src/patch.rs `preserve_masked_connect_secrets`
 * and its `config_endpoints/tests.rs` e2e (PR #456).
 *
 * Enabling/disabling a platform in this UI adds/removes its entry from the
 * `connect.platforms` array — `ConnectPlatformConfig` has no `enabled`
 * field on the backend (unlike `notifications.ntfy`/`.bark`); presence in
 * the array is what starts the bridge.
 */
const SystemSettingsConnectTab: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [connect, setConnect] = useState<ConnectConfig | undefined>(undefined);
  const [draft, setDraft] = useState<ConnectDraft>(() => draftFromConfig(undefined));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const cfg = await serviceFactory.getBambooConfig();
      setConnect(cfg.connect);
      setDraft(draftFromConfig(cfg.connect));
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (p: Partial<ConnectDraft>) => setDraft((d) => ({ ...d, ...p }));

  const storedTelegram = findPlatform(connect?.platforms, "telegram");
  const storedFeishu = findPlatform(connect?.platforms, "feishu");
  const hasStoredTelegramToken = isMaskedSecret(storedTelegram?.token);
  const hasStoredFeishuSecret = isMaskedSecret(storedFeishu?.app_secret);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const telegramToken = draft.telegramToken.trim();
      const feishuAppSecret = draft.feishuAppSecret.trim();

      const buildTelegramEntry = (): ConnectPlatformConfig => ({
        type: "telegram",
        ...(telegramToken
          ? { token: telegramToken }
          : hasStoredTelegramToken
            ? { token: MASK_PLACEHOLDER }
            : {}),
        allow_from: draft.telegramAllowFrom,
      });

      const buildFeishuEntry = (): ConnectPlatformConfig => ({
        type: "feishu",
        ...(draft.feishuAppId.trim() ? { app_id: draft.feishuAppId.trim() } : {}),
        ...(feishuAppSecret
          ? { app_secret: feishuAppSecret }
          : hasStoredFeishuSecret
            ? { app_secret: MASK_PLACEHOLDER }
            : {}),
        ...(draft.feishuDomain.trim() ? { domain: draft.feishuDomain.trim() } : {}),
        allow_from: draft.feishuAllowFrom,
      });

      // Preserve the original array order/positions for entries that stay
      // configured — the backend's masked-secret preservation matches by
      // index+type, so reordering while a secret is left masked would drop
      // it. Untouched/unknown platform types (future adapters) pass through
      // as-is.
      const original = connect?.platforms ?? [];
      const platforms: ConnectPlatformConfig[] = [];
      let telegramSeen = false;
      let feishuSeen = false;
      for (const entry of original) {
        if (entry.type === "telegram") {
          telegramSeen = true;
          if (draft.telegramEnabled) platforms.push(buildTelegramEntry());
        } else if (entry.type === "feishu") {
          feishuSeen = true;
          if (draft.feishuEnabled) platforms.push(buildFeishuEntry());
        } else {
          platforms.push(entry);
        }
      }
      if (draft.telegramEnabled && !telegramSeen) platforms.push(buildTelegramEntry());
      if (draft.feishuEnabled && !feishuSeen) platforms.push(buildFeishuEntry());

      const configPatch: { connect: ConnectConfig } = { connect: { platforms } };
      const savedCfg = await serviceFactory.setBambooConfig(configPatch);
      setConnect(savedCfg.connect);
      setDraft(draftFromConfig(savedCfg.connect));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const telegramDenyAll = draft.telegramEnabled && draft.telegramAllowFrom.length === 0;
  const feishuDenyAll = draft.feishuEnabled && draft.feishuAllowFrom.length === 0;

  return (
    <Card size="small" className="lotus-settings-card" loading={loading}>
      <Flex vertical gap={token.marginMD}>
        <Text strong>{t("settings.connectTab.title", "Connect (IM Bridge)")}</Text>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t(
            "settings.connectTab.description",
            "Drive Bamboo sessions from an external chat platform. Enabling a platform starts a persistent bridge; disabling removes it.",
          )}
        </Text>

        {loadError ? (
          <Alert
            type="error"
            showIcon
            message={loadError}
            action={
              <Button size="small" onClick={() => void load()}>
                {t("settings.connectTab.retry", "Retry")}
              </Button>
            }
          />
        ) : null}

        {!loading && !loadError && (
          <>
            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Flex vertical gap={token.marginXS}>
              <Flex align="center" justify="space-between" gap={token.marginSM}>
                <Text>{t("settings.connectTab.telegram.title", "Telegram")}</Text>
                <Switch
                  data-testid="connect-telegram-enabled"
                  checked={draft.telegramEnabled}
                  onChange={(checked) => patch({ telegramEnabled: checked })}
                  aria-label={t("settings.connectTab.telegram.enable", "Enable Telegram bridge")}
                />
              </Flex>
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.connectTab.telegram.token", "Bot Token")}
                </Text>
                <Input.Password
                  data-testid="connect-telegram-token"
                  value={draft.telegramToken}
                  onChange={(e) => patch({ telegramToken: e.target.value })}
                  placeholder={
                    hasStoredTelegramToken
                      ? t(
                          "settings.connectTab.telegram.tokenPlaceholderConfigured",
                          "Configured — leave blank to keep",
                        )
                      : t(
                          "settings.connectTab.telegram.tokenPlaceholderEmpty",
                          "Token from @BotFather",
                        )
                  }
                />
              </label>
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.connectTab.telegram.allowFrom", "Allowed user IDs")}
                </Text>
                <Select<string[]>
                  data-testid="connect-telegram-allow-from"
                  mode="tags"
                  open={false}
                  tokenSeparators={[",", " "]}
                  value={draft.telegramAllowFrom}
                  onChange={(value) => patch({ telegramAllowFrom: value })}
                  placeholder={t(
                    "settings.connectTab.telegram.allowFromPlaceholder",
                    "Telegram numeric user ID",
                  )}
                  style={{ width: "100%" }}
                />
              </label>
              {telegramDenyAll ? (
                <Text type="warning" style={{ fontSize: token.fontSizeSM }}>
                  {t(
                    "settings.connectTab.denyAllWarning",
                    "No allowed users configured — every inbound message will be rejected until you add at least one ID.",
                  )}
                </Text>
              ) : null}
            </Flex>

            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Flex vertical gap={token.marginXS}>
              <Flex align="center" justify="space-between" gap={token.marginSM}>
                <Text>{t("settings.connectTab.feishu.title", "Feishu / Lark")}</Text>
                <Switch
                  data-testid="connect-feishu-enabled"
                  checked={draft.feishuEnabled}
                  onChange={(checked) => patch({ feishuEnabled: checked })}
                  aria-label={t("settings.connectTab.feishu.enable", "Enable Feishu bridge")}
                />
              </Flex>
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.connectTab.feishu.appId", "App ID")}
                </Text>
                <Input
                  data-testid="connect-feishu-app-id"
                  value={draft.feishuAppId}
                  onChange={(e) => patch({ feishuAppId: e.target.value })}
                  placeholder={t("settings.connectTab.feishu.appIdPlaceholder", "cli_xxxxxxxx")}
                />
              </label>
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.connectTab.feishu.appSecret", "App Secret")}
                </Text>
                <Input.Password
                  data-testid="connect-feishu-app-secret"
                  value={draft.feishuAppSecret}
                  onChange={(e) => patch({ feishuAppSecret: e.target.value })}
                  placeholder={
                    hasStoredFeishuSecret
                      ? t(
                          "settings.connectTab.feishu.appSecretPlaceholderConfigured",
                          "Configured — leave blank to keep",
                        )
                      : t(
                          "settings.connectTab.feishu.appSecretPlaceholderEmpty",
                          "App secret from the Feishu/Lark developer console",
                        )
                  }
                />
              </label>
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.connectTab.feishu.domain", "Domain")}
                </Text>
                <Input
                  data-testid="connect-feishu-domain"
                  value={draft.feishuDomain}
                  onChange={(e) => patch({ feishuDomain: e.target.value })}
                  placeholder={t(
                    "settings.connectTab.feishu.domainPlaceholder",
                    "feishu (default), lark, or a private-deployment https:// base URL",
                  )}
                />
              </label>
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.connectTab.feishu.allowFrom", "Allowed open IDs")}
                </Text>
                <Select<string[]>
                  data-testid="connect-feishu-allow-from"
                  mode="tags"
                  open={false}
                  tokenSeparators={[",", " "]}
                  value={draft.feishuAllowFrom}
                  onChange={(value) => patch({ feishuAllowFrom: value })}
                  placeholder={t(
                    "settings.connectTab.feishu.allowFromPlaceholder",
                    "Feishu open_id",
                  )}
                  style={{ width: "100%" }}
                />
              </label>
              {feishuDenyAll ? (
                <Text type="warning" style={{ fontSize: token.fontSizeSM }}>
                  {t(
                    "settings.connectTab.denyAllWarning",
                    "No allowed users configured — every inbound message will be rejected until you add at least one ID.",
                  )}
                </Text>
              ) : null}
            </Flex>

            {saveError ? <Alert type="error" showIcon message={saveError} /> : null}

            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Flex align="center" justify="end" gap={token.marginSM}>
              {saved ? (
                <Text type="success" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.connectTab.saved", "Saved")}
                </Text>
              ) : null}
              <Button
                data-testid="connect-save-button"
                type="primary"
                size="small"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving
                  ? t("settings.connectTab.saving", "Saving…")
                  : t("settings.connectTab.save", "Save connect settings")}
              </Button>
            </Flex>
          </>
        )}
      </Flex>
    </Card>
  );
};

export default SystemSettingsConnectTab;
