import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Divider,
  Flex,
  Input,
  Segmented,
  Select,
  Typography,
  theme,
} from "antd";
import { useTranslation } from "react-i18next";
import { getErrorMessage } from "@services/api";
import {
  serviceFactory,
  type PluginTrustConfig,
  type PluginTrustEnforcement,
  type TrustedKeyConfig,
} from "@services/common/ServiceFactory";

const { Text } = Typography;
const { useToken } = theme;

interface TrustDraft {
  trustedHosts: string[];
  trustedKeys: TrustedKeyConfig[];
  enforcement: PluginTrustEnforcement;
}

const DEFAULT_ALGORITHM = "ed25519";

function draftFromConfig(pluginTrust: PluginTrustConfig | undefined): TrustDraft {
  return {
    trustedHosts: pluginTrust?.trusted_hosts ?? [],
    trustedKeys: pluginTrust?.trusted_keys ?? [],
    enforcement: pluginTrust?.enforcement ?? "strict",
  };
}

/**
 * `plugin_trust` config card (Lotus issue #51): host allowlist, publisher
 * signing keys, and the persistent enforcement escape hatch that back every
 * URL plugin install (bamboo PRs #449/#450/#465/#483).
 *
 * Reads/writes the `plugin_trust` sub-tree of the bamboo config via the same
 * whole-document `GET`/partial-patch `POST bamboo/config` surface as
 * `NotificationChannelsSection`/`SystemSettingsConnectTab`. `trusted_hosts`/
 * `trusted_keys` ship with built-in defaults (nova/magpie's official keys +
 * `github.com/bigduu/`) — an absent `plugin_trust` in the GET response means
 * "using the built-in defaults", so the empty-array fallback here is only
 * ever hit before the first load resolves.
 *
 * `enforcement: "off"` disables the host allowlist, signature, AND checksum
 * requirement for every URL install/update server-wide (equivalent to
 * passing `--insecure` on every install) — selecting it surfaces a strong,
 * unmissable warning, mirroring `PluginInstallModal`'s per-install
 * trust-override warning pattern.
 */
