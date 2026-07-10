import React, { useCallback, useEffect, useState } from "react";
import { Alert, Button, Card, Divider, Flex, Input, Select, Switch, Typography, theme } from "antd";
import { useTranslation } from "react-i18next";
import { agentApiClient, getErrorMessage } from "@services/api";
import { serviceFactory, type NotificationsChannelConfig } from "@services/common/ServiceFactory";
import { isMaskedSecret } from "@shared/utils/secrets";

const { Text } = Typography;
const { useToken } = theme;

type DesktopMode = "auto" | "on" | "off";

interface ChannelsDraft {
  desktopMode: DesktopMode;
  ntfyEnabled: boolean;
  ntfyBaseUrl: string;
  ntfyTopic: string;
  ntfyToken: string;
  barkEnabled: boolean;
  barkBaseUrl: string;
  barkDeviceKey: string;
}

const DEFAULT_NTFY_BASE_URL = "https://ntfy.sh";
const DEFAULT_BARK_BASE_URL = "https://api.day.app";

function draftFromConfig(notifications: NotificationsChannelConfig | undefined): ChannelsDraft {
  const desktopEnabled = notifications?.desktop?.enabled;
  return {
    desktopMode: desktopEnabled === true ? "on" : desktopEnabled === false ? "off" : "auto",
    ntfyEnabled: notifications?.ntfy?.enabled ?? false,
    ntfyBaseUrl: notifications?.ntfy?.base_url ?? DEFAULT_NTFY_BASE_URL,
    ntfyTopic: notifications?.ntfy?.topic ?? "",
    // Never prefill a masked secret — see isMaskedSecret contract.
    ntfyToken: isMaskedSecret(notifications?.ntfy?.token) ? "" : (notifications?.ntfy?.token ?? ""),
    barkEnabled: notifications?.bark?.enabled ?? false,
    barkBaseUrl: notifications?.bark?.base_url ?? DEFAULT_BARK_BASE_URL,
    barkDeviceKey: isMaskedSecret(notifications?.bark?.device_key)
      ? ""
      : (notifications?.bark?.device_key ?? ""),
  };
}

/**
 * Notification delivery channels: native desktop plus ntfy/Bark push relays.
 *
 * Reads/writes the `notifications` sub-tree of the bamboo config via
 * whole-document `GET`/partial-patch `POST bamboo/config` (server-side
 * deep-merge), the same pattern used by `SystemSettingsHooksTab`. A partial
 * `{"notifications":{"ntfy":{...}}}` body is safe — it merges onto the
 * existing document and never clobbers sibling channels.
 *
 * The ntfy `token` / Bark `device_key` fields follow the `isMaskedSecret`
 * contract exactly: the server never emits a plaintext secret on GET — it's
 * either absent (nothing configured) or redacted to `****...****`
 * (configured) — so these fields always load empty, and a save only sends a
 * value when the user actually typed a new one. An untouched field on an
 * already-configured channel is omitted from the patch entirely so the
 * server keeps the stored secret.
 */
