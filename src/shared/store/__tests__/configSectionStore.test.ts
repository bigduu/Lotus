import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfigConflictError,
  configSectionsService,
  type AccessControlSection,
  type AccessMutationResult,
  type ClusterFabricSection,
  type ClusterNodeMutation,
  type ConnectSection,
  type ConfigSectionEnvelope,
  type CoreSection,
  type CredentialStatus,
  type EnvMutationResult,
  type EnvSection,
  type McpSection,
  type NotificationSectionEnvelope,
  type ProviderSection,
} from "@services/config/configSections";
import { useConfigSectionStore } from "../configSectionStore";

const envelope = (
  revision: number,
  data: CoreSection = { http_proxy: `http://proxy-${revision}` },
): ConfigSectionEnvelope<CoreSection> => ({
  data,
  revision,
  loaded_at: `2026-07-23T00:00:0${revision}Z`,
  source_path: "/tmp/core.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const providerEnvelope = (revision: number): ConfigSectionEnvelope<ProviderSection> => ({
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
  },
  revision,
  loaded_at: "2026-07-24T00:00:00Z",
  source_path: "/tmp/providers.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const mcpEnvelope = (revision: number): ConfigSectionEnvelope<McpSection> => ({
  data: {
    version: 1,
    servers: [],
    credential_status: {},
  },
  revision,
  loaded_at: "2026-07-24T00:00:00Z",
  source_path: "/tmp/mcp.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const connectEnvelope = (revision: number): ConfigSectionEnvelope<ConnectSection> => ({
  data: { platforms: [] },
  revision,
  loaded_at: "2026-07-24T00:00:00Z",
  source_path: "/tmp/connect.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const clusterEnvelope = (revision: number): ConfigSectionEnvelope<ClusterFabricSection> => ({
  data: { nodes: [], clusters: [], credential_status: {} },
  revision,
  loaded_at: "2026-07-27T00:00:00Z",
  source_path: "/tmp/cluster-fabric.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const clusterMutation: ClusterNodeMutation = {
  label: "worker-1",
  placement: { type: "local" },
  credential_changes: {
    password: { action: "clear" },
    private_key: { action: "clear" },
    passphrase: { action: "clear" },
  },
  membership: { cluster_names: [] },
};

const envEnvelope = (revision: number): ConfigSectionEnvelope<EnvSection> => ({
  data: [
    {
      name: "SECRET_TOKEN",
      secret: true,
      credential_ref: "env.SECRET_TOKEN.value",
      configured: true,
    },
  ],
  revision,
  loaded_at: "2026-07-27T00:00:00Z",
  source_path: "/tmp/env.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const credentialsEnvelope = (revision: number): ConfigSectionEnvelope<CredentialStatus[]> => ({
  data: [
    {
      credential_ref: "env.SECRET_TOKEN.value",
      configured: true,
      source: "user",
      updated_at: null,
    },
  ],
  revision,
  loaded_at: "2026-07-27T00:00:00Z",
  source_path: "/tmp/credentials.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const envMutationResult = (envRevision: number, credentialRevision: number): EnvMutationResult => ({
  envelope: envEnvelope(envRevision),
  credentials: credentialsEnvelope(credentialRevision),
});

const accessEnvelope = (revision: number): ConfigSectionEnvelope<AccessControlSection> => ({
  data: {
    password_enabled: true,
    password_credential_ref: "access.root.password",
    password_configured: true,
    updated_at: null,
    devices: [],
  },
  revision,
  loaded_at: "2026-07-27T00:00:00Z",
  source_path: "/tmp/access-control.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
});

const accessMutationResult = (
  sectionRevision: number,
  credentialRevision: number,
): AccessMutationResult => ({
  envelope: accessEnvelope(sectionRevision),
  credentials: {
    ...credentialsEnvelope(credentialRevision),
    data: [
      {
        credential_ref: "access.root.password",
        configured: true,
        source: "user",
        updated_at: null,
      },
    ],
  },
  runtime: {
    password_enabled: true,
    local_bypass: true,
    requires_password: false,
  },
});

