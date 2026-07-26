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

export type ProviderCredentialChange =
  | { action: "replace"; value: string }
  | { action: "clear" };

export interface ProviderCredentialChanges {
  providers?: Partial<Record<ProviderType, ProviderCredentialChange>>;
  provider_instances?: Record<string, ProviderCredentialChange>;
}

export interface McpSection {
  version?: number;
  servers: Array<Record<string, unknown>>;
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
  "cluster-fabric": Record<string, unknown>;
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

const parseConflictRevision = (error: ApiError): number | null => {
  if (!error.body) return null;
  try {
    const parsed = JSON.parse(error.body) as {
      error?: { actual?: unknown; current_revision?: unknown; message?: unknown };
      actual?: unknown;
      current_revision?: unknown;
    };
    const raw =
      parsed.error?.actual ??
      parsed.error?.current_revision ??
      parsed.actual ??
      parsed.current_revision;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  } catch {
    return null;
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

const normalizeNotificationEnvelope = (
  response: NotificationConfigResponse,
): ConfigSectionEnvelope<NotificationSection> => ({
  data: response.data,
  revision: response.revision,
  loaded_at: new Date().toISOString(),
  source_path: response.source ?? "credentials.json",
  source_kind: response.source === "backup" ? "backup" : "file",
  status: response.status,
  last_error: response.last_error,
});

interface NotificationConfigResponse {
  data: NotificationSection;
  revision: number;
  status: ConfigSectionStatus;
  source: string | null;
  last_error: string | null;
}

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
  async getSection<K extends ConfigSectionId>(
    section: K,
  ): Promise<ConfigSectionEnvelope<ConfigSectionDataMap[K]>> {
    if (section === "providers") {
      return apiClient.get<ConfigSectionEnvelope<ConfigSectionDataMap[K]>>(
        "/bamboo/config/provider-settings",
      );
    }
    if (section === "notifications") {
      const response = await apiClient.get<NotificationConfigResponse>(
        "/bamboo/config/notifications",
      );
      return normalizeNotificationEnvelope(response) as ConfigSectionEnvelope<
        ConfigSectionDataMap[K]
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
    expectedRevision: number,
    data: NotificationSectionDraft,
  ): Promise<ConfigSectionEnvelope<NotificationSection>> {
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
        expected_revision: expectedRevision,
        notifications,
      });
      return this.getSection("notifications");
    } catch (error) {
      return mapConflict(error, expectedRevision);
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