const NotificationChannelsSection: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [notifications, setNotifications] = useState<NotificationsChannelConfig | undefined>(
    undefined,
  );
  const [draft, setDraft] = useState<ChannelsDraft>(() => draftFromConfig(undefined));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const cfg = await serviceFactory.getBambooConfig();
      setNotifications(cfg.notifications);
      setDraft(draftFromConfig(cfg.notifications));
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (p: Partial<ChannelsDraft>) => setDraft((d) => ({ ...d, ...p }));

  const hasStoredNtfyToken = isMaskedSecret(notifications?.ntfy?.token);
  const hasStoredBarkKey = isMaskedSecret(notifications?.bark?.device_key);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const ntfyToken = draft.ntfyToken.trim();
      const barkDeviceKey = draft.barkDeviceKey.trim();
      const configPatch: { notifications: NotificationsChannelConfig } = {
        notifications: {
          desktop: {
            // "auto" clears the override back to null (server picks
            // standalone-vs-sidecar default); "on"/"off" is explicit.
            enabled: draft.desktopMode === "auto" ? null : draft.desktopMode === "on",
          },
          ntfy: {
            enabled: draft.ntfyEnabled,
            base_url: draft.ntfyBaseUrl.trim() || DEFAULT_NTFY_BASE_URL,
            topic: draft.ntfyTopic.trim(),
            ...(ntfyToken ? { token: ntfyToken } : {}),
          },
          bark: {
            enabled: draft.barkEnabled,
            base_url: draft.barkBaseUrl.trim() || DEFAULT_BARK_BASE_URL,
            ...(barkDeviceKey ? { device_key: barkDeviceKey } : {}),
          },
        },
      };
      const savedCfg = await serviceFactory.setBambooConfig(configPatch);
      setNotifications(savedCfg.notifications);
      setDraft(draftFromConfig(savedCfg.notifications));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setTestError(null);
    setAttempted(null);
    try {
      const res = await agentApiClient.post<{ attempted: string[] }>("notifications/test");
      setAttempted(res.attempted);
    } catch (error) {
      setTestError(getErrorMessage(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card size="small" className="lotus-settings-card" loading={loading}>
      <Flex vertical gap={token.marginMD}>
        <Text strong>{t("settings.notificationsTab.channels.title", "Notification Channels")}</Text>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t(
            "settings.notificationsTab.channels.description",
            "Configure how the backend delivers notifications (desktop, ntfy, Bark). Saved settings apply to every device.",
          )}
        </Text>

        {loadError ? (
          <Alert
            type="error"
            showIcon
            message={loadError}
            action={
              <Button size="small" onClick={() => void load()}>
                {t("settings.notificationsTab.channels.retry", "Retry")}
              </Button>
            }
          />
        ) : null}

        {!loading && !loadError && (
          <>
            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Flex vertical gap={token.marginXS}>
              <Text>{t("settings.notificationsTab.channels.desktop.title", "Desktop")}</Text>
              <Select<DesktopMode>
                data-testid="channel-desktop-mode"
                value={draft.desktopMode}
                onChange={(value) => patch({ desktopMode: value })}
                options={[
                  {
                    value: "auto",
                    label: t(
                      "settings.notificationsTab.channels.desktop.auto",
                      "Auto (on when standalone, off when embedded in Bodhi)",
                    ),
                  },
                  { value: "on", label: t("settings.notificationsTab.channels.desktop.on", "On") },
                  {
                    value: "off",
                    label: t("settings.notificationsTab.channels.desktop.off", "Off"),
                  },
                ]}
              />
            </Flex>

            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Flex vertical gap={token.marginXS}>
              <Flex align="center" justify="space-between" gap={token.marginSM}>
                <Text>{t("settings.notificationsTab.channels.ntfy.title", "ntfy")}</Text>
                <Switch
                  data-testid="channel-ntfy-enabled"
                  checked={draft.ntfyEnabled}
                  onChange={(checked) => patch({ ntfyEnabled: checked })}
                  aria-label={t("settings.notificationsTab.channels.ntfy.enable", "Enable ntfy")}
                />
              </Flex>
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.notificationsTab.channels.ntfy.baseUrl", "Base URL")}
                </Text>
                <Input
                  data-testid="channel-ntfy-base-url"
                  value={draft.ntfyBaseUrl}
                  onChange={(e) => patch({ ntfyBaseUrl: e.target.value })}
                  placeholder={DEFAULT_NTFY_BASE_URL}
                />
              </label>
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.notificationsTab.channels.ntfy.topic", "Topic")}
                </Text>
                <Input
                  data-testid="channel-ntfy-topic"
                  value={draft.ntfyTopic}
                  onChange={(e) => patch({ ntfyTopic: e.target.value })}
                  placeholder={t(
                    "settings.notificationsTab.channels.ntfy.topicPlaceholder",
                    "my-bamboo-topic",
                  )}
                />
              </label>
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t(
                    "settings.notificationsTab.channels.ntfy.token",
                    "Token (optional, for self-hosted instances)",
                  )}
                </Text>
                <Input.Password
                  data-testid="channel-ntfy-token"
                  value={draft.ntfyToken}
                  onChange={(e) => patch({ ntfyToken: e.target.value })}
                  placeholder={
                    hasStoredNtfyToken
                      ? t(
                          "settings.notificationsTab.channels.ntfy.tokenPlaceholderConfigured",
                          "Configured — leave blank to keep",
                        )
                      : t(
                          "settings.notificationsTab.channels.ntfy.tokenPlaceholderEmpty",
                          "Not required for the public ntfy.sh topic",
                        )
                  }
                />
              </label>
            </Flex>

            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Flex vertical gap={token.marginXS}>
              <Flex align="center" justify="space-between" gap={token.marginSM}>
                <Text>{t("settings.notificationsTab.channels.bark.title", "Bark")}</Text>
                <Switch
                  data-testid="channel-bark-enabled"
                  checked={draft.barkEnabled}
                  onChange={(checked) => patch({ barkEnabled: checked })}
                  aria-label={t("settings.notificationsTab.channels.bark.enable", "Enable Bark")}
                />
              </Flex>
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.notificationsTab.channels.bark.baseUrl", "Base URL")}
                </Text>
                <Input
                  data-testid="channel-bark-base-url"
                  value={draft.barkBaseUrl}
                  onChange={(e) => patch({ barkBaseUrl: e.target.value })}
                  placeholder={DEFAULT_BARK_BASE_URL}
                />
              </label>
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.notificationsTab.channels.bark.deviceKey", "Device Key")}
                </Text>
                <Input.Password
                  data-testid="channel-bark-device-key"
                  value={draft.barkDeviceKey}
                  onChange={(e) => patch({ barkDeviceKey: e.target.value })}
                  placeholder={
                    hasStoredBarkKey
                      ? t(
                          "settings.notificationsTab.channels.bark.deviceKeyPlaceholderConfigured",
                          "Configured — leave blank to keep",
                        )
                      : t(
                          "settings.notificationsTab.channels.bark.deviceKeyPlaceholderEmpty",
                          "The device key from the Bark iOS app",
                        )
                  }
                />
              </label>
            </Flex>

            {saveError ? <Alert type="error" showIcon message={saveError} /> : null}

            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Flex align="center" justify="space-between" gap={token.marginSM} wrap="wrap">
              <Flex vertical gap={token.marginXXS}>
                <Button
                  data-testid="channel-test-button"
                  size="small"
                  onClick={() => void sendTest()}
                  disabled={testing}
                >
                  {testing
                    ? t("settings.notificationsTab.channels.testing", "Sending…")
                    : t("settings.notificationsTab.channels.test", "Send test notification")}
                </Button>
                {attempted ? (
                  <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                    {attempted.length > 0
                      ? t("settings.notificationsTab.channels.testAttempted", {
                          defaultValue: "Attempted: {{channels}}",
                          channels: attempted.join(", "),
                        })
                      : t(
                          "settings.notificationsTab.channels.testNone",
                          "No channels are currently enabled",
                        )}
                  </Text>
                ) : null}
                {testError ? (
                  <Text type="danger" style={{ fontSize: token.fontSizeSM }}>
                    {testError}
                  </Text>
                ) : null}
              </Flex>
              <Flex align="center" gap={token.marginSM}>
                {saved ? (
                  <Text type="success" style={{ fontSize: token.fontSizeSM }}>
                    {t("settings.notificationsTab.channels.saved", "Saved")}
                  </Text>
                ) : null}
                <Button
                  data-testid="channel-save-button"
                  type="primary"
                  size="small"
                  onClick={() => void save()}
                  disabled={saving}
                >
                  {saving
                    ? t("settings.notificationsTab.channels.saving", "Saving…")
                    : t("settings.notificationsTab.channels.save", "Save channel settings")}
                </Button>
              </Flex>
            </Flex>
          </>
        )}
      </Flex>
    </Card>
  );
};

export default NotificationChannelsSection;
