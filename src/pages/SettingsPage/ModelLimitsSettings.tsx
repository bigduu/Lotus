import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Table,
  Input,
  InputNumber,
  Button,
  Space,
  Card,
  Typography,
  Divider,
  Tag,
  Tooltip,
  Empty,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { SaveOutlined, ReloadOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  serviceFactory,
  type BambooConfig,
  type ModelLimitDefault,
} from "../../services/common/ServiceFactory";
import { getUsedModels, removeUsedModel } from "../ChatPage/utils/usedModels";

const { Title, Text, Paragraph } = Typography;

const MODEL_LIMITS_KEY = "model_limits";

/** Global default mirrored from the backend; used until a model is customized. */
interface GlobalDefault {
  max_context_tokens: number;
  max_output_tokens: number;
  safety_margin: number;
}

const FALLBACK_DEFAULT: GlobalDefault = {
  max_context_tokens: 1_000_000,
  max_output_tokens: 64_000,
  safety_margin: 10_000,
};

/** A persisted user override (source = user) sent to the backend on save. */
interface OverrideConfig {
  model_pattern: string;
  max_context_tokens: number;
  max_output_tokens: number;
  safety_margin?: number;
}

/** A row in the editable table — either a default (unchanged) or an override. */
interface LimitRow {
  /** Stable synthetic id (never derived from editable fields → no focus loss). */
  id: string;
  model_pattern: string;
  /** User-added row (model pattern is editable) vs a discovered/used model. */
  isCustom: boolean;
  /** Has a real override (source = user). `false` = default, unchanged. */
  customized: boolean;
  max_context_tokens: number;
  max_output_tokens: number;
  safety_margin?: number;
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const next = Math.floor(value);
  return next > 0 ? next : null;
}

function parseGlobalDefault(response: { model_limits?: ModelLimitDefault[] }): GlobalDefault {
  const first = Array.isArray(response?.model_limits) ? response.model_limits[0] : undefined;
  if (!first) {
    return FALLBACK_DEFAULT;
  }
  return {
    max_context_tokens:
      toPositiveInt(first.max_context_tokens) ?? FALLBACK_DEFAULT.max_context_tokens,
    max_output_tokens: toPositiveInt(first.max_output_tokens) ?? FALLBACK_DEFAULT.max_output_tokens,
    safety_margin: toPositiveInt(first.safety_margin) ?? FALLBACK_DEFAULT.safety_margin,
  };
}

function normalizeOverride(value: unknown): OverrideConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const row = value as Record<string, unknown>;
  const patternValue = row.model_pattern ?? row.model;
  if (typeof patternValue !== "string" || !patternValue.trim()) {
    return null;
  }
  const ctx = toPositiveInt(row.max_context_tokens ?? row.maxContextTokens);
  const out = toPositiveInt(row.max_output_tokens ?? row.maxOutputTokens);
  if (ctx === null || out === null) {
    return null;
  }
  const marginRaw = row.safety_margin ?? row.safetyMargin;
  const margin =
    typeof marginRaw === "number" && Number.isFinite(marginRaw) && marginRaw >= 0
      ? Math.floor(marginRaw)
      : undefined;
  return {
    model_pattern: patternValue.trim(),
    max_context_tokens: ctx,
    max_output_tokens: out,
    safety_margin: margin,
  };
}

function parseOverrides(config: BambooConfig): OverrideConfig[] {
  const raw = config?.[MODEL_LIMITS_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((row) => normalizeOverride(row))
    .filter((row): row is OverrideConfig => row !== null);
}

/** Build display rows = persisted overrides ∪ models the user has used. */
function buildRows(
  def: GlobalDefault,
  overrides: OverrideConfig[],
  usedModels: string[],
): LimitRow[] {
  const overrideMap = new Map(overrides.map((o) => [o.model_pattern, o]));
  const ordered: string[] = [];
  const seen = new Set<string>();

  for (const o of overrides) {
    if (!seen.has(o.model_pattern)) {
      seen.add(o.model_pattern);
      ordered.push(o.model_pattern);
    }
  }
  for (const model of usedModels) {
    const trimmed = model.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      ordered.push(trimmed);
    }
  }

  return ordered.map((pattern) => {
    const override = overrideMap.get(pattern);
    return {
      id: pattern,
      model_pattern: pattern,
      isCustom: false,
      customized: Boolean(override),
      max_context_tokens: override?.max_context_tokens ?? def.max_context_tokens,
      max_output_tokens: override?.max_output_tokens ?? def.max_output_tokens,
      safety_margin: override?.safety_margin,
    };
  });
}

