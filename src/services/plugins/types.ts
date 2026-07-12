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

export interface UrlSource {
  type: "url";
  url: string;
  sha256?: string;
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
