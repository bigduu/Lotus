import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Flex,
  Input,
  List,
  Select,
  Space,
  Switch,
  Typography,
  theme,
} from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined, SaveOutlined } from "@ant-design/icons";
import { ServiceFactory } from "@services/common/ServiceFactory";
import { useTranslation } from "react-i18next";
import i18n from "@shared/i18n";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import { configErrorMessage } from "@shared/utils/configErrors";

const { Text } = Typography;
const { useToken } = theme;

interface KeywordEntry {
  pattern: string;
  match_type: "exact" | "regex";
  enabled: boolean;
}

const readKeywordEntries = (keywordMasking: unknown): KeywordEntry[] => {
  if (Array.isArray(keywordMasking)) return keywordMasking as KeywordEntry[];
  if (
    keywordMasking &&
    typeof keywordMasking === "object" &&
    Array.isArray((keywordMasking as { entries?: unknown }).entries)
  ) {
    return (keywordMasking as { entries: KeywordEntry[] }).entries;
  }
  return [];
};

const entriesEqual = (left: KeywordEntry | undefined, right: KeywordEntry | undefined): boolean =>
  Boolean(
    left &&
      right &&
      left.pattern === right.pattern &&
      left.match_type === right.match_type &&
      left.enabled === right.enabled,
  );

export const reapplyKeywordEntries = (
  base: KeywordEntry[],
  draft: KeywordEntry[],
  latest: KeywordEntry[],
): KeywordEntry[] => {
  const rebased = latest.map((entry) => ({ ...entry }));

  for (let index = base.length - 1; index >= 0; index -= 1) {
    if (draft[index] !== undefined) continue;
    const latestIndex = rebased.findIndex((entry) => entriesEqual(entry, base[index]));
    if (latestIndex >= 0) rebased.splice(latestIndex, 1);
  }

  for (let index = 0; index < base.length; index += 1) {
    if (!draft[index] || entriesEqual(base[index], draft[index])) continue;
    const latestIndex = rebased.findIndex((entry) => entriesEqual(entry, base[index]));
    const targetIndex = latestIndex >= 0 ? latestIndex : Math.min(index, rebased.length);
    if (targetIndex < rebased.length) rebased[targetIndex] = { ...draft[index] };
    else rebased.push({ ...draft[index] });
  }

  for (const entry of draft.slice(base.length)) {
    rebased.push({ ...entry });
  }
  return rebased;
};

const keywordExamples = [
  {
    value: "literal-token",
    labelKey: "settings.keywordMaskingTab.example.literalToken",
    match_type: "exact",
    pattern: "sk-",
  },
  {
    value: "github",
    labelKey: "settings.keywordMaskingTab.example.githubTokens",
    match_type: "regex",
    pattern: "ghp_[A-Za-z0-9]+",
  },
  {
    value: "aws",
    labelKey: "settings.keywordMaskingTab.example.awsKeys",
    match_type: "regex",
    pattern: "AKIA[0-9A-Z]{16}",
  },
  {
    value: "email",
    labelKey: "settings.keywordMaskingTab.example.emails",
    match_type: "regex",
    pattern: "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}",
  },
] as const;

const applyPreviewMasking = (
  text: string,
  pattern: string,
  matchType: "exact" | "regex",
): { masked: string; error?: string } => {
  if (!pattern) {
    return { masked: text };
  }
  if (matchType === "exact") {
    return { masked: text.split(pattern).join("[MASKED]") };
  }
  try {
    const regex = new RegExp(pattern, "g");
    return { masked: text.replace(regex, "[MASKED]") };
  } catch (error) {
    return {
      masked: text,
      error:
        error instanceof Error
          ? error.message
          : i18n.t("settings.keywordMaskingTab.invalidRegexPattern"),
    };
  }
};

