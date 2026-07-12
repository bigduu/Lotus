import { useState } from "react";
import { Alert, Button, Card, Space, Typography, message, theme } from "antd";
import { useTranslation } from "react-i18next";
import { isApiError } from "@services/api";
import { pluginsService, type InstalledPluginView, type PluginSource } from "@services/plugins";
import { usePluginsSettings } from "./hooks/usePluginsSettings";
import { PluginTable } from "./plugins/PluginTable";
import { PluginInstallModal } from "./plugins/PluginInstallModal";

const { Text } = Typography;
const { useToken } = theme;

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (isApiError(error) && error.message.trim()) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
};

const SystemSettingsPluginsTab: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [msgApi, contextHolder] = message.useMessage();
  const { plugins, isLoading, loadError, refresh } = usePluginsSettings();

  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<InstalledPluginView | null>(null);
  const [removingIds, setRemovingIds] = useState<Record<string, boolean>>({});

  const handleInstallSubmit = async (source: PluginSource) => {
    const installed = await pluginsService.installPlugin(source);
    setIsInstallOpen(false);
    msgApi.success(
      t("settings.pluginsTab.install.success", { name: installed.name || installed.id }),
    );
    await refresh();
  };

  const handleUpdateSubmit = async (source: PluginSource) => {
    if (!updateTarget) {
      return;
    }
    const updated = await pluginsService.updatePlugin(updateTarget.id, source);
    setUpdateTarget(null);
    msgApi.success(t("settings.pluginsTab.update.success", { name: updated.name || updated.id }));
    await refresh();
  };

  const handleRemove = async (plugin: InstalledPluginView) => {
    setRemovingIds((prev) => ({ ...prev, [plugin.id]: true }));
    try {
      await pluginsService.deletePlugin(plugin.id);
      msgApi.success(t("settings.pluginsTab.remove.success", { name: plugin.name || plugin.id }));
      await refresh();
    } catch (error) {
      msgApi.error(getErrorMessage(error, t("settings.pluginsTab.remove.genericError")));
    } finally {
      setRemovingIds((prev) => ({ ...prev, [plugin.id]: false }));
    }
  };

  return (
    <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
      {contextHolder}

      <Card
        size="small"
        title={t("settings.pluginsTab.title")}
        extra={
          <Button type="primary" onClick={() => setIsInstallOpen(true)}>
            {t("settings.pluginsTab.install.button")}
          </Button>
        }
      >
        <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
          <Text type="secondary">{t("settings.pluginsTab.description")}</Text>

          {loadError ? (
            <Alert
              type="error"
              showIcon
              message={loadError}
              action={
                <Button size="small" onClick={() => void refresh()}>
                  {t("settings.pluginsTab.retry")}
                </Button>
              }
            />
          ) : null}

          <PluginTable
            plugins={plugins}
            loading={isLoading}
            onUpdate={(plugin) => setUpdateTarget(plugin)}
            onRemove={(plugin) => handleRemove(plugin)}
            isRemoving={(id) => Boolean(removingIds[id])}
          />
        </Space>
      </Card>

      <PluginInstallModal
        open={isInstallOpen}
        mode="install"
        onCancel={() => setIsInstallOpen(false)}
        onSubmit={handleInstallSubmit}
      />

      <PluginInstallModal
        open={Boolean(updateTarget)}
        mode="update"
        pluginLabel={updateTarget ? updateTarget.name || updateTarget.id : undefined}
        onCancel={() => setUpdateTarget(null)}
        onSubmit={handleUpdateSubmit}
      />
    </Space>
  );
};

export default SystemSettingsPluginsTab;
