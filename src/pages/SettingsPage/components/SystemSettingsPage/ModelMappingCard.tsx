import React, { useState, useEffect, useCallback } from "react";
import {
  Collapse,
  Select,
  Space,
  Typography,
  Divider,
  theme,
  message,
  Alert,
  Button,
  Spin,
  Input,
  Modal,
} from "antd";
import { useTranslation } from "react-i18next";
import { ReloadOutlined } from "@ant-design/icons";
import { serviceFactory } from "@services/common/ServiceFactory";
import { settingsService } from "@services/config/SettingsService";

const { Text } = Typography;
const { useToken } = theme;

interface ModelMapping {
  [key: string]: string;
}

// Model cache with 5-minute expiration
interface ModelCache {
  [provider: string]: {
    models: string[];
    timestamp: number;
  };
}

const CACHE_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

export const ModelMappingCard: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [mappings, setMappings] = useState<ModelMapping>({});
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [msgApi, msgContextHolder] = message.useMessage();

  // Model cache state
  const [modelCache, setModelCache] = useState<ModelCache>({});

  // Custom model input modal state
  const [customModalVisible, setCustomModalVisible] = useState(false);
  const [customModelType, setCustomModelType] = useState<string>("");
  const [customModelName, setCustomModelName] = useState<string>("");

  // Load current provider configuration
  useEffect(() => {
    const loadProviderConfig = async () => {
      try {
        const config = await settingsService.getProviderConfig();
        setCurrentProvider(config.provider || "copilot");
      } catch (error) {
        console.error("Failed to load provider config:", error);
        setError(t("settings.modelMappingCard.loadProviderFailed"));
      }
    };
    loadProviderConfig();
  }, [t]);

  // Listen for provider config changes (polling every 10 seconds)
  useEffect(() => {
    const checkProviderChange = async () => {
      try {
        const config = await settingsService.getProviderConfig();
        const newProvider = config.provider || "copilot";

        if (newProvider !== currentProvider && currentProvider !== "") {
          console.log(
            `Provider changed from ${currentProvider} to ${newProvider}`,
          );
          setCurrentProvider(newProvider);
          setError(null);
        }
      } catch (error) {
        console.error("Failed to check provider change:", error);
      }
    };

    const interval = setInterval(checkProviderChange, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, [currentProvider]);

  // Load model mappings
  useEffect(() => {
    const loadMappings = async () => {
      try {
        const response = await serviceFactory.getAnthropicModelMapping();
        setMappings(response.mappings || {});
      } catch (error) {
        console.error("Failed to load model mappings:", error);
        msgApi.error(t("settings.modelMappingCard.loadMappingsFailed"));
      }
    };
    loadMappings();
  }, [msgApi, t]);

  // Fetch models with caching
  const fetchModels = useCallback(
    async (forceRefresh = false) => {
      if (!currentProvider) return;

      // Check cache first (unless force refresh)
      if (!forceRefresh && modelCache[currentProvider]) {
        const cached = modelCache[currentProvider];
        const now = Date.now();

        if (now - cached.timestamp < CACHE_EXPIRATION_MS) {
          console.log(`Using cached models for ${currentProvider}`);
          setAvailableModels(cached.models);
          setError(null);
          return;
        }
      }

      setIsLoadingModels(true);
      setError(null);

      try {
        let models: string[];

        // For Copilot provider, use the /models endpoint (via modelService)
        // For other providers, use /bamboo/settings/provider/models
        if (currentProvider === "copilot") {
          const { modelService } = await import(
            "../../../../services/chat/ModelService"
          );
          models = await modelService.getModels();
        } else {
          models = await settingsService.fetchProviderModels(currentProvider);
        }

        setAvailableModels(models);

        // Update cache
        setModelCache((prev) => ({
          ...prev,
          [currentProvider]: {
            models,
            timestamp: Date.now(),
          },
        }));

        console.log(`Fetched ${models.length} models for ${currentProvider}`);
      } catch (error) {
        console.error("Failed to fetch models:", error);
        const errorMessage =
          error instanceof Error
            ? error.message
            : t("settings.modelMappingCard.loadModelsFailed");
        setError(errorMessage);
        msgApi.error(t("settings.modelMappingCard.loadModelsHint"));
        setAvailableModels([]);
      } finally {
        setIsLoadingModels(false);
      }
    },
    [currentProvider, modelCache, msgApi, t],
  );

  // Fetch models when provider changes
  useEffect(() => {
    if (currentProvider) {
      fetchModels();
    }
  }, [currentProvider, fetchModels]);

  const handleMappingChange = async (
    modelType: string,
    selectedModel: string,
  ) => {
    // Handle custom input
    if (selectedModel === "__custom__") {
      setCustomModelType(modelType);
      setCustomModelName("");
      setCustomModalVisible(true);
      return;
    }

    if (!selectedModel) {
      return; // Don't save empty values
    }

    const newMappings = { ...mappings, [modelType]: selectedModel };
    setMappings(newMappings);

    try {
      await serviceFactory.setAnthropicModelMapping({ mappings: newMappings });
      msgApi.success(t("settings.modelMappingCard.mappingSaved"));
    } catch (error) {
      console.error("Failed to save model mapping:", error);
      msgApi.error(t("settings.modelMappingCard.mappingSaveFailed"));
    }
  };

  const handleCustomModelSave = async () => {
    if (!customModelName.trim()) {
      msgApi.warning(t("settings.modelMappingCard.enterModelName"));
      return;
    }

    const newMappings = {
      ...mappings,
      [customModelType]: customModelName.trim(),
    };
    setMappings(newMappings);

    try {
      await serviceFactory.setAnthropicModelMapping({ mappings: newMappings });
      msgApi.success(t("settings.modelMappingCard.customMappingSaved"));
      setCustomModalVisible(false);
      setCustomModelName("");
    } catch (error) {
      console.error("Failed to save custom model mapping:", error);
      msgApi.error(t("settings.modelMappingCard.customMappingSaveFailed"));
    }
  };

  const handleRefreshModels = () => {
    fetchModels(true); // Force refresh
  };

  // Validate if a mapped model still exists in available models
  const validateMapping = (modelType: string): boolean => {
    const mappedModel = mappings[modelType];
    if (!mappedModel) return true; // No mapping is valid
    return availableModels.includes(mappedModel);
  };

  const modelTypes = [
    {
      key: "opus",
      label: t("settings.modelMappingCard.modelTypeOpus"),
      description: t("settings.modelMappingCard.modelTypeOpusDescription"),
    },
    {
      key: "sonnet",
      label: t("settings.modelMappingCard.modelTypeSonnet"),
      description: t("settings.modelMappingCard.modelTypeSonnetDescription"),
    },
    {
      key: "haiku",
      label: t("settings.modelMappingCard.modelTypeHaiku"),
      description: t("settings.modelMappingCard.modelTypeHaikuDescription"),
    },
  ];
  const providerLabel =
    currentProvider.charAt(0).toUpperCase() + currentProvider.slice(1);

  const collapseItems = [
    {
      key: "1",
      label: t("settings.modelMappingCard.collapseTitle"),
      children: (
        <Space
          direction="vertical"
          size={token.marginSM}
          style={{ width: "100%" }}
        >
          <Text type="secondary">
            {t("settings.modelMappingCard.description", {
              provider: providerLabel,
            })}
          </Text>

          {/* Error Alert with Retry Button */}
          {error && (
            <Alert
              type="error"
              message={t("settings.modelMappingCard.loadModelsErrorTitle")}
              description={error}
              showIcon
              action={
                <Button
                  size="small"
                  icon={<ReloadOutlined />}
                  onClick={handleRefreshModels}
                  loading={isLoadingModels}
                >
                  {t("settings.modelMappingCard.retry")}
                </Button>
              }
            />
          )}

          {/* Loading State */}
          {isLoadingModels && !error && (
            <div style={{ textAlign: "center", padding: token.paddingMD }}>
              <Spin tip={t("settings.modelMappingCard.loadingModels")} />
            </div>
          )}

          {/* Model Mapping Selections */}
          {!isLoadingModels &&
            !error &&
            modelTypes.map(({ key, label, description }) => {
              const isMappingValid = validateMapping(key);
              const mappedModel = mappings[key];

              return (
                <Space
                  key={key}
                  direction="vertical"
                  size={token.marginXXS}
                  style={{ width: "100%" }}
                >
                  <Text type="secondary">
                    {label} ({description})
                  </Text>
                  <Select
                    style={{ width: "100%" }}
                    value={mappedModel || undefined}
                    onChange={(value) => handleMappingChange(key, value)}
                    placeholder={t(
                      "settings.modelMappingCard.selectModelPlaceholder",
                      { label },
                    )}
                    loading={isLoadingModels}
                    disabled={isLoadingModels || availableModels.length === 0}
                    showSearch
                    allowClear
                    optionFilterProp="children"
                    options={[
                      ...availableModels.map((m) => ({ label: m, value: m })),
                      {
                        label: `✏️ ${t("settings.modelMappingCard.customModelOption")}`,
                        value: "__custom__",
                      },
                    ]}
                    status={!isMappingValid ? "warning" : undefined}
                    filterOption={(input, option) =>
                      (option?.label ?? "")
                        .toString()
                        .toLowerCase()
                        .includes(input.toLowerCase())
                    }
                  />
                  {/* Model Validation Warning */}
                  {!isMappingValid && mappedModel && (
                    <Text type="warning" style={{ fontSize: token.fontSizeSM }}>
                      {t("settings.modelMappingCard.mappedModelNotFound", {
                        model: mappedModel,
                      })}
                    </Text>
                  )}
                </Space>
              );
            })}

          <Divider style={{ margin: `${token.marginSM} 0` }} />

          {/* Action Buttons */}
          <Space style={{ width: "100%", justifyContent: "flex-end" }}>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              onClick={handleRefreshModels}
              loading={isLoadingModels}
              disabled={!currentProvider}
            >
              {t("settings.modelMappingCard.refreshModels")}
            </Button>
          </Space>

          {/* Status Information */}
          <Space
            direction="vertical"
            size={token.marginXXS}
            style={{ width: "100%" }}
          >
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {t("settings.modelMappingCard.currentProvider")}:{" "}
              <Text strong>
                {currentProvider ||
                  t("settings.modelMappingCard.loadingProvider")}
              </Text>
            </Text>
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {t("settings.modelMappingCard.availableModels")}:{" "}
              <Text strong>{availableModels.length}</Text>
              {modelCache[currentProvider] && (
                <Text type="secondary" style={{ marginLeft: token.marginXXS }}>
                  {t("settings.modelMappingCard.cached")}
                </Text>
              )}
            </Text>
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {t("settings.modelMappingCard.storedIn")}:{" "}
              <Text code>~/.bamboo/anthropic-model-mapping.json</Text>
            </Text>
          </Space>
        </Space>
      ),
    },
  ];

  return (
    <>
      {msgContextHolder}
      <Collapse
        size="small"
        items={collapseItems}
        style={{ marginBottom: token.marginSM }}
      />

      {/* Custom Model Input Modal */}
      <Modal
        title={t("settings.modelMappingCard.customModalTitle")}
        open={customModalVisible}
        onOk={handleCustomModelSave}
        onCancel={() => {
          setCustomModalVisible(false);
          setCustomModelName("");
        }}
        okText={t("settings.modelMappingCard.save")}
        cancelText={t("settings.modelMappingCard.cancel")}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Text type="secondary">
            {t("settings.modelMappingCard.customModalDescription", {
              modelType: customModelType,
            })}
          </Text>
          <Input
            placeholder={t("settings.modelMappingCard.customModalPlaceholder")}
            value={customModelName}
            onChange={(e) => setCustomModelName(e.target.value)}
            onPressEnter={handleCustomModelSave}
            autoFocus
          />
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            {t("settings.modelMappingCard.customModalNote")}
          </Text>
        </Space>
      </Modal>
    </>
  );
};
