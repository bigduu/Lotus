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

const { Text } = Typography;
const { useToken } = theme;

const DEFAULT_PREFS: NotificationPreferences = {
  enabled: true,
  onClarification: true,
  onToolApproval: true,
  onContextPressure: true,
  onSubAgentComplete: true,
  onBackgroundTaskComplete: true,
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
          message.error(
            t("settings.notificationsTab.loadError", "Failed to load notification preferences"),
          );
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
        message.error(
          t("settings.notificationsTab.saveError", "Failed to save notification preferences"),
        );
      });
  };

  const controlsDisabled = !isTauri || loading;

  return (
    <Card size="small" className="lotus-settings-card">
      <Flex vertical gap={token.marginMD}>
        {!isTauri && (
          <Alert
            type="info"
            showIcon
            message={t(
              "settings.notificationsTab.desktopOnly",
              "Desktop notifications are only available in the Bodhi desktop app.",
            )}
          />
        )}

        <Flex align="center" gap={token.marginSM}>
          <BellOutlined />
          <Text strong>{t("settings.notificationsTab.title", "Desktop Notifications")}</Text>
        </Flex>

        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t(
            "settings.notificationsTab.description",
            "Receive OS-level notifications when the app is in the background and user action is required.",
          )}
        </Text>

        <Divider style={{ margin: `${token.marginXS}px 0` }} />

        <Flex align="center" justify="space-between" gap={token.marginSM}>
          <Text>{t("settings.notificationsTab.enabled", "Enable desktop notifications")}</Text>
          <Switch
            data-testid="notification-enabled-toggle"
            checked={prefs.enabled}
            onChange={(checked) => updatePref("enabled", checked)}
            disabled={controlsDisabled}
          />
        </Flex>

        <Divider style={{ margin: `${token.marginXS}px 0` }} />

        <Text strong style={{ fontSize: token.fontSizeSM, opacity: prefs.enabled ? 1 : 0.5 }}>
          {t("settings.notificationsTab.events", "Notify when:")}
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
            <Text>
              {t("settings.notificationsTab.onClarification", "Agent needs clarification")}
            </Text>
            <Switch
              data-testid="notification-clarification-toggle"
              checked={prefs.onClarification}
              onChange={(checked) => updatePref("onClarification", checked)}
              disabled={controlsDisabled}
            />
          </Flex>

          <Flex align="center" justify="space-between" gap={token.marginSM}>
            <Text>
              {t("settings.notificationsTab.onToolApproval", "Tool execution needs approval")}
            </Text>
            <Switch
              data-testid="notification-tool-approval-toggle"
              checked={prefs.onToolApproval}
              onChange={(checked) => updatePref("onToolApproval", checked)}
              disabled={controlsDisabled}
            />
          </Flex>

          <Flex align="center" justify="space-between" gap={token.marginSM}>
            <Text>
              {t(
                "settings.notificationsTab.onContextPressure",
                "Context window is critically full",
              )}
            </Text>
            <Switch
              data-testid="notification-context-pressure-toggle"
              checked={prefs.onContextPressure}
              onChange={(checked) => updatePref("onContextPressure", checked)}
              disabled={controlsDisabled}
            />
          </Flex>

          <Flex align="center" justify="space-between" gap={token.marginSM}>
            <Text>
              {t("settings.notificationsTab.onSubAgentComplete", "Background task completes")}
            </Text>
            <Switch
              data-testid="notification-subagent-complete-toggle"
              checked={prefs.onSubAgentComplete}
              onChange={(checked) => updatePref("onSubAgentComplete", checked)}
              disabled={controlsDisabled}
            />
          </Flex>

          <Flex align="center" justify="space-between" gap={token.marginSM}>
            <Text>
              {t(
                "settings.notificationsTab.onBackgroundTaskComplete",
                "Background command finishes",
              )}
            </Text>
            <Switch
              data-testid="notification-background-task-complete-toggle"
              checked={prefs.onBackgroundTaskComplete}
              onChange={(checked) => updatePref("onBackgroundTaskComplete", checked)}
              disabled={controlsDisabled}
            />
          </Flex>
        </Flex>

        <Divider style={{ margin: `${token.marginXS}px 0` }} />

        <Flex align="center" gap={token.marginSM}>
          <DesktopOutlined style={{ color: token.colorPrimary }} />
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {t(
              "settings.notificationsTab.osNote",
              "OS notification permissions may also be required. You can manage them in your system settings.",
            )}
          </Text>
        </Flex>
      </Flex>
    </Card>
  );
};

export default SystemSettingsNotificationsTab;