function validateOverrides(
  overrides: OverrideConfig[],
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  const seen = new Set<string>();
  for (const o of overrides) {
    const pattern = o.model_pattern.trim();
    if (!pattern) {
      return t("settings.modelLimits.validation.modelPatternEmpty");
    }
    const key = pattern.toLowerCase();
    if (seen.has(key)) {
      return t("settings.modelLimits.validation.duplicateModelPattern", { pattern });
    }
    seen.add(key);

    if (o.max_context_tokens < 1000) {
      return t("settings.modelLimits.validation.contextWindowMin", { pattern });
    }
    if (o.max_output_tokens < 1) {
      return t("settings.modelLimits.validation.maxOutputMin", { pattern });
    }
    if (o.max_output_tokens > o.max_context_tokens) {
      return t("settings.modelLimits.validation.maxOutputExceedsContext", { pattern });
    }
    if (typeof o.safety_margin === "number") {
      if (o.safety_margin < 0) {
        return t("settings.modelLimits.validation.safetyMarginNegative", { pattern });
      }
      if (o.safety_margin >= o.max_context_tokens) {
        return t("settings.modelLimits.validation.safetyMarginTooLarge", { pattern });
      }
    }
  }
  return null;
}

/**
 * Number cell with LOCAL draft state committed on blur. Typing never writes to
 * shared state and is never clamped mid-keystroke — that is what fixes the old
 * "type one digit and lose focus / value jumps" bug.
 */
const NumberCell = memo(function NumberCell({
  value,
  min,
  max,
  step,
  disabled,
  ariaLabel,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  ariaLabel?: string;
  onCommit: (next: number) => void;
}) {
  const [local, setLocal] = useState<number | null>(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <InputNumber
      aria-label={ariaLabel}
      value={local}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(next) => setLocal(typeof next === "number" ? next : null)}
      onBlur={() => {
        const next = typeof local === "number" && Number.isFinite(local) ? local : value;
        setLocal(next);
        if (next !== value) {
          onCommit(next);
        }
      }}
      style={{ width: "100%" }}
    />
  );
});

