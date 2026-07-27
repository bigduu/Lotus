import React, { useEffect, useState } from "react";
import { App as AntApp, Card, Flex, Switch, Typography, theme, Divider, Alert } from "antd";
import { useTranslation } from "react-i18next";
import { DesktopOutlined, BellOutlined } from "@ant-design/icons";
import {
  getNotificationPreferences,
  setNotificationPreferences,
  type NotificationPreferences,
} from "@services/notification/notificationPreferencesApi";
import { isTauriEnvironment } from "../../../../utils/environment";
import NotificationChannelsSection from "./NotificationChannelsSection";

const { Text } = Typography;
const { useToken } = theme;

const DEFAULT_PREFS: NotificationPreferences = {
  enabled: true,
  onClarification: true,
  onToolApproval: true,
  onContextPressure: true,
  onSubAgentComplete: true,
  onBackgroundTaskComplete: true,
  onRunComplete: true,
  onRunFailed: true,
};

const SystemSettingsNotificationsTab: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const { message } = AntApp.useApp();
  const [prefs, setPrefsState] = useState<NotificationPreferences>(DEFAULT_PREFS);
  const [loading, setLoading] = useState(true);
  const isTauri = isTauriEnvironment();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await getNotificationPreferences();
        if (!cancelled) {
          setPrefsState(loaded);
        }
      } catch {
        if (!cancelled) {
          message.error(t("settings.notificationsTab.loadError"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [message, t]);

  const updatePref = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K],
  ) => {
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    // Optimistic update; revert on failure.
    setPrefsState(next);
    void setNotificationPreferences(next)
      .then((saved) => {
        setPrefsState(saved);
      })
      .catch(() => {
        setPrefsState(previous);
        message.error(t("settings.notificationsTab.saveError"));
      });
  };

  const controlsDisabled = !isTauri || loading;

  const notificationPrefsCard = (
    <Card size="small" className="lotus-settings-card">
      <Flex vertical gap={token.marginMD}>
        {!isTauri && (
          <Alert type="info" showIcon message={t("settings.notificationsTab.desktopOnly")} />
        )}

        <Flex align="center" gap={token.marginSM}>
          <BellOutlined />
          <Text strong>{t("settings.notificationsTab.title")}</Text>
        </Flex>

        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t("settings.notificationsTab.description")}
        </Text>

        <Divider style={{ margin: `${token.marginXS}px 0` }} />

        <Flex align="center" justify="space-between" gap={token.marginSM}>
          <Text>{t("settings.notificationsTab.enabled")}</Text>
          <Switch
            data-testid="notification-enabled-toggle"
            checked={prefs.enabled}
            onChange={(checked) => updatePref("enabled", checked)}
            disabled={controlsDisabled}
          />
        </Flex>

        <Divider style={{ margin: `${token.marginXS}px 0` }} />

        <Text strong style={{ fontSize: token.fontSizeSM, opacity: prefs.enabled ? 1 : 0.5 }}>
          {t("settings.notificationsTab.events")}
        </Text>

        <Flex
          vertical
          gap={token.marginSM}
          style={{
            opacity: prefs.enabled ? 1 : 0.5,
            pointerEvents: prefs.enabled ? "auto" : "none",
          }}
        >
          <Flex align="center" justify="space-between" gap={token.marginSM}>
            <Text>{t("settings.notificationsTab.onClarification")}</Text>
            <Switch
              data-testid="notification-clarification-toggle"
              checked={prefs.onClarification}
              onChange={(checked) => updatePref("onClarification", checked)}
              disabled={controlsDisabled}
            />
          </Flex>

          <Flex align="center" justify="space-between" gap={token.marginSM}>
            <Text>{t("settings.notificationsTab.onToolApproval")}</Text>
            <Switch
              data-testid="notification-tool-approval-toggle"
              checked={prefs.onToolApproval}
              onChange={(checked) => updatePref("onToolApproval", checked)}
              disabled={controlsDisabled}
            />
          </Flex>

          <Flex align="center" justify="space-between" gap={token.marginSM}>
            <Text>{t("settings.notificationsTab.onContextPressure")}</Text>
            <Switch
              data-testid="notification-context-pressure-toggle"
              checked={prefs.onContextPressure}
              onChange={(checked) => updatePref("onContextPressure", checked)}
              disabled={controlsDisabled}
            />
          </Flex>

          <Flex align="center" justify="space-between" gap={token.marginSM}>
            <Text>{t("settings.notificationsTab.onSubAgentComplete")}</Text>
            <Switch
              data-testid="notification-subagent-complete-toggle"
              checked={prefs.onSubAgentComplete}
              onChange={(checked) => updatePref("onSubAgentComplete", checked)}
              disabled={controlsDisabled}
            />
          </Flex>

          <Flex align="center" justify="space-between" gap={token.marginSM}>
            <Text>{t("settings.notificationsTab.onBackgroundTaskComplete")}</Text>
            <Switch
              data-testid="notification-background-task-complete-toggle"
              checked={prefs.onBackgroundTaskComplete}
              onChange={(checked) => updatePref("onBackgroundTaskComplete", checked)}
              disabled={controlsDisabled}
            />
          </Flex>

          <Flex align="center" justify="space-between" gap={token.marginSM}>
            <Text>{t("settings.notificationsTab.onRunComplete")}</Text>
            <Switch
              data-testid="notification-run-complete-toggle"
              checked={prefs.onRunComplete}
              onChange={(checked) => updatePref("onRunComplete", checked)}
              disabled={controlsDisabled}
            />
          </Flex>

          <Flex align="center" justify="space-between" gap={token.marginSM}>
            <Text>{t("settings.notificationsTab.onRunFailed")}</Text>
            <Switch
              data-testid="notification-run-failed-toggle"
              checked={prefs.onRunFailed}
              onChange={(checked) => updatePref("onRunFailed", checked)}
              disabled={controlsDisabled}
            />
          </Flex>
        </Flex>

        <Divider style={{ margin: `${token.marginXS}px 0` }} />

        <Flex align="center" gap={token.marginSM}>
          <DesktopOutlined style={{ color: token.colorPrimary }} />
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {t("settings.notificationsTab.osNote")}
          </Text>
        </Flex>
      </Flex>
    </Card>
  );

  return (
    <Flex vertical gap={token.marginLG}>
      {notificationPrefsCard}
      <NotificationChannelsSection />
    </Flex>
  );
};

export default SystemSettingsNotificationsTab;
