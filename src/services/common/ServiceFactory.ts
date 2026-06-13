import { apiClient } from "../api";
import { copyText } from "@shared/utils/clipboard";

/**
 * Bamboo configuration structure
 */
export interface BambooToolsConfig {
  disabled?: string[];
}

export interface BambooSkillsConfig {
  disabled?: string[];
}

export interface BambooMemoryConfig {
  background_model?: string;
  auto_dream_enabled?: boolean;
}

/** Sub-agent execution settings (mirrors the backend's typed `subagents` section).
 *  Sub-agents always run as isolated OS actor processes; there is no runtime toggle. */
export interface BambooSubagentsConfig {
  /** Max actor processes running at once (backend default: 8). */
  max_concurrent?: number;
}

export interface BambooConfig {
  model?: string;
  api_key?: string;
  api_base?: string;
  http_proxy?: string;
  https_proxy?: string;
  headless_auth?: boolean;
  tools?: BambooToolsConfig;
  skills?: BambooSkillsConfig;
  memory?: BambooMemoryConfig;
  subagents?: BambooSubagentsConfig;
  [key: string]: unknown;
}

export interface ModelLimitDefault {
  vendor?: string;
  model_pattern: string;
  max_context_tokens: number;
  max_output_tokens: number;
  safety_margin: number;
  note?: string;
}

/**
 * Generic API success response
 */
export interface ApiSuccessResponse {
  success: boolean;
}

export interface BambooConfigValidationIssue {
  path: string;
  message: string;
}

export interface ValidateBambooConfigResponse {
  valid: boolean;
  errors: Record<string, BambooConfigValidationIssue[]>;
}

export interface AccessStatusResponse {
  password_enabled: boolean;
  local_bypass: boolean;
  requires_password: boolean;
}

export interface UpdateAccessPasswordRequest {
  current_password?: string;
  new_password: string;
}

export interface UpdateAccessPasswordResponse {
  success: boolean;
  password_enabled: boolean;
}

export interface UtilityService {
  /**
   * Copy text to clipboard
   */
  copyToClipboard(text: string): Promise<void>;

  /**
   * Get Bamboo config
   */
  getBambooConfig(): Promise<BambooConfig>;

  /**
   * Get all available Bamboo tool names.
   */
  getBambooTools(): Promise<{ tools: string[] }>;

  /**
   * Get backend built-in model limit defaults.
   */
  getModelLimitDefaults(): Promise<{ model_limits: ModelLimitDefault[] }>;

  /**
   * Set Bamboo config
   */
  setBambooConfig(config: BambooConfig): Promise<BambooConfig>;

  /**
   * Validate a Bamboo config patch without saving.
   */
  validateBambooConfigPatch(patch: BambooConfig): Promise<ValidateBambooConfigResponse>;

  /**
   * Set proxy auth credentials
   */
  setProxyAuth(auth: { username: string; password: string }): Promise<ApiSuccessResponse>;

  /**
   * Get proxy auth status (returns whether proxy auth is configured, without password)
   */
  getProxyAuthStatus(): Promise<{
    configured: boolean;
    username: string | null;
  }>;

  /**
   * Clear proxy auth credentials
   */
  clearProxyAuth(): Promise<ApiSuccessResponse>;

  /**
   * Reset Bamboo config (delete config.json)
   */
  resetBambooConfig(): Promise<ApiSuccessResponse>;

  /**
   * Reset setup status (mark as incomplete)
   */
  resetSetupStatus(): Promise<void>;

  /**
   * Workflow management
   */
  saveWorkflow(name: string, content: string): Promise<{ success: boolean; path: string }>;
  deleteWorkflow(name: string): Promise<ApiSuccessResponse>;

  /**
   * Keyword masking
   */
  getKeywordMaskingConfig(): Promise<{
    entries: Array<{ pattern: string; match_type: string; enabled: boolean }>;
  }>;
  updateKeywordMaskingConfig(
    entries: Array<{ pattern: string; match_type: string; enabled: boolean }>,
  ): Promise<{
    entries: Array<{ pattern: string; match_type: string; enabled: boolean }>;
  }>;
  validateKeywordEntries(
    entries: Array<{ pattern: string; match_type: string; enabled: boolean }>,
  ): Promise<{
    valid: boolean;
    errors?: Array<{ index: number; message: string }>;
  }>;

  /**
   * Setup status
   */
  getSetupStatus(): Promise<{
    is_complete: boolean;
    has_proxy_config: boolean;
    has_proxy_env: boolean;
    message: string;
  }>;
  markSetupComplete(): Promise<ApiSuccessResponse>;

  /**
   * Access control / password gate
   */
  getAccessStatus(): Promise<AccessStatusResponse>;
  verifyAccessPassword(password: string): Promise<ApiSuccessResponse>;
  updateAccessPassword(payload: UpdateAccessPasswordRequest): Promise<UpdateAccessPasswordResponse>;
}

class HttpUtilityService implements UtilityService {
  async copyToClipboard(text: string): Promise<void> {
    await copyText(text);
  }

  async getBambooConfig(): Promise<BambooConfig> {
    try {
      return await apiClient.get<BambooConfig>("bamboo/config");
    } catch (error) {
      console.error("Failed to fetch Bamboo config:", error);
      return {};
    }
  }

  async getBambooTools(): Promise<{ tools: string[] }> {
    try {
      return await apiClient.get<{ tools: string[] }>("bamboo/tools");
    } catch (error) {
      console.error("Failed to fetch Bamboo tools:", error);
      return { tools: [] };
    }
  }

