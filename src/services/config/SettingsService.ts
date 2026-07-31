/**
 * Settings Service
 *
 * Service for managing application settings, including provider configuration.
 */

import { apiClient } from "../api";
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

export type PermissionRuleEffect = "allow" | "deny" | "always_ask" | string;
export type PermissionRuleScope = "workspace" | "global" | string;
export type TemporaryPermissionGrantScope = "unscoped_session" | "session" | "one_shot" | string;
export type TemporaryPermissionGrantEffect = "allow" | "deny" | string;

export interface DurablePermissionRule {
  id: string;
  permission_type: string;
  effect: PermissionRuleEffect;
  scope: PermissionRuleScope;
  workspace_path?: string;
  matcher: {
    id: string;
    kind: string;
    value: string;
  };
  source: string;
  expires_at?: string;
  created_at?: string;
  last_matched_at?: string;
  match_count?: number;
}

export interface TemporaryPermissionGrant {
  scope: TemporaryPermissionGrantScope;
  effect: TemporaryPermissionGrantEffect;
  session_id?: string;
  request_id?: string;
  permission_type: string;
  matcher: string;
  granted_at?: string;
  expires_at?: string;
}

export interface PermissionPolicyResponse {
  revision: number;
  loaded_at: string;
  source_path: string;
  source_kind: string;
  status: string;
  last_error?: string | null;
  policy: {
    ask_rules?: string[];
    durable_rules?: DurablePermissionRule[];
    session_grant_duration_secs?: number;
  };
  /** Present when Bamboo exposes its live, non-durable grant projection. */
  temporary_grants?: TemporaryPermissionGrant[];
}

/**
 * Settings Service
 *
 * Handles all settings-related API calls to the backend.
 */
export class SettingsService {
  /**
   * Get the configured "always ask" permission rules — tool-call patterns that
   * force a user confirmation even under bypass mode (e.g. "Bash(rm -rf *)").
   */
  async getPermissionAskRules(): Promise<string[]> {
    const response = await apiClient.get<{ rules: string[] }>("/bamboo/permission/ask-rules");
    return response.rules;
  }

  /** Read the revisioned typed permission policy used by the runtime. */
  async getPermissionPolicy(): Promise<PermissionPolicyResponse> {
    return apiClient.get<PermissionPolicyResponse>("/bamboo/permission/policy");
  }

  /**
   * Replace the "always ask" permission rules. Returns the persisted list
   * (blank entries are dropped server-side).
   */
  async updatePermissionAskRules(rules: string[], expectedRevision?: number): Promise<string[]> {
    const response = await apiClient.put<{ rules: string[] }>("/bamboo/permission/ask-rules", {
      rules,
      ...(expectedRevision == null ? {} : { expected_revision: expectedRevision }),
    });
    return response.rules;
  }

  /** Revoke one durable allow/deny/always-ask rule with policy CAS protection. */
  async deletePermissionRule(
    ruleId: string,
    expectedRevision: number,
  ): Promise<PermissionPolicyResponse> {
    const encodedRuleId = encodeURIComponent(ruleId);
    return apiClient.delete<PermissionPolicyResponse>(
      `/bamboo/permission/rules/${encodedRuleId}?expected_revision=${expectedRevision}`,
    );
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
}

/**
 * Singleton instance
 */
export const settingsService = new SettingsService();
