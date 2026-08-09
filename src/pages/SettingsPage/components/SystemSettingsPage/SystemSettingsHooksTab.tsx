import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  Input,
  InputNumber,
  Select,
  Switch,
  Typography,
  message,
  theme,
} from "antd";
import { DeleteOutlined, ExperimentOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import {
  serviceFactory,
  type BambooConfig,
  type BambooConfigValidationIssue,
  type LifecycleHookEvent,
  type LifecycleHooksConfig,
  type LifecycleHookTestResponse,
} from "@services/common/ServiceFactory";
import { useTranslation } from "react-i18next";
import type { HooksSection } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { configErrorMessage } from "@shared/utils/configErrors";

const { Paragraph, Text } = Typography;
const { useToken } = theme;

type ImageFallbackMode = "placeholder" | "error" | "ocr" | "vision";
type EntryErrors = Partial<Record<"matcher" | "command" | "timeout", string>>;

interface LifecycleHookEditorEntry {
  id: string;
  event: LifecycleHookEvent;
  enabled: boolean;
  matcher: string;
  command: string;
  timeoutMs: number;
  errors: EntryErrors;
  testResult?: LifecycleHookTestResponse;
}

const LIFECYCLE_EVENTS: LifecycleHookEvent[] = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "SessionEnd",
  "PreCompact",
  "Notification",
];
const DEFAULT_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 1;
const MAX_TIMEOUT_MS = 600_000;

let nextEntryId = 0;
const newEntryId = () => `lifecycle-hook-${++nextEntryId}`;

const getImageFallbackMode = (config: HooksSection): ImageFallbackMode => {
  const imageFallback = config.image_fallback;
  const mode = String(imageFallback?.mode || "placeholder")
    .trim()
    .toLowerCase();
  if (mode === "error" || mode === "ocr" || mode === "vision") return mode;
  return "placeholder";
};

const getImageFallbackEnabled = (config: HooksSection): boolean => {
  const imageFallback = config.image_fallback;
  const value = imageFallback?.enabled;
  return typeof value === "boolean" ? value : false;
};

const readLifecycleEntries = (
  config: Pick<BambooConfig, "lifecycle_hooks">,
): LifecycleHookEditorEntry[] => {
  const lifecycle = config.lifecycle_hooks;
  if (!lifecycle) return [];
  const entries: LifecycleHookEditorEntry[] = [];
  for (const event of LIFECYCLE_EVENTS) {
    for (const group of lifecycle[event] ?? []) {
      for (const hook of group.hooks ?? []) {
        if (hook.type !== "command") continue;
        entries.push({
          id: newEntryId(),
          event,
          enabled: group.enabled !== false,
          matcher: group.matcher ?? "",
          command: hook.command ?? "",
          timeoutMs: hook.timeout_ms ?? DEFAULT_TIMEOUT_MS,
          errors: {},
        });
      }
    }
  }
  return entries;
};

const buildLifecycleConfig = (
  enabled: boolean,
  entries: LifecycleHookEditorEntry[],
): LifecycleHooksConfig => {
  const lifecycle: LifecycleHooksConfig = { enabled };
  for (const event of LIFECYCLE_EVENTS) lifecycle[event] = [];
  for (const entry of entries) {
    lifecycle[entry.event]?.push({
      enabled: entry.enabled,
      ...(entry.matcher.trim() ? { matcher: entry.matcher } : {}),
      hooks: [
        {
          type: "command",
          command: entry.command,
          timeout_ms: entry.timeoutMs,
        },
      ],
    });
  }
  return lifecycle;
};

type LifecycleDraft = {
  enabled: boolean;
  entries: LifecycleHookEditorEntry[];
};

const lifecycleEntryEqual = (
  left: LifecycleHookEditorEntry | undefined,
  right: LifecycleHookEditorEntry | undefined,
): boolean =>
  Boolean(
    left &&
      right &&
      left.event === right.event &&
      left.enabled === right.enabled &&
      left.matcher === right.matcher &&
      left.command === right.command &&
      left.timeoutMs === right.timeoutMs,
  );

