import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Table, Input, InputNumber, Button, Space, Card, Typography, Divider, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { SaveOutlined, ReloadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  serviceFactory,
  type BambooConfig,
  type ModelLimitDefault,
} from "../../services/common/ServiceFactory";

const { Title, Text, Paragraph } = Typography;

const MODEL_LIMITS_KEY = "model_limits";
const LEGACY_MODEL_LIMITS_KEY = "modelLimitsConfigs";
const LEGACY_BUDGET_STRATEGY_KEY = "defaultBudgetStrategy";
const DEFAULT_SAFETY_MARGIN = 1000;

interface ModelLimitConfig {
  vendor: string;
  model_pattern: string;
  max_context_tokens: number;
  max_output_tokens: number;
  safety_margin: number;
  note: string;
}

function createFallbackDefaultConfigs(
  t: (key: string, options?: Record<string, unknown>) => string,
): ModelLimitConfig[] {
  return [
    {
      vendor: "OpenAI (GPT-5)",
      model_pattern: "gpt-5.4-thinking",
      max_context_tokens: 1_000_000,
      max_output_tokens: 128_000,
      safety_margin: DEFAULT_SAFETY_MARGIN,
      note: t("settings.modelLimits.defaults.gpt54"),
    },
    {
      vendor: "OpenAI (GPT-5)",
      model_pattern: "gpt-5.3-codex",
      max_context_tokens: 400_000,
      max_output_tokens: 128_000,
      safety_margin: DEFAULT_SAFETY_MARGIN,
      note: t("settings.modelLimits.defaults.gpt53Codex"),
    },
    {
      vendor: "OpenAI (GPT-5)",
      model_pattern: "gpt-5.2-pro",
      max_context_tokens: 256_000,
      max_output_tokens: 64_000,
      safety_margin: DEFAULT_SAFETY_MARGIN,
      note: t("settings.modelLimits.defaults.gpt52Pro"),
    },
    {
      vendor: "OpenAI (GPT-5)",
      model_pattern: "gpt-5-mini",
      max_context_tokens: 400_000,
      max_output_tokens: 128_000,
      safety_margin: DEFAULT_SAFETY_MARGIN,
      note: t("settings.modelLimits.defaults.gpt5Mini"),
    },
    {
      vendor: "OpenAI (Legacy)",
      model_pattern: "gpt-4.1",
      max_context_tokens: 128_000,
      max_output_tokens: 16_384,
      safety_margin: DEFAULT_SAFETY_MARGIN,
      note: t("settings.modelLimits.defaults.gpt41"),
    },
    {
      vendor: "OpenAI (Legacy)",
      model_pattern: "gpt-4o",
      max_context_tokens: 128_000,
      max_output_tokens: 16_000,
      safety_margin: DEFAULT_SAFETY_MARGIN,
      note: t("settings.modelLimits.defaults.gpt4o"),
    },
    {
      vendor: "Google",
      model_pattern: "gemini-2.5-pro",
      max_context_tokens: 128_000,
      max_output_tokens: 16_000,
      safety_margin: DEFAULT_SAFETY_MARGIN,
      note: t("settings.modelLimits.defaults.gemini25Pro"),
    },
    {
      vendor: "Moonshot",
      model_pattern: "kimi-k2.5",
      max_context_tokens: 256_000,
      max_output_tokens: 64_000,
      safety_margin: DEFAULT_SAFETY_MARGIN,
      note: t("settings.modelLimits.defaults.kimiK25"),
    },
    {
      vendor: "Moonshot",
      model_pattern: "kimi-for-coding",
      max_context_tokens: 256_000,
      max_output_tokens: 64_000,
      safety_margin: DEFAULT_SAFETY_MARGIN,
      note: t("settings.modelLimits.defaults.kimiCoding"),
    },
    {
      vendor: "Zhipu",
      model_pattern: "glm-5",
      max_context_tokens: 200_000,
      max_output_tokens: 128_000,
      safety_margin: DEFAULT_SAFETY_MARGIN,
      note: t("settings.modelLimits.defaults.glm5"),
    },
  ];
}

