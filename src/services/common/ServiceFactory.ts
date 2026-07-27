import { apiClient } from "../api";
import { copyText } from "@shared/utils/clipboard";
import { getBackendBaseUrlSync } from "@shared/utils/backendBaseUrl";

/**
 * Resolve the backend ORIGIN (no `/v1` suffix) for the v2 pairing/device
 * endpoints, which are mounted at the API root as siblings of `/v1`
 * (`crates/app/bamboo-server/src/routes/agent.rs`'s `v2_scope`), not nested
 * under it. Mirrors exactly how `getV2StreamUrl()` in `backendBaseUrl.ts`
 * derives the `/v2/stream` origin: strip a trailing `/v1` off the stored
 * backend base. Recomputed on every call (not cached) so a runtime
 * backend-base override is honored.
 */
const resolveV2Origin = (): string => {
  const normalized = getBackendBaseUrlSync().trim().replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
};

const buildV2Url = (path: string): string => {
  const cleanPath = path.replace(/^\/+/, "");
  return `${resolveV2Origin()}/${cleanPath}`;
};

/**
 * Minimal fetch wrapper for the 5 v2 pairing/device endpoints below. They are
 * ORIGIN-rooted (see `resolveV2Origin`), so they deliberately do NOT go
 * through the `/v1`-rooted `apiClient` singleton — a raw `fetch` mirrors how
 * `checkBackendHealth` in `backendBaseUrl.ts` hits an origin-rooted path.
 * `credentials: "include"` carries the verified-password cookie for the
 * GATED endpoints (everything but `pairDevice`, which self-gates on the body).
 */
