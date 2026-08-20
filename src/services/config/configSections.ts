import { apiClient, ApiError, isApiError } from "../api";
import type {
  BambooMemoryConfig,
  BambooSkillsConfig,
  BambooSubagentsConfig,
  BambooToolsConfig,
  ConnectPlatformConfig,
  LifecycleHooksConfig,
  PluginTrustConfig,
} from "../common/ServiceFactory";
import type {
  DefaultsConfig,
  ProviderType,
  RequestOverridesConfig,
} from "@shared/types/providerConfig";
import type { McpServerConfig } from "../mcp/types";

export const CONFIG_SECTION_IDS = [
  "core",
  "providers",
  "mcp",
  "tools-skills",
  "memory",
  "subagents",
  "notifications",
  "connect",
  "cluster-fabric",
  "env",
  "access-control",
  "hooks",
  "model-policy",
  "model-limits",
  "credentials",
] as const;

export type ConfigSectionId = (typeof CONFIG_SECTION_IDS)[number];
export type WritableConfigSectionId = Exclude<ConfigSectionId, "credentials">;
export type ConfigSectionStatus = "healthy" | "missing" | "degraded" | "invalid";
export type ConfigSectionSourceKind = "file" | "backup" | "default";

export interface ConfigSectionEnvelope<T> {
  data: T;
  revision: number;
  loaded_at: string;
  source_path: string;
  source_kind: ConfigSectionSourceKind;
  status: ConfigSectionStatus;
  last_error: string | null;
}

export interface CoreSection {
  http_proxy?: string;
  https_proxy?: string;
  proxy_auth_credential_ref?: string | null;
  headless_auth?: boolean;
  server?: unknown;
  default_work_area?: string | null;
  run_budget?: number;
  stream_timeout?: number;
}

export interface ProviderSettingsMetadata {
  base_url?: string | null;
  model?: string | null;
  fast_model?: string | null;
  vision_model?: string | null;
  reasoning_effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  responses_only_models?: string[];
  request_overrides?: RequestOverridesConfig | null;
  max_tokens?: number | null;
  thinking_replay_always?: boolean | null;
  enabled?: boolean;
  headless_auth?: boolean;
  target_provider?: "openai" | "anthropic" | "gemini" | null;
  api_key_from_env?: boolean;
}

export interface ProviderInstanceSettings {
  provider_type: ProviderType;
  label?: string | null;
  base_url?: string | null;
  model?: string | null;
  fast_model?: string | null;
  vision_model?: string | null;
  reasoning_effort?: "low" | "medium" | "high" | "xhigh" | "max" | null;
  responses_only_models?: string[];
  request_overrides?: RequestOverridesConfig | null;
  explicit_prompt_cache?: boolean | null;
  enabled: boolean;
  target_provider?: "openai" | "anthropic" | "gemini" | null;
  thinking_replay_always?: boolean | null;
  max_tokens?: number | null;
  headless_auth?: boolean | null;
}

export interface ProviderCredentialStatus {
  credential_ref: string | null;
  configured: boolean;
  source: "user" | "environment" | "migrated" | "external_store" | null;
  updated_at: string | null;
}

export interface ProviderSection {
  provider: string;
  providers: Partial<Record<ProviderType, ProviderSettingsMetadata>>;
  defaults: DefaultsConfig | null;
  features: {
    provider_model_ref?: boolean;
    dynamic_model_routing?: boolean;
  };
  provider_instances: Record<string, ProviderInstanceSettings>;
  default_provider_instance_id: string | null;
  available_providers: ProviderType[];
  credential_status: {
    providers: Partial<Record<ProviderType, ProviderCredentialStatus>>;
    provider_instances: Record<string, ProviderCredentialStatus>;
  };
}

export type ProviderCredentialChange = { action: "replace"; value: string } | { action: "clear" };

export interface ProviderCredentialChanges {
  providers?: Partial<Record<ProviderType, ProviderCredentialChange>>;
  provider_instances?: Record<string, ProviderCredentialChange>;
}

export interface McpCredentialStatus {
  configured: boolean;
  source: string | null;
  updated_at: string | null;
}

export interface McpServerCredentialStatus {
  env: Record<string, McpCredentialStatus>;
  headers: Record<string, McpCredentialStatus>;
}

export interface McpSection {
  version: number;
  servers: McpServerConfig[];
  credential_status: Record<string, McpServerCredentialStatus>;
}