const PluginTrustSection: React.FC = () => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [draft, setDraft] = useState<TrustDraft>(() => draftFromConfig(undefined));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const cfg = await serviceFactory.getBambooConfig();
      setDraft(draftFromConfig(cfg.plugin_trust));
    } catch (error) {
      setLoadError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (p: Partial<TrustDraft>) => setDraft((d) => ({ ...d, ...p }));

  const updateKey = (index: number, key: Partial<TrustedKeyConfig>) => {
    setDraft((d) => ({
      ...d,
      trustedKeys: d.trustedKeys.map((entry, i) => (i === index ? { ...entry, ...key } : entry)),
    }));
  };

  const addKey = () => {
    setDraft((d) => ({
      ...d,
      trustedKeys: [...d.trustedKeys, { label: "", algorithm: DEFAULT_ALGORITHM, public_key: "" }],
    }));
  };

  const removeKey = (index: number) => {
    setDraft((d) => ({ ...d, trustedKeys: d.trustedKeys.filter((_, i) => i !== index) }));
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const configPatch: { plugin_trust: PluginTrustConfig } = {
        plugin_trust: {
          trusted_hosts: draft.trustedHosts.map((h) => h.trim()).filter((h) => h.length > 0),
          trusted_keys: draft.trustedKeys
            .map((k) => ({
              label: k.label.trim(),
              algorithm: (k.algorithm || DEFAULT_ALGORITHM).trim(),
              public_key: k.public_key.trim(),
            }))
            .filter((k) => k.label.length > 0 && k.public_key.length > 0),
          enforcement: draft.enforcement,
        },
      };
      const savedCfg = await serviceFactory.setBambooConfig(configPatch);
      setDraft(draftFromConfig(savedCfg.plugin_trust));
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card size="small" className="lotus-settings-card" loading={loading}>
      <Flex vertical gap={token.marginMD}>
        <Text strong>{t("settings.pluginsTab.trustConfig.title")}</Text>
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {t("settings.pluginsTab.trustConfig.description")}
        </Text>

        {loadError ? (
          <Alert
            type="error"
            showIcon
            message={loadError}
            action={
              <Button size="small" onClick={() => void load()}>
                {t("settings.pluginsTab.trustConfig.retry")}
              </Button>
            }
          />
        ) : null}

        {!loading && !loadError && (
          <>
            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Flex vertical gap={token.marginXS}>
              <Text>{t("settings.pluginsTab.trustConfig.trustedHosts.title")}</Text>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {t("settings.pluginsTab.trustConfig.trustedHosts.help")}
              </Text>
              <Select<string[]>
                data-testid="trust-hosts"
                mode="tags"
                open={false}
                tokenSeparators={[",", " "]}
                value={draft.trustedHosts}
                onChange={(value) => patch({ trustedHosts: value })}
                placeholder={t("settings.pluginsTab.trustConfig.trustedHosts.placeholder")}
                style={{ width: "100%" }}
              />
            </Flex>

            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Flex vertical gap={token.marginXS}>
              <Flex align="center" justify="space-between" gap={token.marginSM}>
                <Text>{t("settings.pluginsTab.trustConfig.trustedKeys.title")}</Text>
                <Button size="small" data-testid="trust-key-add" onClick={addKey}>
                  {t("settings.pluginsTab.trustConfig.trustedKeys.addButton")}
                </Button>
              </Flex>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {t("settings.pluginsTab.trustConfig.trustedKeys.help")}
              </Text>

              {draft.trustedKeys.length === 0 ? (
                <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.pluginsTab.trustConfig.trustedKeys.empty")}
                </Text>
              ) : (
                draft.trustedKeys.map((key, index) => (
                  <Flex key={index} gap={token.marginXS} align="start" wrap="wrap">
                    <Input
                      data-testid={`trust-key-label-${index}`}
                      value={key.label}
                      onChange={(e) => updateKey(index, { label: e.target.value })}
                      placeholder={t(
                        "settings.pluginsTab.trustConfig.trustedKeys.labelPlaceholder",
                      )}
                      style={{ width: 200 }}
                    />
                    <Input
                      data-testid={`trust-key-public-key-${index}`}
                      value={key.public_key}
                      onChange={(e) => updateKey(index, { public_key: e.target.value })}
                      placeholder={t(
                        "settings.pluginsTab.trustConfig.trustedKeys.publicKeyPlaceholder",
                      )}
                      style={{ flex: 1, minWidth: 220 }}
                    />
                    <Button
                      size="small"
                      danger
                      data-testid={`trust-key-remove-${index}`}
                      onClick={() => removeKey(index)}
                    >
                      {t("settings.pluginsTab.trustConfig.trustedKeys.removeButton")}
                    </Button>
                  </Flex>
                ))
              )}
            </Flex>

            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Flex vertical gap={token.marginXS}>
              <Text>{t("settings.pluginsTab.trustConfig.enforcement.title")}</Text>
              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                {t("settings.pluginsTab.trustConfig.enforcement.help")}
              </Text>
              <Segmented
                data-testid="trust-enforcement"
                value={draft.enforcement}
                onChange={(value) => patch({ enforcement: value as PluginTrustEnforcement })}
                options={[
                  {
                    label: t("settings.pluginsTab.trustConfig.enforcement.strict"),
                    value: "strict",
                  },
                  {
                    label: t("settings.pluginsTab.trustConfig.enforcement.off"),
                    value: "off",
                  },
                ]}
              />
              {draft.enforcement === "off" ? (
                <Alert
                  type="error"
                  showIcon
                  message={t("settings.pluginsTab.trustConfig.enforcement.offWarningTitle")}
                  description={t(
                    "settings.pluginsTab.trustConfig.enforcement.offWarningDescription",
                  )}
                />
              ) : null}
            </Flex>

            {saveError ? <Alert type="error" showIcon message={saveError} /> : null}

            <Divider style={{ margin: `${token.marginXS}px 0` }} />

            <Flex align="center" justify="end" gap={token.marginSM}>
              {saved ? (
                <Text type="success" style={{ fontSize: token.fontSizeSM }}>
                  {t("settings.pluginsTab.trustConfig.saved")}
                </Text>
              ) : null}
              <Button
                data-testid="trust-save-button"
                type="primary"
                size="small"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving
                  ? t("settings.pluginsTab.trustConfig.saving")
                  : t("settings.pluginsTab.trustConfig.save")}
              </Button>
            </Flex>
          </>
        )}
      </Flex>
    </Card>
  );
};

export default PluginTrustSection;