/** Text cell with local draft state committed on blur (stable focus). */
const TextCell = memo(function TextCell({
  value,
  placeholder,
  ariaLabel,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  ariaLabel?: string;
  onCommit: (next: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <Input
      aria-label={ariaLabel}
      value={local}
      placeholder={placeholder}
      onChange={(event) => setLocal(event.target.value)}
      onBlur={() => {
        if (local !== value) {
          onCommit(local);
        }
      }}
    />
  );
});

/**
 * Settings component for per-model token-budget overrides.
 *
 * - The list shows only models you've actually used (plus existing overrides),
 *   so it stays short.
 * - Every model uses the backend global default until you customize it; default
 *   rows are badged "unchanged" and follow future default changes.
 * - Only real overrides are saved (diff-only) — see backend `limits.rs`.
 */
export const ModelLimitsSettings: React.FC = () => {
  const { t } = useTranslation();
  const [globalDefault, setGlobalDefault] = useState<GlobalDefault>(FALLBACK_DEFAULT);
  const [rows, setRows] = useState<LimitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msgApi, contextHolder] = message.useMessage();
  const didLoad = useRef(false);
  const customCounter = useRef(0);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const [config, defaultsResponse] = await Promise.all([
        serviceFactory.getBambooConfig(),
        serviceFactory.getModelLimitDefaults(),
      ]);
      const def = parseGlobalDefault(defaultsResponse);
      setGlobalDefault(def);
      setRows(buildRows(def, parseOverrides(config), getUsedModels()));
    } catch (error) {
      console.error("Failed to load model limits settings:", error);
      msgApi.error(t("settings.modelLimits.loadFailed"));
      setGlobalDefault(FALLBACK_DEFAULT);
      setRows(buildRows(FALLBACK_DEFAULT, [], getUsedModels()));
    } finally {
      setLoading(false);
    }
  }, [msgApi, t]);

  // Load exactly once on mount. A ran-once guard prevents the effect from
  // re-firing (and reloading from the backend) mid-edit.
  useEffect(() => {
    if (didLoad.current) {
      return;
    }
    didLoad.current = true;
    void loadSettings();
  }, [loadSettings]);

  const updateRow = useCallback((id: string, patch: Partial<LimitRow>) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }, []);

  const customizeRow = useCallback((id: string) => {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, customized: true } : row)));
  }, []);

  const revertRow = useCallback(
    (id: string) => {
      setRows((prev) => {
        const target = prev.find((row) => row.id === id);
        if (target?.isCustom) {
          // User-added row: removing the override removes the row entirely.
          return prev.filter((row) => row.id !== id);
        }
        return prev.map((row) =>
          row.id === id
            ? {
                ...row,
                customized: false,
                max_context_tokens: globalDefault.max_context_tokens,
                max_output_tokens: globalDefault.max_output_tokens,
                safety_margin: undefined,
              }
            : row,
        );
      });
    },
    [globalDefault],
  );

  const removeRow = useCallback((id: string) => {
    setRows((prev) => {
      const target = prev.find((row) => row.id === id);
      // Discovered (non-custom) rows live in the usedModels registry; drop it
      // there too so it doesn't reappear. removeUsedModel is idempotent.
      if (target && !target.isCustom && target.model_pattern.trim()) {
        removeUsedModel(target.model_pattern);
      }
      return prev.filter((row) => row.id !== id);
    });
  }, []);

  const addCustomRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      {
        id: `custom-${customCounter.current++}`,
        model_pattern: "",
        isCustom: true,
        customized: true,
        max_context_tokens: globalDefault.max_context_tokens,
        max_output_tokens: globalDefault.max_output_tokens,
        safety_margin: undefined,
      },
    ]);
  }, [globalDefault]);

  const saveSettings = async () => {
    const overrides: OverrideConfig[] = rows
      .filter((row) => row.customized)
      .map((row) => ({
        model_pattern: row.model_pattern.trim(),
        max_context_tokens: row.max_context_tokens,
        max_output_tokens: row.max_output_tokens,
        ...(typeof row.safety_margin === "number" ? { safety_margin: row.safety_margin } : {}),
      }));

    const validationError = validateOverrides(overrides, t);
    if (validationError) {
      msgApi.error(validationError);
      return;
    }

    setLoading(true);
    try {
      await serviceFactory.setBambooConfig({ [MODEL_LIMITS_KEY]: overrides });
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
      await serviceFactory.setBambooConfig({ [MODEL_LIMITS_KEY]: [] });
      setRows((prev) =>
        prev
          .filter((row) => !row.isCustom)
          .map((row) => ({
            ...row,
            customized: false,
            max_context_tokens: globalDefault.max_context_tokens,
            max_output_tokens: globalDefault.max_output_tokens,
            safety_margin: undefined,
          })),
      );
      msgApi.success(t("settings.modelLimits.resetSuccess"));
    } catch (error) {
      console.error("Failed to reset model limits settings:", error);
      msgApi.error(t("settings.modelLimits.resetFailed"));
    } finally {
      setLoading(false);
    }
  };

  const columns: ColumnsType<LimitRow> = useMemo(
    () => [
      {
        title: t("settings.modelLimits.columns.model"),
        dataIndex: "model_pattern",
        key: "model_pattern",
        width: 240,
        render: (value: string, row) =>
          row.isCustom ? (
            <TextCell
              value={value}
              ariaLabel={`model-${row.id}`}
              placeholder={t("settings.modelLimits.placeholders.model")}
              onCommit={(next) => updateRow(row.id, { model_pattern: next })}
            />
          ) : (
            <Text strong>{value}</Text>
          ),
      },
      {
        title: t("settings.modelLimits.columns.contextWindow"),
        dataIndex: "max_context_tokens",
        key: "max_context_tokens",
        width: 170,
        render: (value: number, row) => (
          <NumberCell
            value={value}
            ariaLabel={`context-${row.id}`}
            min={1000}
            max={5_000_000}
            step={1000}
            disabled={!row.customized}
            onCommit={(next) => updateRow(row.id, { max_context_tokens: next })}
          />
        ),
      },
      {
        title: t("settings.modelLimits.columns.maxOutput"),
        dataIndex: "max_output_tokens",
        key: "max_output_tokens",
        width: 150,
        render: (value: number, row) => (
          <NumberCell
            value={value}
            ariaLabel={`output-${row.id}`}
            min={1}
            max={5_000_000}
            step={256}
            disabled={!row.customized}
            onCommit={(next) => updateRow(row.id, { max_output_tokens: next })}
          />
        ),
      },
      {
        title: t("settings.modelLimits.columns.safetyMargin"),
        dataIndex: "safety_margin",
        key: "safety_margin",
        width: 150,
        render: (value: number | undefined, row) => (
          <NumberCell
            value={value ?? globalDefault.safety_margin}
            ariaLabel={`safety-${row.id}`}
            min={0}
            max={1_000_000}
            step={100}
            disabled={!row.customized}
            onCommit={(next) => updateRow(row.id, { safety_margin: next })}
          />
        ),
      },
      {
        title: t("settings.modelLimits.columns.status"),
        key: "status",
        width: 150,
        render: (_value, row) =>
          row.customized ? (
            <Tag color="blue">{t("settings.modelLimits.badge.customized")}</Tag>
          ) : (
            <Tooltip title={t("settings.modelLimits.badge.defaultTooltip")}>
              <Tag>{t("settings.modelLimits.badge.default")}</Tag>
            </Tooltip>
          ),
      },
      {
        title: t("settings.modelLimits.columns.actions"),
        key: "actions",
        width: 200,
        render: (_value, row) => (
          <Space size="small">
            {!row.customized && (
              <Button size="small" type="link" onClick={() => customizeRow(row.id)}>
                {t("settings.modelLimits.actions.customize")}
              </Button>
            )}
            {row.customized && !row.isCustom && (
              <Button size="small" onClick={() => revertRow(row.id)}>
                {t("settings.modelLimits.actions.revert")}
              </Button>
            )}
            <Button size="small" type="text" danger onClick={() => removeRow(row.id)}>
              {t("settings.modelLimits.actions.remove")}
            </Button>
          </Space>
        ),
      },
    ],
    [t, globalDefault.safety_margin, updateRow, customizeRow, revertRow, removeRow],
  );

  return (
    <div className="model-limits-settings">
      {contextHolder}
      <Card>
        <Title level={4}>{t("settings.modelLimits.title")}</Title>
        <Paragraph type="secondary">
          {t("settings.modelLimits.descriptionPrefix")}{" "}
          {t("settings.modelLimits.descriptionSuffix")}
        </Paragraph>

        <Divider />

        <Space direction="vertical" size="small" style={{ width: "100%" }}>
          <Text strong>{t("settings.modelLimits.defaultsTitle")}</Text>
          <Text type="secondary">{t("settings.modelLimits.defaultsDescription")}</Text>
          <Text type="secondary">
            {t("settings.modelLimits.globalDefault", {
              context: globalDefault.max_context_tokens.toLocaleString(),
              output: globalDefault.max_output_tokens.toLocaleString(),
            })}
          </Text>
        </Space>

        <Table
          dataSource={rows}
          columns={columns}
          rowKey={(row) => row.id}
          pagination={false}
          size="small"
          style={{ margin: "16px 0" }}
          scroll={{ x: 1060 }}
          locale={{
            emptyText: <Empty description={t("settings.modelLimits.emptyState")} />,
          }}
        />

        <Space wrap>
          <Button icon={<PlusOutlined />} onClick={addCustomRow}>
            {t("settings.modelLimits.actions.addModel")}
          </Button>
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
