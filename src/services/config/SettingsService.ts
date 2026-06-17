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
}

/**
 * Singleton instance
 */
export const settingsService = new SettingsService();
