import { act } from "@testing-library/react";
import { useProviderStore } from "../providerSlice";
import { settingsService } from "@services/config/SettingsService";
import type { ProviderConfig } from "../../../types/providerConfig";
import type { ProviderModelRef } from "../../../types/providerModelRef";

vi.mock("@services/config/SettingsService", () => ({
  settingsService: {
    getProviderConfig: vi.fn(),
    getProviderInstances: vi.fn(),
  },
}));

const modelRef = (provider: string, model: string): ProviderModelRef => ({ provider, model });

const defaults = (
  provider: string,
  model: string,
  extra: Partial<NonNullable<ProviderConfig["defaults"]>> = {},
): NonNullable<ProviderConfig["defaults"]> => ({
  chat: modelRef(provider, model),
  ...extra,
});

describe("providerSlice", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    useProviderStore.setState({
      currentProvider: "copilot",
      providerConfig: {
        provider: "copilot",
        providers: {},
      },
      providerInstances: [],
      defaultProviderInstanceId: null,
      isInstancesLoaded: false,
      isLoading: false,
      error: null,
      selectedModelRef: null,
      catalog: null,
      isCatalogFetching: false,
    });
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("Initial State", () => {
    it("should have correct initial state", () => {
      const state = useProviderStore.getState();
      expect(state.currentProvider).toBe("copilot");
      expect(state.providerConfig).toEqual({
        provider: "copilot",
        providers: {},
      });
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe("loadProviderConfig", () => {
    it("should load provider config successfully", async () => {
      const mockConfig: ProviderConfig = {
        provider: "anthropic",
        defaults: defaults("anthropic", "claude-3"),
        providers: {
          anthropic: {
            api_key: "test-key",
          },
        },
      };
      vi.mocked(settingsService.getProviderConfig).mockResolvedValueOnce(mockConfig);

      await act(async () => {
        await useProviderStore.getState().loadProviderConfig();
      });

      const state = useProviderStore.getState();
      expect(state.providerConfig).toEqual(mockConfig);
      expect(state.currentProvider).toBe("anthropic");
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("should set loading state while loading", async () => {
      vi.mocked(settingsService.getProviderConfig).mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  provider: "copilot",
                  providers: {},
                }),
              100,
            ),
          ),
      );

      const promise = act(async () => useProviderStore.getState().loadProviderConfig());

      expect(useProviderStore.getState().isLoading).toBe(true);
      await promise;
      expect(useProviderStore.getState().isLoading).toBe(false);
    });

    it("should handle load errors", async () => {
      const error = new Error("Network error");
      vi.mocked(settingsService.getProviderConfig).mockRejectedValueOnce(error);

      await act(async () => {
        await useProviderStore.getState().loadProviderConfig();
      });

      const state = useProviderStore.getState();
      expect(state.error).toBe("Network error");
      expect(state.isLoading).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to load provider config:", error);
    });

    it("should handle non-Error errors", async () => {
      vi.mocked(settingsService.getProviderConfig).mockRejectedValueOnce("string error");

      await act(async () => {
        await useProviderStore.getState().loadProviderConfig();
      });

      const state = useProviderStore.getState();
      expect(state.error).toBe("Failed to load provider config");
      expect(state.isLoading).toBe(false);
    });

    it("should clear error on successful load", async () => {
      useProviderStore.setState({ error: "Previous error" });

      const mockConfig: ProviderConfig = {
        provider: "openai",
        defaults: defaults("openai", "gpt-4"),
        providers: {
          openai: {
            api_key: "key",
          },
        },
      };
      vi.mocked(settingsService.getProviderConfig).mockResolvedValueOnce(mockConfig);

      await act(async () => {
        await useProviderStore.getState().loadProviderConfig();
      });

      expect(useProviderStore.getState().error).toBeNull();
    });

    it("should update currentProvider from config", async () => {
      const mockConfig: ProviderConfig = {
        provider: "openai",
        defaults: defaults("openai", "gpt-4o"),
        providers: {
          openai: {
            api_key: "test",
          },
        },
      };
      vi.mocked(settingsService.getProviderConfig).mockResolvedValueOnce(mockConfig);

      await act(async () => {
        await useProviderStore.getState().loadProviderConfig();
      });

      expect(useProviderStore.getState().currentProvider).toBe("openai");
    });
  });

  describe("setCurrentProvider", () => {
    it("should update current provider", () => {
      act(() => {
        useProviderStore.getState().setCurrentProvider("anthropic");
      });

      expect(useProviderStore.getState().currentProvider).toBe("anthropic");
    });

    it("should update to openai provider", () => {
      act(() => {
        useProviderStore.getState().setCurrentProvider("openai");
      });

      expect(useProviderStore.getState().currentProvider).toBe("openai");
    });

    it("should update to copilot provider", () => {
      useProviderStore.setState({ currentProvider: "anthropic" });

      act(() => {
        useProviderStore.getState().setCurrentProvider("copilot");
      });

      expect(useProviderStore.getState().currentProvider).toBe("copilot");
    });
  });

  describe("updateProviderConfig", () => {
    it("should merge partial config and preserve defaults", () => {
      const initialConfig: ProviderConfig = {
        provider: "copilot",
        defaults: defaults("copilot", "gpt-4"),
        providers: {
          copilot: {
            headless_auth: true,
          },
        },
      };
      useProviderStore.setState({ providerConfig: initialConfig });

      act(() => {
        useProviderStore.getState().updateProviderConfig({
          provider: "anthropic",
        });
      });

      const state = useProviderStore.getState();
      expect(state.providerConfig.provider).toBe("anthropic");
      expect(state.providerConfig.defaults).toEqual(defaults("copilot", "gpt-4"));
      expect(state.providerConfig.providers).toEqual({
        copilot: { headless_auth: true },
      });
    });

    it("should update providers object", () => {
      act(() => {
        useProviderStore.getState().updateProviderConfig({
          providers: {
            openai: {
              api_key: "new-key",
            },
          },
        });
      });

      expect(useProviderStore.getState().providerConfig.providers).toEqual({
        openai: {
          api_key: "new-key",
        },
      });
    });

    it("should preserve existing config when updating", () => {
      const initialConfig: ProviderConfig = {
        provider: "anthropic",
        defaults: defaults("anthropic", "claude-3"),
        providers: {
          anthropic: {
            api_key: "key1",
          },
        },
      };
      useProviderStore.setState({ providerConfig: initialConfig });

      act(() => {
        useProviderStore.getState().updateProviderConfig({
          provider: "openai",
        });
      });

      const state = useProviderStore.getState();
      expect(state.providerConfig.provider).toBe("openai");
      expect(state.providerConfig.defaults).toEqual(defaults("anthropic", "claude-3"));
      expect(state.providerConfig.providers).toEqual({
        anthropic: {
          api_key: "key1",
        },
      });
    });
  });

  describe("getActiveModel", () => {
    it("should return default chat model", () => {
      const config: ProviderConfig = {
        provider: "anthropic",
        defaults: defaults("anthropic", "claude-3-opus"),
        providers: {
          anthropic: {
            api_key: "test",
          },
        },
      };
      useProviderStore.setState({
        currentProvider: "anthropic",
        providerConfig: config,
      });

      expect(useProviderStore.getState().getActiveModel()).toBe("claude-3-opus");
    });

    it("should return undefined when defaults are missing", () => {
      useProviderStore.setState({
        currentProvider: "anthropic",
        providerConfig: {
          provider: "anthropic",
          providers: {},
        },
      });

      expect(useProviderStore.getState().getActiveModel()).toBeUndefined();
    });

    it("should read defaults even when currentProvider differs", () => {
      const config: ProviderConfig = {
        provider: "copilot",
        defaults: defaults("anthropic", "claude-3-sonnet"),
        providers: {
          anthropic: {
            api_key: "key",
          },
          openai: {
            api_key: "key",
          },
        },
      };
      useProviderStore.setState({
        currentProvider: "openai",
        providerConfig: config,
      });

      expect(useProviderStore.getState().getActiveModel()).toBe("claude-3-sonnet");
    });
  });

  describe("isProviderModelRefEnabled", () => {
    it("should always return true (catalog mode is always enabled)", () => {
      useProviderStore.setState({
        providerConfig: { provider: "copilot", providers: {} },
      });
      expect(useProviderStore.getState().isProviderModelRefEnabled()).toBe(true);
    });
  });

  describe("setSelectedModelRef", () => {
    it("should set selected model ref", () => {
      const ref = { provider: "openai", model: "gpt-4o" };
      useProviderStore.getState().setSelectedModelRef(ref);
      expect(useProviderStore.getState().selectedModelRef).toEqual(ref);
    });

    it("should clear selected model ref with null", () => {
      useProviderStore.getState().setSelectedModelRef({ provider: "openai", model: "gpt-4o" });
      useProviderStore.getState().setSelectedModelRef(null);
      expect(useProviderStore.getState().selectedModelRef).toBeNull();
    });
  });

  describe("getFastModelRef", () => {
    it("should return fast model ref", () => {
      useProviderStore.setState({
        currentProvider: "openai",
        providerConfig: {
          provider: "openai",
          defaults: defaults("openai", "gpt-4o", {
            fast: modelRef("openai", "gpt-4o-mini"),
          }),
          providers: { openai: { api_key: "k" } },
        },
      });
      expect(useProviderStore.getState().getFastModelRef()).toEqual({
        provider: "openai",
        model: "gpt-4o-mini",
      });
    });

    it("should fallback to active model when no fast model is configured", () => {
      useProviderStore.setState({
        currentProvider: "anthropic",
        providerConfig: {
          provider: "anthropic",
          defaults: defaults("anthropic", "claude-3"),
          providers: { anthropic: { api_key: "k" } },
        },
      });
      expect(useProviderStore.getState().getFastModelRef()).toEqual({
        provider: "anthropic",
        model: "claude-3",
      });
    });
  });

  describe("getVisionModelRef", () => {
    it("should return vision model ref", () => {
      useProviderStore.setState({
        currentProvider: "openai",
        providerConfig: {
          provider: "openai",
          defaults: defaults("openai", "gpt-4o", {
            vision: modelRef("openai", "gpt-4o-vision"),
          }),
          providers: { openai: { api_key: "k" } },
        },
      });
      expect(useProviderStore.getState().getVisionModelRef()).toEqual({
        provider: "openai",
        model: "gpt-4o-vision",
      });
    });

    it("should fallback to chat model when no vision model is configured", () => {
      useProviderStore.setState({
        currentProvider: "openai",
        providerConfig: {
          provider: "openai",
          defaults: defaults("openai", "gpt-4o"),
          providers: { openai: { api_key: "k" } },
        },
      });
      expect(useProviderStore.getState().getVisionModelRef()).toEqual({
        provider: "openai",
        model: "gpt-4o",
      });
    });
  });

  describe("loadProviderInstances", () => {
    it("should load provider instances successfully", async () => {
      const mockResponse = {
        default_provider_instance_id: "inst-openai-1",
        instances: [
          {
            id: "inst-openai-1",
            type: "openai" as const,
            label: "My OpenAI",
            enabled: true,
            config: { api_key: "sk-test" },
          },
          {
            id: "inst-anthropic-1",
            type: "anthropic" as const,
            label: "My Anthropic",
            enabled: true,
            config: { api_key: "sk-ant-test" },
          },
        ],
        defaults: {
          chat: { provider: "inst-openai-1", model: "gpt-4o" },
        },
      };
      vi.mocked(settingsService.getProviderInstances).mockResolvedValueOnce(mockResponse);

      await act(async () => {
        await useProviderStore.getState().loadProviderInstances();
      });

      const state = useProviderStore.getState();
      expect(state.providerInstances).toHaveLength(2);
      expect(state.providerInstances[0].id).toBe("inst-openai-1");
      expect(state.defaultProviderInstanceId).toBe("inst-openai-1");
      expect(state.currentProvider).toBe("inst-openai-1");
      expect(state.isInstancesLoaded).toBe(true);
      expect(state.isLoading).toBe(false);
    });

    it("should build legacy-compatible providerConfig from instances", async () => {
      const mockResponse = {
        default_provider_instance_id: "inst-1",
        instances: [
          {
            id: "inst-1",
            type: "openai" as const,
            label: "Test",
            enabled: true,
            config: { api_key: "sk-test", base_url: "https://example.com" },
          },
        ],
        defaults: {
          chat: { provider: "inst-1", model: "gpt-4o" },
        },
      };
      vi.mocked(settingsService.getProviderInstances).mockResolvedValueOnce(mockResponse);

      await act(async () => {
        await useProviderStore.getState().loadProviderInstances();
      });

      const state = useProviderStore.getState();
      // providerConfig.providers should map instance id → config
      expect(state.providerConfig.provider).toBe("inst-1");
      expect(state.providerConfig.defaults?.chat).toEqual({ provider: "inst-1", model: "gpt-4o" });
    });

    it("should handle load errors gracefully", async () => {
      const error = new Error("Instance API not available");
      vi.mocked(settingsService.getProviderInstances).mockRejectedValueOnce(error);

      await act(async () => {
        await useProviderStore.getState().loadProviderInstances();
      });

      const state = useProviderStore.getState();
      expect(state.error).toBe("Instance API not available");
      expect(state.isInstancesLoaded).toBe(false);
      expect(state.isLoading).toBe(false);
    });

    it("should handle empty instances list", async () => {
      vi.mocked(settingsService.getProviderInstances).mockResolvedValueOnce({
        instances: [],
      });

      await act(async () => {
        await useProviderStore.getState().loadProviderInstances();
      });

      const state = useProviderStore.getState();
      expect(state.providerInstances).toEqual([]);
      expect(state.defaultProviderInstanceId).toBeNull();
      expect(state.isInstancesLoaded).toBe(true);
    });
  });

  describe("getProviderInstance", () => {
    it("should find instance by id", () => {
      useProviderStore.setState({
        providerInstances: [
          { id: "a", type: "openai", label: "A", enabled: true, config: {} },
          { id: "b", type: "anthropic", label: "B", enabled: true, config: {} },
        ],
      });

      expect(useProviderStore.getState().getProviderInstance("a")?.label).toBe("A");
      expect(useProviderStore.getState().getProviderInstance("b")?.label).toBe("B");
      expect(useProviderStore.getState().getProviderInstance("c")).toBeUndefined();
    });
  });
});
