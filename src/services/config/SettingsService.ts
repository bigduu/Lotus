/**
 * Settings Service
 *
 * Service for managing application settings, including provider configuration.
 */

import { apiClient } from "../api";
import type {
  ProviderConfig,
  ProviderInstance,
  CreateProviderInstanceRequest,
  UpdateProviderInstanceRequest,
  ProviderInstancesConfig,
} from "@shared/types/providerConfig";
import type { ProviderCatalog, ProviderModelDescriptor } from "@shared/types/providerModelRef";

// ── Fetch Models response types ─────────────────────────────────

export interface ProviderFetchResult {
  provider: string;
  models?: ProviderModelDescriptor[];
  error?: string;
}

export interface FetchModelsResponse {
  fetched: ProviderFetchResult[];
}

// ── Env Vars types ──────────────────────────────────────────────

export interface EnvVarResponse {
  name: string;
  /** Masked for secrets; plaintext for non-secrets. */
  value: string;
  secret: boolean;
  /** Whether a real value is configured (useful for secrets where value is masked). */
  has_value: boolean;
  description?: string;
}

export interface EnvVarsListResponse {
  entries: EnvVarResponse[];
}

export interface UpsertEnvVarRequest {
  name: string;
  value: string;
  secret: boolean;
  description?: string;
}

export interface ReplaceEnvVarsRequest {
  entries: UpsertEnvVarRequest[];
}

// ── Cluster Fabric types ────────────────────────────────────────
//
// Mirrors bamboo-config `cluster_fabric`. SSH secrets are redacted in
// responses (returned as the mask "****...****"); re-sending the mask on an
// update preserves the stored secret.

export type SshAuth =
  | { method: "system_ssh_config" }
  | { method: "password"; password?: string }
  | {
      method: "private_key";
      private_key?: string;
      private_key_path?: string;
      passphrase?: string;
    };

export type NodePlacement =
  | { type: "local" }
  | {
      type: "ssh";
      host: string;
      port: number;
      username: string;
      auth: SshAuth;
      host_key_fingerprint?: string;
    };

export type TrustLevel = "trusted" | "untrusted";

export type NodeStatus =
  | "not_deployed"
  | "deploying"
  | "running"
  | "unreachable"
  | "stopped"
  | "failed";

export interface DeployProfile {
  artifact_path?: string;
  artifact_sha256?: string;
  remote_dir?: string;
  default_role?: string;
  model?: string;
  workspace?: string;
  /** Auto-redeploy this node when the health monitor finds its worker gone. */
  auto_recover?: boolean;
}

export interface NodeState {
  status: NodeStatus;
  worker_id?: string;
  remote_pid?: number;
  log_path?: string;
  deployed_at?: string;
  last_health?: string;
  last_error?: string;
}

export interface FabricNode {
  id: string;
  label: string;
  placement: NodePlacement;
  trust_level: TrustLevel;
  deploy: DeployProfile;
  state?: NodeState | null;
  enabled: boolean;
}

export interface FabricCluster {
  name: string;
  description?: string;
  node_ids: string[];
}

export interface FabricListResponse {
  nodes: FabricNode[];
  clusters: FabricCluster[];
}

export interface NodeUpsertRequest {
  label: string;
  placement: NodePlacement;
  trust_level?: TrustLevel;
  deploy?: DeployProfile;
  enabled?: boolean;
}

export interface ClusterUpsertRequest {
  name: string;
  description?: string;
  node_ids: string[];
}

/**
 * Copilot authentication status
 */
export interface CopilotAuthStatus {
  authenticated: boolean;
  message?: string;
}

/**
 * Device code information for Copilot authentication
 */
export interface DeviceCodeInfo {
  device_code: string; // The actual device code for polling (not the user code!)
  user_code: string; // The code user enters in browser
  verification_uri: string;
  expires_in: number;
  interval?: number; // Polling interval in seconds
}

/**
 * Complete authentication request
 */
export interface CompleteAuthRequest {
  device_code: string;
  interval: number;
  expires_in: number;
}

/**
 * Settings Service
 *
 * Handles all settings-related API calls to the backend.
 */
export class SettingsService {
  /**
   * Get the current provider configuration
   */
  async getProviderConfig(): Promise<ProviderConfig> {
    return apiClient.get<ProviderConfig>("/bamboo/settings/provider");
  }

