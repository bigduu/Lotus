/**
 * Plugin types
 *
 * Mirrors the frozen bamboo `/api/v1/plugins` contract. `registered`
 * sub-arrays are omitted (not empty arrays) by the backend when there is
 * nothing of that kind registered, so every field here is optional and
 * should be treated defensively when parsed off the wire.
 */

export type PluginStatus = "installing" | "installed";

export interface LocalDirSource {
  type: "local_dir";
  path: string;
}

export interface LocalArchiveSource {
  type: "local_archive";
  path: string;
}

/**
 * A `url` source's trust-override flags (mirrors the backend's
 * `bamboo_plugin::registry::PluginSource::Url` / the `SourceSpec` wire shape
 * documented in bamboo's `api_types.rs`, PRs #449/#450/#465/#483). Three
 * independent layers are enforced by default for every URL install:
 *
 * 1. **Host allowlist** — the URL's host+path must match
 *    `plugin_trust.trusted_hosts`; `allow_untrusted_host: true` opts out.
 * 2. **Signature** — the bundle's `.sig` must verify against
 *    `plugin_trust.trusted_keys`; `allow_unsigned: true` opts out.
 * 3. **Checksum** — `sha256`, when given, pins the downloaded bundle; with
 *    none given the install is refused unless `allow_unverified: true` (or a
 *    valid signature already satisfied this layer).
 *
 * `insecure: true` is a convenience aggregate over all three at once (same
 * effect as setting all three individually, for this install only).
 * `signed_by` is response-only — the label of the `trusted_keys` entry the
 * bundle verified against; a client-supplied value on a request is ignored
 * by the backend.
 */
export interface UrlSource {
  type: "url";
  url: string;
  sha256?: string;
  allow_unverified?: boolean;
  allow_untrusted_host?: boolean;
  allow_unsigned?: boolean;
  insecure?: boolean;
  /** Response-only. Ignored if present on a request body. */
  signed_by?: string;
}

export type PluginSource = LocalDirSource | LocalArchiveSource | UrlSource;

export interface PluginRegistered {
  mcp_server_ids?: string[];
  preset_ids?: string[];
  skill_dirs?: string[];
  workflow_filenames?: string[];
  service_ids?: string[];
}

/**
 * Live `ServiceManager` state for one supervised service-kind plugin
 * (bamboo PR #482, issue #479 — service artifact kind). Mirrors the
 * backend's `ServiceState` enum (`bamboo-server`'s `service_manager/mod.rs`)
 * exactly, wire-serialized `#[serde(rename_all = "snake_case")]`.
 */
export type ServiceState =
  | "starting"
  | "running"
  | "degraded"
  | "crashed"
  | "restarting"
  | "stopping"
  | "stopped";

/**
 * Mirrors the backend's `ServiceStatusView` (`InstalledPluginView.
 * service_status`, bamboo's `plugin/api_types.rs`). `pid`/`last_error` are
 * omitted (not `null`) by the backend when absent — see `normalizePlugin`.
 */
export interface ServiceStatusView {
  id: string;
  state: ServiceState;
  pid?: number;
  restart_count: number;
  last_error?: string;
}

export interface InstalledPluginView {
  id: string;
  name?: string;
  version: string;
  source: PluginSource;
  status: PluginStatus;
  registered?: PluginRegistered;
  /**
   * Status visibility only (Lotus #52) — the backend exposes no manual
   * start/stop/restart endpoint (only list/install/update/remove under
   * `/api/v1/plugins`), so this is purely read-only supervised-service state.
   * Omitted (not an empty array) by the backend for a plugin with no
   * services, same convention as `registered`'s sub-arrays.
   */
  service_status?: ServiceStatusView[];
}

export interface PluginListResponse {
  plugins: InstalledPluginView[];
}

export interface InstallPluginRequest {
  source: PluginSource;
}
