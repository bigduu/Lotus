import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError } from "@services/api";
import {
  ConfigConflictError,
  configSectionsService,
  type ClusterFabricSection,
  type ClusterNodeMutation,
  type CredentialStatus,
  type EnvSection,
  type McpSection,
  type NotificationSection,
  type ProviderSection,
} from "../configSections";

const envSectionResponse = (
  revision: number,
  data: EnvSection = [
    {
      name: "SECRET_TOKEN",
      secret: true,
      credential_ref: "env.SECRET_TOKEN.value",
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

const credentialResponse = (revision: number) => ({
  data: [
    {
      credential_ref: "env.SECRET_TOKEN.value",
      configured: true,
      source: "user",
      updated_at: null,
    },
  ] satisfies CredentialStatus[],
  revision,
  status: "healthy" as const,
  source: "file",
  last_error: null,
});

const mockEnvReads = (sectionRevisions: number[], credentialRevisions: number[]) => {
  const sections = [...sectionRevisions];
  const credentials = [...credentialRevisions];
  return vi.spyOn(apiClient, "get").mockImplementation(async (path: string) => {
    if (path === "/bamboo/config/sections/env") {
      const revision = sections.shift();
      if (revision === undefined) throw new Error("Unexpected Env section read");
      return envSectionResponse(revision) as never;
    }
    if (path === "/bamboo/config/credentials") {
      const revision = credentials.shift();
      if (revision === undefined) throw new Error("Unexpected credential read");
      return credentialResponse(revision) as never;
    }
    throw new Error(`Unexpected GET ${path}`);
  });
};

const notificationResponse = (credentialRevision: number) => ({
  revision: credentialRevision,
  status: "healthy" as const,
  source: "file" as const,
  last_error: null,
  data: {
    desktop: { enabled: true },
    ntfy: {
      enabled: true,
      base_url: "https://ntfy.sh",
      topic: "topic",
      credential: {
        credential_ref: "notification.ntfy.token",
        configured: true,
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
        source: null,
        updated_at: null,
      },
    },
  } satisfies NotificationSection,
});

const notificationSectionResponse = (
  sectionRevision: number,
  status: "healthy" | "missing" | "degraded" | "invalid" = "healthy",
) => ({
  data: { notifications: {} },
  revision: sectionRevision,
  loaded_at: `2026-07-24T00:00:${sectionRevision}Z`,
  source_path: "/tmp/notifications.json",
  source_kind: "file" as const,
  status,
  last_error: status === "healthy" ? null : "redacted section diagnostic",
});

const mockNotificationReads = (sectionRevisions: number[], credentialRevisions: number[]) => {
  const sections = [...sectionRevisions];
  const credentials = [...credentialRevisions];
  return vi.spyOn(apiClient, "get").mockImplementation(async (path: string) => {
    if (path === "/bamboo/config/sections/notifications") {
      const revision = sections.shift();
      if (revision === undefined) throw new Error("Unexpected typed notification read");
      return notificationSectionResponse(revision) as never;
    }
    if (path === "/bamboo/config/notifications") {
      const revision = credentials.shift();
      if (revision === undefined) throw new Error("Unexpected credential notification read");
      return notificationResponse(revision) as never;
    }
    throw new Error(`Unexpected GET ${path}`);
  });
};

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

  it("merges typed notification metadata with a deliberately different credential revision", async () => {
    const get = mockNotificationReads([7], [70]);

    const result = await configSectionsService.getSection("notifications");

    expect(result).toMatchObject({
      revision: 7,
      source_path: "/tmp/notifications.json",
      data: notificationResponse(70).data,
      credential_revision: 70,
      credential_status: "healthy",
      credential_source: "file",
    });
    expect(get).toHaveBeenCalledWith("/bamboo/config/sections/notifications");
    expect(get).toHaveBeenCalledWith("/bamboo/config/notifications");
  });

  it("freshly reads both notification revisions before every save and omits untouched secrets", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({});
    const get = mockNotificationReads([7, 7, 8], [70, 71, 72]);

    // Prime a prior read to prove the save does not reuse its credential
    // revision. The preflight must adopt credential revision 71, not 70.
    await configSectionsService.getSection("notifications");

    const result = await configSectionsService.putNotifications(7, {
      desktop: { enabled: true },
      ntfy: { enabled: true, base_url: "https://ntfy.sh", topic: "topic" },
      bark: { enabled: false, base_url: "https://api.day.app" },
    });

    expect(post).toHaveBeenCalledWith("/bamboo/config", {
      expected_revision: 71,
      notifications: {
        desktop: { enabled: true },
        ntfy: { enabled: true, base_url: "https://ntfy.sh", topic: "topic" },
        bark: { enabled: false, base_url: "https://api.day.app" },
      },
    });
    expect(JSON.stringify(post.mock.calls[0])).not.toContain("****");
    expect(result.revision).toBe(8);
    expect(result.credential_revision).toBe(72);
    expect(get).toHaveBeenCalledTimes(6);
  });

  it("sends null only for an explicit credential clear", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({});
    mockNotificationReads([20, 21], [90, 91]);

    await configSectionsService.putNotifications(20, {
      desktop: { enabled: true },
      ntfy: {
        enabled: true,
        base_url: "https://ntfy.sh",
        topic: "topic",
        token: null,
      },
      bark: { enabled: false, base_url: "https://api.day.app" },
    });

    expect(post.mock.calls[0]?.[1]).toMatchObject({
      notifications: { ntfy: { token: null } },
    });
  });

  it("rejects a stale typed notification base before the credential transaction", async () => {
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({});
    mockNotificationReads([8], [71]);

    await expect(
      configSectionsService.putNotifications(7, {
        desktop: { enabled: true },
        ntfy: { enabled: true, base_url: "https://ntfy.sh", topic: "topic" },
        bark: { enabled: false, base_url: "https://api.day.app" },
      }),
    ).rejects.toMatchObject<ConfigConflictError>({
      conflict: {
        expectedRevision: 7,
        currentRevision: 8,
        message: "The notification configuration changed on disk.",
      },
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("reports the typed notification revision after a credential-transaction race", async () => {
    mockNotificationReads([7, 8], [70, 71]);
    vi.spyOn(apiClient, "post").mockRejectedValue(
      new ApiError(
        "Configuration revision conflict: expected 70, actual 71",
        409,
        "Conflict",
        JSON.stringify({
          error: {
            message: "Configuration revision conflict: expected 70, actual 71",
            type: "api_error",
            code: "config_revision_conflict",
          },
        }),
      ),
    );

    await expect(
      configSectionsService.putNotifications(7, {
        desktop: { enabled: true },
        ntfy: { enabled: true, base_url: "https://ntfy.sh", topic: "topic" },
        bark: { enabled: false, base_url: "https://api.day.app" },
      }),
    ).rejects.toMatchObject<ConfigConflictError>({
      conflict: {
        expectedRevision: 7,
        currentRevision: 8,
      },
    });
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
    const get = mockNotificationReads([4], [44]);

    const result = await configSectionsService.resetSection("notifications", 3);

    expect(post).toHaveBeenCalledWith("/bamboo/config/sections/notifications/reset", {
      expected_revision: 3,
    });
    expect(get).toHaveBeenCalledWith("/bamboo/config/sections/notifications");
    expect(get).toHaveBeenCalledWith("/bamboo/config/notifications");
    expect(result.revision).toBe(4);
    expect((result as typeof result & { credential_revision: number }).credential_revision).toBe(
      44,
    );
    expect(result.data.ntfy.credential.configured).toBe(true);
  });

  it("writes Env through the captured section revision and never adopts a mask response", async () => {
    mockEnvReads([5, 6], [10, 11]);
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({
      revision: 11,
      entries: [
        {
          name: "SECRET_TOKEN",
          value: "****...****",
          secret: true,
          configured: true,
        },
      ],
    });

    const result = await configSectionsService.upsertEnvVar(5, {
      name: "SECRET_TOKEN",
      value: "replacement",
      secret: true,
    });

    expect(post).toHaveBeenCalledWith("/bamboo/env-vars", {
      expected_revision: 10,
      name: "SECRET_TOKEN",
      value: "replacement",
      secret: true,
    });
    expect(result.envelope.revision).toBe(6);
    expect(result.credentials.revision).toBe(11);
    expect(JSON.stringify(result)).not.toContain("****...****");
    expect(JSON.stringify(result)).not.toContain("replacement");
  });

  it("rejects a stale Env section before touching the credential endpoint", async () => {
    mockEnvReads([6], [10]);
    const post = vi.spyOn(apiClient, "post");

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
    expect(post).not.toHaveBeenCalled();
  });

  it("rebases one unrelated credential race only after rechecking the Env section", async () => {
    mockEnvReads([5, 5, 6], [10, 11, 12]);
    const post = vi
      .spyOn(apiClient, "post")
      .mockRejectedValueOnce(new ApiError("credential race", 409, "Conflict"))
      .mockResolvedValueOnce({ revision: 12, entries: [] });

    await expect(
      configSectionsService.upsertEnvVar(5, {
        name: "VISIBLE",
        value: "value",
        secret: false,
      }),
    ).resolves.toMatchObject({
      envelope: { revision: 6 },
      credentials: { revision: 12 },
    });
    expect(post.mock.calls.map((call) => call[1])).toEqual([
      expect.objectContaining({ expected_revision: 10 }),
      expect.objectContaining({ expected_revision: 11 }),
    ]);
  });

  it("maps a repeated Env credential race back to the latest owned section revision", async () => {
    mockEnvReads([5, 5, 6], [10, 11, 12]);
    vi.spyOn(apiClient, "delete")
      .mockRejectedValueOnce(new ApiError("credential race", 409, "Conflict"))
      .mockRejectedValueOnce(new ApiError("stale Env writer", 409, "Conflict"));

    await expect(
      configSectionsService.deleteEnvVar("SECRET/TOKEN", 5),
    ).rejects.toMatchObject<ConfigConflictError>({
      conflict: {
        expectedRevision: 5,
        currentRevision: 6,
        message: "stale Env writer",
      },
    });
    expect(apiClient.delete).toHaveBeenNthCalledWith(
      1,
      "/bamboo/env-vars/SECRET%2FTOKEN?expected_revision=10",
    );
    expect(apiClient.delete).toHaveBeenNthCalledWith(
      2,
      "/bamboo/env-vars/SECRET%2FTOKEN?expected_revision=11",
    );
  });

  it("replaces proxy credentials with the credential revision and no mask round-trip", async () => {
    const response = {
      configured: true,
      credential_ref: "proxy.default.auth",
      source: "user",
      updated_at: "2026-07-23T00:00:00Z",
      revision: 7,
      status: "healthy" as const,
      source_kind: "file",
      last_error: null,
    };
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(response);

    await expect(
      configSectionsService.replaceProxyAuth(6, { username: "alice", password: "secret" }),
    ).resolves.toEqual(response);
    expect(post).toHaveBeenCalledWith("/bamboo/proxy-auth", {
      expected_revision: 6,
      username: "alice",
      password: "secret",
    });
  });
});