  /**
   * Save provider configuration
   */
  async saveProviderConfig(config: Record<string, unknown>): Promise<void> {
    return apiClient.post<void>("/bamboo/settings/provider", config);
  }

  /**
   * Reload configuration (apply changes)
   */
  async reloadConfig(): Promise<void> {
    return apiClient.post<void>("/bamboo/settings/reload");
  }

  /**
   * Get the configured "always ask" permission rules — tool-call patterns that
   * force a user confirmation even under bypass mode (e.g. "Bash(rm -rf *)").
   */
  async getPermissionAskRules(): Promise<string[]> {
    const response = await apiClient.get<{ rules: string[] }>("/bamboo/permission/ask-rules");
    return response.rules;
  }

  /**
   * Replace the "always ask" permission rules. Returns the persisted list
   * (blank entries are dropped server-side).
   */
  async updatePermissionAskRules(rules: string[]): Promise<string[]> {
    const response = await apiClient.put<{ rules: string[] }>("/bamboo/permission/ask-rules", {
      rules,
    });
    return response.rules;
  }

  /**
   * Check Copilot authentication status
   */
  async getCopilotAuthStatus(): Promise<CopilotAuthStatus> {
    return apiClient.post<CopilotAuthStatus>("/bamboo/copilot/auth/status");
  }

  /**
   * Start Copilot authentication - get device code
   */
  async startCopilotAuth(): Promise<DeviceCodeInfo> {
    return apiClient.post<DeviceCodeInfo>("/bamboo/copilot/auth/start");
  }

  /**
   * Complete Copilot authentication with device code
   */
  async completeCopilotAuth(request: CompleteAuthRequest): Promise<void> {
    return apiClient.post<void>("/bamboo/copilot/auth/complete", request);
  }

  /**
   * Trigger Copilot authentication flow (legacy)
   */
  async authenticateCopilot(): Promise<void> {
    return apiClient.post<void>("/bamboo/copilot/authenticate");
  }

  /**
   * Logout from Copilot (delete cached token)
   */
  async logoutCopilot(): Promise<void> {
    return apiClient.post<void>("/bamboo/copilot/logout");
  }

  /**
   * Fetch available models for a provider (via backend)
   */
  async fetchProviderModels(provider: string): Promise<string[]> {
    const response = await apiClient.post<{ models: string[] }>(
      "/bamboo/settings/provider/models",
      {
        provider,
      },
    );
    return response.models;
  }

  /**
   * Fetch the full provider catalog (used by ProviderModelPicker).
   */
  async getProviderCatalog(): Promise<ProviderCatalog> {
    return apiClient.get<ProviderCatalog>("/bamboo/provider-catalog");
  }

  /**
   * Fetch model lists from one or all providers via the catalog.
   *
   * If `provider` is specified, fetches models for that single provider.
   * If omitted, fetches models from all configured providers.
   */
  async fetchCatalogModels(provider?: string): Promise<FetchModelsResponse> {
    const body = provider ? { provider } : {};
    return apiClient.post<FetchModelsResponse>("/bamboo/provider-catalog/fetch-models", body);
  }

  // ── Provider Instances (multi-instance) ──────────────────────────

  /**
   * Get all provider instances and the default instance id.
   */
  async getProviderInstances(): Promise<ProviderInstancesConfig> {
    return apiClient.get<ProviderInstancesConfig>("/bamboo/settings/provider-instances");
  }

  /**
   * Create a new provider instance.
   */
  async createProviderInstance(request: CreateProviderInstanceRequest): Promise<ProviderInstance> {
    return apiClient.post<ProviderInstance>("/bamboo/settings/provider-instances", request);
  }

  /**
   * Update an existing provider instance.
   */
  async updateProviderInstance(
    instanceId: string,
    request: UpdateProviderInstanceRequest,
  ): Promise<ProviderInstance> {
    return apiClient.put<ProviderInstance>(
      `/bamboo/settings/provider-instances/${encodeURIComponent(instanceId)}`,
      request,
    );
  }

  /**
   * Delete a provider instance.
   */
  async deleteProviderInstance(instanceId: string): Promise<void> {
    return apiClient.delete<void>(
      `/bamboo/settings/provider-instances/${encodeURIComponent(instanceId)}`,
    );
  }

