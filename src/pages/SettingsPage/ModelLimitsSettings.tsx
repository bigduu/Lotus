import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Table,
  Input,
  InputNumber,
  Button,
  Space,
  Card,
  Typography,
  Divider,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { SaveOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  serviceFactory,
  type BambooConfig,
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

const DEFAULT_MODEL_LIMIT_CONFIGS: ModelLimitConfig[] = [
  {
    vendor: "OpenAI (GPT-5)",
    model_pattern: "gpt-5.4-thinking",
    max_context_tokens: 1_000_000,
    max_output_tokens: 128_000,
    safety_margin: DEFAULT_SAFETY_MARGIN,
    note: "Top-tier capability with reasoning depth.",
  },
  {
    vendor: "OpenAI (GPT-5)",
    model_pattern: "gpt-5.3-codex",
    max_context_tokens: 1_000_000,
    max_output_tokens: 128_000,
    safety_margin: DEFAULT_SAFETY_MARGIN,
    note: "Optimized for code refactoring workflows.",
  },
  {
    vendor: "OpenAI (GPT-5)",
    model_pattern: "gpt-5.2-pro",
    max_context_tokens: 256_000,
    max_output_tokens: 64_000,
    safety_margin: DEFAULT_SAFETY_MARGIN,
    note: "Strong logical stability for complex tasks.",
  },
  {
    vendor: "OpenAI (GPT-5)",
    model_pattern: "gpt-5-mini",
    max_context_tokens: 400_000,
    max_output_tokens: 128_000,
    safety_margin: DEFAULT_SAFETY_MARGIN,
    note: "Fast and cost-efficient general-purpose option.",
  },
  {
    vendor: "OpenAI (Legacy)",
    model_pattern: "gpt-4.1",
    max_context_tokens: 1_000_000,
    max_output_tokens: 32_000,
    safety_margin: DEFAULT_SAFETY_MARGIN,
    note: "Classic large-context model with 1M window.",
  },
  {
    vendor: "OpenAI (Legacy)",
    model_pattern: "gpt-4o",
    max_context_tokens: 128_000,
    max_output_tokens: 16_000,
    safety_margin: DEFAULT_SAFETY_MARGIN,
    note: "Low latency, suitable for everyday chat.",
  },
  {
    vendor: "Google",
    model_pattern: "gemini-2.5-pro",
    max_context_tokens: 1_000_000,
    max_output_tokens: 64_000,
    safety_margin: DEFAULT_SAFETY_MARGIN,
    note: "Strong multimodal analysis capabilities.",
  },
  {
    vendor: "Moonshot",
    model_pattern: "kimi-k2.5",
    max_context_tokens: 256_000,
    max_output_tokens: 64_000,
    safety_margin: DEFAULT_SAFETY_MARGIN,
    note: "Preferred for long-form Chinese content.",
  },
  {
    vendor: "Moonshot",
    model_pattern: "kimi-for-coding",
    max_context_tokens: 256_000,
    max_output_tokens: 64_000,
    safety_margin: DEFAULT_SAFETY_MARGIN,
    note: "Tuned for coding-focused scenarios.",
  },
  {
    vendor: "Zhipu",
    model_pattern: "glm-5",
    max_context_tokens: 200_000,
    max_output_tokens: 128_000,
    safety_margin: DEFAULT_SAFETY_MARGIN,
    note: "Good for one-shot large-document generation.",
  },
];

function createDefaultConfigs(): ModelLimitConfig[] {
  return DEFAULT_MODEL_LIMIT_CONFIGS.map((item) => ({ ...item }));
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
    vendor:
      typeof row.vendor === "string" && row.vendor.trim()
        ? row.vendor.trim()
        : "",
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
  const hasModelLimitsKey = Object.prototype.hasOwnProperty.call(
    config,
    MODEL_LIMITS_KEY,
  );

  if (!hasModelLimitsKey) {
    return { hasModelLimitsKey: false, modelLimits: [] };
  }

  return {
    hasModelLimitsKey,
    modelLimits: parseModelLimits(config[MODEL_LIMITS_KEY]),
  };
}

function validateModelLimits(configs: ModelLimitConfig[]): string | null {
  if (configs.length === 0) {
    return "Please keep at least one model limit row.";
  }

  const seenPatterns = new Set<string>();

  for (const config of configs) {
    const pattern = config.model_pattern.trim();
    if (!pattern) {
      return "Model pattern cannot be empty.";
    }

    const normalizedPattern = pattern.toLowerCase();
    if (seenPatterns.has(normalizedPattern)) {
      return `Duplicate model pattern: ${pattern}`;
    }
    seenPatterns.add(normalizedPattern);

    if (config.max_context_tokens < 1000) {
      return `Context window for ${pattern} must be at least 1000.`;
    }

    if (config.max_output_tokens < 1) {
      return `Max output for ${pattern} must be at least 1.`;
    }

    if (config.max_output_tokens > config.max_context_tokens) {
      return `Max output for ${pattern} must be <= context window.`;
    }

    if (config.safety_margin < 0) {
      return `Safety margin for ${pattern} cannot be negative.`;
    }

    if (config.safety_margin >= config.max_context_tokens) {
      return `Safety margin for ${pattern} must be smaller than context window.`;
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
  const [configs, setConfigs] = useState<ModelLimitConfig[]>(() =>
    createDefaultConfigs(),
  );
  const [loading, setLoading] = useState(false);
  const [msgApi, contextHolder] = message.useMessage();

  const updateConfig = useCallback(
    (index: number, updates: Partial<ModelLimitConfig>) => {
      setConfigs((prev) =>
        prev.map((config, rowIndex) =>
          rowIndex === index ? { ...config, ...updates } : config,
        ),
      );
    },
    [],
  );

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
        setConfigs(createDefaultConfigs());
        return;
      }

      const migrated = migrateLegacyModelLimitConfigs();
      if (migrated.length > 0) {
        await serviceFactory.setBambooConfig({ model_limits: migrated });
        localStorage.removeItem(LEGACY_MODEL_LIMITS_KEY);
        localStorage.removeItem(LEGACY_BUDGET_STRATEGY_KEY);
        setConfigs(migrated);
        msgApi.info("Migrated model limits from local storage to global config.");
        return;
      }

      setConfigs(createDefaultConfigs());
    } catch (error) {
      console.error("Failed to load model limits settings:", error);
      msgApi.error("Failed to load model limits settings");
      setConfigs(createDefaultConfigs());
    } finally {
      setLoading(false);
    }
  }, [msgApi]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const saveSettings = async () => {
    const validationError = validateModelLimits(configs);
    if (validationError) {
      msgApi.error(validationError);
      return;
    }

    setLoading(true);
    try {
      await serviceFactory.setBambooConfig({ model_limits: configs });
      msgApi.success("Model limits saved to global config");
    } catch (error) {
      console.error("Failed to save model limits settings:", error);
      msgApi.error("Failed to save model limits settings");
    } finally {
      setLoading(false);
    }
  };

  const resetToDefaults = async () => {
    const defaults = createDefaultConfigs();

    setLoading(true);
    try {
      await serviceFactory.setBambooConfig({ model_limits: defaults });
      setConfigs(defaults);
      localStorage.removeItem(LEGACY_MODEL_LIMITS_KEY);
      localStorage.removeItem(LEGACY_BUDGET_STRATEGY_KEY);
      msgApi.success("Model limits reset to product defaults");
    } catch (error) {
      console.error("Failed to reset model limits settings:", error);
      msgApi.error("Failed to reset model limits settings");
    } finally {
      setLoading(false);
    }
  };

  const columns: ColumnsType<ModelLimitConfig> = useMemo(
    () => [
      {
        title: "Vendor/Series",
        dataIndex: "vendor",
        key: "vendor",
        width: 170,
        render: (value: string, _record, index) => (
          <Input
            value={value}
            placeholder="OpenAI / Google / Moonshot"
            onChange={(event) => updateConfig(index, { vendor: event.target.value })}
          />
        ),
      },
      {
        title: "Model",
        dataIndex: "model_pattern",
        key: "model_pattern",
        width: 220,
        render: (value: string, _record, index) => (
          <Input
            value={value}
            placeholder="e.g. gpt-5.4-thinking"
            onChange={(event) =>
              updateConfig(index, { model_pattern: event.target.value })
            }
          />
        ),
      },
      {
        title: "Context Window",
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
        title: "Max Output",
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
        title: "Notes",
        dataIndex: "note",
        key: "note",
        width: 240,
        render: (value: string, _record, index) => (
          <Input
            value={value}
            placeholder="Optional"
            onChange={(event) => updateConfig(index, { note: event.target.value })}
          />
        ),
      },
      {
        title: "Actions",
        key: "actions",
        width: 100,
        render: (_value, _record, index) => (
          <Button danger size="small" onClick={() => removeConfigRow(index)}>
            Remove
          </Button>
        ),
      },
    ],
    [removeConfigRow, updateConfig],
  );

  return (
    <div className="model-limits-settings">
      {contextHolder}
      <Card>
        <Title level={4}>Token Budget Model Limits</Title>
        <Paragraph type="secondary">
          Configure per-model token limits for context budgeting. These settings
          are persisted globally in Bamboo <Text code>config.json</Text> and used
          by the backend resolver.
        </Paragraph>

        <Divider />

        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Text strong>Model Defaults</Text>
          <Text type="secondary">
            Preloaded with your GPT-5 / GPT-4 / Gemini / Kimi / GLM model
            context and max-output defaults. You can keep editing as needed.
          </Text>
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
          <Button onClick={addConfigRow}>Add Row</Button>
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={() => void saveSettings()}
            loading={loading}
          >
            Save
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void resetToDefaults()}
            loading={loading}
          >
            Reset to Defaults
          </Button>
          <Button onClick={() => void loadSettings()} loading={loading}>
            Reload
          </Button>
        </Space>
      </Card>
    </div>
  );
};

export default ModelLimitsSettings;
