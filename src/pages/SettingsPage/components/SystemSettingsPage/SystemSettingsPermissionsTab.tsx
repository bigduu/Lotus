import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Flex,
  Input,
  List,
  Space,
  Tag,
  Typography,
} from "antd";
import { DeleteOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import {
  settingsService,
  type DurablePermissionRule,
  type PermissionPolicyResponse,
} from "@services/config";

const { Text, Paragraph } = Typography;

// Suggested patterns offered as one-click chips.
const EXAMPLE_RULES = ["Bash(rm -rf *)", "Bash(git push *)", "Bash(sudo *)", "Write(/etc/**)"];

interface PermissionRuleListProps {
  rules: DurablePermissionRule[];
  loading: boolean;
  saving: boolean;
  emptyText: string;
  onRevoke: (rule: DurablePermissionRule) => void;
}

const PermissionRuleList: React.FC<PermissionRuleListProps> = ({
  rules,
  loading,
  saving,
  emptyText,
  onRevoke,
}) => {
  const { t } = useTranslation();

  return (
    <List
      loading={loading}
      dataSource={rules}
      locale={{ emptyText }}
      renderItem={(rule) => (
        <List.Item
          actions={[
            <Button
              key="revoke"
              danger
              size="small"
              icon={<DeleteOutlined />}
              loading={saving}
              onClick={() => onRevoke(rule)}
              aria-label={t("settings.permissionsTab.revokeRule", { id: rule.id })}
            >
              {t("settings.permissionsTab.revoke")}
            </Button>,
          ]}
        >
          <Space direction="vertical" size="small" style={{ width: "100%" }}>
            <Flex gap={8} wrap="wrap" align="center">
              <Text code style={{ overflowWrap: "anywhere" }}>
                {rule.matcher.kind}: {rule.matcher.value}
              </Text>
              <Tag color={rule.scope === "global" ? "warning" : "processing"}>{rule.scope}</Tag>
              <Tag>{rule.permission_type}</Tag>
            </Flex>
            <Descriptions size="small" column={1} colon={false}>
              <Descriptions.Item label={t("settings.permissionsTab.ruleSource")}>
                {rule.source}
              </Descriptions.Item>
              <Descriptions.Item label={t("settings.permissionsTab.ruleId")}>
                <Text type="secondary" copyable>
                  {rule.id}
                </Text>
              </Descriptions.Item>
              {rule.workspace_path ? (
                <Descriptions.Item label={t("settings.permissionsTab.workspace")}>
                  <Text code style={{ overflowWrap: "anywhere" }}>
                    {rule.workspace_path}
                  </Text>
                </Descriptions.Item>
              ) : null}
              {rule.created_at ? (
                <Descriptions.Item label={t("settings.permissionsTab.createdAt")}>
                  {new Date(rule.created_at).toLocaleString()}
                </Descriptions.Item>
              ) : null}
              {rule.expires_at ? (
                <Descriptions.Item label={t("settings.permissionsTab.expiresAt")}>
                  {new Date(rule.expires_at).toLocaleString()}
                </Descriptions.Item>
              ) : null}
              {rule.last_matched_at ? (
                <Descriptions.Item label={t("settings.permissionsTab.lastMatchedAt")}>
                  {new Date(rule.last_matched_at).toLocaleString()}
                </Descriptions.Item>
              ) : null}
              {typeof rule.match_count === "number" ? (
                <Descriptions.Item label={t("settings.permissionsTab.matchCount")}>
                  {rule.match_count}
                </Descriptions.Item>
              ) : null}
            </Descriptions>
          </Space>
        </List.Item>
      )}
    />
  );
};

const SystemSettingsPermissionsTab: React.FC = () => {
  const { t } = useTranslation();
  const { message, modal } = AntApp.useApp();
  const [policy, setPolicy] = useState<PermissionPolicyResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [askRuleError, setAskRuleError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const adoptPolicy = useCallback((next: PermissionPolicyResponse) => {
    // Policy revisions are monotonic within a Bamboo process. A slow refresh
    // must not roll the UI back after a newer CAS mutation has completed.
    setPolicy((current) => (!current || next.revision >= current.revision ? next : current));
  }, []);

  const loadPolicy = useCallback(
    async (showError = true) => {
      try {
        setLoading(true);
        adoptPolicy(await settingsService.getPermissionPolicy());
      } catch (error) {
        if (showError) {
          message.error(t("settings.permissionsTab.loadFailed"));
        }
        console.error(error);
      } finally {
        setLoading(false);
      }
    },
    [adoptPolicy, message, t],
  );

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const askRules = useMemo(() => policy?.policy.ask_rules ?? [], [policy]);
  const durableRules = useMemo(() => policy?.policy.durable_rules ?? [], [policy]);
  const rememberedAllows = useMemo(
    () => durableRules.filter((rule) => rule.effect === "allow"),
    [durableRules],
  );
  const denies = useMemo(
    () => durableRules.filter((rule) => rule.effect === "deny"),
    [durableRules],
  );
  const typedAlwaysAsk = useMemo(
    () => durableRules.filter((rule) => rule.effect === "always_ask"),
    [durableRules],
  );
  const otherRules = useMemo(
    () => durableRules.filter((rule) => !["allow", "deny", "always_ask"].includes(rule.effect)),
    [durableRules],
  );

  // Persist a new rule set with the revision the user actually inspected. On
  // success, reload the canonical policy so all groups advance together.
  const persistAskRules = useCallback(
    async (next: string[]) => {
      if (!policy) return false;
      try {
        setSaving(true);
        setAskRuleError(null);
        await settingsService.updatePermissionAskRules(next, policy.revision);
        adoptPolicy(await settingsService.getPermissionPolicy());
        message.success(t("settings.permissionsTab.saveSuccess"));
        return true;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : t("settings.permissionsTab.saveFailed");
        setAskRuleError(errorMessage);
        message.error(errorMessage);
        await loadPolicy(false);
        return false;
      } finally {
        setSaving(false);
      }
    },
    [adoptPolicy, loadPolicy, message, policy, t],
  );

  const addAskRule = useCallback(
    async (pattern: string) => {
      const trimmed = pattern.trim();
      if (!trimmed) return;
      if (askRules.includes(trimmed)) {
        message.info(t("settings.permissionsTab.duplicate"));
        return;
      }
      const ok = await persistAskRules([...askRules, trimmed]);
      if (ok) setDraft("");
    },
    [askRules, message, persistAskRules, t],
  );

  const removeAskRule = useCallback(
    (pattern: string) => persistAskRules(askRules.filter((rule) => rule !== pattern)),
    [askRules, persistAskRules],
  );

  const revokeRule = useCallback(
    (rule: DurablePermissionRule) => {
      if (!policy) return;
      modal.confirm({
        title: t("settings.permissionsTab.revokeTitle"),
        content: (
          <Space direction="vertical">
            <span>{t("settings.permissionsTab.revokeDescription")}</span>
            <Text code style={{ overflowWrap: "anywhere" }}>
              {rule.matcher.kind}: {rule.matcher.value}
            </Text>
          </Space>
        ),
        okText: t("settings.permissionsTab.revoke"),
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            setSaving(true);
            const nextPolicy = await settingsService.deletePermissionRule(rule.id, policy.revision);
            adoptPolicy(nextPolicy);
            message.success(t("settings.permissionsTab.revokeSuccess"));
          } catch (error) {
            message.error(
              error instanceof Error ? error.message : t("settings.permissionsTab.revokeFailed"),
            );
            await loadPolicy(false);
          } finally {
            setSaving(false);
          }
        },
      });
    },
    [adoptPolicy, loadPolicy, message, modal, policy, t],
  );

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <Card className="lotus-settings-card" title={t("settings.permissionsTab.title")}>
        <Space direction="vertical" style={{ width: "100%" }} size="middle">
          <Flex justify="space-between" align="center" gap={12} wrap="wrap">
            <Paragraph type="secondary" style={{ marginBottom: 0, flex: "1 1 420px" }}>
              {t("settings.permissionsTab.description")}
            </Paragraph>
            <Space wrap>
              {policy ? (
                <Tag>
                  {t("settings.permissionsTab.policyRevision", { revision: policy.revision })}
                </Tag>
              ) : null}
              <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadPolicy()}>
                {t("settings.permissionsTab.refresh")}
              </Button>
            </Space>
          </Flex>
          {policy?.last_error ? <Alert type="error" showIcon message={policy.last_error} /> : null}
        </Space>
      </Card>

      <Card type="inner" title={t("settings.permissionsTab.alwaysAsk")}>
        <Space direction="vertical" style={{ width: "100%" }} size="large">
          <Flex gap={8} wrap="wrap">
            <Input
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setAskRuleError(null);
              }}
              onPressEnter={() => void addAskRule(draft)}
              placeholder={t("settings.permissionsTab.placeholder")}
              allowClear
              style={{ flex: "1 1 280px" }}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              loading={saving}
              disabled={!policy || !draft.trim()}
              onClick={() => void addAskRule(draft)}
            >
              {t("settings.permissionsTab.add")}
            </Button>
          </Flex>
          {askRuleError ? <Alert type="error" showIcon message={askRuleError} /> : null}

          <Flex gap={8} wrap="wrap" align="center">
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t("settings.permissionsTab.examples")}
            </Text>
            {EXAMPLE_RULES.map((example) => (
              <Tag.CheckableTag
                key={example}
                checked={askRules.includes(example)}
                onChange={() => {
                  if (!askRules.includes(example)) void addAskRule(example);
                }}
              >
                {example}
              </Tag.CheckableTag>
            ))}
          </Flex>

          <List
            loading={loading}
            dataSource={askRules}
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
                    onClick={() => void removeAskRule(rule)}
                    aria-label={t("settings.permissionsTab.remove")}
                  />,
                ]}
              >
                <Text code>{rule}</Text>
              </List.Item>
            )}
          />

          {typedAlwaysAsk.length > 0 ? (
            <>
              <Text strong>{t("settings.permissionsTab.typedAlwaysAsk")}</Text>
              <PermissionRuleList
                rules={typedAlwaysAsk}
                loading={loading}
                saving={saving}
                emptyText={t("settings.permissionsTab.noTypedAlwaysAsk")}
                onRevoke={revokeRule}
              />
            </>
          ) : null}
        </Space>
      </Card>

      <Card type="inner" title={t("settings.permissionsTab.rememberedAllows")}>
        <PermissionRuleList
          rules={rememberedAllows}
          loading={loading}
          saving={saving}
          emptyText={t("settings.permissionsTab.noRememberedAllows")}
          onRevoke={revokeRule}
        />
      </Card>

      <Card type="inner" title={t("settings.permissionsTab.denies")}>
        <PermissionRuleList
          rules={denies}
          loading={loading}
          saving={saving}
          emptyText={t("settings.permissionsTab.noDenies")}
          onRevoke={revokeRule}
        />
      </Card>

      {otherRules.length > 0 ? (
        <Card type="inner" title={t("settings.permissionsTab.otherRules")}>
          <PermissionRuleList
            rules={otherRules}
            loading={loading}
            saving={saving}
            emptyText={t("settings.permissionsTab.noOtherRules")}
            onRevoke={revokeRule}
          />
        </Card>
      ) : null}

      <Card type="inner" title={t("settings.permissionsTab.temporaryGrants")}>
        <Alert
          type="info"
          showIcon
          message={t("settings.permissionsTab.temporaryInspectionUnavailable")}
          description={
            policy?.policy.session_grant_duration_secs
              ? t("settings.permissionsTab.temporaryGrantDuration", {
                  seconds: policy.policy.session_grant_duration_secs,
                })
              : undefined
          }
        />
      </Card>
    </Space>
  );
};

export default SystemSettingsPermissionsTab;