const v2Fetch = async <T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> => {
  const response = await fetch(buildV2Url(path), {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `v2 device API request failed: ${method} ${path} -> ${response.status} ${text}`.trim(),
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

/**
 * Config-corruption recovery status (Lotus #59, consuming bamboo-agent #153 /
 * bamboo PR #493). Mirrors `bamboo_config::ConfigRecoverySource` /
 * `ConfigRecoveryStatus` and the `GET/POST /bamboo/config/recovery-*`
 * endpoints' JSON shape exactly:
 *
 * - `GET /bamboo/config/recovery-status` and
 *   `POST /bamboo/config/recovery/confirm` `{"accept": boolean}` both return
 *   `{"pending": false}` or `{"pending": true, "status": {...}}`.
 * - `source.kind` is `"salvaged"` (partial field-by-field recovery — `fields`
 *   lists the recovered top-level keys), `"backup"` (restored from a
 *   `config.json.bak[.N]` generation — `generation` 0 == `.bak`), or
 *   `"defaults"` (no usable salvage/backup; fell back to built-in defaults).
 */
export type ConfigRecoverySource =
  | { kind: "salvaged"; fields: string[] }
  | { kind: "backup"; generation: number }
  | { kind: "defaults" };

export interface ConfigRecoveryStatusInfo {
  source: ConfigRecoverySource;
  /** Absolute path of the preserved copy of the corrupt original, or `null`
   *  if even the quarantine copy failed. */
  quarantine_path: string | null;
  confirmed: boolean;
}

export interface ConfigRecoveryStatusResponse {
  pending: boolean;
  status?: ConfigRecoveryStatusInfo;
}

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
  /**
   * Which engine drives sub-agent actors: unset/`"bamboo_runtime"` for the
   * built-in agent loop, `"claude_code"` to drive the official Claude Code
   * CLI instead (see `claude_code_*` fields below; mirrors bamboo
   * `SubagentsConfig`/`ExecutorSpec::ClaudeCode`).
   */
  executor?: string;
  /** `executor === "claude_code"` only: override the `claude` executable. Unset resolves `claude` from `PATH`. */
  claude_code_binary?: string;
  /** `executor === "claude_code"` only: `--model` override. Unset omits the flag (CLI default). */
  claude_code_model?: string;
  /**
   * `executor === "claude_code"` only: `--permission-mode` override — one of
   * `"default" | "acceptEdits" | "plan" | "bypassPermissions"`. The backend
   * always passes an EXPLICIT `--permission-mode` (unset still means
   * `"default"`, never "omit the flag" — the CLI's own headless default is
   * `auto`, which self-approves every tool).
   */
  claude_code_permission_mode?: string;
  /**
   * `executor === "claude_code"` only: `true` lets the child inherit the
   * invoking user's `~/.claude` MCP servers/skills/settings. `false`/unset
   * (the default) isolates it.
   */
  claude_code_inherit_user_config?: boolean;
  /**
   * `executor === "claude_code"` only: extra env var NAMES forwarded
   * verbatim from the bamboo process's env to the child, on top of the
   * fixed allowlist. These are variable NAMES only (e.g.
   * `"ANTHROPIC_API_KEY"`) — never values — so nothing secret round-trips
   * through this config.
   */
  claude_code_forward_env?: string[];
  /** `executor === "codex"` only: override the Codex CLI executable. */
  codex_binary?: string | null;
  /** `executor === "codex"` only: optional `--model` override. */
  codex_model?: string | null;
  /** One-shot exec (default) or long-lived app-server approval relay. */
  codex_mode?: "exec" | "app_server";
  /** Authentication and billing boundary used by the Codex child. */
  codex_auth_mode?: "inherit" | "api_key" | "custom" | "bamboo";
  /** Custom-provider base URL; valid only when `codex_auth_mode === "custom"`. */
  codex_base_url?: string | null;
  /** Supported Codex provider wire protocol (currently Responses only). */
  codex_wire_api?: "responses" | null;
  /** Stable provider-instance credential reference for custom auth. */
  codex_provider_key_ref?: string | null;
  /** Extra environment variable names forwarded after the child environment is cleared. */
  codex_forward_env?: string[] | null;
  /** Explicit sandbox override; null/unset derives the mapped parent default. */
  codex_sandbox?: "read-only" | "workspace-write" | "danger-full-access" | null;
  /** Mode-specific approval policy. App-server uses `on-request`. */
  codex_approval_policy?: "never" | "on-failure" | "on-request" | null;
  /** Allow network access inside a workspace-write sandbox. */
  codex_network_access?: boolean;
  /** Second gate required before a parent-bypass run may disable the OS sandbox. */
  codex_allow_danger_bypass?: boolean;
}

/**
 * Notification delivery channels: native desktop plus ntfy/Bark push relays
 * (mirrors the backend's `notifications` config sub-tree).
 *
 * Legacy effective-config reads may contain masked secret placeholders. New
 * settings code uses typed section metadata plus explicit credential writes.
 */
export interface NotificationsChannelConfig {
  desktop?: {
    /** `null`/absent = auto (backend picks standalone-vs-sidecar default). */
    enabled?: boolean | null;
  };
  ntfy?: {
    enabled: boolean;
    base_url: string;
    topic: string;
    token?: string;
  };
  bark?: {
    enabled: boolean;
    base_url: string;
    device_key?: string;
  };
}

/**
 * One IM-platform bridge entry under `connect.platforms[]` (mirrors the
 * backend's `ConnectPlatformConfig` in
 * crates/infra/bamboo-config/src/config.rs, bamboo bigduu/Bamboo-agent
 * #453/#456/#476/#462). bamboo-connect drives a Bamboo session from an
 * external chat platform — Telegram and Feishu/Lark today.
 *
 * At most one entry per `type` is honored by the backend
 * (`multi_bot_guard`, #462): a second entry of the same type is warn-skipped
 * on the server, so the settings UI presents a single fixed slot per
 * platform rather than an arbitrary list.
 *
 * `token` (Telegram bot token) and `app_secret` (Feishu app secret) are
 * write-only in the typed settings flow. Their configured state is exposed as
 * metadata, while unchanged secrets are omitted and clear uses an explicit
 * credential action.
 */
export interface ConnectPlatformConfig {
  /** Stable server-managed identity used to preserve credential ownership. */
  id?: string;
  /** Platform adapter selector: `"telegram"` | `"feishu"`. */
  type: string;
  /** Telegram bot token. Secret — see the masked-secret contract above. */
  token?: string;
  /** Feishu/Lark app id. Not a secret. */
  app_id?: string;
  /** Feishu/Lark app secret. Secret — see the masked-secret contract above. */
  app_secret?: string;
  /**
   * Feishu/Lark domain selector: `"feishu"` (default, open.feishu.cn),
   * `"lark"` (open.larksuite.com), or a private-deployment `https://` base
   * URL used verbatim.
   */
  domain?: string;
  /**
   * Platform-scoped user/open ids allowed to drive a session. An EMPTY list
   * means deny-all (every inbound message is rejected) — deliberately
   * stricter than other allow-list precedents in this app.
   */
  allow_from?: string[];
}

export interface ConnectConfig {
  platforms?: ConnectPlatformConfig[];
}

/**
 * One publisher key trusted to verify a plugin bundle's `.sig` signature
 * (mirrors the backend's `bamboo_config::TrustedKey`, bamboo PR #450).
 * `algorithm` is a plain string on the wire (only `"ed25519"` is currently
 * understood by the backend verifier) so an unrecognized future value just
 * never matches rather than failing to parse.
 */
export interface TrustedKeyConfig {
  /** Human-readable label (also what a signed install's `signed_by` names). */
  label: string;
  algorithm: string;
  /** Hex-encoded public key. */
  public_key: string;
}

/**
 * `plugin_trust.enforcement` — the persistent, config-level escape hatch over
 * the whole three-layer URL-install trust policy (bamboo PR #465). `"strict"`
 * (the backend default) enforces the host allowlist / signature / checksum
 * layers; `"off"` makes every URL install behave as if `--insecure` were
 * passed, with no per-install flag needed. The backend also accepts a bare
 * `true`/`false` on read for a hand-edited config.json, but always
 * serializes back out as the string form — this UI only ever writes the
 * string form.
 */
export type PluginTrustEnforcement = "strict" | "off";

/**
 * Plugin URL-install source-trust policy (mirrors the backend's
 * `bamboo_config::PluginTrustConfig`, bamboo PRs #450/#465): a host
 * allowlist (is the source authorized?), ed25519 publisher keys (is the
 * publisher authentic?), plus a persistent enforcement escape hatch. Both
 * `trusted_hosts`/`trusted_keys` ship with built-in defaults (nova/magpie's
 * official keys + `github.com/bigduu/`) — an absent `plugin_trust` key in
 * `GET bamboo/config` means "using the built-in defaults", not "empty
 * policy".
 */
export interface PluginTrustConfig {
  /** Host+path prefixes, e.g. `"github.com/bigduu/"` (bare host = any path). */
  trusted_hosts?: string[];
  trusted_keys?: TrustedKeyConfig[];
  enforcement?: PluginTrustEnforcement;
}

export type LifecycleHookEvent =
  | "SessionStart"
  | "UserPromptSubmit"
  | "PreToolUse"
  | "PostToolUse"
  | "Stop"
  | "SessionEnd"
  | "PreCompact"
  | "Notification";

export interface LifecycleHookCommandConfig {
  type: "command";
  command: string;
  timeout_ms?: number;
}

export interface LifecycleHookGroupConfig {
  /** Missing means enabled for backward compatibility with existing files. */
  enabled?: boolean;
  matcher?: string;
  hooks: LifecycleHookCommandConfig[];
}

export interface LifecycleHooksConfig
  extends Partial<Record<LifecycleHookEvent, LifecycleHookGroupConfig[]>> {
  enabled?: boolean;
}

export interface LifecycleHookTestRequest {
  event: LifecycleHookEvent;
  matcher?: string;
  command: string;
  timeout_ms: number;
}

export interface LifecycleHookTestResponse {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  timed_out: boolean;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
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
  notifications?: NotificationsChannelConfig;
  connect?: ConnectConfig;
  plugin_trust?: PluginTrustConfig;
  lifecycle_hooks?: LifecycleHooksConfig;
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

export interface CodexCliDiscoveryResponse {
  path: string;
  version: string;
}

export interface AccessStatusResponse {
  password_enabled: boolean;
  local_bypass: boolean;
  requires_password: boolean;
}

/**
 * Device pairing / management (API v2 per-device tokens — bamboo #181,
 * handlers in `crates/app/bamboo-server/src/handlers/settings/access_control.rs`;
 * epic #26 phase 1 — wire plumbing only, no UI yet consumes these).
 *
 * ⚠️ These 5 endpoints live at the backend ORIGIN root (`/v2/...`), NOT under
 * the `/v1`-rooted base `apiClient` uses — see `resolveV2Origin`/`v2Fetch`
 * near the top of this file.
 */
export interface PairDeviceRequest {
  /** Owner root password — authorizes first-device pairing. */
  root_password?: string;
  /** One-time 6-digit pairing code from `createPairingCode()` — authorizes
   *  subsequent-device pairing. */
  code?: string;
  /** Human-readable device label, e.g. "iPhone 15". */
  label: string;
}

export interface PairDeviceResponse {
  device_id: string;
  /** Plaintext token — returned ONCE; store it via `setDeviceCredential`. */
  device_token: string;
  expires_hint: string;
}

export interface CreatePairingCodeResponse {
  code: string;
  /** TTL in whole seconds. */
  ttl: number;
}

export interface DeviceSummary {
  device_id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

export interface RevokeDeviceResponse {
  device_id: string;
  revoked: true;
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
   * Validate a Bamboo config patch without saving.
   */
  validateBambooConfigPatch(patch: BambooConfig): Promise<ValidateBambooConfigResponse>;

  /** Resolve and capability-check the Codex executable without saving config. */
  detectCodexCli(binary?: string, mode?: "exec" | "app_server"): Promise<CodexCliDiscoveryResponse>;

  /** Execute one lifecycle hook against Bamboo's synthetic dry-run payload. */
  testLifecycleHook(payload: LifecycleHookTestRequest): Promise<LifecycleHookTestResponse>;

  /**
   * Check whether `config.json` was recovered from corruption at load and is
   * awaiting confirmation (Lotus #59 / bamboo #153).
   */
  getConfigRecoveryStatus(): Promise<ConfigRecoveryStatusResponse>;

  /**
   * Accept (`true`) or reject (`false`) a pending config-corruption recovery.
   * Accepting persists the recovered config over the quarantined-corrupt
   * original and unblocks settings saves; rejecting is a no-op that leaves
   * disk, in-memory config, and the pending flag untouched — settings saves
   * stay refused until a later accept or a manual fix + backend restart.
   */
  confirmConfigRecovery(accept: boolean): Promise<ConfigRecoveryStatusResponse>;

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

  /**
   * Device pairing / management (API v2, epic #26 phase 1 — wire plumbing
   * only; nothing calls these yet). See `PairDeviceRequest` etc. above for
   * why these hit the backend origin root, not the `/v1` base.
   */
  pairDevice(payload: PairDeviceRequest): Promise<PairDeviceResponse>;
  createPairingCode(): Promise<CreatePairingCodeResponse>;
  listDevices(): Promise<DeviceSummary[]>;
  revokeDevice(deviceId: string): Promise<RevokeDeviceResponse>;
  rotateDevice(deviceId: string): Promise<PairDeviceResponse>;
}

class HttpUtilityService implements UtilityService {
  async copyToClipboard(text: string): Promise<void> {
    await copyText(text);
  }

  async getBambooConfig(): Promise<BambooConfig> {
    return apiClient.get<BambooConfig>("bamboo/config");
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

  async validateBambooConfigPatch(patch: BambooConfig): Promise<ValidateBambooConfigResponse> {
    return apiClient.post<ValidateBambooConfigResponse>("bamboo/config/validate", patch);
  }

  async detectCodexCli(
    binary?: string,
    mode: "exec" | "app_server" = "exec",
  ): Promise<CodexCliDiscoveryResponse> {
    return apiClient.post<CodexCliDiscoveryResponse>("bamboo/config/codex/detect", {
      binary: binary?.trim() || undefined,
      mode,
    });
  }

  async testLifecycleHook(payload: LifecycleHookTestRequest): Promise<LifecycleHookTestResponse> {
    return apiClient.post<LifecycleHookTestResponse>("bamboo/hooks/test", payload);
  }

  async getConfigRecoveryStatus(): Promise<ConfigRecoveryStatusResponse> {
    return apiClient.get<ConfigRecoveryStatusResponse>("bamboo/config/recovery-status");
  }

  async confirmConfigRecovery(accept: boolean): Promise<ConfigRecoveryStatusResponse> {
    return apiClient.post<ConfigRecoveryStatusResponse>("bamboo/config/recovery/confirm", {
      accept,
    });
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

  // ── v2-P2 device pairing / management (epic #26 phase 1) ─────────────────
  // ⚠️ All 5 below hit the backend ORIGIN root via `v2Fetch`/`buildV2Url`, NOT
  // the `/v1`-rooted `apiClient` — see `resolveV2Origin`'s doc comment.

  async pairDevice(payload: PairDeviceRequest): Promise<PairDeviceResponse> {
    return v2Fetch<PairDeviceResponse>("POST", "v2/pair", payload);
  }

  async createPairingCode(): Promise<CreatePairingCodeResponse> {
    return v2Fetch<CreatePairingCodeResponse>("POST", "v2/pair/code");
  }

  async listDevices(): Promise<DeviceSummary[]> {
    return v2Fetch<DeviceSummary[]>("GET", "v2/devices");
  }

  async revokeDevice(deviceId: string): Promise<RevokeDeviceResponse> {
    return v2Fetch<RevokeDeviceResponse>("DELETE", `v2/devices/${encodeURIComponent(deviceId)}`);
  }

  async rotateDevice(deviceId: string): Promise<PairDeviceResponse> {
    return v2Fetch<PairDeviceResponse>("POST", `v2/devices/${encodeURIComponent(deviceId)}/rotate`);
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
