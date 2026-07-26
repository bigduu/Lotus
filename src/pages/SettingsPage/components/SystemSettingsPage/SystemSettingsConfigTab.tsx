import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  Space,
  Typography,
  Input,
  InputNumber,
  Button,
  theme,
  Alert,
  Select,
  List,
  Spin,
  Switch,
  Tabs,
  Modal,
} from "antd";
import { useTranslation } from "react-i18next";
import { NetworkSettingsCard } from "./NetworkSettingsCard";
import AccessPasswordCard from "./AccessPasswordCard";
import CodexExecutorSettings from "./CodexExecutorSettings";
import { serviceFactory } from "@services/common/ServiceFactory";
import type {
  BambooConfig,
  BambooConfigValidationIssue,
  BambooSubagentsConfig,
} from "@services/common/ServiceFactory";
import type { AppLocale } from "@shared/i18n/types";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import type { ToolsSkillsSection } from "@services/config/configSections";
import { reapplyConfigChanges } from "@shared/hooks/useConfigSectionDraft";
import { redactConfigError } from "./ConfigSectionStatus";

interface ConfigFormState {
  http_proxy: string;
  https_proxy: string;
  memory: {
    auto_dream_enabled: boolean;
  };
  subagents: BambooSubagentsConfig;
}

type ConfigSaveSection = "network" | "memory" | "subagents";

const { Text } = Typography;
const { useToken } = theme;
const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:9562/v1";
const SUBAGENT_EXECUTOR_BUILT_IN = "bamboo_runtime";
const SUBAGENT_EXECUTOR_CLAUDE_CODE = "claude_code";
const SUBAGENT_EXECUTOR_CODEX = "codex";
const CLAUDE_CODE_PERMISSION_MODES = [
  "default",
  "acceptEdits",
  "plan",
  "bypassPermissions",
] as const;

const normalizeToolNames = (names: string[]): string[] =>
  [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))].sort();

const readDisabledTools = (
  section: ToolsSkillsSection,
): string[] => {
  const rawDisabled = section.tools?.disabled;
  if (!Array.isArray(rawDisabled)) {
    return [];
  }

  return normalizeToolNames(rawDisabled.filter((name): name is string => typeof name === "string"));
};

const normalizeSubagentsForm = (subagents: BambooSubagentsConfig): BambooSubagentsConfig => ({
  max_concurrent: subagents.max_concurrent,
  executor: subagents.executor,
  claude_code_binary: subagents.claude_code_binary,
  claude_code_model: subagents.claude_code_model,
  claude_code_permission_mode: subagents.claude_code_permission_mode,
  claude_code_inherit_user_config: subagents.claude_code_inherit_user_config ?? false,
  claude_code_forward_env: normalizeToolNames(subagents.claude_code_forward_env ?? []),
  codex_binary: subagents.codex_binary,
  codex_model: subagents.codex_model,
  codex_mode: subagents.codex_mode ?? "exec",
  codex_auth_mode: subagents.codex_auth_mode ?? "bamboo",
  codex_base_url: subagents.codex_base_url,
  codex_wire_api: subagents.codex_wire_api,
  codex_provider_key_ref: subagents.codex_provider_key_ref,
  codex_forward_env: normalizeToolNames(subagents.codex_forward_env ?? []),
  codex_sandbox: subagents.codex_sandbox,
  codex_approval_policy: subagents.codex_approval_policy,
  codex_network_access: subagents.codex_network_access ?? false,
  codex_allow_danger_bypass: subagents.codex_allow_danger_bypass ?? false,
});

interface ConfigBaseDrafts {
  core: Pick<ConfigFormState, "http_proxy" | "https_proxy">;
  memory: ConfigFormState["memory"];
  subagents: BambooSubagentsConfig;
  toolsDisabled: string[];
}

const reapplyDisabledTools = (base: string[], draft: string[], latest: string[]): string[] => {
  const baseSet = new Set(base);
  const draftSet = new Set(draft);
  const result = new Set(latest);
  for (const tool of new Set([...base, ...draft])) {
    if (baseSet.has(tool) === draftSet.has(tool)) continue;
    if (draftSet.has(tool)) result.add(tool);
    else result.delete(tool);
  }
  return normalizeToolNames([...result]);
};

interface SystemSettingsConfigTabProps {
  msgApi: {
    success: (content: string) => void;
    error: (content: string) => void;
  };
  locale: AppLocale;
  onLocaleChange: (locale: AppLocale) => void;
}

