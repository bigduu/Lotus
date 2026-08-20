import { act } from "@testing-library/react";
import { useProviderStore } from "../providerSlice";
import type { ProviderConfig } from "@shared/types/providerConfig";
import type { ProviderModelRef } from "@shared/types/providerModelRef";
import type { ConfigSectionEnvelope, ProviderSection } from "@services/config/configSections";

const { loadSectionMock } = vi.hoisted(() => ({
  loadSectionMock: vi.fn(),
}));

vi.mock("@shared/store/configSectionStore", () => ({
  useConfigSectionStore: {
    getState: () => ({ loadSection: loadSectionMock }),
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

const providerEnvelope = (
  data: Partial<ProviderSection> = {},
  revision = 1,
): ConfigSectionEnvelope<ProviderSection> => ({
  data: {
    provider: "copilot",
    providers: {},
    defaults: null,
    features: {},
    provider_instances: {},
    default_provider_instance_id: null,
    available_providers: ["copilot", "openai", "anthropic", "gemini", "bodhi"],
    credential_status: { providers: {}, provider_instances: {} },
    ...data,
  },
  revision,
  loaded_at: "2026-07-24T00:00:00Z",
  source_path: "/tmp/providers.json",
  source_kind: "file",
  status: "healthy",
  last_error: null,
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
      loadSectionMock.mockResolvedValueOnce(
        providerEnvelope({
          defaults: mockResponse.defaults,
          provider_instances: {
            "inst-openai-1": {
              provider_type: "openai",
              label: "My OpenAI",
              enabled: true,
            },
            "inst-anthropic-1": {
              provider_type: "anthropic",
              label: "My Anthropic",
              enabled: true,
            },
          },
          default_provider_instance_id: "inst-openai-1",
        }),
      );

      await act(async () => {
        await useProviderStore.getState().loadProviderInstances();
      });

      const state = useProviderStore.getState();
      expect(state.providerInstances).toHaveLength(2);
      expect(state.providerInstances.map((instance) => instance.id)).toEqual(
        expect.arrayContaining(["inst-openai-1", "inst-anthropic-1"]),
      );
      expect(state.defaultProviderInstanceId).toBe("inst-openai-1");
      expect(state.currentProvider).toBe("inst-openai-1");
      expect(state.isLoading).toBe(false);
      expect(JSON.stringify(state.providerInstances)).not.toContain("sk-");
    });

    it("should build normalized providerConfig from instances", async () => {
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
      loadSectionMock.mockResolvedValueOnce(
        providerEnvelope({
          defaults: mockResponse.defaults,
          provider_instances: {
            "inst-1": {
              provider_type: "openai",
              label: "Test",
              enabled: true,
              base_url: "https://example.com",
            },
          },
          default_provider_instance_id: "inst-1",
        }),
      );

      await act(async () => {
        await useProviderStore.getState().loadProviderInstances();
      });

      const state = useProviderStore.getState();
      // providerConfig.providers maps instance id → config for model consumers.
      expect(state.providerConfig.provider).toBe("inst-1");
      expect(state.providerConfig.defaults?.chat).toEqual({ provider: "inst-1", model: "gpt-4o" });
      expect(state.providerConfig.providers).toEqual({
        "inst-1": { base_url: "https://example.com" },
      });
    });

    it("should handle load errors gracefully", async () => {
      const error = new Error("Instance API not available");
      loadSectionMock.mockRejectedValueOnce(error);

      await act(async () => {
        await useProviderStore.getState().loadProviderInstances();
      });

      const state = useProviderStore.getState();
      expect(state.error).toBe("Instance API not available");
      expect(state.isLoading).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to load provider instances:", error);
    });

    it("should handle empty instances list", async () => {
      loadSectionMock.mockResolvedValueOnce(providerEnvelope());

      await act(async () => {
        await useProviderStore.getState().loadProviderInstances();
      });

      const state = useProviderStore.getState();
      expect(state.providerInstances).toEqual([]);
      expect(state.defaultProviderInstanceId).toBeNull();
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