export interface McpServerCredentialChanges {
  env?: Record<string, string | null>;
  headers?: Record<string, string | null>;
}

export interface McpCredentialChanges {
  servers?: Record<string, McpServerCredentialChanges>;
}

export interface ToolsSkillsSection {
  tools?: BambooToolsConfig;
  skills?: BambooSkillsConfig;
  plugin_trust?: PluginTrustConfig;
}

export type MemorySection = BambooMemoryConfig | null;
export type SubagentsSection = BambooSubagentsConfig;

export interface ConnectSectionPlatform extends ConnectPlatformConfig {
  token_configured?: boolean;
  token_credential_ref?: string | null;
  token_credential?: CredentialStatusView;
  app_secret_configured?: boolean;
  app_secret_credential_ref?: string | null;
  app_secret_credential?: CredentialStatusView;
}

export interface ConnectSection {
  platforms?: ConnectSectionPlatform[];
}

export type ConnectSectionDraftPlatform = Omit<ConnectPlatformConfig, "token" | "app_secret"> & {
  token_change?: CredentialAction;
  app_secret_change?: CredentialAction;
};

export interface ConnectSectionDraft {
  platforms: ConnectSectionDraftPlatform[];
}

export type ClusterNodeStatus =
  | "not_deployed"
  | "deploying"
  | "running"
  | "unreachable"
  | "stopped"
  | "failed";

export interface ClusterNodeState {
  status: ClusterNodeStatus;
  worker_id?: string;
  remote_pid?: number;
  log_path?: string;
  deployed_at?: string;
  last_health?: string;
  last_error?: string;
}

export interface ClusterDeployProfile {
  artifact_path?: string;
  artifact_sha256?: string;
  remote_dir?: string;
  default_role?: string;
  model?: string;
  workspace?: string;
  auto_recover?: boolean;
}

export type ClusterSshAuth =
  | { method: "system_ssh_config" }
  | { method: "password" }
  | { method: "private_key"; private_key_path?: string };

export type ClusterNodePlacement =
  | { type: "local" }
  | {
      type: "ssh";
      host: string;
      port: number;
      username: string;
      auth: ClusterSshAuth;
      host_key_fingerprint?: string;
    };

export interface ClusterFabricNode {
  id: string;
  label: string;
  placement: ClusterNodePlacement;
  trust_level: "trusted" | "untrusted";
  deploy: ClusterDeployProfile;
  state?: ClusterNodeState | null;
  enabled: boolean;
}

export interface ClusterFabricCluster {
  name: string;
  description?: string;
  node_ids: string[];
}

export type ClusterCredentialState = "configured" | "from_env" | "missing" | "error";

export interface ClusterCredentialFieldStatus {
  state: ClusterCredentialState;
  source: string | null;
  updated_at: string | null;
}

export interface ClusterNodeCredentialStatus {
  password: ClusterCredentialFieldStatus;
  private_key: ClusterCredentialFieldStatus;
  passphrase: ClusterCredentialFieldStatus;
}

export interface ClusterFabricSection {
  nodes: ClusterFabricNode[];
  clusters: ClusterFabricCluster[];
  credential_status: Record<string, ClusterNodeCredentialStatus>;
}

export type ClusterCredentialAction =
  | { action: "keep" }
  | { action: "replace"; value: string }
  | { action: "clear" };

export interface ClusterNodeCredentialChanges {
  password: ClusterCredentialAction;
  private_key: ClusterCredentialAction;
  passphrase: ClusterCredentialAction;
}

export interface ClusterNodeMutation {
  label: string;
  placement: ClusterNodePlacement;
  trust_level?: "trusted" | "untrusted";
  deploy?: ClusterDeployProfile;
  enabled?: boolean;
  credential_changes: ClusterNodeCredentialChanges;
  membership?: { cluster_names: string[] };
}

export interface ClusterDefinitionMutation {
  name: string;
  description?: string;
  node_ids: string[];
}

export interface ClusterMutationResult {
  envelope: ConfigSectionEnvelope<ClusterFabricSection>;
  nodeId?: string;
  preflight?: string;
}

export interface EnvSectionEntry {
  name: string;
  /** Plaintext exists only for non-secret entries. Secret section data keeps this empty/omitted. */
  value?: string;
  secret: boolean;
  has_value?: boolean;
  credential_state?: CredentialState;
  credential_ref?: string | null;
  source?: CredentialStatus["source"] | null;
  updated_at?: string | null;
  configured: boolean;
  description?: string;
}

