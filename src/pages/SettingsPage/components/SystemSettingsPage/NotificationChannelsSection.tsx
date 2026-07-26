import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Divider,
  Flex,
  Input,
  Select,
  Switch,
  Tag,
  Typography,
  theme,
} from "antd";
import { useTranslation } from "react-i18next";
import { agentApiClient, getErrorMessage } from "@services/api";
import type {
  ConfigSectionEnvelope,
  NotificationCredentialStatus,
  NotificationSection,
} from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { reapplyConfigChanges } from "@shared/hooks/useConfigSectionDraft";

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

function draftFromConfig(notifications: NotificationSection | undefined): ChannelsDraft {
  const desktopEnabled = notifications?.desktop.enabled;
  return {
    desktopMode: desktopEnabled === true ? "on" : desktopEnabled === false ? "off" : "auto",
    ntfyEnabled: notifications?.ntfy.enabled ?? false,
    ntfyBaseUrl: notifications?.ntfy.base_url ?? DEFAULT_NTFY_BASE_URL,
    ntfyTopic: notifications?.ntfy.topic ?? "",
    ntfyToken: "",
    barkEnabled: notifications?.bark.enabled ?? false,
    barkBaseUrl: notifications?.bark.base_url ?? DEFAULT_BARK_BASE_URL,
    barkDeviceKey: "",
  };
}

const secretFreeDraft = (draft: ChannelsDraft) => ({
  ...draft,
  ntfyToken: draft.ntfyToken ? "[replace requested]" : "",
  barkDeviceKey: draft.barkDeviceKey ? "[replace requested]" : "",
});

/**
 * Notification delivery channels: native desktop plus ntfy/Bark push relays.
 *
 * Reads/writes the versioned `notifications` section and sends its expected
 * revision on every update. Secret inputs are write-only: status metadata is
 * displayed separately, untouched values are omitted, and clear is explicit.
 */
