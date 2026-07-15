import { agentApiClient } from "../api";
import type {
  InstalledPluginView,
  PluginListResponse,
  PluginRegistered,
  PluginSource,
  PluginStatus,
} from "./types";

const normalizeStringArray = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const filtered = value.filter((item): item is string => typeof item === "string");
  return filtered.length > 0 ? filtered : undefined;
};

const normalizeRegistered = (value: unknown): PluginRegistered | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const registered: PluginRegistered = {};

  const mcpServerIds = normalizeStringArray(record.mcp_server_ids);
  if (mcpServerIds) registered.mcp_server_ids = mcpServerIds;

  const presetIds = normalizeStringArray(record.preset_ids);
  if (presetIds) registered.preset_ids = presetIds;

  const skillDirs = normalizeStringArray(record.skill_dirs);
  if (skillDirs) registered.skill_dirs = skillDirs;

  const workflowFilenames = normalizeStringArray(record.workflow_filenames);
  if (workflowFilenames) registered.workflow_filenames = workflowFilenames;

  return Object.keys(registered).length > 0 ? registered : undefined;
};

const normalizeSource = (value: unknown): PluginSource => {
  if (!value || typeof value !== "object") {
    return { type: "local_dir", path: "" };
  }

  const record = value as Record<string, unknown>;
  const path = typeof record.path === "string" ? record.path : "";

  switch (record.type) {
    case "local_archive":
      return { type: "local_archive", path };
    case "url": {
      const asBool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
      return {
        type: "url",
        url: typeof record.url === "string" ? record.url : "",
        sha256: typeof record.sha256 === "string" ? record.sha256 : undefined,
        allow_unverified: asBool(record.allow_unverified),
        allow_untrusted_host: asBool(record.allow_untrusted_host),
        allow_unsigned: asBool(record.allow_unsigned),
        insecure: asBool(record.insecure),
        signed_by: typeof record.signed_by === "string" ? record.signed_by : undefined,
      };
    }
    case "local_dir":
    default:
      return { type: "local_dir", path };
  }
};

const normalizeStatus = (value: unknown): PluginStatus =>
  value === "installing" ? "installing" : "installed";

const normalizePlugin = (raw: unknown, index = 0): InstalledPluginView | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id : `plugin_${index}`;

  return {
    id,
    name: typeof record.name === "string" ? record.name : undefined,
    version: typeof record.version === "string" ? record.version : "",
    source: normalizeSource(record.source),
    status: normalizeStatus(record.status),
    registered: normalizeRegistered(record.registered),
  };
};

export class PluginsService {
  async getPlugins(): Promise<InstalledPluginView[]> {
    const response = await agentApiClient.get<PluginListResponse>("plugins");
    const rawPlugins = Array.isArray(response?.plugins) ? response.plugins : [];
    return rawPlugins
      .map((plugin, index) => normalizePlugin(plugin, index))
      .filter((plugin): plugin is InstalledPluginView => Boolean(plugin));
  }

  // Bamboo's install/update handler returns the full InstalledPluginView as the
  // 201/200 body, so a non-normalizable body is a defensive edge that should not
  // happen in practice. When it does, return null (rather than throwing a raw,
  // un-localizable English string at the UI) and let the caller reconcile by
  // refetching the list — the freshly installed/updated plugin shows up there.
  async installPlugin(source: PluginSource): Promise<InstalledPluginView | null> {
    const response = await agentApiClient.post<unknown>("plugins/install", { source });
    return normalizePlugin(response);
  }

  async updatePlugin(id: string, source: PluginSource): Promise<InstalledPluginView | null> {
    const response = await agentApiClient.post<unknown>(
      `plugins/${encodeURIComponent(id)}/update`,
      { source },
    );
    return normalizePlugin(response);
  }

  async deletePlugin(id: string): Promise<void> {
    await agentApiClient.delete<unknown>(`plugins/${encodeURIComponent(id)}`);
  }
}

export const pluginsService = new PluginsService();