export type EnvSection = EnvSectionEntry[];

export interface EnvVarMutation {
  name: string;
  /** Plain values only. Secret values use credential_change. */
  value?: string;
  credential_change?: CredentialAction;
  secret: boolean;
  description?: string;
}

export interface CredentialStatus {
  credential_ref: string;
  configured: boolean;
  source: "user" | "environment" | "migrated" | string;
  updated_at: string | null;
}

export type CredentialState = "configured" | "from_env" | "missing" | "error";

export interface CredentialStatusView {
  credential_ref: string | null;
  configured: boolean;
  state: CredentialState;
  source: CredentialStatus["source"] | null;
  updated_at: string | null;
}

export type CredentialAction =
  | { action: "keep" }
  | { action: "replace"; value: string }
  | { action: "clear" };

export interface EnvMutationResult {
  envelope: ConfigSectionEnvelope<EnvSection>;
}

export interface AccessControlDevice {
  device_id: string;
  label: string;
  token_credential_ref?: string | null;
  token_configured: boolean;
  created_at: string;
  last_used_at?: string | null;
  revoked: boolean;
}

export interface AccessControlConfig {
  password_enabled: boolean;
  password_credential_ref?: string | null;
  password_configured: boolean;
  updated_at?: string | null;
  devices: AccessControlDevice[];
}

export type AccessControlSection = AccessControlConfig | null;

export interface AccessRuntimeStatus {
  password_enabled: boolean;
  local_bypass: boolean;
  requires_password: boolean;
  revision: number;
  status: ConfigSectionStatus;
  source_kind: ConfigSectionSourceKind;
  loaded_at: string;
  last_error: string | null;
  password_configured: boolean;
  credential_state: CredentialState;
  credential_ref: string | null;
  credential_source: CredentialStatus["source"] | null;
  credential_updated_at: string | null;
}

export interface AccessPasswordMutation {
  current_password?: string;
  value: string;
}

export interface AccessPasswordClearMutation {
  current_password?: string;
}

export interface AccessMutationResult {
  envelope: ConfigSectionEnvelope<AccessControlSection>;
  credential: CredentialStatusView;
}

export type NotificationCredentialStatus = CredentialStatusView;

export interface NotificationSection {
  desktop: { enabled: boolean | null };
  ntfy: {
    enabled: boolean;
    base_url: string;
    topic: string;
    credential: NotificationCredentialStatus;
  };
  bark: {
    enabled: boolean;
    base_url: string;
    credential: NotificationCredentialStatus;
  };
}

export type NotificationSectionEnvelope = ConfigSectionEnvelope<NotificationSection>;

export interface HooksSection {
  image_fallback?: { enabled?: boolean; mode?: string };
  lifecycle_hooks?: LifecycleHooksConfig;
}

export interface KeywordMaskingEntry {
  pattern: string;
  match_type: string;
  enabled: boolean;
}

export interface ModelPolicySection {
  keyword_masking?: { entries?: KeywordMaskingEntry[] } | KeywordMaskingEntry[];
  anthropic_model_mapping?: Record<string, string>;
  gemini_model_mapping?: Record<string, string>;
}

export interface ModelLimitSectionEntry {
  vendor?: string;
  model_pattern: string;
  max_context_tokens: number;
  max_output_tokens: number;
  safety_margin?: number;
  note?: string;
}

export type ModelLimitsSection = ModelLimitSectionEntry[];

export interface ConfigSectionDataMap {
  core: CoreSection;
  providers: ProviderSection;
  mcp: McpSection;
  "tools-skills": ToolsSkillsSection;
  memory: MemorySection;
  subagents: SubagentsSection;
  notifications: NotificationSection;
  connect: ConnectSection;
  "cluster-fabric": ClusterFabricSection;
  env: EnvSection;
  "access-control": AccessControlSection;
  hooks: HooksSection;
  "model-policy": ModelPolicySection;
  "model-limits": ModelLimitsSection;
  credentials: CredentialStatus[];
}

export interface ConfigRevisionConflict {
  expectedRevision: number;
  currentRevision: number | null;
  message: string;
}

export class ConfigConflictError extends Error {
  readonly conflict: ConfigRevisionConflict;

  constructor(conflict: ConfigRevisionConflict) {
    super(conflict.message);
    this.name = "ConfigConflictError";
    this.conflict = conflict;
  }
}

const parseRevisionValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
};

const parseRevisionMessage = (value: unknown): number | null => {
  if (typeof value !== "string") return null;
  const match = value.match(/\bactual(?:\s+revision)?\s*[:=]?\s*(\d+)\b/i);
  return match ? Number(match[1]) : null;
};

const parseConflictRevision = (error: ApiError): number | null => {
  if (!error.body) return parseRevisionMessage(error.message);
  try {
    const parsed = JSON.parse(error.body) as {
      error?: { actual?: unknown; current_revision?: unknown; message?: unknown } | string;
      actual?: unknown;
      current_revision?: unknown;
      message?: unknown;
    };
    const nested = typeof parsed.error === "object" && parsed.error !== null ? parsed.error : null;
    const raw =
      nested?.actual ?? nested?.current_revision ?? parsed.actual ?? parsed.current_revision;
    return (
      parseRevisionValue(raw) ??
      parseRevisionMessage(nested?.message) ??
      parseRevisionMessage(parsed.error) ??
      parseRevisionMessage(parsed.message) ??
      parseRevisionMessage(error.message) ??
      parseRevisionMessage(error.body)
    );
  } catch {
    return parseRevisionMessage(error.body) ?? parseRevisionMessage(error.message);
  }
};

const mapConflict = (error: unknown, expectedRevision: number): never => {
  if (isApiError(error) && error.status === 409) {
    throw new ConfigConflictError({
      expectedRevision,
      currentRevision: parseConflictRevision(error),
      message: error.message || "The configuration changed on disk.",
    });
  }
  throw error;
};

interface NotificationConfigResponse {
  data: NotificationSection;
  revision: number;
  status: ConfigSectionStatus;
  source: ConfigSectionSourceKind | null;
  source_path: string;
  loaded_at: string;
  last_error: string | null;
  section: ConfigSectionEnvelope<unknown>;
}

const normalizeNotificationEnvelope = (
  response: NotificationConfigResponse,
): NotificationSectionEnvelope => ({
  ...response.section,
  data: response.data,
});

export interface NotificationSectionDraft {
  desktop: { enabled: boolean | null };
  ntfy: {
    enabled: boolean;
    base_url: string;
    topic: string;
    credential_change?: CredentialAction;
  };
  bark: { enabled: boolean; base_url: string; credential_change?: CredentialAction };
}

export interface CredentialEnvelope {
  data: CredentialStatus[];
  revision: number;
  status: ConfigSectionStatus;
  source: string | null;
  last_error: string | null;
}

export interface ProxyAuthStatus {
  success?: boolean;
  section: ConfigSectionEnvelope<CoreSection>;
  credential_ref: string | null;
  state: CredentialState;
  configured: boolean;
  source: string | null;
  updated_at: string | null;
  revision: number;
  status: ConfigSectionStatus;
  source_kind: ConfigSectionSourceKind;
  source_path: string;
  loaded_at: string;
  last_error: string | null;
}

type ClusterMutationWireResponse = ConfigSectionEnvelope<ClusterFabricSection> & {
  node_id?: string;
  preflight?: string;
};

interface ConnectConfigResponse {
  revision: number;
  section: ConfigSectionEnvelope<ConnectSection>;
  credential_status: Record<
    string,
    {
      token: CredentialStatusView;
      app_secret: CredentialStatusView;
    }
  >;
}

interface EnvMutationWireResponse {
  revision: number;
  entries: EnvSectionEntry[];
  section: ConfigSectionEnvelope<unknown>;
}

interface AccessMutationWireResponse {
  revision: number;
  section: ConfigSectionEnvelope<AccessControlSection>;
  credential: CredentialStatusView;
}

interface ProxyAuthWireResponse
  extends Partial<
    Omit<
      ProxyAuthStatus,
      "section" | "credential_ref" | "state" | "configured" | "source" | "updated_at" | "revision"
    >
  > {
  section: ConfigSectionEnvelope<CoreSection>;
  credential_ref: string | null;
  state: CredentialState;
  configured: boolean;
  source: string | null;
  updated_at: string | null;
  revision: number;
}

