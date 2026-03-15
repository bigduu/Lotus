import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, Flex, Select, Switch, Typography, message, theme } from "antd";
import { serviceFactory } from "../../../../services/common/ServiceFactory";
import { useTranslation } from "react-i18next";

const { Text } = Typography;
const { useToken } = theme;

type ImageFallbackMode = "placeholder" | "error" | "ocr";

const getImageFallbackMode = (config: any): ImageFallbackMode => {
  const mode = String(config?.hooks?.image_fallback?.mode || "placeholder")
    .trim()
    .toLowerCase();
  if (mode === "error" || mode === "ocr") return mode;
  return "placeholder";
};

const getImageFallbackEnabled = (config: any): boolean => {
  const value = config?.hooks?.image_fallback?.enabled;
  return typeof value === "boolean" ? value : false;
};

const SystemSettingsHooksTab: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [msgApi, contextHolder] = message.useMessage();
  const [isLoading, setIsLoading] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<ImageFallbackMode>("placeholder");

  const modeOptions = useMemo(
    () => [
      {
        label: t("settings.hooksTab.mode.placeholder"),
        value: "placeholder" as const,
      },
      { label: t("settings.hooksTab.mode.error"), value: "error" as const },
      { label: t("settings.hooksTab.mode.ocr"), value: "ocr" as const },
    ],
    [t],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const config = await serviceFactory.getBambooConfig();
      setEnabled(getImageFallbackEnabled(config));
      setMode(getImageFallbackMode(config));
    } catch (error) {
      msgApi.error(
        error instanceof Error
          ? error.message
          : t("settings.hooksTab.loadFailed"),
      );
    } finally {
      setIsLoading(false);
    }
  }, [msgApi]);

  const patch = useCallback(
    async (nextEnabled: boolean, nextMode: ImageFallbackMode) => {
      await serviceFactory.setBambooConfig({
        hooks: {
          image_fallback: {
            enabled: nextEnabled,
            mode: nextMode,
          },
        },
      });
    },
    [],
  );

  const handleEnabledChange = useCallback(
    async (checked: boolean) => {
      setIsLoading(true);
      try {
        await patch(checked, mode);
        msgApi.success(
          checked
            ? t("settings.hooksTab.enabled")
            : t("settings.hooksTab.disabled"),
        );
        await load();
      } catch (error) {
        msgApi.error(
          error instanceof Error ? error.message : t("settings.hooksTab.updateFailed"),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [load, mode, msgApi, patch],
  );

  const handleModeChange = useCallback(
    async (nextMode: ImageFallbackMode) => {
      setIsLoading(true);
      try {
        await patch(enabled, nextMode);
        msgApi.success(
          t("settings.hooksTab.modeUpdated", {
            mode:
              modeOptions.find((option) => option.value === nextMode)?.label ??
              nextMode,
          }),
        );
        await load();
      } catch (error) {
        msgApi.error(
          error instanceof Error
            ? error.message
            : t("settings.hooksTab.modeUpdateFailed"),
        );
      } finally {
        setIsLoading(false);
      }
    },
    [enabled, load, msgApi, patch],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Flex vertical gap={token.marginLG}>
      {contextHolder}
      <Card size="small" loading={isLoading}>
        <Flex vertical gap={token.marginXS}>
          <Text strong>{t("settings.hooksTab.title")}</Text>
          <Flex align="center" justify="space-between">
            <Text>{t("settings.hooksTab.enableImagePreflight")}</Text>
            <Switch checked={enabled} onChange={handleEnabledChange} />
          </Flex>
          <Flex align="center" justify="space-between">
            <Text>{t("settings.hooksTab.modeLabel")}</Text>
            <Select
              style={{ width: 180 }}
              value={mode}
              options={modeOptions}
              onChange={handleModeChange}
              disabled={!enabled}
            />
          </Flex>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {t("settings.hooksTab.description")}
          </Text>
        </Flex>
      </Card>
    </Flex>
  );
};

export default SystemSettingsHooksTab;
