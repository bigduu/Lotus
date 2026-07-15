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
}

export interface InstalledPluginView {
  id: string;
  name?: string;
  version: string;
  source: PluginSource;
  status: PluginStatus;
  registered?: PluginRegistered;
}

export interface PluginListResponse {
  plugins: InstalledPluginView[];
}

export interface InstallPluginRequest {
  source: PluginSource;
}