const normalizeClusterMutation = (
  response: ClusterMutationWireResponse,
): ClusterMutationResult => ({
  envelope: {
    data: response.data,
    revision: response.revision,
    loaded_at: response.loaded_at,
    source_path: response.source_path,
    source_kind: response.source_kind,
    status: response.status,
    last_error: response.last_error,
  },
  ...(response.node_id ? { nodeId: response.node_id } : {}),
  ...(response.preflight ? { preflight: response.preflight } : {}),
});

const normalizeCredentialEnvelope = (
  response: CredentialEnvelope,
): ConfigSectionEnvelope<CredentialStatus[]> => ({
  data: response.data,
  revision: response.revision,
  loaded_at: new Date().toISOString(),
  source_path: response.source ?? "credentials.json",
  source_kind: response.source === "backup" ? "backup" : "file",
  status: response.status,
  last_error: response.last_error,
});

const normalizeConnectEnvelope = (
  response: ConnectConfigResponse,
): ConfigSectionEnvelope<ConnectSection> => ({
  ...response.section,
  data: {
    ...response.section.data,
    platforms: (response.section.data.platforms ?? []).map((platform, index) => {
      const status = response.credential_status[platform.id ?? `index-${index}`];
      return {
        ...platform,
        ...(status?.token ? { token_credential: status.token } : {}),
        ...(status?.app_secret ? { app_secret_credential: status.app_secret } : {}),
      };
    }),
  },
});

const normalizeEnvEnvelope = (
  response: EnvMutationWireResponse,
): ConfigSectionEnvelope<EnvSection> => ({
  ...response.section,
  data: response.entries,
});

const normalizeProxyAuthStatus = (response: ProxyAuthWireResponse): ProxyAuthStatus => ({
  ...response,
  status: response.section.status,
  source_kind: response.section.source_kind,
  source_path: response.section.source_path,
  loaded_at: response.section.loaded_at,
  last_error: response.section.last_error,
});

class ConfigSectionsService {
  async getNotificationSection(): Promise<NotificationSectionEnvelope> {
    const response = await apiClient.get<NotificationConfigResponse>(
      "/bamboo/config/notifications",
    );
    return normalizeNotificationEnvelope(response);
  }

  async getConnectSection(): Promise<ConfigSectionEnvelope<ConnectSection>> {
    const response = await apiClient.get<ConnectConfigResponse>("/bamboo/config/connect");
    return normalizeConnectEnvelope(response);
  }

  async getEnvSection(): Promise<ConfigSectionEnvelope<EnvSection>> {
    const response = await apiClient.get<EnvMutationWireResponse>("/bamboo/env-vars");
    return normalizeEnvEnvelope(response);
  }

  async getMcpSettings(): Promise<ConfigSectionEnvelope<McpSection>> {
    return apiClient.get<ConfigSectionEnvelope<McpSection>>("/bamboo/config/sections/mcp");
  }

  async getAccessRuntimeStatus(): Promise<AccessRuntimeStatus> {
    return apiClient.get<AccessRuntimeStatus>("/bamboo/access/status");
  }

  async getSection<K extends ConfigSectionId>(
    section: K,
  ): Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>> {
    if (section === "providers") {
      return apiClient.get<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>(
        "/bamboo/config/provider-settings",
      );
    }
    if (section === "mcp") {
      return this.getMcpSettings() as Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>;
    }
    if (section === "notifications") {
      return this.getNotificationSection() as unknown as Promise<
        ConfigSectionEnvelope<ConfigSectionDataMap[K]>
      >;
    }
    if (section === "connect") {
      return this.getConnectSection() as Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>;
    }
    if (section === "env") {
      return this.getEnvSection() as Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>;
    }
    if (section === "credentials") {
      const response = await this.listCredentials();
      return normalizeCredentialEnvelope(response) as ConfigSectionEnvelope<
        ConfigSectionDataMap[K]
      >;
    }
    return apiClient.get<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>(
      `/bamboo/config/sections/${encodeURIComponent(section)}`,
    );
  }