const reapplyLifecycleEntries = (
  base: LifecycleHookEditorEntry[],
  draft: LifecycleHookEditorEntry[],
  latest: LifecycleHookEditorEntry[],
): LifecycleHookEditorEntry[] => {
  const result: LifecycleHookEditorEntry[] = [];
  for (const event of LIFECYCLE_EVENTS) {
    const baseEntries = base.filter((entry) => entry.event === event);
    const draftEntries = draft.filter((entry) => entry.event === event);
    const latestEntries = latest
      .filter((entry) => entry.event === event)
      .map((entry) => ({ ...entry }));

    for (let index = baseEntries.length - 1; index >= 0; index -= 1) {
      if (draftEntries[index] !== undefined) continue;
      const latestIndex = latestEntries.findIndex((entry) =>
        lifecycleEntryEqual(entry, baseEntries[index]),
      );
      if (latestIndex >= 0) latestEntries.splice(latestIndex, 1);
    }

    for (let index = 0; index < baseEntries.length; index += 1) {
      if (!draftEntries[index] || lifecycleEntryEqual(baseEntries[index], draftEntries[index])) {
        continue;
      }
      const latestIndex = latestEntries.findIndex((entry) =>
        lifecycleEntryEqual(entry, baseEntries[index]),
      );
      const targetIndex = latestIndex >= 0 ? latestIndex : Math.min(index, latestEntries.length);
      if (targetIndex < latestEntries.length)
        latestEntries[targetIndex] = { ...draftEntries[index] };
      else latestEntries.push({ ...draftEntries[index] });
    }

    for (const entry of draftEntries.slice(baseEntries.length)) {
      latestEntries.push({ ...entry });
    }
    result.push(...latestEntries);
  }
  return result;
};

