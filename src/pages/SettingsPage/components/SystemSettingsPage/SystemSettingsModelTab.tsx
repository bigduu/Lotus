import React from "react";
import { Input, Select, Spin, theme } from "antd";
import { Card } from "@/components/ui/card";
import { Space } from "@/components/ui/space";
import { Flex } from "@/components/ui/flex";
import { Typography } from "@/components/ui/typography";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";

const { Text } = Typography;
const { useToken } = theme;

interface SystemSettingsModelTabProps {
  isLoadingModels: boolean;
  modelsError: string | null;
  models: string[];
  selectedModel: string | undefined;
  onModelChange: (model: string) => void;
  backendBaseUrl: string;
  onBackendBaseUrlChange: (value: string) => void;
  onSaveBackendBaseUrl: () => void;
  onResetBackendBaseUrl: () => void;
  hasBackendOverride: boolean;
  defaultBackendBaseUrl: string;
}

const SystemSettingsModelTab: React.FC<SystemSettingsModelTabProps> = ({
  isLoadingModels,
  modelsError,
  models,
  selectedModel,
  onModelChange,
  backendBaseUrl,
  onBackendBaseUrlChange,
  onSaveBackendBaseUrl,
  onResetBackendBaseUrl,
  hasBackendOverride,
  defaultBackendBaseUrl,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const tabGap = token.marginLG;

  return (
    <Flex vertical gap={tabGap}>
      <Card size="small">
        <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
          <Text strong>{t("settings.modelTab.selectModelTitle")}</Text>
          {isLoadingModels ? (
            <div style={{ textAlign: "center", padding: token.paddingMD }}>
              <Spin tip={t("settings.modelTab.loadingModels")} />
            </div>
          ) : modelsError ? (
            <Text type="danger">{modelsError}</Text>
          ) : (
            <Select
              data-testid="model-select"
              style={{ width: "100%" }}
              value={selectedModel}
              onChange={onModelChange}
              placeholder={t("settings.modelTab.selectModelPlaceholder")}
              showSearch
              optionFilterProp="children"
              options={models.map((m) => ({ label: m, value: m }))}
              filterOption={(input, option) =>
                (option?.label ?? "").toString().toLowerCase().includes(input.toLowerCase())
              }
            />
          )}
        </Space>
      </Card>
      <Card size="small">
        <Space direction="vertical" size={token.marginXS} style={{ width: "100%" }}>
          <Text strong>{t("settings.modelTab.backendApiBaseUrlTitle")}</Text>
          <Input
            placeholder={defaultBackendBaseUrl}
            value={backendBaseUrl}
            onChange={(event) => onBackendBaseUrlChange(event.target.value)}
          />
          <Flex justify="flex-end" gap={token.marginSM}>
            <Button disabled={!hasBackendOverride} onClick={onResetBackendBaseUrl}>
              {t("settings.modelTab.resetToDefault")}
            </Button>
            <Button
              data-testid="save-general-settings"
              variant="default"
              onClick={onSaveBackendBaseUrl}
            >
              {t("settings.modelTab.save")}
            </Button>
          </Flex>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {t("settings.modelTab.backendApiHint", {
              example: "http://127.0.0.1:9562/v1",
            })}
          </Text>
        </Space>
      </Card>
    </Flex>
  );
};

export default SystemSettingsModelTab;
