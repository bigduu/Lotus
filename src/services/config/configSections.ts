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
  enabled: boolean;
  target_provider?: "openai" | "anthropic" | "gemini" | null;
  thinking_replay_always?: boolean | null;
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
  app_secret_configured?: boolean;
  app_secret_credential_ref?: string | null;
}

export interface ConnectSection {
  platforms?: ConnectSectionPlatform[];
}

export type ConnectSectionDraftPlatform = Omit<ConnectPlatformConfig, "token" | "app_secret"> & {
  token?: string | null;
  app_secret?: string | null;
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

export interface CredentialStatus {
  credential_ref: string;
  configured: boolean;
  source: "user" | "environment" | "migrated" | string;
  updated_at: string | null;
}

export interface NotificationCredentialStatus {
  credential_ref: string | null;
  configured: boolean;
  source: CredentialStatus["source"] | null;
  updated_at: string | null;
}

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

export interface NotificationSectionEnvelope extends ConfigSectionEnvelope<NotificationSection> {
  credential_revision: number;
  credential_status: ConfigSectionStatus;
  credential_source: ConfigSectionSourceKind | null;
  credential_last_error: string | null;
}

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
  env: unknown[];
  "access-control": Record<string, unknown> | null;
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
  last_error: string | null;
}

const mergeNotificationEnvelope = (
  section: ConfigSectionEnvelope<unknown>,
  credentials: NotificationConfigResponse,
): NotificationSectionEnvelope => ({
  data: credentials.data,
  revision: section.revision,
  loaded_at: section.loaded_at,
  source_path: section.source_path,
  source_kind: section.source_kind,
  status: section.status,
  last_error: section.last_error,
  credential_revision: credentials.revision,
  credential_status: credentials.status,
  credential_source: credentials.source,
  credential_last_error: credentials.last_error,
});

export interface NotificationSectionDraft {
  desktop: { enabled: boolean | null };
  ntfy: { enabled: boolean; base_url: string; topic: string; token?: string | null };
  bark: { enabled: boolean; base_url: string; device_key?: string | null };
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
  credential_ref: string | null;
  configured: boolean;
  source: string | null;
  updated_at: string | null;
  revision: number;
  status: ConfigSectionStatus;
  source_kind: string | null;
  last_error: string | null;
}

type ClusterMutationWireResponse = ConfigSectionEnvelope<ClusterFabricSection> & {
  node_id?: string;
  preflight?: string;
};

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

class ConfigSectionsService {
  async getNotificationSection(): Promise<NotificationSectionEnvelope> {
    const [section, credentials] = await Promise.all([
      apiClient.get<ConfigSectionEnvelope<unknown>>("/bamboo/config/sections/notifications"),
      apiClient.get<NotificationConfigResponse>("/bamboo/config/notifications"),
    ]);
    return mergeNotificationEnvelope(section, credentials);
  }

  async getMcpSettings(): Promise<ConfigSectionEnvelope<McpSection>> {
    return apiClient.get<ConfigSectionEnvelope<McpSection>>("/bamboo/config/sections/mcp");
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

  async putSection<K extends Exclude<WritableConfigSectionId, "notifications" | "providers">>(
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

      // Notifications use a credential-aware diagnostic projection for normal
      // reads, while the typed reset endpoint returns the persisted section.
      // Re-read it so the store never loses configured/source credential status.
      if (section === "notifications") return this.getSection(section);
      return response;
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async putNotifications(
    expectedSectionRevision: number,
    data: NotificationSectionDraft,
  ): Promise<NotificationSectionEnvelope> {
    // Notification metadata is revisioned by its typed section, while the
    // compatibility transaction that owns ntfy/Bark credentials uses the
    // credential-store revision. Always refresh both immediately before the
    // write: a cached credential revision can conflict with an unrelated
    // credential update, and a stale typed draft must never overwrite newer
    // notification metadata merely because the credential CAS still matches.
    const current = await this.getNotificationSection();
    if (current.revision !== expectedSectionRevision) {
      throw new ConfigConflictError({
        expectedRevision: expectedSectionRevision,
        currentRevision: current.revision,
        message: "The notification configuration changed on disk.",
      });
    }

    const notifications = {
      desktop: data.desktop,
      ntfy: {
        enabled: data.ntfy.enabled,
        base_url: data.ntfy.base_url,
        topic: data.ntfy.topic,
        ...(Object.prototype.hasOwnProperty.call(data.ntfy, "token")
          ? { token: data.ntfy.token }
          : {}),
      },
      bark: {
        enabled: data.bark.enabled,
        base_url: data.bark.base_url,
        ...(Object.prototype.hasOwnProperty.call(data.bark, "device_key")
          ? { device_key: data.bark.device_key }
          : {}),
      },
    };
    try {
      await apiClient.post("/bamboo/config", {
        expected_revision: current.credential_revision,
        notifications,
      });
      return this.getNotificationSection();
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        let currentRevision: number | null = null;
        try {
          currentRevision = (await this.getNotificationSection()).revision;
        } catch {
          // Preserve the original conflict when the diagnostic refresh also fails.
        }
        throw new ConfigConflictError({
          expectedRevision: expectedSectionRevision,
          currentRevision,
          message: error.message || "The notification configuration changed on disk.",
        });
      }
      throw error;
    }
  }

  async putConnect(
    expectedRevision: number,
    data: ConnectSectionDraft,
  ): Promise<{
    envelope: ConfigSectionEnvelope<ConnectSection>;
    credentialRevision: number;
  }> {
    try {
      await apiClient.post("/bamboo/config", {
        expected_revision: expectedRevision,
        connect: data,
      });
      const [envelope, credentials] = await Promise.all([
        this.getSection("connect"),
        this.listCredentials(),
      ]);
      return { envelope, credentialRevision: credentials.revision };
    } catch (error) {
      return mapConflict(error, expectedRevision);
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
    return apiClient.get<ProxyAuthStatus>("/bamboo/proxy-auth/status");
  }

  async replaceProxyAuth(
    expectedRevision: number,
    auth: { username: string; password: string },
  ): Promise<ProxyAuthStatus> {
    try {
      return await apiClient.post<ProxyAuthStatus>("/bamboo/proxy-auth", {
        expected_revision: expectedRevision,
        ...auth,
      });
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async clearProxyAuth(expectedRevision: number): Promise<ProxyAuthStatus> {
    try {
      return await apiClient.post<ProxyAuthStatus>("/bamboo/proxy-auth", {
        expected_revision: expectedRevision,
        username: "",
      });
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async replaceCredential(
    credentialRef: string,
    expectedRevision: number,
    value: string,
  ): Promise<CredentialEnvelope> {
    try {
      return await apiClient.put<CredentialEnvelope>(
        `/bamboo/config/credentials/${encodeURIComponent(credentialRef)}`,
        { expected_revision: expectedRevision, value },
      );
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }

  async clearCredential(
    credentialRef: string,
    expectedRevision: number,
  ): Promise<CredentialEnvelope> {
    try {
      return await apiClient.post<CredentialEnvelope>(
        `/bamboo/config/credentials/${encodeURIComponent(credentialRef)}/clear`,
        { expected_revision: expectedRevision },
      );
    } catch (error) {
      return mapConflict(error, expectedRevision);
    }
  }
}

export const configSectionsService = new ConfigSectionsService();