const SystemSettingsHooksTab: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const { modal } = AntApp.useApp();
  const [msgApi, contextHolder] = message.useMessage();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [imageEnabled, setImageEnabled] = useState(false);
  const [imageMode, setImageMode] = useState<ImageFallbackMode>("placeholder");
  const [lifecycleEnabled, setLifecycleEnabled] = useState(false);
  const [entries, setEntries] = useState<LifecycleHookEditorEntry[]>([]);
  const [validationSummary, setValidationSummary] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [lifecycleDirty, setLifecycleDirty] = useState(false);
  const [externalRevision, setExternalRevision] = useState<number | null>(null);
  const baseLifecycleRef = React.useRef<LifecycleDraft>({ enabled: false, entries: [] });
  const snapshot = useConfigSectionStore((state) => state.sections.hooks);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const saveSection = useConfigSectionStore((state) => state.saveSection);

  const modeOptions = useMemo(
    () => [
      { label: t("settings.hooksTab.mode.placeholder"), value: "placeholder" as const },
      { label: t("settings.hooksTab.mode.error"), value: "error" as const },
      { label: t("settings.hooksTab.mode.ocr"), value: "ocr" as const },
      { label: t("settings.hooksTab.mode.vision"), value: "vision" as const },
    ],
    [t],
  );

  const eventOptions = useMemo(
    () =>
      LIFECYCLE_EVENTS.map((event) => ({
        value: event,
        label: t(`settings.hooksTab.lifecycle.events.${event}`),
      })),
    [t],
  );

  const load = useCallback(async () => {
    setIsLoading(true);
    setValidationSummary(null);
    try {
      const envelope = await loadSection("hooks", { force: true });
      const config = envelope.data;
      setImageEnabled(getImageFallbackEnabled(config));
      setImageMode(getImageFallbackMode(config));
      setLifecycleEnabled(config.lifecycle_hooks?.enabled ?? false);
      const nextEntries = readLifecycleEntries(config);
      setEntries(nextEntries);
      baseLifecycleRef.current = {
        enabled: config.lifecycle_hooks?.enabled ?? false,
        entries: nextEntries.map((entry) => ({ ...entry })),
      };
      setBaseRevision(envelope.revision);
      setLifecycleDirty(false);
      setExternalRevision(null);
    } catch (error) {
      msgApi.error(configErrorMessage(error, t("settings.hooksTab.loadFailed")));
    } finally {
      setIsLoading(false);
    }
  }, [loadSection, msgApi, t]);

  const patchImageHook = useCallback(
    async (nextEnabled: boolean, nextMode: ImageFallbackMode) => {
      if (baseRevision === null) throw new Error("Hooks configuration is not loaded.");
      const saved = await saveSection(
        "hooks",
        {
          ...(snapshot.envelope?.data ?? {}),
          image_fallback: { enabled: nextEnabled, mode: nextMode },
        },
        baseRevision,
      );
      setBaseRevision(saved.revision);
      setExternalRevision(null);
    },
    [baseRevision, saveSection, snapshot.envelope],
  );

  const handleImageEnabledChange = useCallback(
    async (checked: boolean) => {
      try {
        await patchImageHook(checked, imageMode);
        setImageEnabled(checked);
        msgApi.success(checked ? t("settings.hooksTab.enabled") : t("settings.hooksTab.disabled"));
      } catch (error) {
        msgApi.error(configErrorMessage(error, t("settings.hooksTab.updateFailed")));
      }
    },
    [imageMode, msgApi, patchImageHook, t],
  );

  const handleImageModeChange = useCallback(
    async (nextMode: ImageFallbackMode) => {
      try {
        await patchImageHook(imageEnabled, nextMode);
        setImageMode(nextMode);
        msgApi.success(
          t("settings.hooksTab.modeUpdated", {
            mode: modeOptions.find((option) => option.value === nextMode)?.label ?? nextMode,
          }),
        );
      } catch (error) {
        msgApi.error(configErrorMessage(error, t("settings.hooksTab.modeUpdateFailed")));
      }
    },
    [imageEnabled, modeOptions, msgApi, patchImageHook, t],
  );

  const updateEntry = useCallback((id: string, patch: Partial<LifecycleHookEditorEntry>) => {
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id
          ? { ...entry, ...patch, errors: patch.errors ?? {}, testResult: undefined }
          : entry,
      ),
    );
    setValidationSummary(null);
    setLifecycleDirty(true);
  }, []);

  const validateEntry = useCallback(
    (entry: LifecycleHookEditorEntry): EntryErrors => {
      const errors: EntryErrors = {};
      if (!entry.command.trim()) errors.command = t("settings.hooksTab.lifecycle.commandRequired");
      if (
        !Number.isInteger(entry.timeoutMs) ||
        entry.timeoutMs < MIN_TIMEOUT_MS ||
        entry.timeoutMs > MAX_TIMEOUT_MS
      ) {
        errors.timeout = t("settings.hooksTab.lifecycle.timeoutRange", {
          min: MIN_TIMEOUT_MS,
          max: MAX_TIMEOUT_MS,
        });
      }
      return errors;
    },
    [t],
  );

  const validateAllEntries = useCallback(() => {
    const validated = entries.map((entry) => ({ ...entry, errors: validateEntry(entry) }));
    setEntries(validated);
    return validated.every((entry) => Object.keys(entry.errors).length === 0);
  }, [entries, validateEntry]);

  const applyServerIssues = useCallback(
    (issues: BambooConfigValidationIssue[]) => {
      const remaining: string[] = [];
      const next = entries.map((entry) => ({ ...entry, errors: { ...entry.errors } }));
      for (const issue of issues) {
        const match = issue.path.match(
          /^lifecycle_hooks\.([A-Za-z]+)\[(\d+)\](?:\.hooks\[0\])?\.(matcher|command|timeout_ms)$/,
        );
        if (!match) {
          remaining.push(issue.message);
          continue;
        }
        const [, event, rawIndex, field] = match;
        const target = next.filter((entry) => entry.event === event)[Number(rawIndex)];
        if (!target) {
          remaining.push(issue.message);
          continue;
        }
        const key = field === "timeout_ms" ? "timeout" : (field as "matcher" | "command");
        target.errors[key] = issue.message;
      }
      setEntries(next);
      setValidationSummary(
        remaining.length > 0 ? remaining.join(" · ") : t("settings.hooksTab.lifecycle.fixErrors"),
      );
    },
    [entries, t],
  );

  const handleSaveLifecycleHooks = useCallback(async () => {
    setValidationSummary(null);
    if (!validateAllEntries()) {
      setValidationSummary(t("settings.hooksTab.lifecycle.fixErrors"));
      return;
    }
    const lifecycleHooks = buildLifecycleConfig(lifecycleEnabled, entries);
    setIsSaving(true);
    try {
      const validation = await serviceFactory.validateBambooConfigPatch({
        lifecycle_hooks: lifecycleHooks,
      });
      if (!validation.valid) {
        applyServerIssues(validation.errors.lifecycle_hooks ?? []);
        return;
      }
      if (baseRevision === null) throw new Error("Hooks configuration is not loaded.");
      const savedEnvelope = await saveSection(
        "hooks",
        { ...(snapshot.envelope?.data ?? {}), lifecycle_hooks: lifecycleHooks },
        baseRevision,
      );
      const saved = savedEnvelope.data;
      setBaseRevision(savedEnvelope.revision);
      const nextEnabled = saved.lifecycle_hooks?.enabled ?? lifecycleEnabled;
      const nextEntries = readLifecycleEntries(saved);
      setLifecycleEnabled(nextEnabled);
      setEntries(nextEntries);
      baseLifecycleRef.current = {
        enabled: nextEnabled,
        entries: nextEntries.map((entry) => ({ ...entry })),
      };
      setLifecycleDirty(false);
      setExternalRevision(null);
      msgApi.success(t("settings.hooksTab.lifecycle.saved"));
    } catch (error) {
      msgApi.error(configErrorMessage(error, t("settings.hooksTab.lifecycle.saveFailed")));
    } finally {
      setIsSaving(false);
    }
  }, [
    applyServerIssues,
    baseRevision,
    entries,
    lifecycleEnabled,
    msgApi,
    saveSection,
    snapshot.envelope,
    t,
    validateAllEntries,
  ]);

  const handleTest = useCallback(
    async (id: string) => {
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry) return;
      const errors = validateEntry(entry);
      if (Object.keys(errors).length > 0) {
        updateEntry(id, { errors });
        return;
      }
      setTestingId(id);
      try {
        const result = await serviceFactory.testLifecycleHook({
          event: entry.event,
          ...(entry.matcher.trim() ? { matcher: entry.matcher } : {}),
          command: entry.command,
          timeout_ms: entry.timeoutMs,
        });
        setEntries((current) =>
          current.map((candidate) =>
            candidate.id === id ? { ...candidate, testResult: result } : candidate,
          ),
        );
      } catch (error) {
        msgApi.error(configErrorMessage(error, t("settings.hooksTab.lifecycle.testFailed")));
      } finally {
        setTestingId(null);
      }
    },
    [entries, msgApi, t, updateEntry, validateEntry],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const envelope = snapshot.envelope;
    if (!envelope || baseRevision === null || envelope.revision === baseRevision) return;
    if (lifecycleDirty) {
      setExternalRevision(envelope.revision);
      return;
    }
    const nextEntries = readLifecycleEntries(envelope.data);
    const nextEnabled = envelope.data.lifecycle_hooks?.enabled ?? false;
    setImageEnabled(getImageFallbackEnabled(envelope.data));
    setImageMode(getImageFallbackMode(envelope.data));
    setLifecycleEnabled(nextEnabled);
    setEntries(nextEntries);
    baseLifecycleRef.current = {
      enabled: nextEnabled,
      entries: nextEntries.map((entry) => ({ ...entry })),
    };
    setBaseRevision(envelope.revision);
    setExternalRevision(null);
  }, [baseRevision, lifecycleDirty, snapshot.envelope]);

  const reapplyExternalChanges = () => {
    const envelope = snapshot.envelope;
    if (!envelope || externalRevision === null) return;
    const latestEntries = readLifecycleEntries(envelope.data);
    const latestEnabled = envelope.data.lifecycle_hooks?.enabled ?? false;
    const base = baseLifecycleRef.current;
    setEntries(reapplyLifecycleEntries(base.entries, entries, latestEntries));
    setLifecycleEnabled(base.enabled === lifecycleEnabled ? latestEnabled : lifecycleEnabled);
    setImageEnabled(getImageFallbackEnabled(envelope.data));
    setImageMode(getImageFallbackMode(envelope.data));
    baseLifecycleRef.current = {
      enabled: latestEnabled,
      entries: latestEntries.map((entry) => ({ ...entry })),
    };
    setBaseRevision(envelope.revision);
    setExternalRevision(null);
    setLifecycleDirty(true);
  };

  const compareExternalChanges = () => {
    const envelope = snapshot.envelope;
    if (!envelope) return;
    modal.info({
      title: "Compare hook revisions",
      width: 800,
      content: (
        <pre style={{ maxHeight: 460, overflow: "auto", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(
            {
              base: {
                enabled: baseLifecycleRef.current.enabled,
                lifecycle_hooks: buildLifecycleConfig(
                  baseLifecycleRef.current.enabled,
                  baseLifecycleRef.current.entries,
                ),
              },
              draft: {
                enabled: lifecycleEnabled,
                lifecycle_hooks: buildLifecycleConfig(lifecycleEnabled, entries),
              },
              latest: envelope.data,
            },
            null,
            2,
          )}
        </pre>
      ),
    });
  };

  return (
    <Flex vertical gap={token.marginLG}>
      {contextHolder}
      {externalRevision !== null ? (
        <Alert
          type="warning"
          showIcon
          message={`Hooks configuration changed on disk (r${baseRevision} → r${externalRevision})`}
          description="Your unsaved lifecycle-hook edits were kept. Reload to discard them, compare revisions, or reapply them on the latest snapshot."
          action={
            <Flex gap={8} wrap="wrap">
              <Button size="small" onClick={() => void load()}>
                Reload
              </Button>
              <Button size="small" onClick={compareExternalChanges}>
                Compare
              </Button>
              <Button size="small" type="primary" onClick={reapplyExternalChanges}>
                Reapply
              </Button>
            </Flex>
          }
        />
      ) : null}
      <Card
        size="small"
        loading={isLoading}
        title={t("settings.hooksTab.lifecycle.title")}
        extra={
          <Flex align="center" gap={token.marginXS}>
            <Text>{t("settings.hooksTab.lifecycle.globalEnabled")}</Text>
            <Switch
              aria-label={t("settings.hooksTab.lifecycle.globalEnabled")}
              checked={lifecycleEnabled}
              onChange={(checked) => {
                setLifecycleEnabled(checked);
                setLifecycleDirty(true);
              }}
            />
          </Flex>
        }
      >
        <Paragraph type="secondary">{t("settings.hooksTab.lifecycle.description")}</Paragraph>
        <Flex vertical gap={token.marginSM}>
          {entries.length === 0 ? (
            <Text type="secondary">{t("settings.hooksTab.lifecycle.empty")}</Text>
          ) : null}
          {entries.map((entry) => {
            const testSucceeded =
              entry.testResult && !entry.testResult.timed_out && entry.testResult.exit_code === 0;
            return (
              <Card
                key={entry.id}
                size="small"
                data-testid="lifecycle-hook-entry"
                title={
                  <Select
                    aria-label={t("settings.hooksTab.lifecycle.event")}
                    value={entry.event}
                    options={eventOptions}
                    style={{ minWidth: 190 }}
                    onChange={(event) =>
                      updateEntry(entry.id, {
                        event,
                        ...(!["PreToolUse", "PostToolUse"].includes(event) ? { matcher: "" } : {}),
                      })
                    }
                  />
                }
                extra={
                  <Flex align="center" gap={token.marginXS}>
                    <Text>{t("settings.hooksTab.lifecycle.entryEnabled")}</Text>
                    <Switch
                      aria-label={t("settings.hooksTab.lifecycle.entryEnabled")}
                      checked={entry.enabled}
                      onChange={(enabled) => updateEntry(entry.id, { enabled })}
                    />
                  </Flex>
                }
              >
                <Flex vertical gap={token.marginSM}>
                  <Flex gap={token.marginSM} wrap="wrap">
                    <Flex vertical style={{ flex: "1 1 280px" }}>
                      <Text>{t("settings.hooksTab.lifecycle.matcher")}</Text>
                      <Input
                        aria-label={t("settings.hooksTab.lifecycle.matcher")}
                        value={entry.matcher}
                        disabled={!["PreToolUse", "PostToolUse"].includes(entry.event)}
                        status={entry.errors.matcher ? "error" : undefined}
                        placeholder={
                          ["PreToolUse", "PostToolUse"].includes(entry.event)
                            ? t("settings.hooksTab.lifecycle.matcherPlaceholder")
                            : t("settings.hooksTab.lifecycle.matcherToolOnly")
                        }
                        onChange={(event) => updateEntry(entry.id, { matcher: event.target.value })}
                      />
                      {entry.errors.matcher ? (
                        <Text type="danger">{entry.errors.matcher}</Text>
                      ) : null}
                    </Flex>
                    <Flex vertical style={{ flex: "0 1 220px" }}>
                      <Text>{t("settings.hooksTab.lifecycle.timeout")}</Text>
                      <InputNumber
                        aria-label={t("settings.hooksTab.lifecycle.timeout")}
                        value={entry.timeoutMs}
                        min={MIN_TIMEOUT_MS}
                        max={MAX_TIMEOUT_MS}
                        precision={0}
                        status={entry.errors.timeout ? "error" : undefined}
                        style={{ width: "100%" }}
                        onChange={(value) => updateEntry(entry.id, { timeoutMs: value ?? 0 })}
                      />
                      {entry.errors.timeout ? (
                        <Text type="danger">{entry.errors.timeout}</Text>
                      ) : null}
                    </Flex>
                  </Flex>
                  <Flex vertical>
                    <Text>{t("settings.hooksTab.lifecycle.command")}</Text>
                    <Input.TextArea
                      aria-label={t("settings.hooksTab.lifecycle.command")}
                      autoSize={{ minRows: 2, maxRows: 6 }}
                      value={entry.command}
                      status={entry.errors.command ? "error" : undefined}
                      placeholder={t("settings.hooksTab.lifecycle.commandPlaceholder")}
                      onChange={(event) => updateEntry(entry.id, { command: event.target.value })}
                    />
                    {entry.errors.command ? (
                      <Text type="danger">{entry.errors.command}</Text>
                    ) : null}
                  </Flex>
                  <Flex gap={token.marginSM}>
                    <Button
                      aria-label={t("settings.hooksTab.lifecycle.test")}
                      icon={<ExperimentOutlined />}
                      loading={testingId === entry.id}
                      onClick={() => void handleTest(entry.id)}
                    >
                      {t("settings.hooksTab.lifecycle.test")}
                    </Button>
                    <Button
                      aria-label={t("settings.hooksTab.lifecycle.remove")}
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() =>
                        setEntries((current) => {
                          setLifecycleDirty(true);
                          return current.filter(({ id }) => id !== entry.id);
                        })
                      }
                    >
                      {t("settings.hooksTab.lifecycle.remove")}
                    </Button>
                  </Flex>
                  {entry.testResult ? (
                    <Alert
                      showIcon
                      type={testSucceeded ? "success" : "warning"}
                      message={
                        entry.testResult.timed_out
                          ? t("settings.hooksTab.lifecycle.testTimedOut")
                          : t("settings.hooksTab.lifecycle.testExit", {
                              code: entry.testResult.exit_code ?? "signal",
                            })
                      }
                      description={
                        <Flex vertical gap={token.marginXS}>
                          <Text strong>{t("settings.hooksTab.lifecycle.stdout")}</Text>
                          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                            {entry.testResult.stdout || t("settings.hooksTab.lifecycle.noOutput")}
                          </pre>
                          <Text strong>{t("settings.hooksTab.lifecycle.stderr")}</Text>
                          <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                            {entry.testResult.stderr || t("settings.hooksTab.lifecycle.noOutput")}
                          </pre>
                        </Flex>
                      }
                    />
                  ) : null}
                </Flex>
              </Card>
            );
          })}
          {validationSummary ? <Alert type="error" showIcon message={validationSummary} /> : null}
          <Flex gap={token.marginSM}>
            <Button
              aria-label={t("settings.hooksTab.lifecycle.add")}
              icon={<PlusOutlined />}
              onClick={() =>
                setEntries((current) => {
                  setLifecycleDirty(true);
                  return [
                    ...current,
                    {
                      id: newEntryId(),
                      event: "PreToolUse",
                      enabled: true,
                      matcher: "",
                      command: "",
                      timeoutMs: DEFAULT_TIMEOUT_MS,
                      errors: {},
                    },
                  ];
                })
              }
            >
              {t("settings.hooksTab.lifecycle.add")}
            </Button>
            <Button
              aria-label={t("settings.hooksTab.lifecycle.save")}
              type="primary"
              icon={<SaveOutlined />}
              loading={isSaving}
              onClick={() => void handleSaveLifecycleHooks()}
            >
              {t("settings.hooksTab.lifecycle.save")}
            </Button>
          </Flex>
        </Flex>
      </Card>

      <Card size="small" loading={isLoading} title={t("settings.hooksTab.imageTitle")}>
        <Flex vertical gap={token.marginXS}>
          <Flex align="center" justify="space-between">
            <Text>{t("settings.hooksTab.enableImagePreflight")}</Text>
            <Switch checked={imageEnabled} onChange={handleImageEnabledChange} />
          </Flex>
          <Flex align="center" justify="space-between">
            <Text>{t("settings.hooksTab.modeLabel")}</Text>
            <Select
              style={{ width: 180 }}
              value={imageMode}
              options={modeOptions}
              onChange={handleImageModeChange}
              disabled={!imageEnabled}
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
