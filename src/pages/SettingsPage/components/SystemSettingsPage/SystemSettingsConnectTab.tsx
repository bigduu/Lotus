import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Divider, Flex, Input, Select, Switch, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@services/api";
import {
  configSectionsService,
  type ConnectSection,
  type ConnectSectionDraftPlatform,
  type ConnectSectionPlatform,
} from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { reapplyConfigChanges } from "@shared/hooks/useConfigSectionDraft";

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
  platforms: ConnectSectionPlatform[] | undefined,
  type: string,
): ConnectSectionPlatform | undefined => platforms?.find((p) => p.type === type);

function draftFromConfig(connect: ConnectSection | undefined): ConnectDraft {
  const telegram = findPlatform(connect?.platforms, "telegram");
  const feishu = findPlatform(connect?.platforms, "feishu");
  return {
    telegramEnabled: Boolean(telegram),
    telegramToken: "",
    telegramAllowFrom: telegram?.allow_from ?? [],
    feishuEnabled: Boolean(feishu),
    feishuAppId: feishu?.app_id ?? "",
    feishuAppSecret: "",
    feishuDomain: feishu?.domain ?? "",
    feishuAllowFrom: feishu?.allow_from ?? [],
  };
}

/**
 * Connect / IM-bridge settings: drive Bamboo sessions from Telegram or
 * Feishu/Lark (bamboo epic #447, closes Lotus #49).
 *
 * Reads the typed `connect` section and performs revisioned credential-domain
 * writes. `connect.platforms` is at most one
 * entry per platform `type` in this UI (the backend only ever starts the
 * first configured entry per type — `multi_bot_guard`, bamboo #462) so the
 * form presents one fixed Telegram slot and one fixed Feishu slot rather
 * than a freeform list.
 *
 * Secret inputs are always blank. Unchanged values are omitted, replacement
 * sends plaintext exactly once, and clear sends explicit null. Stable platform
 * ids are preserved so credential ownership cannot drift when entries move.
 *
 * Enabling/disabling a platform in this UI adds/removes its entry from the
 * `connect.platforms` array — `ConnectPlatformConfig` has no `enabled`
 * field on the backend (unlike `notifications.ntfy`/`.bark`); presence in
 * the array is what starts the bridge.
 */