function parseModelLimitDefaults(defaults: ModelLimitDefault[] | unknown): ModelLimitConfig[] {
  if (!Array.isArray(defaults)) {
    return [];
  }
  return parseModelLimits(defaults);
}

function toSafePositiveInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const next = Math.floor(value);
  return next > 0 ? next : fallback;
}

function toSafeNonNegativeInteger(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  const next = Math.floor(value);
  return next >= 0 ? next : fallback;
}

function normalizeModelLimit(value: unknown): ModelLimitConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const row = value as Record<string, unknown>;
  const patternValue = row.model_pattern ?? row.model;
  if (typeof patternValue !== "string" || !patternValue.trim()) {
    return null;
  }

  const maxContextTokens = toSafePositiveInteger(
    row.max_context_tokens ?? row.maxContextTokens,
    128000,
  );
  const maxOutputTokens = toSafePositiveInteger(
    row.max_output_tokens ?? row.maxOutputTokens,
    Math.min(4096, Math.floor(maxContextTokens / 4)),
  );
  const safetyMargin = toSafeNonNegativeInteger(
    row.safety_margin ?? row.safetyMargin,
    DEFAULT_SAFETY_MARGIN,
  );

  return {
    vendor: typeof row.vendor === "string" && row.vendor.trim() ? row.vendor.trim() : "",
    model_pattern: patternValue.trim(),
    max_context_tokens: maxContextTokens,
    max_output_tokens: maxOutputTokens,
    safety_margin: safetyMargin,
    note: typeof row.note === "string" ? row.note : "",
  };
}

function parseModelLimits(value: unknown): ModelLimitConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((row) => normalizeModelLimit(row))
    .filter((row): row is ModelLimitConfig => Boolean(row));
}

function migrateLegacyModelLimitConfigs(): ModelLimitConfig[] {
  const raw = localStorage.getItem(LEGACY_MODEL_LIMITS_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseModelLimits(parsed);
  } catch {
    return [];
  }
}

function getConfigModelLimits(config: BambooConfig): {
  hasModelLimitsKey: boolean;
  modelLimits: ModelLimitConfig[];
} {
  const hasModelLimitsKey = Object.prototype.hasOwnProperty.call(config, MODEL_LIMITS_KEY);

  if (!hasModelLimitsKey) {
    return { hasModelLimitsKey: false, modelLimits: [] };
  }

  return {
    hasModelLimitsKey,
    modelLimits: parseModelLimits(config[MODEL_LIMITS_KEY]),
  };
}

