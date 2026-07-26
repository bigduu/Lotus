import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConfigConflictError,
  configSectionsService,
  type ConfigSectionEnvelope,
  type CoreSection,
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
