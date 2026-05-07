import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROXY_AUTH_STORAGE_KEY = "bamboo_proxy_auth";

const createDeferred = <T>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const loadStoreContext = async () => {
  vi.resetModules();

  const storeModule = await import("../index");
  const { AgentClient } = await import("../../services/AgentService");
  const { serviceFactory } = await import("../../../../services/common/ServiceFactory");
  const { useBambooConfigStore } = await import("../../../../shared/stores/bambooConfigStore");

  return {
    ...storeModule,
    AgentClient,
    serviceFactory,
    useBambooConfigStore,
  };
};

describe("store/index bootstrap and scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("deduplicates in-flight health checks and updates availability", async () => {
    const { useAppStore, AgentClient } = await loadStoreContext();
    const client = AgentClient.getInstance();
    const deferred = createDeferred<boolean>();
    const healthCheckSpy = vi.spyOn(client, "healthCheck").mockReturnValue(deferred.promise);

    const first = useAppStore.getState().checkAgentAvailability();
    const second = useAppStore.getState().checkAgentAvailability();

    expect(healthCheckSpy).toHaveBeenCalledTimes(1);

    deferred.resolve(true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(useAppStore.getState().agentAvailability).toBe(true);
  });

  it("startAgentHealthCheck schedules only one polling interval", async () => {
    vi.useFakeTimers();
    const { useAppStore } = await loadStoreContext();
    const checkSpy = vi.fn().mockResolvedValue(true);
    useAppStore.setState({ checkAgentAvailability: checkSpy } as any);

    useAppStore.getState().startAgentHealthCheck();
    useAppStore.getState().startAgentHealthCheck();
    expect(checkSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(checkSpy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(checkSpy).toHaveBeenCalledTimes(3);
  });

  it("deduplicates in-flight sessions index refresh", async () => {
    const { useAppStore } = await loadStoreContext();
    const deferred = createDeferred<void>();
    const refreshChatsSpy = vi.fn().mockReturnValue(deferred.promise);
    useAppStore.setState({ refreshChats: refreshChatsSpy } as any);

    const first = useAppStore.getState().refreshSessionsIndex();
    const second = useAppStore.getState().refreshSessionsIndex();

    expect(refreshChatsSpy).toHaveBeenCalledTimes(1);

    deferred.resolve(undefined);
    await Promise.all([first, second]);

    await useAppStore.getState().refreshSessionsIndex();
    expect(refreshChatsSpy).toHaveBeenCalledTimes(2);
  });

  it("refreshSessionsIndex swallows refresh errors as best effort", async () => {
    const { useAppStore } = await loadStoreContext();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const refreshChatsSpy = vi.fn().mockRejectedValue(new Error("backend temporarily unavailable"));
    useAppStore.setState({ refreshChats: refreshChatsSpy } as any);

    await expect(useAppStore.getState().refreshSessionsIndex()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith("[AppStore] refreshChats failed:", expect.any(Error));
  });

  it("refreshChatsNow forces one follow-up refresh after an in-flight refresh settles", async () => {
    const { useAppStore, AgentClient } = await loadStoreContext();
    const client = AgentClient.getInstance();
    const first = createDeferred<any>();

    const listSessionsSpy = vi
      .spyOn(client, "listSessions")
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ sessions: [] } as any);

    const inFlight = useAppStore.getState().refreshChats();
    const forced = useAppStore.getState().refreshChatsNow();

    expect(listSessionsSpy).toHaveBeenCalledTimes(1);

    first.resolve({ sessions: [] } as any);
    await Promise.all([inFlight, forced]);

    expect(listSessionsSpy).toHaveBeenCalledTimes(2);
  });

  it("startSessionsIndexSync schedules one timer and triggers immediate refresh", async () => {
    vi.useFakeTimers();
    const { useAppStore } = await loadStoreContext();
    const refreshSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({ refreshSessionsIndex: refreshSpy } as any);

    useAppStore.getState().startSessionsIndexSync();
    useAppStore.getState().startSessionsIndexSync();
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(refreshSpy).toHaveBeenCalledTimes(2);
  });

  it("refreshChats preserves newer local session model when remote summary is stale", async () => {
    const { useAppStore, AgentClient } = await loadStoreContext();
    const client = AgentClient.getInstance();
    vi.spyOn(client, "listSessions").mockResolvedValue({
      sessions: [
        {
          id: "session-1",
          kind: "root",
          title: "New Session",
          pinned: false,
          parent_session_id: null,
          root_session_id: "session-1",
          spawn_depth: 0,
          model: "gpt-global-default",
          reasoning_effort: "medium",
          created_by_schedule_id: null,
          created_at: "2026-03-31T15:00:00.000Z",
          updated_at: "2026-03-31T15:00:00.000Z",
          last_activity_at: "2026-03-31T15:00:00.000Z",
          message_count: 0,
          has_attachments: false,
          is_running: false,
          last_run_status: undefined,
          last_run_error: undefined,
          token_usage: undefined,
        },
      ],
    });

    useAppStore.setState({
      chats: [
        {
          id: "session-1",
          kind: "root",
          rootSessionId: "session-1",
          spawnDepth: 0,
          createdByScheduleId: null,
          isRunning: false,
          updatedAt: "2026-03-31T15:00:01.500Z",
          lastActivityAt: "2026-03-31T15:00:00.000Z",
          messageCount: 0,
          hasAttachments: false,
          lastRunStatus: undefined,
          lastRunError: undefined,
          title: "New Session",
          createdAt: Date.now(),
          pinned: false,
          messages: [],
          config: {
            systemPromptId: "general_assistant",
            baseSystemPrompt: "",
            lastUsedEnhancedPrompt: null,
            model: "gpt-session-specific",
            reasoningEffort: "high",
            compressionEvents: [],
          },
          currentInteraction: null,
        },
      ],
      currentSessionId: "session-1",
    } as any);

    await useAppStore.getState().refreshChats();

    const chat = useAppStore.getState().chats.find((item) => item.id === "session-1");
    expect(chat?.config.model).toBe("gpt-session-specific");
    expect(chat?.config.reasoningEffort).toBe("high");
    expect(chat?.updatedAt).toBe("2026-03-31T15:00:01.500Z");
  });

  it("staged bootstrap applies stored proxy auth in auto mode and returns early when already initialized", async () => {
    const {
      bootstrapCritical,
      bootstrapDeferred,
      useAppStore,
      serviceFactory,
      useBambooConfigStore,
    } = await loadStoreContext();
    const startAgentHealthCheckSpy = vi.fn();
    const startSessionsIndexSyncSpy = vi.fn();
    const loadChatsSpy = vi.fn().mockResolvedValue(undefined);
    const fetchModelsSpy = vi.fn().mockResolvedValue(undefined);
    const loadSystemPromptsSpy = vi.fn().mockResolvedValue(undefined);

    useAppStore.setState({
      startAgentHealthCheck: startAgentHealthCheckSpy,
      startSessionsIndexSync: startSessionsIndexSyncSpy,
      loadChats: loadChatsSpy,
      fetchModels: fetchModelsSpy,
      loadSystemPrompts: loadSystemPromptsSpy,
    } as any);

    const loadConfigSpy = vi.fn().mockResolvedValue({ proxy_auth_mode: "auto" });
    const loadProxyAuthStatusSpy = vi.fn().mockResolvedValue({ configured: false, username: null });
    useBambooConfigStore.setState({
      loadConfig: loadConfigSpy,
      loadProxyAuthStatus: loadProxyAuthStatusSpy,
    } as any);

    localStorage.setItem(
      PROXY_AUTH_STORAGE_KEY,
      JSON.stringify({ username: "alice", password: "secret" }),
    );
    const setProxyAuthSpy = vi
      .spyOn(serviceFactory, "setProxyAuth")
      .mockResolvedValue({ success: true });

    await bootstrapCritical(true);
    await bootstrapDeferred();
    await bootstrapCritical();

    expect(setProxyAuthSpy).toHaveBeenCalledWith({
      username: "alice",
      password: "secret",
    });
    expect(loadProxyAuthStatusSpy).not.toHaveBeenCalled();
    expect(loadChatsSpy).toHaveBeenCalledTimes(1);
    expect(fetchModelsSpy).toHaveBeenCalledTimes(1);
    expect(loadSystemPromptsSpy).toHaveBeenCalledTimes(1);
    expect(startAgentHealthCheckSpy).not.toHaveBeenCalled();
    expect(startSessionsIndexSyncSpy).not.toHaveBeenCalled();
  });

  it("staged bootstrap does not gate model bootstrap when required mode is already configured", async () => {
    const {
      bootstrapCritical,
      bootstrapDeferred,
      useAppStore,
      serviceFactory,
      useBambooConfigStore,
    } = await loadStoreContext();
    const loadChatsSpy = vi.fn().mockResolvedValue(undefined);
    const fetchModelsSpy = vi.fn().mockResolvedValue(undefined);
    const loadSystemPromptsSpy = vi.fn().mockResolvedValue(undefined);

    useAppStore.setState({
      loadChats: loadChatsSpy,
      fetchModels: fetchModelsSpy,
      loadSystemPrompts: loadSystemPromptsSpy,
    } as any);

    const loadConfigSpy = vi.fn().mockResolvedValue({ proxy_auth_mode: "required" });
    const loadProxyAuthStatusSpy = vi
      .fn()
      .mockResolvedValue({ configured: true, username: "user" });
    useBambooConfigStore.setState({
      loadConfig: loadConfigSpy,
      loadProxyAuthStatus: loadProxyAuthStatusSpy,
    } as any);
    const setProxyAuthSpy = vi.spyOn(serviceFactory, "setProxyAuth");

    await bootstrapCritical(true);
    await bootstrapDeferred();

    expect(loadConfigSpy).toHaveBeenCalledTimes(1);
    expect(loadProxyAuthStatusSpy).toHaveBeenCalledWith({ force: true });
    expect(setProxyAuthSpy).not.toHaveBeenCalled();
    expect(loadChatsSpy).toHaveBeenCalledTimes(1);
    expect(fetchModelsSpy).toHaveBeenCalledTimes(1);
    expect(loadSystemPromptsSpy).toHaveBeenCalledTimes(1);
  });

  it("staged bootstrap gates models when required mode has no configured or stored auth", async () => {
    const {
      bootstrapCritical,
      bootstrapDeferred,
      useAppStore,
      serviceFactory,
      useBambooConfigStore,
    } = await loadStoreContext();
    const loadChatsSpy = vi.fn().mockResolvedValue(undefined);
    const fetchModelsSpy = vi.fn().mockResolvedValue(undefined);
    const loadSystemPromptsSpy = vi.fn().mockResolvedValue(undefined);

    useAppStore.setState({
      loadChats: loadChatsSpy,
      fetchModels: fetchModelsSpy,
      loadSystemPrompts: loadSystemPromptsSpy,
      models: ["existing-model"] as any,
      selectedModel: "existing-model" as any,
      modelsError: undefined,
      isLoadingModels: true,
    } as any);

    const loadConfigSpy = vi.fn().mockResolvedValue({ proxy_auth_mode: "required" });
    const loadProxyAuthStatusSpy = vi.fn().mockResolvedValue({ configured: false, username: null });
    useBambooConfigStore.setState({
      loadConfig: loadConfigSpy,
      loadProxyAuthStatus: loadProxyAuthStatusSpy,
    } as any);
    const setProxyAuthSpy = vi.spyOn(serviceFactory, "setProxyAuth");

    await bootstrapCritical(true);
    await bootstrapDeferred();

    expect(loadConfigSpy).toHaveBeenCalledTimes(1);
    expect(loadProxyAuthStatusSpy).toHaveBeenCalledWith({ force: true });
    expect(setProxyAuthSpy).not.toHaveBeenCalled();
    expect(fetchModelsSpy).not.toHaveBeenCalled();
    expect(useAppStore.getState().models).toEqual([]);
    expect(useAppStore.getState().selectedModel).toBeUndefined();
    expect(useAppStore.getState().isLoadingModels).toBe(false);
    expect(useAppStore.getState().modelsError).toContain("Proxy auth mode is set to required");
    expect(loadChatsSpy).toHaveBeenCalledTimes(1);
    expect(loadSystemPromptsSpy).toHaveBeenCalledTimes(1);
  });

  it("staged bootstrap applies stored auth in required mode and continues bootstrap", async () => {
    const {
      bootstrapCritical,
      bootstrapDeferred,
      useAppStore,
      serviceFactory,
      useBambooConfigStore,
    } = await loadStoreContext();
    const loadChatsSpy = vi.fn().mockResolvedValue(undefined);
    const fetchModelsSpy = vi.fn().mockResolvedValue(undefined);
    const loadSystemPromptsSpy = vi.fn().mockResolvedValue(undefined);

    useAppStore.setState({
      loadChats: loadChatsSpy,
      fetchModels: fetchModelsSpy,
      loadSystemPrompts: loadSystemPromptsSpy,
      modelsError: undefined,
    } as any);

    useBambooConfigStore.setState({
      loadConfig: vi.fn().mockResolvedValue({ proxy_auth_mode: "required" }),
      loadProxyAuthStatus: vi.fn().mockResolvedValue({ configured: false, username: null }),
    } as any);

    localStorage.setItem(
      PROXY_AUTH_STORAGE_KEY,
      JSON.stringify({ username: "alice", password: "secret" }),
    );
    const setProxyAuthSpy = vi
      .spyOn(serviceFactory, "setProxyAuth")
      .mockResolvedValue({ success: true });

    await bootstrapCritical(true);
    await bootstrapDeferred();

    expect(setProxyAuthSpy).toHaveBeenCalledWith({
      username: "alice",
      password: "secret",
    });
    expect(fetchModelsSpy).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().modelsError).toBeUndefined();
    expect(loadChatsSpy).toHaveBeenCalledTimes(1);
    expect(loadSystemPromptsSpy).toHaveBeenCalledTimes(1);
  });

  it("staged bootstrap logs and continues when applying stored auth fails", async () => {
    const {
      bootstrapCritical,
      bootstrapDeferred,
      useAppStore,
      serviceFactory,
      useBambooConfigStore,
    } = await loadStoreContext();
    const loadChatsSpy = vi.fn().mockResolvedValue(undefined);
    const fetchModelsSpy = vi.fn().mockResolvedValue(undefined);
    const loadSystemPromptsSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      loadChats: loadChatsSpy,
      fetchModels: fetchModelsSpy,
      loadSystemPrompts: loadSystemPromptsSpy,
    } as any);
    useBambooConfigStore.setState({
      loadConfig: vi.fn().mockResolvedValue({ proxy_auth_mode: "auto" }),
      loadProxyAuthStatus: vi.fn(),
    } as any);

    localStorage.setItem(
      PROXY_AUTH_STORAGE_KEY,
      JSON.stringify({ username: "alice", password: "secret" }),
    );
    vi.spyOn(serviceFactory, "setProxyAuth").mockRejectedValue(new Error("boom"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await bootstrapCritical(true);
    await bootstrapDeferred();

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to apply stored proxy auth during startup:",
      expect.any(Error),
    );
    expect(loadChatsSpy).toHaveBeenCalledTimes(1);
    expect(fetchModelsSpy).toHaveBeenCalledTimes(1);
    expect(loadSystemPromptsSpy).toHaveBeenCalledTimes(1);
  });

  it("staged bootstrap logs gate evaluation failures and still loads models", async () => {
    const { bootstrapCritical, bootstrapDeferred, useAppStore, useBambooConfigStore } =
      await loadStoreContext();
    const loadChatsSpy = vi.fn().mockResolvedValue(undefined);
    const fetchModelsSpy = vi.fn().mockResolvedValue(undefined);
    const loadSystemPromptsSpy = vi.fn().mockResolvedValue(undefined);
    useAppStore.setState({
      loadChats: loadChatsSpy,
      fetchModels: fetchModelsSpy,
      loadSystemPrompts: loadSystemPromptsSpy,
    } as any);
    useBambooConfigStore.setState({
      loadConfig: vi.fn().mockRejectedValue(new Error("config unavailable")),
      loadProxyAuthStatus: vi.fn(),
    } as any);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await bootstrapCritical(true);
    await bootstrapDeferred();

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to evaluate startup proxy auth mode:",
      expect.any(Error),
    );
    expect(loadChatsSpy).toHaveBeenCalledTimes(1);
    expect(fetchModelsSpy).toHaveBeenCalledTimes(1);
    expect(loadSystemPromptsSpy).toHaveBeenCalledTimes(1);
  });

  it("staged bootstrap starts periodic checks outside test mode", async () => {
    vi.stubEnv("MODE", "development");
    const { bootstrapCritical, bootstrapDeferred, useAppStore, useBambooConfigStore } =
      await loadStoreContext();
    const startAgentHealthCheckSpy = vi.fn();
    const startSessionsIndexSyncSpy = vi.fn();
    const loadChatsSpy = vi.fn().mockResolvedValue(undefined);
    const fetchModelsSpy = vi.fn().mockResolvedValue(undefined);
    const loadSystemPromptsSpy = vi.fn().mockResolvedValue(undefined);

    useAppStore.setState({
      startAgentHealthCheck: startAgentHealthCheckSpy,
      startSessionsIndexSync: startSessionsIndexSyncSpy,
      loadChats: loadChatsSpy,
      fetchModels: fetchModelsSpy,
      loadSystemPrompts: loadSystemPromptsSpy,
    } as any);
    useBambooConfigStore.setState({
      loadConfig: vi.fn().mockResolvedValue({ proxy_auth_mode: "auto" }),
      loadProxyAuthStatus: vi.fn(),
    } as any);

    await bootstrapCritical(true);
    await bootstrapDeferred();

    expect(startAgentHealthCheckSpy).toHaveBeenCalledTimes(1);
    // A low-frequency self-healing session index sync now complements event-driven updates.
    expect(startSessionsIndexSyncSpy).toHaveBeenCalledTimes(1);
    expect(loadChatsSpy).toHaveBeenCalledTimes(1);
    expect(fetchModelsSpy).toHaveBeenCalledTimes(1);
    expect(loadSystemPromptsSpy).toHaveBeenCalledTimes(1);
  });
});
