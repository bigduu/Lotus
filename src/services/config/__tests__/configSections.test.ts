import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError } from "@services/api";
import {
  ConfigConflictError,
  configSectionsService,
  type AccessControlSection,
  type ClusterFabricSection,
  type ClusterNodeMutation,
  type EnvSection,
  type McpSection,
  type NotificationSection,
  type ProviderSection,
} from "../configSections";

const envSectionEnvelope = (
  revision: number,
  data: EnvSection = [
    {
      name: "SECRET_TOKEN",
      secret: true,
      credential_state: "configured",
      credential_ref: "env.SECRET_TOKEN.value",
      source: "user",
      updated_at: null,
      configured: true,
    },
  ],
) => ({
  data,
  revision,
  loaded_at: `2026-07-26T00:00:0${revision}Z`,
  source_path: "/tmp/env.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

const envResponse = (revision: number, entries?: EnvSection) => ({
  revision,
  entries: entries ?? envSectionEnvelope(revision).data,
  section: envSectionEnvelope(revision, entries),
  credential_health: { revision: 99, status: "healthy" },
});

const accessSectionEnvelope = (
  revision: number,
  data: AccessControlSection = {
    password_enabled: true,
    password_credential_ref: "access.root.password",
    password_configured: true,
    updated_at: null,
    devices: [],
  },
) => ({
  data,
  revision,
  loaded_at: `2026-07-26T00:02:0${revision}Z`,
  source_path: "/tmp/access-control.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

const accessMutationResponse = (revision: number, configured = true) => ({
  success: true,
  password_enabled: configured,
  revision,
  section: accessSectionEnvelope(
    revision,
    configured
      ? undefined
      : {
          password_enabled: false,
          password_credential_ref: null,
          password_configured: false,
          updated_at: null,
          devices: [],
        },
  ),
  credential: {
    credential_ref: configured ? "access.root.password" : null,
    configured,
    state: configured ? ("configured" as const) : ("missing" as const),
    source: configured ? "user" : null,
    updated_at: null,
  },
  credential_health: { revision: 42, status: "healthy" },
});

const notificationSectionEnvelope = (
  revision: number,
  status: "healthy" | "missing" | "degraded" | "invalid" = "healthy",
) => ({
  data: { notifications: {} },
  revision,
  loaded_at: `2026-07-24T00:00:${revision}Z`,
  source_path: "/tmp/notifications.json",
  source_kind: "file" as const,
  status,
  last_error: status === "healthy" ? null : "redacted section diagnostic",
});

const notificationResponse = (revision: number) => ({
  revision,
  status: "healthy" as const,
  source: "file" as const,
  source_path: "/tmp/notifications.json",
  loaded_at: `2026-07-24T00:00:${revision}Z`,
  last_error: null,
  section: notificationSectionEnvelope(revision),
  data: {
    desktop: { enabled: true },
    ntfy: {
      enabled: true,
      base_url: "https://ntfy.sh",
      topic: "topic",
      credential: {
        credential_ref: "notification.ntfy.token",
        configured: true,
        state: "configured" as const,
        source: "user",
        updated_at: null,
      },
    },
    bark: {
      enabled: false,
      base_url: "https://api.day.app",
      credential: {
        credential_ref: null,
        configured: false,
        state: "missing" as const,
        source: null,
        updated_at: null,
      },
    },
  } satisfies NotificationSection,
});

const providerResponse = (revision: number) => ({
  data: {
    provider: "openai",
    providers: { openai: { model: "gpt-4o" } },
    defaults: { chat: { provider: "openai", model: "gpt-4o" } },
    features: { provider_model_ref: true },
    provider_instances: {},
    default_provider_instance_id: null,
    available_providers: ["copilot", "openai", "anthropic", "gemini", "bodhi"],
    credential_status: {
      providers: {
        openai: {
          credential_ref: "provider.openai.api_key",
          configured: true,
          source: "user",
          updated_at: null,
        },
      },
      provider_instances: {},
    },
  } satisfies ProviderSection,
  revision,
  loaded_at: "2026-07-24T00:00:00Z",
  source_path: "/tmp/providers.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

const mcpResponse = (revision: number) => ({
  data: {
    version: 1,
    servers: [
      {
        id: "stdio",
        name: "Canonical stdio",
        enabled: true,
        transport: {
          type: "stdio" as const,
          command: "node",
          args: ["server.js"],
          env: { TOKEN: "" },
          startup_timeout_ms: 20_000,
        },
        request_timeout_ms: 60_000,
        healthcheck_interval_ms: 30_000,
        reconnect: {
          enabled: true,
          initial_backoff_ms: 1_000,
          max_backoff_ms: 30_000,
          max_attempts: 3,
        },
        allowed_tools: [],
        denied_tools: [],
      },
    ],
    credential_status: {
      stdio: {
        env: {
          TOKEN: {
            configured: true,
            source: "user",
            updated_at: null,
          },
        },
        headers: {},
      },
    },
  } satisfies McpSection,
  revision,
  loaded_at: "2026-07-24T00:00:00Z",
  source_path: "/tmp/mcp.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

const clusterResponse = (revision: number) => ({
  data: {
    nodes: [],
    clusters: [],
    credential_status: {},
  } satisfies ClusterFabricSection,
  revision,
  loaded_at: "2026-07-27T00:00:00Z",
  source_path: "/tmp/cluster-fabric.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
  node_id: "node-1",
});

const clusterNodeMutation: ClusterNodeMutation = {
  label: "worker-1",
  placement: {
    type: "ssh",
    host: "10.0.0.5",
    port: 22,
    username: "deploy",
    auth: { method: "password" },
  },
  credential_changes: {
    password: { action: "replace", value: "cluster-secret" },
    private_key: { action: "clear" },
    passphrase: { action: "clear" },
  },
  membership: { cluster_names: ["gpu"] },
};

describe("configSectionsService", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses the canonical provider settings route for reads", async () => {
    const response = providerResponse(2);
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(response);

    await expect(configSectionsService.getSection("providers")).resolves.toEqual(response);
    expect(get).toHaveBeenCalledWith("/bamboo/config/provider-settings");
  });

  it("keeps provider metadata secret-free and sends replace intent explicitly", async () => {
    const response = providerResponse(3);
    const put = vi.spyOn(apiClient, "put").mockResolvedValue(response);

    await configSectionsService.putProviderSettings(2, response.data, {
      providers: {
        openai: { action: "replace", value: "new-provider-secret" },
      },
    });

    expect(put).toHaveBeenCalledWith("/bamboo/config/provider-settings", {
      expected_revision: 2,
      data: response.data,
      credential_changes: {
        providers: {
          openai: { action: "replace", value: "new-provider-secret" },
        },
      },
    });
    expect(JSON.stringify(response.data)).not.toContain("new-provider-secret");
    expect(JSON.stringify(response.data)).not.toContain("****");
  });

  it("reads the exact notification projection in one request", async () => {
    const response = notificationResponse(7);
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(response);

    const result = await configSectionsService.getSection("notifications");

    expect(result).toMatchObject({
      revision: 7,
      source_path: "/tmp/notifications.json",
      data: response.data,
    });
    expect(get).toHaveBeenCalledWith("/bamboo/config/notifications");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("writes notifications through the owned section CAS with explicit keep actions", async () => {
    const response = notificationResponse(8);
    const put = vi.spyOn(apiClient, "put").mockResolvedValue(response);

    const result = await configSectionsService.putNotifications(7, {
      desktop: { enabled: true },
      ntfy: {
        enabled: true,
        base_url: "https://ntfy.sh",
        topic: "topic",
        credential_change: { action: "keep" },
      },
      bark: {
        enabled: false,
        base_url: "https://api.day.app",
        credential_change: { action: "keep" },
      },
    });

    expect(put).toHaveBeenCalledWith("/bamboo/config/notifications", {
      expected_revision: 7,
      data: {
        desktop: { enabled: true },
        ntfy: {
          enabled: true,
          base_url: "https://ntfy.sh",
          topic: "topic",
          credential_change: { action: "keep" },
        },
        bark: {
          enabled: false,
          base_url: "https://api.day.app",
          credential_change: { action: "keep" },
        },
      },
    });
    expect(JSON.stringify(put.mock.calls[0])).not.toContain("****");
    expect(result.revision).toBe(8);
  });

  it("sends an explicit action for notification credential clear", async () => {
    const put = vi.spyOn(apiClient, "put").mockResolvedValue(notificationResponse(21));

    await configSectionsService.putNotifications(20, {
      desktop: { enabled: true },
      ntfy: {
        enabled: true,
        base_url: "https://ntfy.sh",
        topic: "topic",
        credential_change: { action: "clear" },
      },
      bark: {
        enabled: false,
        base_url: "https://api.day.app",
        credential_change: { action: "keep" },
      },
    });

    expect(put.mock.calls[0]?.[1]).toMatchObject({
      expected_revision: 20,
      data: { ntfy: { credential_change: { action: "clear" } } },
    });
    expect(JSON.stringify(put.mock.calls[0])).not.toContain('"token"');
  });

  it("maps the backend notification section conflict without a client preflight", async () => {
    const put = vi
      .spyOn(apiClient, "put")
      .mockRejectedValue(
        new ApiError("Configuration revision conflict: expected 7, actual 8", 409, "Conflict"),
      );

    await expect(
      configSectionsService.putNotifications(7, {
        desktop: { enabled: true },
        ntfy: {
          enabled: true,
          base_url: "https://ntfy.sh",
          topic: "topic",
          credential_change: { action: "keep" },
        },
        bark: {
          enabled: false,
          base_url: "https://api.day.app",
          credential_change: { action: "keep" },
        },
      }),
    ).rejects.toMatchObject<ConfigConflictError>({
      conflict: {
        expectedRevision: 7,
        currentRevision: 8,
        message: "Configuration revision conflict: expected 7, actual 8",
      },
    });
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("uses the canonical MCP settings route for reads", async () => {
    const response = mcpResponse(5);
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(response);

    await expect(configSectionsService.getMcpSettings()).resolves.toEqual(response);
    await expect(configSectionsService.getSection("mcp")).resolves.toEqual(response);
    expect(get).toHaveBeenNthCalledWith(1, "/bamboo/config/sections/mcp");
    expect(get).toHaveBeenNthCalledWith(2, "/bamboo/config/sections/mcp");
  });

  it("writes canonical MCP data with explicit credential changes", async () => {
    const response = mcpResponse(6);
    const put = vi.spyOn(apiClient, "put").mockResolvedValue(response);
    const credentialChanges = {
      servers: {
        stdio: {
          env: { TOKEN: "new-mcp-secret" },
          headers: { Authorization: null },
        },
      },
    };

    await expect(
      configSectionsService.putMcpSettings(5, response.data, credentialChanges),
    ).resolves.toEqual(response);
    expect(put).toHaveBeenCalledWith("/bamboo/config/sections/mcp", {
      expected_revision: 5,
      data: response.data,
      credential_changes: credentialChanges,
    });
    expect(JSON.stringify(response.data)).not.toContain("new-mcp-secret");
    expect(JSON.stringify(response.data)).not.toContain("credential_ref");
  });

  it("uses one cluster section revision for atomic node, credential, and membership changes", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(clusterResponse(9));

    await expect(configSectionsService.createClusterNode(8, clusterNodeMutation)).resolves.toEqual({
      envelope: {
        data: clusterResponse(9).data,
        revision: 9,
        loaded_at: "2026-07-27T00:00:00Z",
        source_path: "/tmp/cluster-fabric.json",
        source_kind: "file",
        status: "healthy",
        last_error: null,
      },
      nodeId: "node-1",
    });
    expect(post).toHaveBeenCalledWith("/bamboo/settings/nodes", {
      expected_revision: 8,
      ...clusterNodeMutation,
    });
    expect(JSON.stringify(post.mock.calls[0]?.[1]?.placement)).not.toContain("cluster-secret");
  });

  it("binds cluster lifecycle actions to the same section revision", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({
      ...clusterResponse(10),
      preflight: "Linux worker 6.1",
    });

    await expect(
      configSectionsService.runClusterNodeAction("node/1", "test", 9),
    ).resolves.toMatchObject({
      envelope: { revision: 10 },
      nodeId: "node-1",
      preflight: "Linux worker 6.1",
    });
    expect(post).toHaveBeenCalledWith(
      "/bamboo/settings/nodes/node%2F1/test?expected_revision=9",
      {},
    );
  });

  it.each([
    [
      "direct",
      JSON.stringify({
        message: "Configuration revision conflict: expected 5, actual 9",
      }),
    ],
    [
      "nested",
      JSON.stringify({
        error: {
          message: "Configuration revision conflict: expected 5, actual 9",
          type: "api_error",
          code: "config_revision_conflict",
        },
      }),
    ],
  ])("parses the actual MCP revision from a %s Bamboo conflict message", async (_shape, body) => {
    vi.spyOn(apiClient, "put").mockRejectedValue(
      new ApiError("revision conflict", 409, "Conflict", body),
    );

    await expect(
      configSectionsService.putMcpSettings(5, mcpResponse(5).data),
    ).rejects.toMatchObject<ConfigConflictError>({
      conflict: {
        expectedRevision: 5,
        currentRevision: 9,
        message: "revision conflict",
      },
    });
  });

  it("maps a 409 response to a typed revision conflict", async () => {
    vi.spyOn(apiClient, "put").mockRejectedValue(
      new ApiError("revision conflict", 409, "Conflict", JSON.stringify({ error: { actual: 8 } })),
    );

    await expect(
      configSectionsService.putSection("core", 7, { http_proxy: "http://proxy" }),
    ).rejects.toMatchObject<ConfigConflictError>({
      conflict: { expectedRevision: 7, currentRevision: 8, message: "revision conflict" },
    });
  });

  it("resets a section with CAS and adopts the returned envelope", async () => {
    const resetEnvelope = {
      data: { http_proxy: "" },
      revision: 12,
      loaded_at: "2026-07-23T00:00:00Z",
      source_path: "/tmp/core.json",
      source_kind: "default" as const,
      status: "healthy" as const,
      last_error: null,
    };
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(resetEnvelope);

    await expect(configSectionsService.resetSection("core", 11)).resolves.toEqual(resetEnvelope);
    expect(post).toHaveBeenCalledWith("/bamboo/config/sections/core/reset", {
      expected_revision: 11,
    });
  });

  it("reconciles notification reset through the credential-aware projection", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({
      data: {},
      revision: 4,
      status: "healthy",
    });
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(notificationResponse(4));

    const result = await configSectionsService.resetSection("notifications", 3);

    expect(post).toHaveBeenCalledWith("/bamboo/config/sections/notifications/reset", {
      expected_revision: 3,
    });
    expect(get).toHaveBeenCalledWith("/bamboo/config/notifications");
    expect(result.revision).toBe(4);
    expect(result.data.ntfy.credential.configured).toBe(true);
  });

  it("writes Env through the owned section revision and adopts the exact secret-free response", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(envResponse(6));

    const result = await configSectionsService.upsertEnvVar(5, {
      name: "SECRET_TOKEN",
      credential_change: { action: "replace", value: "replacement" },
      secret: true,
    });

    expect(post).toHaveBeenCalledWith("/bamboo/env-vars", {
      expected_revision: 5,
      name: "SECRET_TOKEN",
      credential_change: { action: "replace", value: "replacement" },
      secret: true,
    });
    expect(result.envelope.revision).toBe(6);
    expect(JSON.stringify(result)).not.toContain("****...****");
    expect(JSON.stringify(result)).not.toContain("replacement");
  });

  it("maps a stale Env section response without preflight or retry", async () => {
    const post = vi
      .spyOn(apiClient, "post")
      .mockRejectedValue(
        new ApiError("Configuration revision conflict: expected 5, actual 6", 409, "Conflict"),
      );

    await expect(
      configSectionsService.upsertEnvVar(5, {
        name: "VISIBLE",
        value: "value",
        secret: false,
      }),
    ).rejects.toMatchObject<ConfigConflictError>({
      conflict: {
        expectedRevision: 5,
        currentRevision: 6,
      },
    });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("reads Env status and section metadata from the exact dedicated endpoint", async () => {
    const response = envResponse(5);
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(response);

    await expect(configSectionsService.getSection("env")).resolves.toEqual(envSectionEnvelope(5));
    expect(get).toHaveBeenCalledWith("/bamboo/env-vars");
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("binds Env deletion to the owned section revision", async () => {
    vi.spyOn(apiClient, "delete").mockResolvedValue(envResponse(6, []));

    await expect(configSectionsService.deleteEnvVar("SECRET/TOKEN", 5)).resolves.toMatchObject({
      envelope: { revision: 6, data: [] },
    });
    expect(apiClient.delete).toHaveBeenNthCalledWith(
      1,
      "/bamboo/env-vars/SECRET%2FTOKEN?expected_revision=5",
    );
  });

  it("reads the exact flattened Access status envelope", async () => {
    const status = {
      password_enabled: false,
      local_bypass: true,
      requires_password: false,
      revision: 4,
      status: "healthy" as const,
      source_kind: "file" as const,
      loaded_at: "2026-07-27T00:00:00Z",
      last_error: null,
      password_configured: false,
      credential_state: "missing" as const,
      credential_ref: null,
      credential_source: null,
      credential_updated_at: null,
    };
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(status);

    await expect(configSectionsService.getAccessRuntimeStatus()).resolves.toEqual(status);
    expect(get).toHaveBeenCalledWith("/bamboo/access/status");
  });

  it("replaces Access password through the owned section CAS and adopts the exact response", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(accessMutationResponse(5));

    const result = await configSectionsService.replaceAccessPassword(4, {
      current_password: "current-secret",
      value: "replacement-secret",
    });

    expect(post).toHaveBeenCalledWith("/bamboo/access/password", {
      expected_revision: 4,
      action: "replace",
      current_password: "current-secret",
      value: "replacement-secret",
    });
    expect(result).toMatchObject({
      envelope: { revision: 5 },
      credential: { state: "configured", configured: true },
    });
    expect(JSON.stringify(result)).not.toContain("current-secret");
    expect(JSON.stringify(result)).not.toContain("replacement-secret");
  });

  it("maps a stale Access password response without a client preflight", async () => {
    const post = vi
      .spyOn(apiClient, "post")
      .mockRejectedValue(
        new ApiError("Configuration revision conflict: expected 4, actual 5", 409, "Conflict"),
      );
    const get = vi.spyOn(apiClient, "get");

    await expect(
      configSectionsService.replaceAccessPassword(4, {
        current_password: "current-secret",
        value: "replacement-secret",
      }),
    ).rejects.toMatchObject<ConfigConflictError>({
      conflict: {
        expectedRevision: 4,
        currentRevision: 5,
      },
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
  });

  it("clears Access password explicitly and preserves the returned section generation", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(accessMutationResponse(5, false));

    await expect(
      configSectionsService.clearAccessPassword(4, {
        current_password: "current-secret",
      }),
    ).resolves.toMatchObject({
      envelope: { revision: 5, data: { password_enabled: false } },
      credential: { state: "missing", configured: false },
    });
    expect(post).toHaveBeenCalledWith("/bamboo/access/password", {
      expected_revision: 4,
      action: "clear",
      current_password: "current-secret",
    });
  });

  it("replaces proxy credentials with the Core section revision and explicit action", async () => {
    const section = {
      data: { proxy_auth_credential_ref: "proxy.default.auth" },
      revision: 7,
      loaded_at: "2026-07-23T00:00:00Z",
      source_path: "/tmp/core.json",
      source_kind: "file" as const,
      status: "healthy" as const,
      last_error: null,
    };
    const response = {
      section,
      state: "configured" as const,
      configured: true,
      credential_ref: "proxy.default.auth",
      source: "user",
      updated_at: "2026-07-23T00:00:00Z",
      revision: 7,
    };
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(response);

    await expect(
      configSectionsService.replaceProxyAuth(6, { username: "alice", password: "secret" }),
    ).resolves.toMatchObject({
      ...response,
      status: "healthy",
      source_kind: "file",
      source_path: "/tmp/core.json",
    });
    expect(post).toHaveBeenCalledWith("/bamboo/proxy-auth", {
      expected_revision: 6,
      action: "replace",
      username: "alice",
      password: "secret",
    });
  });
});