const SystemSettingsConnectTab: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [connect, setConnect] = useState<ConnectSection | undefined>(undefined);
  const [draft, setDraft] = useState<ConnectDraft>(() => draftFromConfig(undefined));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [credentialRevision, setCredentialRevision] = useState<number | null>(null);
  const [baseSectionRevision, setBaseSectionRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [clearTelegramToken, setClearTelegramToken] = useState(false);
  const [clearFeishuSecret, setClearFeishuSecret] = useState(false);
  const baseDraftRef = useRef<ConnectDraft | null>(null);
  const snapshot = useConfigSectionStore((state) => state.sections.connect);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const saveConnect = useConfigSectionStore((state) => state.saveConnect);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [envelope, credentials] = await Promise.all([
        loadSection("connect", { force: true }),
        configSectionsService.listCredentials(),
      ]);
      setConnect(envelope.data);
      const nextDraft = draftFromConfig(envelope.data);
      setDraft(nextDraft);
      baseDraftRef.current = structuredClone(nextDraft);
      setCredentialRevision(credentials.revision);
      setBaseSectionRevision(envelope.revision);
      setDirty(false);
      setClearTelegramToken(false);
      setClearFeishuSecret(false);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [loadSection]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (p: Partial<ConnectDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };

  const storedTelegram = findPlatform(connect?.platforms, "telegram");
  const storedFeishu = findPlatform(connect?.platforms, "feishu");
  const hasStoredTelegramToken =
    storedTelegram?.token_configured ?? Boolean(storedTelegram?.token_credential_ref);
  const hasStoredFeishuSecret =
    storedFeishu?.app_secret_configured ?? Boolean(storedFeishu?.app_secret_credential_ref);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const telegramToken = draft.telegramToken.trim();
      const feishuAppSecret = draft.feishuAppSecret.trim();

      if (credentialRevision === null) throw new Error("Connect credentials are not loaded.");

      const buildTelegramEntry = (): ConnectSectionDraftPlatform => ({
        ...(storedTelegram?.id ? { id: storedTelegram.id } : {}),
        type: "telegram",
        ...(clearTelegramToken ? { token: null } : telegramToken ? { token: telegramToken } : {}),
        allow_from: draft.telegramAllowFrom,
      });

      const buildFeishuEntry = (): ConnectSectionDraftPlatform => ({
        ...(storedFeishu?.id ? { id: storedFeishu.id } : {}),
        type: "feishu",
        ...(draft.feishuAppId.trim() ? { app_id: draft.feishuAppId.trim() } : {}),
        ...(clearFeishuSecret
          ? { app_secret: null }
          : feishuAppSecret
            ? { app_secret: feishuAppSecret }
            : {}),
        ...(draft.feishuDomain.trim() ? { domain: draft.feishuDomain.trim() } : {}),
        allow_from: draft.feishuAllowFrom,
      });

      // Preserve original order and stable ids. Untouched/unknown platform
      // types (future adapters) pass through without server-managed metadata.
      const original = connect?.platforms ?? [];
      const platforms: ConnectSectionDraftPlatform[] = [];
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
          const sanitized = { ...entry } as ConnectSectionPlatform;
          delete sanitized.token;
          delete sanitized.app_secret;
          delete sanitized.token_configured;
          delete sanitized.token_credential_ref;
          delete sanitized.app_secret_configured;
          delete sanitized.app_secret_credential_ref;
          platforms.push(sanitized);
        }
      }
      if (draft.telegramEnabled && !telegramSeen) platforms.push(buildTelegramEntry());
      if (draft.feishuEnabled && !feishuSeen) platforms.push(buildFeishuEntry());

      const result = await saveConnect({ platforms }, credentialRevision);
      setConnect(result.envelope.data);
      const nextDraft = draftFromConfig(result.envelope.data);
      setDraft(nextDraft);
      baseDraftRef.current = structuredClone(nextDraft);
      setCredentialRevision(result.credentialRevision);
      setBaseSectionRevision(result.envelope.revision);
      setDirty(false);
      setClearTelegramToken(false);
      setClearFeishuSecret(false);
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
  const externalRevision =
    dirty && snapshot.envelope && snapshot.envelope.revision !== baseSectionRevision
      ? snapshot.envelope.revision
      : null;

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

        {externalRevision !== null ? (
          <Alert
            type="warning"
            showIcon
            message={`Connect configuration changed on disk (r${baseSectionRevision} → r${externalRevision})`}
            action={
              <Flex gap={8}>
                <Button size="small" onClick={() => void load()}>
                  Reload
                </Button>
                <Button
                  size="small"
                  onClick={() =>
                    void (async () => {
                      if (!snapshot.envelope || !baseDraftRef.current) return;
                      const credentials = await configSectionsService.listCredentials();
                      const latest = draftFromConfig(snapshot.envelope.data);
                      setDraft(reapplyConfigChanges(baseDraftRef.current, draft, latest));
                      setConnect(snapshot.envelope.data);
                      baseDraftRef.current = structuredClone(latest);
                      setCredentialRevision(credentials.revision);
                      setBaseSectionRevision(snapshot.envelope.revision);
                    })()
                  }
                >
                  Reapply
                </Button>
              </Flex>
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
              {hasStoredTelegramToken ? (
                <Button
                  size="small"
                  danger={clearTelegramToken}
                  onClick={() => {
                    setClearTelegramToken((current) => !current);
                    setDirty(true);
                  }}
                >
                  {clearTelegramToken ? "Token will be cleared" : "Clear configured token"}
                </Button>
              ) : null}
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
              {hasStoredFeishuSecret ? (
                <Button
                  size="small"
                  danger={clearFeishuSecret}
                  onClick={() => {
                    setClearFeishuSecret((current) => !current);
                    setDirty(true);
                  }}
                >
                  {clearFeishuSecret ? "Secret will be cleared" : "Clear configured secret"}
                </Button>
              ) : null}
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