function validateModelLimits(
  configs: ModelLimitConfig[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (configs.length === 0) {
    return t("settings.modelLimits.validation.atLeastOneRow");
  }

  const seenPatterns = new Set<string>();

  for (const config of configs) {
    const pattern = config.model_pattern.trim();
    if (!pattern) {
      return t("settings.modelLimits.validation.modelPatternEmpty");
    }

    const normalizedPattern = pattern.toLowerCase();
    if (seenPatterns.has(normalizedPattern)) {
      return t("settings.modelLimits.validation.duplicateModelPattern", {
        pattern,
      });
    }
    seenPatterns.add(normalizedPattern);

    if (config.max_context_tokens < 1000) {
      return t("settings.modelLimits.validation.contextWindowMin", { pattern });
    }

    if (config.max_output_tokens < 1) {
      return t("settings.modelLimits.validation.maxOutputMin", { pattern });
    }

    if (config.max_output_tokens > config.max_context_tokens) {
      return t("settings.modelLimits.validation.maxOutputExceedsContext", {
        pattern,
      });
    }

    if (config.safety_margin < 0) {
      return t("settings.modelLimits.validation.safetyMarginNegative", {
        pattern,
      });
    }

    if (config.safety_margin >= config.max_context_tokens) {
      return t("settings.modelLimits.validation.safetyMarginTooLarge", {
        pattern,
      });
    }
  }

  return null;
}

/**
 * Settings component for configuring model limits for token budgets.
 *
 * Persisted in `config.json` under the root key `model_limits`.
 */
export const ModelLimitsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [configs, setConfigs] = useState<ModelLimitConfig[]>(() => createFallbackDefaultConfigs(t));
  const [loading, setLoading] = useState(false);
  const [msgApi, contextHolder] = message.useMessage();

  const updateConfig = useCallback((index: number, updates: Partial<ModelLimitConfig>) => {
    setConfigs((prev) =>
      prev.map((config, rowIndex) => (rowIndex === index ? { ...config, ...updates } : config)),
    );
  }, []);

  const addConfigRow = useCallback(() => {
    setConfigs((prev) => [
      ...prev,
      {
        vendor: "",
        model_pattern: "",
        max_context_tokens: 128000,
        max_output_tokens: 4096,
        safety_margin: DEFAULT_SAFETY_MARGIN,
        note: "",
      },
    ]);
  }, []);

  const removeConfigRow = useCallback((index: number) => {
    setConfigs((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  }, []);

  const loadDefaultConfigs = useCallback(async (): Promise<ModelLimitConfig[]> => {
    const fallbackDefaults = createFallbackDefaultConfigs(t);
    const response = await serviceFactory.getModelLimitDefaults();
    const backendDefaults = parseModelLimitDefaults(response.model_limits);
    return backendDefaults.length > 0 ? backendDefaults : fallbackDefaults;
  }, [t]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const bambooConfig = await serviceFactory.getBambooConfig();
      const { hasModelLimitsKey, modelLimits } = getConfigModelLimits(bambooConfig);

      if (modelLimits.length > 0) {
        setConfigs(modelLimits);
        return;
      }

      if (hasModelLimitsKey) {
        setConfigs(await loadDefaultConfigs());
        return;
      }

      const migrated = migrateLegacyModelLimitConfigs();
      if (migrated.length > 0) {
        await serviceFactory.setBambooConfig({ model_limits: migrated });
        localStorage.removeItem(LEGACY_MODEL_LIMITS_KEY);
        localStorage.removeItem(LEGACY_BUDGET_STRATEGY_KEY);
        setConfigs(migrated);
        msgApi.info(t("settings.modelLimits.migratedFromLocalStorage"));
        return;
      }

      setConfigs(await loadDefaultConfigs());
    } catch (error) {
      console.error("Failed to load model limits settings:", error);
      msgApi.error(t("settings.modelLimits.loadFailed"));
      setConfigs(await loadDefaultConfigs());
    } finally {
      setLoading(false);
    }
  }, [loadDefaultConfigs, msgApi, t]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = async () => {
    const validationError = validateModelLimits(configs, t);
    if (validationError) {
      msgApi.error(validationError);
      return;
    }

    setLoading(true);
    try {
      await serviceFactory.setBambooConfig({ model_limits: configs });
      msgApi.success(t("settings.modelLimits.saveSuccess"));
    } catch (error) {
      console.error("Failed to save model limits settings:", error);
      msgApi.error(t("settings.modelLimits.saveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const resetToDefaults = async () => {
    setLoading(true);
    try {
      const defaults = await loadDefaultConfigs();
      await serviceFactory.setBambooConfig({ model_limits: defaults });
      setConfigs(defaults);
      localStorage.removeItem(LEGACY_MODEL_LIMITS_KEY);
      localStorage.removeItem(LEGACY_BUDGET_STRATEGY_KEY);
      msgApi.success(t("settings.modelLimits.resetSuccess"));
    } catch (error) {
      console.error("Failed to reset model limits settings:", error);
      msgApi.error(t("settings.modelLimits.resetFailed"));
    } finally {
      setLoading(false);
    }
  };

  const columns: ColumnsType<ModelLimitConfig> = useMemo(
    () => [
      {
        title: t("settings.modelLimits.columns.vendor"),
        dataIndex: "vendor",
        key: "vendor",
        width: 170,
        render: (value: string, _record, index) => (
          <Input
            value={value}
            placeholder={t("settings.modelLimits.placeholders.vendor")}
            onChange={(event) => updateConfig(index, { vendor: event.target.value })}
          />
        ),
      },
      {
        title: t("settings.modelLimits.columns.model"),
        dataIndex: "model_pattern",
        key: "model_pattern",
        width: 220,
        render: (value: string, _record, index) => (
          <Input
            value={value}
            placeholder={t("settings.modelLimits.placeholders.model")}
            onChange={(event) => updateConfig(index, { model_pattern: event.target.value })}
          />
        ),
      },
      {
        title: t("settings.modelLimits.columns.contextWindow"),
        dataIndex: "max_context_tokens",
        key: "max_context_tokens",
        width: 180,
        render: (value: number, _record, index) => (
          <InputNumber
            value={value}
            onChange={(next) =>
              updateConfig(index, {
                max_context_tokens: Math.max(1000, Number(next) || 128000),
              })
            }
            min={1000}
            max={2000000}
            step={1000}
            style={{ width: "100%" }}
          />
        ),
      },
      {
        title: t("settings.modelLimits.columns.maxOutput"),
        dataIndex: "max_output_tokens",
        key: "max_output_tokens",
        width: 160,
        render: (value: number, _record, index) => (
          <InputNumber
            value={value}
            onChange={(next) =>
              updateConfig(index, {
                max_output_tokens: Math.max(1, Number(next) || 4096),
              })
            }
            min={1}
            max={2000000}
            step={256}
            style={{ width: "100%" }}
          />
        ),
      },
      {
        title: t("settings.modelLimits.columns.notes"),
        dataIndex: "note",
        key: "note",
        width: 240,
        render: (value: string, _record, index) => (
          <Input
            value={value}
            placeholder={t("settings.modelLimits.placeholders.optional")}
            onChange={(event) => updateConfig(index, { note: event.target.value })}
          />
        ),
      },
      {
        title: t("settings.modelLimits.columns.actions"),
        key: "actions",
        width: 100,
        render: (_value, _record, index) => (
          <Button danger size="small" onClick={() => removeConfigRow(index)}>
            {t("settings.modelLimits.actions.remove")}
          </Button>
        ),
      },
    ],
    [removeConfigRow, t, updateConfig],
  );

  return (
    <div className="model-limits-settings">
      {contextHolder}
      <Card>
        <Title level={4}>{t("settings.modelLimits.title")}</Title>
        <Paragraph type="secondary">
          {t("settings.modelLimits.descriptionPrefix")} <Text code>config.json</Text>{" "}
          {t("settings.modelLimits.descriptionSuffix")}
        </Paragraph>

        <Divider />

        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Text strong>{t("settings.modelLimits.defaultsTitle")}</Text>
          <Text type="secondary">{t("settings.modelLimits.defaultsDescription")}</Text>
        </Space>

        <Table
          dataSource={configs}
          columns={columns}
          rowKey={(row, index) => `${row.model_pattern}-${index}`}
          pagination={false}
          size="small"
          style={{ margin: "16px 0" }}
          scroll={{ x: 1150 }}
        />

        <Space>
          <Button onClick={addConfigRow}>{t("settings.modelLimits.actions.addRow")}</Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={() => void saveSettings()}
            loading={loading}
          >
            {t("settings.modelLimits.actions.save")}
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void resetToDefaults()}
            loading={loading}
          >
            {t("settings.modelLimits.actions.resetToDefaults")}
          </Button>
          <Button onClick={() => void loadSettings()} loading={loading}>
            {t("settings.modelLimits.actions.reload")}
          </Button>
        </Space>
      </Card>
    </div>
  );
};

export default ModelLimitsSettings;