  async getModelLimitDefaults(): Promise<{ model_limits: ModelLimitDefault[] }> {
    try {
      return await apiClient.get<{ model_limits: ModelLimitDefault[] }>(
        "bamboo/model-limits/defaults",
      );
    } catch (error) {
      console.error("Failed to fetch model limit defaults:", error);
      return { model_limits: [] };
    }
  }

  async setBambooConfig(config: BambooConfig): Promise<BambooConfig> {
    return apiClient.post<BambooConfig>("bamboo/config", config);
  }

  async validateBambooConfigPatch(patch: BambooConfig): Promise<ValidateBambooConfigResponse> {
    return apiClient.post<ValidateBambooConfigResponse>("bamboo/config/validate", patch);
  }

  async setProxyAuth(auth: { username: string; password: string }): Promise<ApiSuccessResponse> {
    return apiClient.post<ApiSuccessResponse>("bamboo/proxy-auth", auth);
  }

  async getProxyAuthStatus(): Promise<{
    configured: boolean;
    username: string | null;
  }> {
    try {
      return await apiClient.get<{
        configured: boolean;
        username: string | null;
      }>("bamboo/proxy-auth/status");
    } catch (error) {
      console.error("Failed to fetch proxy auth status:", error);
      return { configured: false, username: null };
    }
  }

  async clearProxyAuth(): Promise<ApiSuccessResponse> {
    return apiClient.post<ApiSuccessResponse>("bamboo/proxy-auth", {
      username: "",
      password: "",
    });
  }

  async resetBambooConfig(): Promise<ApiSuccessResponse> {
    return apiClient.post<ApiSuccessResponse>("bamboo/config/reset", {});
  }

  async saveWorkflow(name: string, content: string): Promise<{ success: boolean; path: string }> {
    return apiClient.post<{ success: boolean; path: string }>("bamboo/workflows", {
      name,
      content,
    });
  }

  async deleteWorkflow(name: string): Promise<ApiSuccessResponse> {
    return apiClient.delete<ApiSuccessResponse>(`bamboo/workflows/${encodeURIComponent(name)}`);
  }

  async getKeywordMaskingConfig(): Promise<{
    entries: Array<{ pattern: string; match_type: string; enabled: boolean }>;
  }> {
    try {
      return await apiClient.get<{
        entries: Array<{
          pattern: string;
          match_type: string;
          enabled: boolean;
        }>;
      }>("bamboo/keyword-masking");
    } catch (error) {
      console.error("Failed to fetch keyword masking config:", error);
      return { entries: [] };
    }
  }

  async updateKeywordMaskingConfig(
    entries: Array<{ pattern: string; match_type: string; enabled: boolean }>,
  ): Promise<{
    entries: Array<{ pattern: string; match_type: string; enabled: boolean }>;
  }> {
    return apiClient.post<{
      entries: Array<{ pattern: string; match_type: string; enabled: boolean }>;
    }>("bamboo/keyword-masking", entries);
  }

  async validateKeywordEntries(
    entries: Array<{ pattern: string; match_type: string; enabled: boolean }>,
  ): Promise<{
    valid: boolean;
    errors?: Array<{ index: number; message: string }>;
  }> {
    return apiClient.post<{
      valid: boolean;
      errors?: Array<{ index: number; message: string }>;
    }>("bamboo/keyword-masking/validate", entries);
  }

  async getSetupStatus(): Promise<{
    is_complete: boolean;
    has_proxy_config: boolean;
    has_proxy_env: boolean;
    message: string;
  }> {
    // Important: do not swallow network/startup failures here. The app bootstrap
    // flow distinguishes "setup incomplete" from "backend not reachable yet".
    return await apiClient.get<{
      is_complete: boolean;
      has_proxy_config: boolean;
      has_proxy_env: boolean;
      message: string;
    }>("bamboo/setup/status");
  }

  async markSetupComplete(): Promise<ApiSuccessResponse> {
    return apiClient.post<ApiSuccessResponse>("bamboo/setup/complete", {});
  }

  async resetSetupStatus(): Promise<void> {
    await apiClient.post<ApiSuccessResponse>("bamboo/setup/incomplete", {});
  }

  async getAccessStatus(): Promise<AccessStatusResponse> {
    return apiClient.get<AccessStatusResponse>("bamboo/access/status");
  }

  async verifyAccessPassword(password: string): Promise<ApiSuccessResponse> {
    return apiClient.post<ApiSuccessResponse>("bamboo/access/verify", { password });
  }

  async updateAccessPassword(
    payload: UpdateAccessPasswordRequest,
  ): Promise<UpdateAccessPasswordResponse> {
    return apiClient.post<UpdateAccessPasswordResponse>("bamboo/access/password", payload);
  }
}

/**
 * ServiceFactory - Simplified to use only Web/HTTP mode.
 *
 * All utility methods are inherited from HttpUtilityService (HTTP API calls
 * to the backend); ServiceFactory only layers on the singleton accessor.
 */
export class ServiceFactory extends HttpUtilityService {
  private static instance: ServiceFactory;

  private constructor() {
    super();
  }

  static getInstance(): ServiceFactory {
    if (!ServiceFactory.instance) {
      ServiceFactory.instance = new ServiceFactory();
    }
    return ServiceFactory.instance;
  }

  /**
   * The factory itself fulfills the full UtilityService contract; exposed for
   * callers that want to depend on the interface rather than the concrete class.
   */
  getUtilityService(): UtilityService {
    return this;
  }
}

// Export singleton instance for easy access
export const serviceFactory = ServiceFactory.getInstance();