const notificationEnvelope = (
  sectionRevision: number,
  credentialRevision: number,
): NotificationSectionEnvelope => ({
  data: {
    desktop: { enabled: true },
    ntfy: {
      enabled: false,
      base_url: "https://ntfy.sh",
      topic: "",
      credential: {
        credential_ref: null,
        configured: false,
        source: null,
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
  },
  revision: sectionRevision,
  loaded_at: "2026-07-24T00:00:00Z",
  source_path: "/tmp/notifications.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
  credential_revision: credentialRevision,
  credential_status: "healthy",
  credential_source: "file",
  credential_last_error: null,
});

describe("useConfigSectionStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useConfigSectionStore.getState().reset();
  });

  it("keeps the last-known-good snapshot when a refresh fails", async () => {
    vi.spyOn(configSectionsService, "getSection").mockResolvedValueOnce(envelope(1));
    await useConfigSectionStore.getState().loadSection("core");

    vi.spyOn(configSectionsService, "getSection").mockRejectedValueOnce(
      new Error("redacted parse failure"),
    );
    await expect(
      useConfigSectionStore.getState().loadSection("core", { force: true }),
    ).rejects.toThrow("redacted parse failure");

    const snapshot = useConfigSectionStore.getState().sections.core;
    expect(snapshot.envelope).toEqual(envelope(1));
    expect(snapshot.error).toBe("redacted parse failure");
  });

  it("does not let an older load response overwrite a newer save", async () => {
    let resolveLoad!: (value: ConfigSectionEnvelope<CoreSection>) => void;
    vi.spyOn(configSectionsService, "getSection").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve as typeof resolveLoad;
        }),
    );
    const load = useConfigSectionStore.getState().loadSection("core", { force: true });

    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(1) },
      },
    }));
    vi.spyOn(configSectionsService, "putSection").mockResolvedValueOnce(envelope(2));
    await useConfigSectionStore.getState().saveSection("core", { http_proxy: "http://proxy-2" }, 1);

    resolveLoad(envelope(1));
    await expect(load).resolves.toEqual(envelope(2));
    expect(useConfigSectionStore.getState().sections.core.envelope?.revision).toBe(2);
  });

  it("does not let a late generic save response overwrite or return past a newer snapshot", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(1) },
      },
    }));
    let resolveSave!: (value: ConfigSectionEnvelope<CoreSection>) => void;
    vi.spyOn(configSectionsService, "putSection").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve as typeof resolveSave;
        }),
    );

    const pending = useConfigSectionStore
      .getState()
      .saveSection("core", { http_proxy: "http://proxy-2" }, 1);
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(3) },
      },
    }));
    resolveSave(envelope(2));

    await expect(pending).resolves.toEqual(envelope(3));
    expect(useConfigSectionStore.getState().sections.core.envelope).toEqual(envelope(3));
  });

  it("ignores an older mutation error after a newer save succeeds", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(1) },
      },
    }));
    let rejectFirst!: (reason: unknown) => void;
    vi.spyOn(configSectionsService, "putSection")
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce(envelope(2));

    const first = useConfigSectionStore
      .getState()
      .saveSection("core", { http_proxy: "http://first" }, 1);
    await useConfigSectionStore.getState().saveSection("core", { http_proxy: "http://second" }, 1);
    rejectFirst(
      new ConfigConflictError({
        expectedRevision: 1,
        currentRevision: 2,
        message: "stale request failed",
      }),
    );

    await expect(first).rejects.toThrow("stale request failed");
    const snapshot = useConfigSectionStore.getState().sections.core;
    expect(snapshot.envelope).toEqual(envelope(2));
    expect(snapshot.error).toBeNull();
    expect(snapshot.conflict).toBeNull();
  });

  it("records a 409 conflict without changing local data", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(4) },
      },
    }));
    vi.spyOn(configSectionsService, "putSection").mockRejectedValueOnce(
      new ConfigConflictError({
        expectedRevision: 4,
        currentRevision: 5,
        message: "revision conflict",
      }),
    );

    await expect(
      useConfigSectionStore.getState().saveSection("core", { http_proxy: "http://draft" }, 4),
    ).rejects.toThrow("revision conflict");

    const snapshot = useConfigSectionStore.getState().sections.core;
    expect(snapshot.envelope).toEqual(envelope(4));
    expect(snapshot.conflict).toEqual({
      expectedRevision: 4,
      currentRevision: 5,
      message: "revision conflict",
    });
  });

  it("stores only the secret-free provider response after an explicit credential replace", async () => {
    const before = providerEnvelope(4);
    const after = providerEnvelope(5);
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        providers: { ...state.sections.providers, envelope: before },
      },
    }));
    const save = vi
      .spyOn(configSectionsService, "putProviderSettings")
      .mockResolvedValueOnce(after);

    await useConfigSectionStore.getState().saveProviderSettings(
      before.data,
      {
        providers: {
          openai: { action: "replace", value: "plaintext-provider-secret" },
        },
      },
      4,
    );

    expect(save).toHaveBeenCalledWith(4, before.data, {
      providers: {
        openai: { action: "replace", value: "plaintext-provider-secret" },
      },
    });
    const stored = useConfigSectionStore.getState().sections.providers.envelope;
    expect(stored).toEqual(after);
    expect(JSON.stringify(stored)).not.toContain("plaintext-provider-secret");
  });

  it("does not regress providers when a save response arrives after a newer event snapshot", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        providers: { ...state.sections.providers, envelope: providerEnvelope(4) },
      },
    }));
    let resolveSave!: (value: ConfigSectionEnvelope<ProviderSection>) => void;
    vi.spyOn(configSectionsService, "putProviderSettings").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    const pending = useConfigSectionStore
      .getState()
      .saveProviderSettings(providerEnvelope(4).data, {}, 4);
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        providers: { ...state.sections.providers, envelope: providerEnvelope(6) },
      },
    }));
    resolveSave(providerEnvelope(5));

    await expect(pending).resolves.toEqual(providerEnvelope(6));
    expect(useConfigSectionStore.getState().sections.providers.envelope).toEqual(
      providerEnvelope(6),
    );
  });

  it("uses the canonical MCP save and never regresses a concurrently newer snapshot", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        mcp: { ...state.sections.mcp, envelope: mcpEnvelope(1) },
      },
    }));
    let resolveSave!: (value: ConfigSectionEnvelope<McpSection>) => void;
    const save = vi.spyOn(configSectionsService, "putMcpSettings").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const credentialChanges = {
      servers: { stdio: { env: { TOKEN: "replacement-secret" } } },
    };

    const pending = useConfigSectionStore
      .getState()
      .saveMcpSettings(mcpEnvelope(1).data, credentialChanges, 1);
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        mcp: { ...state.sections.mcp, envelope: mcpEnvelope(3) },
      },
    }));
    resolveSave(mcpEnvelope(2));

    await expect(pending).resolves.toEqual(mcpEnvelope(3));
    expect(save).toHaveBeenCalledWith(1, mcpEnvelope(1).data, credentialChanges);
    expect(useConfigSectionStore.getState().sections.mcp.envelope).toEqual(mcpEnvelope(3));
  });

  it("records a canonical MCP save conflict without replacing the cached envelope", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        mcp: { ...state.sections.mcp, envelope: mcpEnvelope(4) },
      },
    }));
    vi.spyOn(configSectionsService, "putMcpSettings").mockRejectedValueOnce(
      new ConfigConflictError({
        expectedRevision: 4,
        currentRevision: 5,
        message: "revision conflict",
      }),
    );

    await expect(
      useConfigSectionStore.getState().saveMcpSettings(mcpEnvelope(4).data, {}, 4),
    ).rejects.toThrow("revision conflict");
    expect(useConfigSectionStore.getState().sections.mcp.envelope).toEqual(mcpEnvelope(4));
    expect(useConfigSectionStore.getState().sections.mcp.conflict?.currentRevision).toBe(5);
  });

  it("adopts cluster mutation envelopes monotonically through the section store", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        "cluster-fabric": {
          ...state.sections["cluster-fabric"],
          envelope: clusterEnvelope(4),
        },
      },
    }));
    let resolveSave!: (value: { envelope: ConfigSectionEnvelope<ClusterFabricSection> }) => void;
    const save = vi.spyOn(configSectionsService, "createClusterNode").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    const pending = useConfigSectionStore.getState().saveClusterNode(null, clusterMutation, 4);
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        "cluster-fabric": {
          ...state.sections["cluster-fabric"],
          envelope: clusterEnvelope(6),
        },
      },
    }));
    resolveSave({ envelope: clusterEnvelope(5) });

    await expect(pending).resolves.toEqual({ envelope: clusterEnvelope(6) });
    expect(save).toHaveBeenCalledWith(4, clusterMutation);
    expect(useConfigSectionStore.getState().sections["cluster-fabric"].envelope).toEqual(
      clusterEnvelope(6),
    );
  });

  it("keeps the cluster LKG and records a canonical stale mutation conflict", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        "cluster-fabric": {
          ...state.sections["cluster-fabric"],
          envelope: clusterEnvelope(4),
        },
      },
    }));
    vi.spyOn(configSectionsService, "updateClusterNode").mockRejectedValueOnce(
      new ConfigConflictError({
        expectedRevision: 4,
        currentRevision: 5,
        message: "revision conflict",
      }),
    );

    await expect(
      useConfigSectionStore.getState().saveClusterNode("node-1", clusterMutation, 4),
    ).rejects.toThrow("revision conflict");
    expect(useConfigSectionStore.getState().sections["cluster-fabric"].envelope).toEqual(
      clusterEnvelope(4),
    );
    expect(
      useConfigSectionStore.getState().sections["cluster-fabric"].conflict?.currentRevision,
    ).toBe(5);
  });

  it("adopts Env and credential envelopes together without storing a mutation secret", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        env: { ...state.sections.env, envelope: envEnvelope(4) },
        credentials: {
          ...state.sections.credentials,
          envelope: credentialsEnvelope(10),
        },
      },
    }));
    const save = vi
      .spyOn(configSectionsService, "upsertEnvVar")
      .mockResolvedValueOnce(envMutationResult(5, 11));

    await useConfigSectionStore.getState().saveEnvVar(
      {
        name: "SECRET_TOKEN",
        value: "replacement-secret",
        secret: true,
      },
      4,
    );

    expect(save).toHaveBeenCalledWith(4, {
      name: "SECRET_TOKEN",
      value: "replacement-secret",
      secret: true,
    });
    expect(useConfigSectionStore.getState().sections.env.envelope).toEqual(envEnvelope(5));
    expect(useConfigSectionStore.getState().sections.credentials.envelope).toEqual(
      credentialsEnvelope(11),
    );
    expect(JSON.stringify(useConfigSectionStore.getState().sections)).not.toContain(
      "replacement-secret",
    );
  });

  it("does not regress Env or credential state behind newer event snapshots", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        env: { ...state.sections.env, envelope: envEnvelope(4) },
        credentials: {
          ...state.sections.credentials,
          envelope: credentialsEnvelope(10),
        },
      },
    }));
    let resolveSave!: (value: EnvMutationResult) => void;
    vi.spyOn(configSectionsService, "upsertEnvVar").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    const pending = useConfigSectionStore.getState().saveEnvVar(
      {
        name: "SECRET_TOKEN",
        secret: true,
      },
      4,
    );
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        env: { ...state.sections.env, envelope: envEnvelope(6) },
        credentials: {
          ...state.sections.credentials,
          envelope: credentialsEnvelope(12),
        },
      },
    }));
    resolveSave(envMutationResult(5, 11));

    await expect(pending).resolves.toEqual(envMutationResult(6, 12));
    expect(useConfigSectionStore.getState().sections.env.envelope).toEqual(envEnvelope(6));
    expect(useConfigSectionStore.getState().sections.credentials.envelope).toEqual(
      credentialsEnvelope(12),
    );
  });

  it("keeps the Env LKG and records a canonical stale mutation conflict", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        env: { ...state.sections.env, envelope: envEnvelope(4) },
      },
    }));
    vi.spyOn(configSectionsService, "deleteEnvVar").mockRejectedValueOnce(
      new ConfigConflictError({
        expectedRevision: 4,
        currentRevision: 5,
        message: "revision conflict",
      }),
    );

    await expect(useConfigSectionStore.getState().deleteEnvVar("SECRET_TOKEN", 4)).rejects.toThrow(
      "revision conflict",
    );
    expect(useConfigSectionStore.getState().sections.env.envelope).toEqual(envEnvelope(4));
    expect(useConfigSectionStore.getState().sections.env.conflict?.currentRevision).toBe(5);
  });

  it("adopts Access, credential, and runtime status together without storing passwords", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        "access-control": {
          ...state.sections["access-control"],
          envelope: accessEnvelope(4),
        },
        credentials: {
          ...state.sections.credentials,
          envelope: credentialsEnvelope(20),
        },
      },
    }));
    const replace = vi
      .spyOn(configSectionsService, "replaceAccessPassword")
      .mockResolvedValueOnce(accessMutationResult(5, 21));

    await useConfigSectionStore.getState().replaceAccessPassword(
      {
        current_password: "current-secret",
        new_password: "replacement-secret",
      },
      4,
    );

    expect(replace).toHaveBeenCalledWith(4, {
      current_password: "current-secret",
      new_password: "replacement-secret",
    });
    expect(useConfigSectionStore.getState().sections["access-control"].envelope).toEqual(
      accessEnvelope(5),
    );
    expect(useConfigSectionStore.getState().sections.credentials.envelope?.revision).toBe(21);
    expect(useConfigSectionStore.getState().accessRuntimeStatus).toEqual(
      accessMutationResult(5, 21).runtime,
    );
    expect(JSON.stringify(useConfigSectionStore.getState())).not.toContain("current-secret");
    expect(JSON.stringify(useConfigSectionStore.getState())).not.toContain("replacement-secret");
  });

  it("does not let an older Access runtime load regress a password mutation", async () => {
    let resolveRuntime!: (value: {
      password_enabled: boolean;
      local_bypass: boolean;
      requires_password: boolean;
    }) => void;
    vi.spyOn(configSectionsService, "getAccessRuntimeStatus").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRuntime = resolve;
        }),
    );
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        "access-control": {
          ...state.sections["access-control"],
          envelope: accessEnvelope(4),
        },
      },
    }));
    vi.spyOn(configSectionsService, "replaceAccessPassword").mockResolvedValueOnce(
      accessMutationResult(5, 21),
    );

    const pendingRuntime = useConfigSectionStore.getState().loadAccessRuntimeStatus({
      force: true,
    });
    await useConfigSectionStore
      .getState()
      .replaceAccessPassword({ new_password: "replacement-secret" }, 4);
    resolveRuntime({
      password_enabled: false,
      local_bypass: false,
      requires_password: false,
    });

    await expect(pendingRuntime).resolves.toEqual(accessMutationResult(5, 21).runtime);
    expect(useConfigSectionStore.getState().accessRuntimeStatus).toEqual(
      accessMutationResult(5, 21).runtime,
    );
  });

  it("keeps the Access LKG and records a canonical stale password conflict", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        "access-control": {
          ...state.sections["access-control"],
          envelope: accessEnvelope(4),
        },
      },
    }));
    vi.spyOn(configSectionsService, "replaceAccessPassword").mockRejectedValueOnce(
      new ConfigConflictError({
        expectedRevision: 4,
        currentRevision: 5,
        message: "revision conflict",
      }),
    );

    await expect(
      useConfigSectionStore
        .getState()
        .replaceAccessPassword({ new_password: "replacement-secret" }, 4),
    ).rejects.toThrow("revision conflict");
    expect(useConfigSectionStore.getState().sections["access-control"].envelope).toEqual(
      accessEnvelope(4),
    );
    expect(
      useConfigSectionStore.getState().sections["access-control"].conflict?.currentRevision,
    ).toBe(5);
  });

  it("retains notification credential metadata alongside the typed section revision", async () => {
    vi.spyOn(configSectionsService, "getSection").mockResolvedValueOnce(
      notificationEnvelope(7, 70),
    );

    await useConfigSectionStore.getState().loadSection("notifications");

    expect(useConfigSectionStore.getState().sections.notifications.envelope).toMatchObject({
      revision: 7,
      credential_revision: 70,
      credential_status: "healthy",
      credential_source: "file",
    });
  });

  it("does not regress notification or connect saves behind newer section snapshots", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        notifications: {
          ...state.sections.notifications,
          envelope: notificationEnvelope(7, 70),
        },
        connect: { ...state.sections.connect, envelope: connectEnvelope(7) },
      },
    }));
    let resolveNotifications!: (value: NotificationSectionEnvelope) => void;
    let resolveConnect!: (value: {
      envelope: ConfigSectionEnvelope<ConnectSection>;
      credentialRevision: number;
    }) => void;
    vi.spyOn(configSectionsService, "putNotifications").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNotifications = resolve;
        }),
    );
    vi.spyOn(configSectionsService, "putConnect").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveConnect = resolve;
        }),
    );

    const notificationSave = useConfigSectionStore
      .getState()
      .saveNotifications(notificationEnvelope(7, 70).data, 7);
    const connectSave = useConfigSectionStore.getState().saveConnect({ platforms: [] }, 70);
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        notifications: {
          ...state.sections.notifications,
          envelope: notificationEnvelope(9, 90),
        },
        connect: { ...state.sections.connect, envelope: connectEnvelope(9) },
      },
    }));
    resolveNotifications(notificationEnvelope(8, 80));
    resolveConnect({ envelope: connectEnvelope(8), credentialRevision: 80 });

    await expect(notificationSave).resolves.toEqual(notificationEnvelope(9, 90));
    await expect(connectSave).resolves.toEqual({
      envelope: connectEnvelope(9),
      credentialRevision: 80,
    });
    expect(useConfigSectionStore.getState().sections.notifications.envelope).toEqual(
      notificationEnvelope(9, 90),
    );
    expect(useConfigSectionStore.getState().sections.connect.envelope).toEqual(connectEnvelope(9));
  });

  it("resets a section without optimistic data replacement", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(8) },
      },
    }));
    let resolveReset!: (value: ConfigSectionEnvelope<CoreSection>) => void;
    vi.spyOn(configSectionsService, "resetSection").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReset = resolve as typeof resolveReset;
        }),
    );

    const reset = useConfigSectionStore.getState().resetSection("core", 8);
    expect(useConfigSectionStore.getState().sections.core.envelope).toEqual(envelope(8));
    expect(useConfigSectionStore.getState().sections.core.loading).toBe(true);

    resolveReset(envelope(9, {}));
    await reset;
    expect(useConfigSectionStore.getState().sections.core.envelope).toEqual(envelope(9, {}));
    expect(useConfigSectionStore.getState().sections.core.loading).toBe(false);
  });

  it("does not regress a reset response behind a newer event snapshot", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(8) },
      },
    }));
    let resolveReset!: (value: ConfigSectionEnvelope<CoreSection>) => void;
    vi.spyOn(configSectionsService, "resetSection").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveReset = resolve as typeof resolveReset;
        }),
    );

    const pending = useConfigSectionStore.getState().resetSection("core", 8);
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(10) },
      },
    }));
    resolveReset(envelope(9, {}));

    await expect(pending).resolves.toEqual(envelope(10));
    expect(useConfigSectionStore.getState().sections.core.envelope).toEqual(envelope(10));
  });

  it("keeps the last-known-good section and records a reset conflict", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(8) },
      },
    }));
    vi.spyOn(configSectionsService, "resetSection").mockRejectedValueOnce(
      new ConfigConflictError({
        expectedRevision: 8,
        currentRevision: 9,
        message: "revision conflict",
      }),
    );

    await expect(useConfigSectionStore.getState().resetSection("core", 8)).rejects.toThrow(
      "revision conflict",
    );
    expect(useConfigSectionStore.getState().sections.core.envelope).toEqual(envelope(8));
    expect(useConfigSectionStore.getState().sections.core.conflict?.currentRevision).toBe(9);
  });

  it("dedupes proxy credential status and uses its revision for replacement", async () => {
    const missing = {
      configured: false,
      credential_ref: null,
      source: null,
      updated_at: null,
      revision: 3,
      status: "healthy" as const,
      source_kind: "file",
      last_error: null,
    };
    const configured = {
      ...missing,
      configured: true,
      credential_ref: "proxy.default.auth",
      source: "user",
      revision: 4,
    };
    const load = vi.spyOn(configSectionsService, "getProxyAuthStatus").mockResolvedValue(missing);
    const replace = vi
      .spyOn(configSectionsService, "replaceProxyAuth")
      .mockResolvedValue(configured);

    const store = useConfigSectionStore.getState();
    const [first, second] = await Promise.all([
      store.loadProxyAuthStatus(),
      store.loadProxyAuthStatus(),
    ]);
    expect(first).toEqual(missing);
    expect(second).toEqual(missing);
    expect(load).toHaveBeenCalledTimes(1);

    await store.replaceProxyAuth({ username: "alice", password: "secret" });
    expect(replace).toHaveBeenCalledWith(3, { username: "alice", password: "secret" });
    expect(useConfigSectionStore.getState().proxyAuthStatus).toEqual(configured);
  });

  it("does not let a stale proxy status load regress a newer credential mutation", async () => {
    const status = (revision: number, configured: boolean) => ({
      configured,
      credential_ref: configured ? "proxy.default.auth" : null,
      source: configured ? "user" : null,
      updated_at: null,
      revision,
      status: "healthy" as const,
      source_kind: "file",
      last_error: null,
    });
    let resolveLoad!: (value: ReturnType<typeof status>) => void;
    vi.spyOn(configSectionsService, "getProxyAuthStatus").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const pending = useConfigSectionStore.getState().loadProxyAuthStatus({ force: true });
    useConfigSectionStore.setState({ proxyAuthStatus: status(4, true) });
    resolveLoad(status(3, false));

    await expect(pending).resolves.toEqual(status(4, true));
    expect(useConfigSectionStore.getState().proxyAuthStatus).toEqual(status(4, true));
  });

  it("coalesces event bursts and preserves data while invalid", async () => {
    vi.useFakeTimers();
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(1) },
      },
    }));
    const getSection = vi.spyOn(configSectionsService, "getSection").mockResolvedValue(envelope(3));

    const store = useConfigSectionStore.getState();
    store.handleConfigEvent("core", 2, "config.invalid");
    store.handleConfigEvent("core", 3, "config.recovered");

    expect(useConfigSectionStore.getState().sections.core.envelope?.data).toEqual(envelope(1).data);
    expect(useConfigSectionStore.getState().sections.core.envelope?.status).toBe("invalid");

    await vi.advanceTimersByTimeAsync(100);
    expect(getSection).toHaveBeenCalledTimes(1);
    expect(useConfigSectionStore.getState().sections.core.envelope?.revision).toBe(3);
    vi.useRealTimers();
  });

  it("retains a newer event target while a GET is in flight and retries until it converges", async () => {
    vi.useFakeTimers();
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(1) },
      },
    }));
    let resolveFirst!: (value: ConfigSectionEnvelope<CoreSection>) => void;
    const getSection = vi
      .spyOn(configSectionsService, "getSection")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve as typeof resolveFirst;
          }),
      )
      .mockResolvedValueOnce(envelope(3));

    const initialRefresh = useConfigSectionStore.getState().loadSection("core", { force: true });
    useConfigSectionStore.getState().handleConfigEvent("core", 3, "config.changed");
    await vi.advanceTimersByTimeAsync(80);
    expect(getSection).toHaveBeenCalledTimes(1);

    resolveFirst(envelope(2));
    await initialRefresh;
    await vi.advanceTimersByTimeAsync(0);
    expect(useConfigSectionStore.getState().sections.core.envelope?.revision).toBe(2);

    await vi.advanceTimersByTimeAsync(999);
    expect(getSection).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(getSection).toHaveBeenCalledTimes(2);
    expect(useConfigSectionStore.getState().sections.core.envelope?.revision).toBe(3);
    vi.useRealTimers();
  });

  it("surfaces partial reconnect resync failures and remains retryable", async () => {
    useConfigSectionStore.setState((state) => ({
      sections: {
        ...state.sections,
        core: { ...state.sections.core, envelope: envelope(1) },
        hooks: { ...state.sections.hooks, envelope: envelope(1) as never },
      },
    }));
    const getSection = vi
      .spyOn(configSectionsService, "getSection")
      .mockImplementation(async (section) => {
        if (section === "core") throw new Error("redacted core refresh failure");
        return envelope(2) as never;
      });

    await expect(useConfigSectionStore.getState().resyncLoadedSections()).rejects.toThrow(
      "Failed to resync configuration sections: core",
    );
    expect(useConfigSectionStore.getState().sections.core.envelope?.revision).toBe(1);
    expect(useConfigSectionStore.getState().sections.core.error).toBe(
      "redacted core refresh failure",
    );
    expect(useConfigSectionStore.getState().sections.hooks.envelope?.revision).toBe(2);

    getSection.mockResolvedValue(envelope(3) as never);
    await expect(useConfigSectionStore.getState().resyncLoadedSections()).resolves.toBeUndefined();
    expect(useConfigSectionStore.getState().sections.core.envelope?.revision).toBe(3);
    expect(useConfigSectionStore.getState().sections.core.error).toBeNull();
  });
});