const NotificationChannelsSection: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [notifications, setNotifications] = useState<NotificationSection | undefined>(undefined);
  const [draft, setDraft] = useState<ChannelsDraft>(() => draftFromConfig(undefined));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState<string[] | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [clearNtfyToken, setClearNtfyToken] = useState(false);
  const [clearBarkKey, setClearBarkKey] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const baseDraftRef = useRef<ChannelsDraft | null>(null);
  const snapshot = useConfigSectionStore((state) => state.sections.notifications);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const saveNotifications = useConfigSectionStore((state) => state.saveNotifications);

  const adoptEnvelope = useCallback((envelope: ConfigSectionEnvelope<NotificationSection>) => {
    setNotifications(envelope.data);
    const nextDraft = draftFromConfig(envelope.data);
    setDraft(nextDraft);
    baseDraftRef.current = structuredClone(nextDraft);
    setBaseRevision(envelope.revision);
    setDirty(false);
    setClearNtfyToken(false);
    setClearBarkKey(false);
    setShowComparison(false);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const envelope = await loadSection("notifications", { force: true });
      adoptEnvelope(envelope);
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [adoptEnvelope, loadSection]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const envelope = snapshot.envelope;
    if (!envelope || baseRevision === null || envelope.revision === baseRevision || dirty) return;
    adoptEnvelope(envelope);
  }, [adoptEnvelope, baseRevision, dirty, snapshot.envelope]);

  const patch = (p: Partial<ChannelsDraft>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };

  const hasStoredNtfyToken = notifications?.ntfy.credential.configured ?? false;
  const hasStoredBarkKey = notifications?.bark.credential.configured ?? false;
  const externalRevision =
    dirty && snapshot.envelope && baseRevision !== snapshot.envelope.revision
      ? snapshot.envelope.revision
      : null;

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const ntfyToken = draft.ntfyToken.trim();
      const barkDeviceKey = draft.barkDeviceKey.trim();
      if (baseRevision === null) throw new Error("Notification configuration is not loaded.");
      const savedEnvelope = await saveNotifications(
        {
          desktop: {
            // "auto" clears the override back to null (server picks
            // standalone-vs-sidecar default); "on"/"off" is explicit.
            enabled: draft.desktopMode === "auto" ? null : draft.desktopMode === "on",
          },
          ntfy: {
            enabled: draft.ntfyEnabled,
            base_url: draft.ntfyBaseUrl.trim() || DEFAULT_NTFY_BASE_URL,
            topic: draft.ntfyTopic.trim(),
            ...(clearNtfyToken ? { token: null } : ntfyToken ? { token: ntfyToken } : {}),
          },
          bark: {
            enabled: draft.barkEnabled,
            base_url: draft.barkBaseUrl.trim() || DEFAULT_BARK_BASE_URL,
            ...(clearBarkKey
              ? { device_key: null }
              : barkDeviceKey
                ? { device_key: barkDeviceKey }
                : {}),
          },
        },
        baseRevision,
      );
      adoptEnvelope(savedEnvelope);
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

  const comparison =
    showComparison && externalRevision !== null && snapshot.envelope && baseDraftRef.current
      ? JSON.stringify(
          {
            baseRevision,
            latestRevision: snapshot.envelope.revision,
            base: secretFreeDraft(baseDraftRef.current),
            draft: {
              ...secretFreeDraft(draft),
              clearNtfyToken,
              clearBarkKey,
            },
            latest: secretFreeDraft(draftFromConfig(snapshot.envelope.data)),
          },
          null,
          2,
        )
      : null;

  const credentialStatus = (status: NotificationCredentialStatus) => {
    const fromEnvironment =
      status.configured && (status.source === "environment" || status.source === "env");
    const label = fromEnvironment ? "From env" : status.configured ? "Configured" : "Missing";
    return (
      <Flex align="center" gap={8} wrap="wrap">
        <Tag color={status.configured ? "success" : "warning"}>{label}</Tag>
        {fromEnvironment ? (
          <Text type="secondary">
            The environment value is read-only; only an explicit replacement is persisted.
          </Text>
        ) : null}
      </Flex>
    );
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

        {externalRevision !== null ? (
          <Alert
            type="warning"
            showIcon
            message="Notification configuration changed on disk"
            description={`Your draft is based on revision ${baseRevision}; revision ${externalRevision} is now available.`}
            action={
              <Flex gap={8}>
                <Button size="small" onClick={() => void load()}>
                  Reload
                </Button>
                <Button size="small" onClick={() => setShowComparison((current) => !current)}>
                  Compare
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    if (!snapshot.envelope || !baseDraftRef.current) return;
                    const latest = draftFromConfig(snapshot.envelope.data);
                    setDraft(reapplyConfigChanges(baseDraftRef.current, draft, latest));
                    setNotifications(snapshot.envelope.data);
                    baseDraftRef.current = structuredClone(latest);
                    setBaseRevision(snapshot.envelope.revision);
                    setShowComparison(false);
                  }}
                >
                  Reapply
                </Button>
              </Flex>
            }
          />
        ) : null}

        {comparison ? (
          <pre
            data-testid="notification-revision-comparison"
            style={{ maxHeight: 240, overflow: "auto", whiteSpace: "pre-wrap" }}
          >
            {comparison}
          </pre>
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
                  onChange={(e) => {
                    setClearNtfyToken(false);
                    patch({ ntfyToken: e.target.value });
                  }}
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
              {notifications ? credentialStatus(notifications.ntfy.credential) : null}
              {hasStoredNtfyToken ? (
                <Button
                  size="small"
                  danger={clearNtfyToken}
                  onClick={() => {
                    setClearNtfyToken((current) => !current);
                    setDraft((current) => ({ ...current, ntfyToken: "" }));
                    setDirty(true);
                  }}
                >
                  {clearNtfyToken ? "Token will be cleared on save" : "Clear configured token"}
                </Button>
              ) : null}
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
              {hasStoredBarkKey ? (
                <Button
                  size="small"
                  danger={clearBarkKey}
                  onClick={() => {
                    setClearBarkKey((current) => !current);
                    setDraft((current) => ({ ...current, barkDeviceKey: "" }));
                    setDirty(true);
                  }}
                >
                  {clearBarkKey
                    ? "Device key will be cleared on save"
                    : "Clear configured device key"}
                </Button>
              ) : null}
              <label>
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.notificationsTab.channels.bark.deviceKey", "Device Key")}
                </Text>
                <Input.Password
                  data-testid="channel-bark-device-key"
                  value={draft.barkDeviceKey}
                  onChange={(e) => {
                    setClearBarkKey(false);
                    patch({ barkDeviceKey: e.target.value });
                  }}
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
              {notifications ? credentialStatus(notifications.bark.credential) : null}
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