const SystemSettingsKeywordMaskingTab: React.FC = () => {
  const { t } = useTranslation();
  const { message, modal } = AntApp.useApp();
  const { token } = useToken();
  const [entries, setEntries] = useState<KeywordEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editPattern, setEditPattern] = useState("");
  const [editMatchType, setEditMatchType] = useState<"exact" | "regex">("exact");
  const [editEnabled, setEditEnabled] = useState(true);
  const [exampleValue, setExampleValue] = useState<string | undefined>();
  const [previewText, setPreviewText] = useState("My token is sk-123");
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [externalRevision, setExternalRevision] = useState<number | null>(null);
  const baseEntriesRef = useRef<KeywordEntry[]>([]);
  const snapshot = useConfigSectionStore((state) => state.sections["model-policy"]);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const saveSection = useConfigSectionStore((state) => state.saveSection);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      const envelope = await loadSection("model-policy", { force: true });
      const nextEntries = readKeywordEntries(envelope.data.keyword_masking);
      setEntries(nextEntries);
      baseEntriesRef.current = structuredClone(nextEntries);
      setBaseRevision(envelope.revision);
      setExternalRevision(null);
    } catch (error) {
      message.error(t("settings.keywordMaskingTab.loadFailed"));
      console.error(
        "Failed to load keyword masking configuration:",
        configErrorMessage(error, t("settings.keywordMaskingTab.loadFailed")),
      );
    } finally {
      setLoading(false);
    }
  }, [loadSection, message, t]);

  // Load keyword masking config on mount
  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const envelope = snapshot.envelope;
    if (!envelope || baseRevision === null || envelope.revision === baseRevision) return;
    const latest = readKeywordEntries(envelope.data.keyword_masking);
    if (editingIndex !== null) {
      setExternalRevision(envelope.revision);
      return;
    }
    setEntries(latest);
    baseEntriesRef.current = structuredClone(latest);
    setBaseRevision(envelope.revision);
    setExternalRevision(null);
  }, [baseRevision, editingIndex, snapshot.envelope]);

  const saveConfig = async (newEntries: KeywordEntry[]) => {
    try {
      // Validate first
      const serviceFactory = ServiceFactory.getInstance();
      const validationResult = await serviceFactory.validateKeywordEntries(newEntries);

      if (!validationResult.valid && validationResult.errors) {
        const errorMessages = validationResult.errors
          .map((e) => `Entry ${e.index + 1}: ${e.message}`)
          .join("; ");
        message.error(
          `${t("settings.keywordMaskingTab.validationFailedPrefix")}: ${errorMessages}`,
        );
        return false;
      }

      // Save if validation passes
      if (baseRevision === null) throw new Error("Model policy is not loaded.");
      const saved = await saveSection(
        "model-policy",
        {
          ...(snapshot.envelope?.data ?? {}),
          keyword_masking: { entries: newEntries },
        },
        baseRevision,
      );
      const savedEntries = readKeywordEntries(saved.data.keyword_masking);
      setEntries(savedEntries);
      baseEntriesRef.current = structuredClone(savedEntries);
      setBaseRevision(saved.revision);
      setExternalRevision(null);
      message.success(t("settings.keywordMaskingTab.saveSuccess"));
      return true;
    } catch (error) {
      message.error(configErrorMessage(error, t("settings.keywordMaskingTab.saveFailed")));
      return false;
    }
  };

  const handleAddEntry = async () => {
    const newEntry: KeywordEntry = {
      pattern: "",
      match_type: "exact",
      enabled: true,
    };
    const newEntries = [...entries, newEntry];

    // Don't save empty entry, just set editing mode
    setEntries(newEntries);
    setEditingIndex(newEntries.length - 1);
    setEditPattern("");
    setEditMatchType("exact");
    setEditEnabled(true);
    setExampleValue(undefined);
  };

  const handleEditEntry = (index: number) => {
    const entry = entries[index];
    setEditingIndex(index);
    setEditPattern(entry.pattern);
    setEditMatchType(entry.match_type);
    setEditEnabled(entry.enabled);
    setExampleValue(undefined);
  };

  const handleSaveEdit = async () => {
    if (editingIndex === null) return;

    if (!editPattern.trim()) {
      message.error(t("settings.keywordMaskingTab.patternRequired"));
      return;
    }

    const newEntries = [...entries];
    newEntries[editingIndex] = {
      pattern: editPattern.trim(),
      match_type: editMatchType,
      enabled: editEnabled,
    };

    const success = await saveConfig(newEntries);
    if (success) {
      setEditingIndex(null);
    }
  };

  const handleCancelEdit = () => {
    // Remove the entry if it was a new empty one
    if (editingIndex !== null && !entries[editingIndex]?.pattern) {
      setEntries(entries.filter((_, i) => i !== editingIndex));
    }
    setEditingIndex(null);
  };

  const handleDeleteEntry = async (index: number) => {
    const newEntries = entries.filter((_, i) => i !== index);
    await saveConfig(newEntries);
  };

  const handleToggleEnabled = async (index: number, checked: boolean) => {
    const newEntries = [...entries];
    newEntries[index] = { ...newEntries[index], enabled: checked };
    await saveConfig(newEntries);
  };

  const currentDraftEntries = (): KeywordEntry[] => {
    if (editingIndex === null) return entries;
    const draft = [...entries];
    draft[editingIndex] = {
      pattern: editPattern,
      match_type: editMatchType,
      enabled: editEnabled,
    };
    return draft;
  };

  const reapplyExternalChanges = () => {
    const envelope = snapshot.envelope;
    if (!envelope || externalRevision === null) return;
    const latest = readKeywordEntries(envelope.data.keyword_masking);
    const currentDraft = currentDraftEntries();
    const rebased = reapplyKeywordEntries(baseEntriesRef.current, currentDraft, latest);
    const editedEntry = editingIndex === null ? null : currentDraft[editingIndex];
    setEntries(rebased);
    if (editedEntry) {
      const nextIndex = rebased.findIndex(
        (entry) =>
          entry.pattern === editedEntry.pattern &&
          entry.match_type === editedEntry.match_type &&
          entry.enabled === editedEntry.enabled,
      );
      setEditingIndex(nextIndex >= 0 ? nextIndex : null);
    }
    baseEntriesRef.current = structuredClone(latest);
    setBaseRevision(envelope.revision);
    setExternalRevision(null);
  };

  const compareExternalChanges = () => {
    const envelope = snapshot.envelope;
    if (!envelope) return;
    modal.info({
      title: t("settings.keywordMaskingTab.externalCompareTitle", "Compare keyword revisions"),
      width: 760,
      content: (
        <pre style={{ maxHeight: 460, overflow: "auto", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(
            {
              base: baseEntriesRef.current,
              draft: currentDraftEntries(),
              latest: readKeywordEntries(envelope.data.keyword_masking),
            },
            null,
            2,
          )}
        </pre>
      ),
    });
  };

  const reloadExternalChanges = () => {
    setEditingIndex(null);
    setEditPattern("");
    setEditMatchType("exact");
    setEditEnabled(true);
    setExampleValue(undefined);
    void loadConfig();
  };

  const preview = applyPreviewMasking(previewText, editPattern, editMatchType);

  return (
    <Card
      className="lotus-settings-card"
      title={t("settings.keywordMaskingTab.title")}
      extra={
        <Button
          data-testid="add-keyword"
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleAddEntry}
          loading={loading}
        >
          {t("settings.keywordMaskingTab.addKeyword")}
        </Button>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }} size="large">
        <Text type="secondary">{t("settings.keywordMaskingTab.description")}</Text>

        {externalRevision !== null ? (
          <Alert
            type="warning"
            showIcon
            message={t(
              "settings.keywordMaskingTab.externalChange",
              "Keyword masking changed on disk",
            )}
            description={t("settings.keywordMaskingTab.externalChangeDescription", {
              defaultValue:
                "Your draft is based on revision {{loaded}}; revision {{latest}} is now available.",
              loaded: baseRevision,
              latest: externalRevision,
            })}
            action={
              <Flex gap={8} wrap="wrap">
                <Button size="small" onClick={reloadExternalChanges}>
                  {t("settings.keywordMaskingTab.reload", "Reload")}
                </Button>
                <Button size="small" onClick={compareExternalChanges}>
                  {t("settings.keywordMaskingTab.compare", "Compare")}
                </Button>
                <Button size="small" type="primary" onClick={reapplyExternalChanges}>
                  {t("settings.keywordMaskingTab.reapply", "Reapply")}
                </Button>
              </Flex>
            }
          />
        ) : null}

        <List
          loading={loading}
          dataSource={entries}
          locale={{ emptyText: t("settings.keywordMaskingTab.empty") }}
          renderItem={(item, index) => (
            <List.Item
              style={{
                backgroundColor: token.colorFillAlter,
                marginBottom: 8,
                borderRadius: token.borderRadius,
                padding: 12,
              }}
              actions={
                editingIndex === index
                  ? [
                      <Button
                        data-testid="save-keyword"
                        key="save"
                        type="primary"
                        icon={<SaveOutlined />}
                        onClick={handleSaveEdit}
                        aria-label={t("settings.keywordMaskingTab.save")}
                      />,
                      <Button key="cancel" onClick={handleCancelEdit}>
                        {t("settings.keywordMaskingTab.cancel")}
                      </Button>,
                    ]
                  : [
                      <Button
                        key="edit"
                        icon={<EditOutlined />}
                        onClick={() => handleEditEntry(index)}
                        aria-label={t("settings.keywordMaskingTab.edit")}
                      />,
                      <Button
                        data-testid={`delete-keyword-${index}`}
                        key="delete"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => handleDeleteEntry(index)}
                        aria-label={t("settings.keywordMaskingTab.delete")}
                      />,
                    ]
              }
            >
              <Flex vertical style={{ width: "100%" }} gap={8}>
                {editingIndex === index ? (
                  // Edit mode
                  <>
                    <Input
                      data-testid="keyword-pattern-input"
                      placeholder={t("settings.keywordMaskingTab.patternPlaceholder")}
                      value={editPattern}
                      onChange={(e) => setEditPattern(e.target.value)}
                      autoFocus
                    />
                    <Flex gap={8} align="center" wrap="wrap">
                      <Select
                        data-testid="keyword-examples-select"
                        aria-label={t("settings.keywordMaskingTab.examples")}
                        placeholder={t("settings.keywordMaskingTab.examples")}
                        value={exampleValue}
                        onChange={(value) => {
                          setExampleValue(value);
                          const example = keywordExamples.find((item) => item.value === value);
                          if (!example) return;
                          setEditPattern(example.pattern);
                          setEditMatchType(example.match_type);
                        }}
                        options={keywordExamples.map((example) => ({
                          value: example.value,
                          label: t(example.labelKey),
                        }))}
                        style={{ minWidth: 220 }}
                      />
                      <Select
                        value={editMatchType}
                        onChange={setEditMatchType}
                        options={[
                          {
                            value: "exact",
                            label: t("settings.keywordMaskingTab.exactMatch"),
                          },
                          {
                            value: "regex",
                            label: t("settings.keywordMaskingTab.regexPattern"),
                          },
                        ]}
                        style={{ width: 150 }}
                      />
                      <Switch checked={editEnabled} onChange={setEditEnabled} />
                    </Flex>
                    <Flex vertical gap={6}>
                      <Text type="secondary">{t("settings.keywordMaskingTab.sampleText")}</Text>
                      <Input
                        placeholder={t("settings.keywordMaskingTab.sampleTextPlaceholder")}
                        value={previewText}
                        onChange={(e) => setPreviewText(e.target.value)}
                      />
                      <Text type="secondary">{t("settings.keywordMaskingTab.maskedPreview")}</Text>
                      <Input
                        readOnly
                        value={preview.masked}
                        status={preview.error ? "error" : undefined}
                      />
                      {preview.error && <Text type="danger">{preview.error}</Text>}
                    </Flex>
                  </>
                ) : (
                  // View mode
                  <Flex justify="space-between" align="center">
                    <Flex vertical gap={4}>
                      <Text strong>
                        {item.pattern || t("settings.keywordMaskingTab.emptyPattern")}
                      </Text>
                      <Flex gap={8}>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.match_type === "regex"
                            ? t("settings.keywordMaskingTab.regexPattern")
                            : t("settings.keywordMaskingTab.exactMatch")}
                        </Text>
                        {!item.enabled && (
                          <Text type="warning" style={{ fontSize: 12 }}>
                            {t("settings.keywordMaskingTab.disabled")}
                          </Text>
                        )}
                      </Flex>
                    </Flex>
                    <Switch
                      checked={item.enabled}
                      onChange={(checked) => handleToggleEnabled(index, checked)}
                      size="small"
                    />
                  </Flex>
                )}
              </Flex>
            </List.Item>
          )}
        />
      </Space>
    </Card>
  );
};

export default SystemSettingsKeywordMaskingTab;