  async putSection<
    K extends Exclude<
      WritableConfigSectionId,
      | "notifications"
      | "providers"
      | "mcp"
      | "connect"
      | "cluster-fabric"
      | "env"
      | "access-control"
    >,
  >(
    section: K,
    expectedRevision: number,
    data: ConfigSectionDataMap[K],
  ): Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>> {
    try {
      return await apiClient.put<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>(
        `/bamboo/config/sections/${encodeURIComponent(section)}`,
        { expected_revision: expectedRevision, data },
      );
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async putMcpSettings(
    expectedRevision: number,
    data: McpSection,
    credentialChanges: McpCredentialChanges = {},
  ): Promise<ConfigSectionEnvelope<McpSection>> {
    try {
      return await apiClient.put<ConfigSectionEnvelope<McpSection>>("/bamboo/config/sections/mcp", {
        expected_revision: expectedRevision,
        data,
        credential_changes: credentialChanges,
      });
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async putProviderSettings(
    expectedRevision: number,
    data: ProviderSection,
    credentialChanges: ProviderCredentialChanges = {},
  ): Promise<ConfigSectionEnvelope<ProviderSection>> {
    try {
      return await apiClient.put<ConfigSectionEnvelope<ProviderSection>>(
        "/bamboo/config/provider-settings",
        {
          expected_revision: expectedRevision,
          data,
          credential_changes: credentialChanges,
        },
      );
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async resetSection<K extends ConfigSectionId>(
    section: K,
    expectedRevision: number,
  ): Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>> {
    try {
      if (section === "credentials") {
        const response = await apiClient.post<CredentialEnvelope>(
          "/bamboo/config/sections/credentials/reset",
          { expected_revision: expectedRevision },
        );
        return normalizeCredentialEnvelope(response) as ConfigSectionEnvelope<
          ConfigSectionDataMap[K]
        >;
      }

      const response = await apiClient.post<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>(
        `/bamboo/config/sections/${encodeURIComponent(section)}/reset`,
        { expected_revision: expectedRevision },
      );

      // Dedicated credential-backed reads add secret-free status projections to
      // the canonical typed envelope. Re-read after reset so the store keeps
      // those statuses without ever loading the global credential document.
      if (section === "notifications" || section === "connect" || section === "env") {
        return this.getSection(section);
      }
      return response;
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async putNotifications(
    expectedSectionRevision: number,
    data: NotificationSectionDraft,
  ): Promise<NotificationSectionEnvelope> {
    try {
      const response = await apiClient.put<NotificationConfigResponse>(
        "/bamboo/config/notifications",
        {
          expected_revision: expectedSectionRevision,
          data,
        },
      );
      return normalizeNotificationEnvelope(response);
    } catch (error) {
      return mapConflict(error, expectedSectionRevision);
    }
  }

  async putConnect(
    expectedRevision: number,
    data: ConnectSectionDraft,
  ): Promise<ConfigSectionEnvelope<ConnectSection>> {
    try {
      const response = await apiClient.put<ConnectConfigResponse>("/bamboo/config/connect", {
        expected_revision: expectedRevision,
        data,
      });
      return normalizeConnectEnvelope(response);
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async upsertEnvVar(
    expectedSectionRevision: number,
    data: EnvVarMutation,
  ): Promise<EnvMutationResult> {
    try {
      const response = await apiClient.post<EnvMutationWireResponse>("/bamboo/env-vars", {
        expected_revision: expectedSectionRevision,
        ...data,
      });
      return { envelope: normalizeEnvEnvelope(response) };
    } catch (error) {
      return mapConflict(error, expectedSectionRevision);
    }
  }

  async deleteEnvVar(name: string, expectedSectionRevision: number): Promise<EnvMutationResult> {
    try {
      const response = await apiClient.delete<EnvMutationWireResponse>(
        `/bamboo/env-vars/${encodeURIComponent(name)}?expected_revision=${expectedSectionRevision}`,
      );
      return { envelope: normalizeEnvEnvelope(response) };
    } catch (error) {
      return mapConflict(error, expectedSectionRevision);
    }
  }

  async replaceAccessPassword(
    expectedSectionRevision: number,
    data: AccessPasswordMutation,
  ): Promise<AccessMutationResult> {
    try {
      const response = await apiClient.post<AccessMutationWireResponse>("/bamboo/access/password", {
        expected_revision: expectedSectionRevision,
        action: "replace",
        current_password: data.current_password,
        value: data.value,
      });
      return {
        envelope: response.section,
        credential: response.credential,
      };
    } catch (error) {
      return mapConflict(error, expectedSectionRevision);
    }
  }

  async clearAccessPassword(
    expectedSectionRevision: number,
    data: AccessPasswordClearMutation,
  ): Promise<AccessMutationResult> {
    try {
      const response = await apiClient.post<AccessMutationWireResponse>("/bamboo/access/password", {
        expected_revision: expectedSectionRevision,
        action: "clear",
        current_password: data.current_password,
      });
      return {
        envelope: response.section,
        credential: response.credential,
      };
    } catch (error) {
      return mapConflict(error, expectedSectionRevision);
    }
  }

  async createClusterNode(
    expectedRevision: number,
    data: ClusterNodeMutation,
  ): Promise<ClusterMutationResult> {
    try {
      const response = await apiClient.post<ClusterMutationWireResponse>("/bamboo/settings/nodes", {
        expected_revision: expectedRevision,
        ...data,
      });
      return normalizeClusterMutation(response);
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async updateClusterNode(
    nodeId: string,
    expectedRevision: number,
    data: ClusterNodeMutation,
  ): Promise<ClusterMutationResult> {
    try {
      const response = await apiClient.put<ClusterMutationWireResponse>(
        `/bamboo/settings/nodes/${encodeURIComponent(nodeId)}`,
        {
          expected_revision: expectedRevision,
          ...data,
        },
      );
      return normalizeClusterMutation(response);
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async deleteClusterNode(
    nodeId: string,
    expectedRevision: number,
  ): Promise<ClusterMutationResult> {
    try {
      const response = await apiClient.delete<ClusterMutationWireResponse>(
        `/bamboo/settings/nodes/${encodeURIComponent(
          nodeId,
        )}?expected_revision=${expectedRevision}`,
      );
      return normalizeClusterMutation(response);
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async createCluster(
    expectedRevision: number,
    data: ClusterDefinitionMutation,
  ): Promise<ClusterMutationResult> {
    try {
      const response = await apiClient.post<ClusterMutationWireResponse>(
        "/bamboo/settings/clusters",
        {
          expected_revision: expectedRevision,
          ...data,
        },
      );
      return normalizeClusterMutation(response);
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async updateCluster(
    currentName: string,
    expectedRevision: number,
    data: ClusterDefinitionMutation,
  ): Promise<ClusterMutationResult> {
    try {
      const response = await apiClient.put<ClusterMutationWireResponse>(
        `/bamboo/settings/clusters/${encodeURIComponent(currentName)}`,
        {
          expected_revision: expectedRevision,
          ...data,
        },
      );
      return normalizeClusterMutation(response);
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async deleteCluster(name: string, expectedRevision: number): Promise<ClusterMutationResult> {
    try {
      const response = await apiClient.delete<ClusterMutationWireResponse>(
        `/bamboo/settings/clusters/${encodeURIComponent(
          name,
        )}?expected_revision=${expectedRevision}`,
      );
      return normalizeClusterMutation(response);
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async runClusterNodeAction(
    nodeId: string,
    action: "test" | "deploy" | "stop",
    expectedRevision: number,
  ): Promise<ClusterMutationResult> {
    try {
      const response = await apiClient.post<ClusterMutationWireResponse>(
        `/bamboo/settings/nodes/${encodeURIComponent(
          nodeId,
        )}/${action}?expected_revision=${expectedRevision}`,
        {},
      );
      return normalizeClusterMutation(response);
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async getClusterNodeLogs(nodeId: string, lines = 200): Promise<{ id: string; logs: string }> {
    return apiClient.get(
      `/bamboo/settings/nodes/${encodeURIComponent(nodeId)}/logs?lines=${lines}`,
    );
  }

  async listCredentials(): Promise<CredentialEnvelope> {
    return apiClient.get<CredentialEnvelope>("/bamboo/config/credentials");
  }

  async getProxyAuthStatus(): Promise<ProxyAuthStatus> {
    const response = await apiClient.get<ProxyAuthWireResponse>("/bamboo/proxy-auth/status");
    return normalizeProxyAuthStatus(response);
  }

  async replaceProxyAuth(
    expectedRevision: number,
    auth: { username: string; password: string },
  ): Promise<ProxyAuthStatus> {
    try {
      const response = await apiClient.post<ProxyAuthWireResponse>("/bamboo/proxy-auth", {
        expected_revision: expectedRevision,
        action: "replace",
        ...auth,
      });
      return normalizeProxyAuthStatus(response);
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async clearProxyAuth(expectedRevision: number): Promise<ProxyAuthStatus> {
    try {
      const response = await apiClient.post<ProxyAuthWireResponse>("/bamboo/proxy-auth", {
        expected_revision: expectedRevision,
        action: "clear",
      });
      return normalizeProxyAuthStatus(response);
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }
}

export const configSectionsService = new ConfigSectionsService();
