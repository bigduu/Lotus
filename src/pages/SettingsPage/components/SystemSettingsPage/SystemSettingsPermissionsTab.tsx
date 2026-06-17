import React, { useCallback, useEffect, useState } from "react";
import { App as AntApp, Button, Card, Flex, Input, List, Space, Tag, Typography } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import { settingsService } from "@services/config";

const { Text, Paragraph } = Typography;

// Suggested patterns offered as one-click chips.
const EXAMPLE_RULES = ["Bash(rm -rf *)", "Bash(git push *)", "Bash(sudo *)", "Write(/etc/**)"];

const SystemSettingsPermissionsTab: React.FC = () => {
  const { t } = useTranslation();
  const { message } = AntApp.useApp();
  const [rules, setRules] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      setLoading(true);
      setRules(await settingsService.getPermissionAskRules());
    } catch (error) {
      message.error(t("settings.permissionsTab.loadFailed"));
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  // Persist a new rule set; on success adopt the server-normalized list.
  const persist = useCallback(
    async (next: string[]) => {
      try {
        setSaving(true);
        const saved = await settingsService.updatePermissionAskRules(next);
        setRules(saved);
        message.success(t("settings.permissionsTab.saveSuccess"));
        return true;
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : t("settings.permissionsTab.saveFailed"),
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    [message, t],
  );

  const addRule = useCallback(
    async (pattern: string) => {
      const trimmed = pattern.trim();
      if (!trimmed) return;
      if (rules.includes(trimmed)) {
        message.info(t("settings.permissionsTab.duplicate"));
        return;
      }
      const ok = await persist([...rules, trimmed]);
      if (ok) setDraft("");
    },
    [rules, persist, message, t],
  );

  const removeRule = useCallback(
    (pattern: string) => persist(rules.filter((r) => r !== pattern)),
    [rules, persist],
  );

  return (
    <Card
      className="lotus-settings-card"
      title={t("settings.permissionsTab.title")}
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          loading={saving}
          disabled={!draft.trim()}
          onClick={() => void addRule(draft)}
        >
          {t("settings.permissionsTab.add")}
        </Button>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }} size="large">
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("settings.permissionsTab.description")}
        </Paragraph>

        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={() => void addRule(draft)}
          placeholder={t("settings.permissionsTab.placeholder")}
          allowClear
        />

        <Flex gap={8} wrap="wrap" align="center">
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t("settings.permissionsTab.examples")}
          </Text>
          {EXAMPLE_RULES.map((example) => (
            <Tag.CheckableTag
              key={example}
              checked={rules.includes(example)}
              onChange={() => {
                if (!rules.includes(example)) void addRule(example);
              }}
            >
              {example}
            </Tag.CheckableTag>
          ))}
        </Flex>

        <List
          loading={loading}
          dataSource={rules}
          locale={{ emptyText: t("settings.permissionsTab.empty") }}
          renderItem={(rule) => (
            <List.Item
              actions={[
                <Button
                  key="delete"
                  danger
                  size="small"
                  icon={<DeleteOutlined />}
                  loading={saving}
                  onClick={() => void removeRule(rule)}
                  aria-label={t("settings.permissionsTab.remove")}
                />,
              ]}
            >
              <Text code>{rule}</Text>
            </List.Item>
          )}
        />
      </Space>
    </Card>
  );
};

export default SystemSettingsPermissionsTab;