export const SystemSettingsConfigTab: React.FC<SystemSettingsConfigTabProps> = ({
  msgApi,
  locale,
  onLocaleChange,
}) => {
  const { t } = useTranslation();
  const { token } = useToken();
  const [config, setConfig] = useState<ConfigFormState>({
    http_proxy: "",
    https_proxy: "",
    memory: {
      auto_dream_enabled: false,
    },
    subagents: {},
  });
  const [backendBaseUrl, setBackendBaseUrl] = useState(DEFAULT_BACKEND_BASE_URL);
  const [availableTools, setAvailableTools] = useState<string[]>([]);
  const [disabledTools, setDisabledTools] = useState<string[]>([]);
  const [savedDisabledTools, setSavedDisabledTools] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isToolsBusy, setIsToolsBusy] = useState(false);
  const [subagentValidationIssues, setSubagentValidationIssues] = useState<
    BambooConfigValidationIssue[]
  >([]);
  const loadSection = useConfigSectionStore((state) => state.loadSection);
  const saveSection = useConfigSectionStore((state) => state.saveSection);
  const coreSnapshot = useConfigSectionStore((state) => state.sections.core);
  const memorySnapshot = useConfigSectionStore((state) => state.sections.memory);
  const subagentsSnapshot = useConfigSectionStore((state) => state.sections.subagents);
  const toolsSnapshot = useConfigSectionStore((state) => state.sections["tools-skills"]);
  const [baseRevisions, setBaseRevisions] = useState<
    Partial<Record<"core" | "memory" | "subagents" | "tools-skills", number>>
  >({});
  const [dirtySections, setDirtySections] = useState<
    Partial<Record<"core" | "memory" | "subagents" | "tools-skills", boolean>>
  >({});
  const baseDraftsRef = useRef<ConfigBaseDrafts | null>(null);

  // Load config
  const loadConfig = useCallback(async () => {
    setIsLoading(true);
    try {
      const [core, memory, subagents, toolsSkills, toolsResponse] = await Promise.all([
        loadSection("core", { force: true }),
        loadSection("memory", { force: true }),
        loadSection("subagents", { force: true }),
        loadSection("tools-skills", { force: true }),
        serviceFactory.getBambooTools(),
      ]);
      const nextConfig: ConfigFormState = {
        http_proxy: core.data.http_proxy || "",
        https_proxy: core.data.https_proxy || "",
        memory: {
          auto_dream_enabled: memory.data?.auto_dream_enabled ?? false,
        },
        subagents: normalizeSubagentsForm(subagents.data),
      };
      setConfig(nextConfig);
      setSubagentValidationIssues([]);
      const nextDisabled = readDisabledTools(toolsSkills.data);
      setDisabledTools(nextDisabled);
      setSavedDisabledTools(nextDisabled);
      setAvailableTools(normalizeToolNames(toolsResponse.tools || []));
      baseDraftsRef.current = {
        core: {
          http_proxy: nextConfig.http_proxy,
          https_proxy: nextConfig.https_proxy,
        },
        memory: structuredClone(nextConfig.memory),
        subagents: structuredClone(nextConfig.subagents),
        toolsDisabled: [...nextDisabled],
      };
      setBaseRevisions({
        core: core.revision,
        memory: memory.revision,
        subagents: subagents.revision,
        "tools-skills": toolsSkills.revision,
      });
      setDirtySections({});
    } catch (error) {
      console.error("Failed to load config:", error);
      msgApi.error(t("settings.configTab.loadConfigFailed"));
    } finally {
      setIsLoading(false);
    }
  }, [loadSection, msgApi, t]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const envelope = coreSnapshot.envelope;
    if (!envelope || envelope.revision === baseRevisions.core || dirtySections.core) return;
    setConfig((current) => ({
      ...current,
      http_proxy: envelope.data.http_proxy ?? "",
      https_proxy: envelope.data.https_proxy ?? "",
    }));
    if (baseDraftsRef.current) {
      baseDraftsRef.current.core = {
        http_proxy: envelope.data.http_proxy ?? "",
        https_proxy: envelope.data.https_proxy ?? "",
      };
    }
    setBaseRevisions((current) => ({ ...current, core: envelope.revision }));
  }, [baseRevisions.core, coreSnapshot.envelope, dirtySections.core]);

  useEffect(() => {
    const envelope = memorySnapshot.envelope;
    if (!envelope || envelope.revision === baseRevisions.memory || dirtySections.memory) return;
    setConfig((current) => ({
      ...current,
      memory: { auto_dream_enabled: envelope.data?.auto_dream_enabled ?? false },
    }));
    if (baseDraftsRef.current) {
      baseDraftsRef.current.memory = {
        auto_dream_enabled: envelope.data?.auto_dream_enabled ?? false,
      };
    }
    setBaseRevisions((current) => ({ ...current, memory: envelope.revision }));
  }, [baseRevisions.memory, dirtySections.memory, memorySnapshot.envelope]);

  useEffect(() => {
    const envelope = subagentsSnapshot.envelope;
    if (!envelope || envelope.revision === baseRevisions.subagents || dirtySections.subagents) return;
    const nextSubagents = normalizeSubagentsForm(envelope.data);
    setConfig((current) => ({ ...current, subagents: nextSubagents }));
    if (baseDraftsRef.current) {
      baseDraftsRef.current.subagents = structuredClone(nextSubagents);
    }
    setBaseRevisions((current) => ({ ...current, subagents: envelope.revision }));
  }, [baseRevisions.subagents, dirtySections.subagents, subagentsSnapshot.envelope]);

  useEffect(() => {
    const envelope = toolsSnapshot.envelope;
    if (
      !envelope ||
      envelope.revision === baseRevisions["tools-skills"] ||
      dirtySections["tools-skills"]
    ) {
      return;
    }
    const nextDisabled = readDisabledTools(envelope.data);
    setDisabledTools(nextDisabled);
    setSavedDisabledTools(nextDisabled);
    if (baseDraftsRef.current) {
      baseDraftsRef.current.toolsDisabled = [...nextDisabled];
    }
    setBaseRevisions((current) => ({ ...current, "tools-skills": envelope.revision }));
  }, [baseRevisions, dirtySections, toolsSnapshot.envelope]);

  // Handlers
  const handleHttpProxyChange = (value: string) => {
    setDirtySections((current) => ({ ...current, core: true }));
    setConfig((prev) => ({ ...prev, http_proxy: value }));
  };

  const handleHttpsProxyChange = (value: string) => {
    setDirtySections((current) => ({ ...current, core: true }));
    setConfig((prev) => ({ ...prev, https_proxy: value }));
  };

  const handleAutoDreamToggle = (checked: boolean) => {
    setDirtySections((current) => ({ ...current, memory: true }));
    setConfig((prev) => ({
      ...prev,
      memory: {
        ...prev.memory,
        auto_dream_enabled: checked,
      },
    }));
  };

  const handleSubagentMaxConcurrentChange = (value: number | null) => {
    setDirtySections((current) => ({ ...current, subagents: true }));
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        max_concurrent: value !== null && Number.isFinite(value) && value > 0 ? value : undefined,
      },
    }));
  };

  const handleSubagentExecutorChange = (value: string) => {
    setDirtySections((current) => ({ ...current, subagents: true }));
    setSubagentValidationIssues([]);
    setConfig((prev) => ({
      ...prev,
      // Always store a concrete string (never `undefined`): the save patch
      // is deep-merged server-side (crates/infra/bamboo-config/src/patch.rs
      // `deep_merge_json`), so an OMITTED key means "leave unchanged," not
      // "clear." Sending the literal "bamboo_runtime" (which the backend
      // treats identically to an absent/`None` executor — see
      // bamboo-engine external_agents/runtime.rs) is what actually reverts
      // a previously-saved `claude_code` executor back to built-in.
      subagents: {
        ...prev.subagents,
        executor: value,
      },
    }));
  };

  const handleCodexSettingsChange = (patch: Partial<BambooSubagentsConfig>) => {
    setDirtySections((current) => ({ ...current, subagents: true }));
    setSubagentValidationIssues([]);
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        ...patch,
      },
    }));
  };

  const handleClaudeCodeBinaryChange = (value: string) => {
    setDirtySections((current) => ({ ...current, subagents: true }));
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        claude_code_binary: value.trim() || undefined,
      },
    }));
  };

  const handleClaudeCodeModelChange = (value: string) => {
    setDirtySections((current) => ({ ...current, subagents: true }));
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        claude_code_model: value.trim() || undefined,
      },
    }));
  };

  const handleClaudeCodePermissionModeChange = (value: string) => {
    setDirtySections((current) => ({ ...current, subagents: true }));
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        claude_code_permission_mode: value,
      },
    }));
  };

  const handleClaudeCodeInheritUserConfigToggle = (checked: boolean) => {
    setDirtySections((current) => ({ ...current, subagents: true }));
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        claude_code_inherit_user_config: checked,
      },
    }));
  };

  const handleClaudeCodeForwardEnvChange = (values: string[]) => {
    setDirtySections((current) => ({ ...current, subagents: true }));
    setConfig((prev) => ({
      ...prev,
      subagents: {
        ...prev.subagents,
        claude_code_forward_env: normalizeToolNames(values),
      },
    }));
  };

  const handleSaveConfig = async (section: ConfigSaveSection) => {
    setIsLoading(true);
    try {
      let patch: BambooConfig;
      let savedRevision: number;
      if (section === "network") {
        patch = {
          http_proxy: config.http_proxy,
          https_proxy: config.https_proxy,
        };
      } else if (section === "memory") {
        patch = {
          memory: { auto_dream_enabled: config.memory.auto_dream_enabled },
        };
      } else {
        const isClaudeCode = config.subagents.executor === SUBAGENT_EXECUTOR_CLAUDE_CODE;
        const isCodex = config.subagents.executor === SUBAGENT_EXECUTOR_CODEX;
        const codexAuthMode = config.subagents.codex_auth_mode ?? "bamboo";
        const codexMode = config.subagents.codex_mode ?? "exec";
        const isCustomCodex = codexAuthMode === "custom";
        const codexForwardEnv = normalizeToolNames(config.subagents.codex_forward_env ?? []).filter(
          (name) => name !== "OPENAI_API_KEY" || codexAuthMode === "api_key",
        );
        if (isCodex && codexAuthMode === "api_key" && !codexForwardEnv.includes("OPENAI_API_KEY")) {
          codexForwardEnv.push("OPENAI_API_KEY");
        }
        patch = {
          subagents: {
            max_concurrent: config.subagents.max_concurrent,
            executor: config.subagents.executor,
            claude_code_binary: isClaudeCode ? config.subagents.claude_code_binary : undefined,
            claude_code_model: isClaudeCode ? config.subagents.claude_code_model : undefined,
            claude_code_permission_mode: isClaudeCode
              ? config.subagents.claude_code_permission_mode
              : undefined,
            claude_code_inherit_user_config: isClaudeCode
              ? config.subagents.claude_code_inherit_user_config
              : undefined,
            claude_code_forward_env: isClaudeCode
              ? config.subagents.claude_code_forward_env
              : undefined,
            codex_binary: isCodex ? config.subagents.codex_binary?.trim() || null : undefined,
            codex_model: isCodex ? config.subagents.codex_model?.trim() || null : undefined,
            codex_mode: isCodex ? codexMode : undefined,
            codex_auth_mode: isCodex ? codexAuthMode : undefined,
            codex_base_url: isCodex
              ? isCustomCodex
                ? config.subagents.codex_base_url?.trim() || null
                : null
              : undefined,
            codex_wire_api: isCodex ? (isCustomCodex ? "responses" : null) : undefined,
            codex_provider_key_ref: isCodex
              ? isCustomCodex
                ? config.subagents.codex_provider_key_ref?.trim() || null
                : null
              : undefined,
            codex_forward_env: isCodex ? codexForwardEnv : undefined,
            codex_sandbox: isCodex ? (config.subagents.codex_sandbox ?? null) : undefined,
            codex_approval_policy: isCodex
              ? codexMode === "app_server"
                ? "on-request"
                : (config.subagents.codex_approval_policy ?? null)
              : undefined,
            codex_network_access: isCodex
              ? (config.subagents.codex_network_access ?? false)
              : undefined,
            codex_allow_danger_bypass: isCodex
              ? (config.subagents.codex_allow_danger_bypass ?? false)
              : undefined,
          },
        };
      }

      const validation = await serviceFactory.validateBambooConfigPatch(patch);
      if (!validation.valid) {
        const proxyIssue = validation.errors?.proxy?.[0];
        const issue =
          proxyIssue ??
          Object.values(validation.errors || {})
            .flat()
            .filter(Boolean)[0];
        if (section === "subagents") {
          setSubagentValidationIssues(validation.errors?.subagents ?? []);
        }
        msgApi.error(
          issue ? `${issue.path}: ${issue.message}` : t("settings.configTab.invalidConfig"),
        );
        return;
      }

      if (section === "network") {
        const baseRevision = baseRevisions.core;
        if (baseRevision === undefined) throw new Error("Core configuration is not loaded.");
        const saved = await saveSection(
          "core",
          {
            ...(coreSnapshot.envelope?.data ?? {}),
            http_proxy: config.http_proxy,
            https_proxy: config.https_proxy,
          },
          baseRevision,
        );
        savedRevision = saved.revision;
        setConfig((current) => ({
          ...current,
          http_proxy: saved.data.http_proxy ?? "",
          https_proxy: saved.data.https_proxy ?? "",
        }));
        if (baseDraftsRef.current) {
          baseDraftsRef.current.core = {
            http_proxy: saved.data.http_proxy ?? "",
            https_proxy: saved.data.https_proxy ?? "",
          };
        }
        setBaseRevisions((current) => ({ ...current, core: savedRevision }));
        setDirtySections((current) => ({ ...current, core: false }));
      } else if (section === "memory") {
        const baseRevision = baseRevisions.memory;
        if (baseRevision === undefined) throw new Error("Memory configuration is not loaded.");
        const saved = await saveSection(
          "memory",
          {
            ...(memorySnapshot.envelope?.data ?? {}),
            auto_dream_enabled: config.memory.auto_dream_enabled,
          },
          baseRevision,
        );
        savedRevision = saved.revision;
        setConfig((current) => ({
          ...current,
          memory: {
            auto_dream_enabled: saved.data?.auto_dream_enabled ?? false,
          },
        }));
        if (baseDraftsRef.current) {
          baseDraftsRef.current.memory = {
            auto_dream_enabled: saved.data?.auto_dream_enabled ?? false,
          };
        }
        setBaseRevisions((current) => ({ ...current, memory: savedRevision }));
        setDirtySections((current) => ({ ...current, memory: false }));
      } else {
        const baseRevision = baseRevisions.subagents;
        if (baseRevision === undefined) throw new Error("Sub-agent configuration is not loaded.");
        const saved = await saveSection(
          "subagents",
          {
            ...(subagentsSnapshot.envelope?.data ?? {}),
            ...(patch.subagents ?? {}),
          },
          baseRevision,
        );
        savedRevision = saved.revision;
        const canonicalSubagents = normalizeSubagentsForm(saved.data);
        setConfig((current) => ({ ...current, subagents: canonicalSubagents }));
        if (baseDraftsRef.current) {
          baseDraftsRef.current.subagents = structuredClone(canonicalSubagents);
        }
        setBaseRevisions((current) => ({ ...current, subagents: savedRevision }));
        setDirtySections((current) => ({ ...current, subagents: false }));
      }
      if (section === "subagents") {
        setSubagentValidationIssues([]);
      }
      msgApi.success(t("settings.configTab.saveConfigSuccess"));
    } catch (error) {
      console.error("Failed to save config:", error);
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : t("settings.configTab.saveConfigFailed");
      msgApi.error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveBackendUrl = async () => {
    msgApi.success(t("settings.configTab.backendSaved"));
  };

  const handleResetBackendUrl = () => {
    setBackendBaseUrl(DEFAULT_BACKEND_BASE_URL);
    msgApi.success(t("settings.configTab.backendResetDefault"));
  };

  const handleToolEnabledChange = (toolName: string, enabled: boolean) => {
    setDirtySections((current) => ({ ...current, "tools-skills": true }));
    setDisabledTools((previous) => {
      const next = new Set(previous);
      if (enabled) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      return normalizeToolNames([...next]);
    });
  };

  const handleReloadTools = async () => {
    setIsToolsBusy(true);
    try {
      const toolsResponse = await serviceFactory.getBambooTools();
      setAvailableTools(normalizeToolNames(toolsResponse.tools || []));
      msgApi.success(t("settings.configTab.toolsReloadSuccess"));
    } catch (error) {
      console.error("Failed to reload tools:", error);
      msgApi.error(t("settings.configTab.toolsLoadFailed"));
    } finally {
      setIsToolsBusy(false);
    }
  };

  const handleSaveTools = async () => {
    setIsToolsBusy(true);
    try {
      const nextDisabled = normalizeToolNames(disabledTools);
      const baseRevision = baseRevisions["tools-skills"];
      if (baseRevision === undefined) throw new Error("Tools configuration is not loaded.");
      const saved = await saveSection(
        "tools-skills",
        {
          ...(toolsSnapshot.envelope?.data ?? {}),
          tools: {
            ...(toolsSnapshot.envelope?.data.tools ?? {}),
            disabled: nextDisabled,
          },
        },
        baseRevision,
      );
      const canonicalDisabled = readDisabledTools(saved.data);
      if (baseDraftsRef.current) {
        baseDraftsRef.current.toolsDisabled = [...canonicalDisabled];
      }
      setBaseRevisions((current) => ({ ...current, "tools-skills": saved.revision }));
      setDirtySections((current) => ({ ...current, "tools-skills": false }));
      setDisabledTools(canonicalDisabled);
      setSavedDisabledTools(canonicalDisabled);
      msgApi.success(t("settings.configTab.toolsSaveSuccess"));
    } catch (error) {
      console.error("Failed to save tool settings:", error);
      msgApi.error(t("settings.configTab.toolsSaveFailed"));
    } finally {
      setIsToolsBusy(false);
    }
  };

  const hasToolChanges = JSON.stringify(disabledTools) !== JSON.stringify(savedDisabledTools);
  const disabledToolSet = new Set(disabledTools);
  const externalSections = [
    ["core", coreSnapshot.envelope?.revision, baseRevisions.core, dirtySections.core],
    ["memory", memorySnapshot.envelope?.revision, baseRevisions.memory, dirtySections.memory],
    [
      "subagents",
      subagentsSnapshot.envelope?.revision,
      baseRevisions.subagents,
      dirtySections.subagents,
    ],
    [
      "tools-skills",
      toolsSnapshot.envelope?.revision,
      baseRevisions["tools-skills"],
      dirtySections["tools-skills"],
    ],
  ].filter((entry) => entry[3] && entry[1] !== undefined && entry[1] !== entry[2]) as Array<
    [string, number, number | undefined, boolean]
  >;

  const reapplyExternalDrafts = () => {
    const baseDrafts = baseDraftsRef.current;
    if (!baseDrafts) return;
    const externalNames = new Set(externalSections.map(([section]) => section));
    let nextConfig = config;
    const nextBaseDrafts = structuredClone(baseDrafts);

    if (externalNames.has("core") && coreSnapshot.envelope) {
      const latest = {
        http_proxy: coreSnapshot.envelope.data.http_proxy ?? "",
        https_proxy: coreSnapshot.envelope.data.https_proxy ?? "",
      };
      const rebased = reapplyConfigChanges(
        baseDrafts.core,
        { http_proxy: config.http_proxy, https_proxy: config.https_proxy },
        latest,
      );
      nextConfig = { ...nextConfig, ...rebased };
      nextBaseDrafts.core = latest;
    }
    if (externalNames.has("memory") && memorySnapshot.envelope) {
      const latest = {
        auto_dream_enabled: memorySnapshot.envelope.data?.auto_dream_enabled ?? false,
      };
      const rebased = reapplyConfigChanges(baseDrafts.memory, config.memory, latest);
      nextConfig = { ...nextConfig, memory: rebased };
      nextBaseDrafts.memory = latest;
    }
    if (externalNames.has("subagents") && subagentsSnapshot.envelope) {
      const latest = normalizeSubagentsForm(subagentsSnapshot.envelope.data);
      const rebased = reapplyConfigChanges(
        baseDrafts.subagents,
        config.subagents,
        latest,
      );
      nextConfig = { ...nextConfig, subagents: rebased };
      nextBaseDrafts.subagents = structuredClone(latest);
    }
    if (externalNames.has("tools-skills") && toolsSnapshot.envelope) {
      const latest = readDisabledTools(toolsSnapshot.envelope.data);
      const rebased = reapplyDisabledTools(
        baseDrafts.toolsDisabled,
        disabledTools,
        latest,
      );
      setDisabledTools(rebased);
      nextBaseDrafts.toolsDisabled = [...latest];
    }

    setConfig(nextConfig);
    baseDraftsRef.current = nextBaseDrafts;
    setBaseRevisions((current) => {
      const next = { ...current };
      for (const [section, revision] of externalSections) {
        next[section as keyof typeof next] = revision;
      }
      return next;
    });
  };

  const compareExternalDrafts = () => {
    const baseDrafts = baseDraftsRef.current;
    if (!baseDrafts) return;
    const comparison = Object.fromEntries(
      externalSections.map(([section]) => {
        if (section === "core") {
          return [
            section,
            {
              base: baseDrafts.core,
              draft: {
                http_proxy: config.http_proxy,
                https_proxy: config.https_proxy,
              },
              latest: {
                http_proxy: coreSnapshot.envelope?.data.http_proxy ?? "",
                https_proxy: coreSnapshot.envelope?.data.https_proxy ?? "",
              },
            },
          ];
        }
        if (section === "memory") {
          return [
            section,
            {
              base: baseDrafts.memory,
              draft: config.memory,
              latest: {
                auto_dream_enabled: memorySnapshot.envelope?.data?.auto_dream_enabled ?? false,
              },
            },
          ];
        }
        if (section === "subagents") {
          return [
            section,
            {
              base: baseDrafts.subagents,
              draft: config.subagents,
              latest: subagentsSnapshot.envelope
                ? normalizeSubagentsForm(subagentsSnapshot.envelope.data)
                : null,
            },
          ];
        }
        return [
          section,
          {
            base: baseDrafts.toolsDisabled,
            draft: disabledTools,
            latest: toolsSnapshot.envelope ? readDisabledTools(toolsSnapshot.envelope.data) : null,
          },
        ];
      }),
    );
    Modal.info({
      title: "Configuration changed on disk",
      content: (
        <pre style={{ maxHeight: 460, overflow: "auto", whiteSpace: "pre-wrap" }}>
          {redactConfigError(JSON.stringify(comparison, null, 2))}
        </pre>
      ),
    });
  };

  return (
    <Spin spinning={isLoading} tip={t("settings.common.loading")}>
      <div>
        {externalSections.length > 0 && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: token.marginMD }}
            message="Configuration changed on disk"
            description="Your unsaved edits were kept. Reload to discard them, compare revisions, or reapply them on the latest snapshot before saving."
            action={
              <Space>
                <Button size="small" onClick={compareExternalDrafts}>
                  Compare
                </Button>
                <Button size="small" onClick={() => void loadConfig()}>
                  Reload
                </Button>
                <Button size="small" type="primary" onClick={reapplyExternalDrafts}>
                  Reapply
                </Button>
              </Space>
            }
          />
        )}
        <Tabs
        items={[
          {
            key: "general",
            label: t("settings.configTab.tabs.general"),
            children: (
              <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
                <NetworkSettingsCard
                  httpProxy={config.http_proxy}
                  httpsProxy={config.https_proxy}
                  onHttpProxyChange={handleHttpProxyChange}
                  onHttpsProxyChange={handleHttpsProxyChange}
                  onReload={loadConfig}
                  onSave={() => handleSaveConfig("network")}
                  isLoading={isLoading}
                />

                <Card
                  size="small"
                  className="lotus-settings-card"
                  title={<Text strong>{t("settings.configTab.language")}</Text>}
                >
                  <Select
                    value={locale}
                    style={{ width: 260 }}
                    options={[
                      {
                        label: t("settings.configTab.languageEnglish"),
                        value: "en-US",
                      },
                      {
                        label: t("settings.configTab.languageChinese"),
                        value: "zh-CN",
                      },
                      {
                        label: t("settings.configTab.languageTraditionalChinese"),
                        value: "zh-TW",
                      },
                      {
                        label: t("settings.configTab.languageFrench"),
                        value: "fr-FR",
                      },
                      {
                        label: t("settings.configTab.languageJapanese"),
                        value: "ja-JP",
                      },
                      {
                        label: t("settings.configTab.languageHindi"),
                        value: "hi-IN",
                      },
                    ]}
                    onChange={(value) => onLocaleChange(value as AppLocale)}
                  />
                </Card>

                <Card
                  size="small"
                  className="lotus-settings-card"
                  title={<Text strong>{t("settings.configTab.memoryTitle")}</Text>}
                >
                  <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
                    <Text type="secondary">{t("settings.configTab.memoryDescription")}</Text>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: token.marginMD,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <Text strong>{t("settings.configTab.autoDreamEnabled")}</Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            {t("settings.configTab.autoDreamEnabledHint")}
                          </Text>
                        </div>
                      </div>
                      <Switch
                        data-testid="auto-dream-toggle"
                        checked={config.memory.auto_dream_enabled}
                        onChange={handleAutoDreamToggle}
                      />
                    </div>

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Button
                        data-testid="save-memory-settings"
                        type="primary"
                        onClick={() => handleSaveConfig("memory")}
                        loading={isLoading}
                      >
                        {t("settings.configTab.save")}
                      </Button>
                    </div>
                  </Space>
                </Card>

                <Card
                  size="small"
                  className="lotus-settings-card"
                  title={<Text strong>{t("settings.configTab.subagentsTitle")}</Text>}
                >
                  <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
                    <Text type="secondary">{t("settings.configTab.subagentsDescription")}</Text>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: token.marginMD,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <Text strong>{t("settings.configTab.subagentMaxConcurrent")}</Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            {t("settings.configTab.subagentMaxConcurrentHint")}
                          </Text>
                        </div>
                      </div>
                      <InputNumber
                        data-testid="subagent-max-concurrent"
                        style={{ width: 120 }}
                        min={1}
                        step={1}
                        precision={0}
                        placeholder="8"
                        value={config.subagents.max_concurrent ?? null}
                        onChange={(value) =>
                          handleSubagentMaxConcurrentChange(
                            typeof value === "number" ? value : null,
                          )
                        }
                      />
                    </div>

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: token.marginMD,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <Text strong>{t("settings.configTab.subagentExecutor")}</Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                            {t("settings.configTab.subagentExecutorHint")}
                          </Text>
                        </div>
                      </div>
                      <Select
                        data-testid="subagent-executor"
                        style={{ width: 260 }}
                        value={config.subagents.executor ?? SUBAGENT_EXECUTOR_BUILT_IN}
                        onChange={(value) => handleSubagentExecutorChange(value as string)}
                        options={[
                          {
                            label: t("settings.configTab.subagentExecutorBuiltIn"),
                            value: SUBAGENT_EXECUTOR_BUILT_IN,
                          },
                          {
                            label: t("settings.configTab.subagentExecutorClaudeCode"),
                            value: SUBAGENT_EXECUTOR_CLAUDE_CODE,
                          },
                          {
                            label: t("settings.configTab.subagentExecutorCodex"),
                            value: SUBAGENT_EXECUTOR_CODEX,
                          },
                        ]}
                      />
                    </div>

                    {config.subagents.executor === SUBAGENT_EXECUTOR_CLAUDE_CODE && (
                      <Space
                        direction="vertical"
                        size={token.marginMD}
                        style={{
                          width: "100%",
                          padding: token.paddingSM,
                          borderRadius: token.borderRadiusLG,
                          background: token.colorFillTertiary,
                        }}
                      >
                        <Alert
                          type="info"
                          showIcon
                          message={t("settings.configTab.claudeCodeExecutorNotice")}
                        />

                        <div>
                          <Text strong>{t("settings.configTab.claudeCodeBinary")}</Text>
                          <div>
                            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                              {t("settings.configTab.claudeCodeBinaryHint")}
                            </Text>
                          </div>
                          <Input
                            data-testid="claude-code-binary"
                            style={{ marginTop: token.marginXXS }}
                            placeholder={t("settings.configTab.claudeCodeBinaryPlaceholder")}
                            value={config.subagents.claude_code_binary ?? ""}
                            onChange={(e) => handleClaudeCodeBinaryChange(e.target.value)}
                          />
                        </div>

                        <div>
                          <Text strong>{t("settings.configTab.claudeCodeModel")}</Text>
                          <div>
                            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                              {t("settings.configTab.claudeCodeModelHint")}
                            </Text>
                          </div>
                          <Input
                            data-testid="claude-code-model"
                            style={{ marginTop: token.marginXXS }}
                            placeholder={t("settings.configTab.claudeCodeModelPlaceholder")}
                            value={config.subagents.claude_code_model ?? ""}
                            onChange={(e) => handleClaudeCodeModelChange(e.target.value)}
                          />
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: token.marginMD,
                            flexWrap: "wrap",
                          }}
                        >
                          <div>
                            <Text strong>{t("settings.configTab.claudeCodePermissionMode")}</Text>
                            <div>
                              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                {t("settings.configTab.claudeCodePermissionModeHint")}
                              </Text>
                            </div>
                          </div>
                          <Select
                            data-testid="claude-code-permission-mode"
                            style={{ width: 220 }}
                            value={config.subagents.claude_code_permission_mode ?? "default"}
                            onChange={(value) =>
                              handleClaudeCodePermissionModeChange(value as string)
                            }
                            options={CLAUDE_CODE_PERMISSION_MODES.map((mode) => ({
                              label: t(`settings.configTab.claudeCodePermissionModes.${mode}`),
                              value: mode,
                            }))}
                          />
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            gap: token.marginMD,
                            flexWrap: "wrap",
                          }}
                        >
                          <div>
                            <Text strong>
                              {t("settings.configTab.claudeCodeInheritUserConfig")}
                            </Text>
                            <div>
                              <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                                {t("settings.configTab.claudeCodeInheritUserConfigHint")}
                              </Text>
                            </div>
                          </div>
                          <Switch
                            data-testid="claude-code-inherit-user-config"
                            checked={config.subagents.claude_code_inherit_user_config ?? false}
                            onChange={handleClaudeCodeInheritUserConfigToggle}
                          />
                        </div>

                        <div>
                          <Text strong>{t("settings.configTab.claudeCodeForwardEnv")}</Text>
                          <div>
                            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                              {t("settings.configTab.claudeCodeForwardEnvHint")}
                            </Text>
                          </div>
                          <Select<string[]>
                            data-testid="claude-code-forward-env"
                            mode="tags"
                            open={false}
                            tokenSeparators={[",", " "]}
                            style={{ width: "100%", marginTop: token.marginXXS }}
                            value={config.subagents.claude_code_forward_env ?? []}
                            onChange={(value) => handleClaudeCodeForwardEnvChange(value)}
                            placeholder={t("settings.configTab.claudeCodeForwardEnvPlaceholder")}
                          />
                        </div>
                      </Space>
                    )}

                    {config.subagents.executor === SUBAGENT_EXECUTOR_CODEX && (
                      <CodexExecutorSettings
                        value={config.subagents}
                        validationIssues={subagentValidationIssues}
                        onChange={handleCodexSettingsChange}
                      />
                    )}

                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Button
                        data-testid="save-subagent-settings"
                        type="primary"
                        onClick={() => handleSaveConfig("subagents")}
                        loading={isLoading}
                      >
                        {t("settings.configTab.save")}
                      </Button>
                    </div>
                  </Space>
                </Card>

                <Card
                  size="small"
                  title={<Text strong>{t("settings.configTab.backendApiBaseUrlTitle")}</Text>}
                >
                  <Space direction="vertical" size={token.marginSM} style={{ width: "100%" }}>
                    <Space direction="vertical" size={token.marginXXS} style={{ width: "100%" }}>
                      <Input
                        style={{ width: "100%" }}
                        value={backendBaseUrl}
                        onChange={(e) => setBackendBaseUrl(e.target.value)}
                        placeholder={t("settings.configTab.backendApiPlaceholder")}
                      />
                    </Space>
                    <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
                      {t("settings.configTab.backendApiHint")}
                    </Text>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: token.marginSM,
                      }}
                    >
                      <Button data-testid="reset-to-defaults" onClick={handleResetBackendUrl}>
                        {t("settings.configTab.resetToDefault")}
                      </Button>
                      <Button
                        data-testid="save-api-settings"
                        type="primary"
                        onClick={handleSaveBackendUrl}
                      >
                        {t("settings.configTab.save")}
                      </Button>
                    </div>
                  </Space>
                </Card>

                <AccessPasswordCard msgApi={msgApi} />
              </Space>
            ),
          },
          {
            key: "tools",
            label: t("settings.configTab.tabs.tools"),
            children: (
              <Card size="small" title={<Text strong>{t("settings.configTab.toolsTitle")}</Text>}>
                <Space direction="vertical" size={token.marginMD} style={{ width: "100%" }}>
                  <Text type="secondary">{t("settings.configTab.toolsDescription")}</Text>

                  {availableTools.length === 0 ? (
                    <Alert type="info" showIcon message={t("settings.configTab.toolsEmpty")} />
                  ) : (
                    <List
                      bordered
                      dataSource={availableTools}
                      renderItem={(toolName) => (
                        <List.Item
                          actions={[
                            <Switch
                              key={`${toolName}-switch`}
                              checked={!disabledToolSet.has(toolName)}
                              onChange={(enabled) => handleToolEnabledChange(toolName, enabled)}
                            />,
                          ]}
                        >
                          <Text code>{toolName}</Text>
                        </List.Item>
                      )}
                    />
                  )}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      gap: token.marginSM,
                    }}
                  >
                    <Button onClick={handleReloadTools} loading={isToolsBusy}>
                      {t("settings.configTab.reloadTools")}
                    </Button>
                    <Button
                      type="primary"
                      onClick={handleSaveTools}
                      loading={isToolsBusy}
                      disabled={!hasToolChanges}
                    >
                      {t("settings.configTab.save")}
                    </Button>
                  </div>
                </Space>
              </Card>
            ),
          },
        ]}
        />
      </div>
    </Spin>
  );
};

export default SystemSettingsConfigTab;