  /**
   * Set the default provider instance.
   */
  async setDefaultProviderInstance(instanceId: string): Promise<void> {
    return apiClient.post<void>("/bamboo/settings/provider-instances/default", {
      default_provider_instance_id: instanceId,
    });
  }

  // ── Env Vars ────────────────────────────────────────────────────

  /**
   * List all environment variables (secrets are masked).
   */
  async getEnvVars(): Promise<EnvVarsListResponse> {
    return apiClient.get<EnvVarsListResponse>("/bamboo/env-vars");
  }

  /**
   * Create or update a single environment variable.
   */
  async upsertEnvVar(entry: UpsertEnvVarRequest): Promise<EnvVarsListResponse> {
    return apiClient.post<EnvVarsListResponse>("/bamboo/env-vars", entry);
  }

  /**
   * Delete an environment variable by name.
   */
  async deleteEnvVar(name: string): Promise<EnvVarsListResponse> {
    return apiClient.delete<EnvVarsListResponse>(`/bamboo/env-vars/${encodeURIComponent(name)}`);
  }

  /**
   * Replace the entire env vars list (bulk save).
   */
  async replaceEnvVars(entries: UpsertEnvVarRequest[]): Promise<EnvVarsListResponse> {
    return apiClient.post<EnvVarsListResponse>("/bamboo/env-vars/replace", {
      entries,
    });
  }

  // ── Cluster Fabric ────────────────────────────────────────────

  /** List all nodes (secrets redacted) and clusters. */
  async listNodes(): Promise<FabricListResponse> {
    return apiClient.get<FabricListResponse>("/bamboo/settings/nodes");
  }

  /** Create a node. */
  async createNode(req: NodeUpsertRequest): Promise<FabricNode> {
    return apiClient.post<FabricNode>("/bamboo/settings/nodes", req);
  }

  /** Update a node (re-send the secret mask to preserve the stored secret). */
  async updateNode(id: string, req: NodeUpsertRequest): Promise<FabricNode> {
    return apiClient.put<FabricNode>(`/bamboo/settings/nodes/${encodeURIComponent(id)}`, req);
  }

  /** Delete a node. */
  async deleteNode(id: string): Promise<void> {
    await apiClient.delete(`/bamboo/settings/nodes/${encodeURIComponent(id)}`);
  }

  /** Create a cluster. */
  async createCluster(req: ClusterUpsertRequest): Promise<{ clusters: FabricCluster[] }> {
    return apiClient.post<{ clusters: FabricCluster[] }>("/bamboo/settings/clusters", req);
  }

  /** Update a cluster. */
  async updateCluster(
    name: string,
    req: ClusterUpsertRequest,
  ): Promise<{ clusters: FabricCluster[] }> {
    return apiClient.put<{ clusters: FabricCluster[] }>(
      `/bamboo/settings/clusters/${encodeURIComponent(name)}`,
      req,
    );
  }

  /** Delete a cluster (member nodes are kept). */
  async deleteCluster(name: string): Promise<{ clusters: FabricCluster[] }> {
    return apiClient.delete<{ clusters: FabricCluster[] }>(
      `/bamboo/settings/clusters/${encodeURIComponent(name)}`,
    );
  }

  /** Trigger a node lifecycle action (deploy/test/stop). Stubbed 501 until P2. */
  async nodeAction(id: string, action: "test" | "deploy" | "stop"): Promise<unknown> {
    return apiClient.post(`/bamboo/settings/nodes/${encodeURIComponent(id)}/${action}`, {});
  }

  /** Read a node's persisted lifecycle state. */
  async nodeStatus(id: string): Promise<{ id: string; enabled: boolean; state: NodeState | null }> {
    return apiClient.get(`/bamboo/settings/nodes/${encodeURIComponent(id)}/status`);
  }

  /** Tail a node worker's log (last `lines` lines). */
  async nodeLogs(id: string, lines = 200): Promise<{ id: string; logs: string }> {
    return apiClient.get(`/bamboo/settings/nodes/${encodeURIComponent(id)}/logs?lines=${lines}`);
  }
}

/**
 * Singleton instance
 */
export const settingsService = new SettingsService();
