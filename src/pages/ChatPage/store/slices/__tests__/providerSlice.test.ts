import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { useProviderStore } from "../providerSlice";
import { settingsService } from "@services/config/SettingsService";
import type { ProviderConfig } from "../../../types/providerConfig";

// Mock settingsService
vi.mock("@services/config/SettingsService", () => ({
  settingsService: {
    getProviderConfig: vi.fn(),
  },
}));

describe("providerSlice", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    useProviderStore.setState({
      currentProvider: "copilot",
      providerConfig: {
        provider: "copilot",
        providers: {},
      },
      isLoading: false,
      error: null,
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
        providers: {
          anthropic: {
            api_key: "test-key",
            model: "claude-3",
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

      const promise = act(async () => {
        return useProviderStore.getState().loadProviderConfig();
      });

      // Check loading state immediately
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
      // First, set an error
      useProviderStore.setState({ error: "Previous error" });

      const mockConfig: ProviderConfig = {
        provider: "openai",
        providers: {
          openai: {
            api_key: "key",
            model: "gpt-4",
          },
        },
      };
      vi.mocked(settingsService.getProviderConfig).mockResolvedValueOnce(mockConfig);

      await act(async () => {
        await useProviderStore.getState().loadProviderConfig();
      });

      const state = useProviderStore.getState();
      expect(state.error).toBeNull();
    });

    it("should update currentProvider from config", async () => {
      const mockConfig: ProviderConfig = {
        provider: "openai",
        providers: {
          openai: {
            api_key: "test",
            model: "gpt-4o",
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
      // First change to something else
      useProviderStore.setState({ currentProvider: "anthropic" });

      act(() => {
        useProviderStore.getState().setCurrentProvider("copilot");
      });

      expect(useProviderStore.getState().currentProvider).toBe("copilot");
    });
  });

  describe("updateProviderConfig", () => {
    it("should merge partial config", () => {
      const initialConfig: ProviderConfig = {
        provider: "copilot",
        providers: {
          copilot: {
            model: "gpt-4",
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
      expect(state.providerConfig.providers).toEqual({
        copilot: { model: "gpt-4" },
      });
    });

    it("should update providers object", () => {
      act(() => {
        useProviderStore.getState().updateProviderConfig({
          providers: {
            openai: {
              api_key: "new-key",
              model: "gpt-4o",
            },
          },
        });
      });

      const state = useProviderStore.getState();
      expect(state.providerConfig.providers).toEqual({
        openai: {
          api_key: "new-key",
          model: "gpt-4o",
        },
      });
    });

    it("should preserve existing config when updating", () => {
      const initialConfig: ProviderConfig = {
        provider: "anthropic",
        providers: {
          anthropic: {
            api_key: "key1",
            model: "claude-3",
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
      expect(state.providerConfig.providers).toEqual({
        anthropic: {
          api_key: "key1",
          model: "claude-3",
        },
      });
    });
  });

  describe("getActiveModel", () => {
    it("should return model for current provider", () => {
      const config: ProviderConfig = {
        provider: "anthropic",
        providers: {
          anthropic: {
            api_key: "test",
            model: "claude-3-opus",
          },
        },
      };
      useProviderStore.setState({
        currentProvider: "anthropic",
        providerConfig: config,
      });

      const model = useProviderStore.getState().getActiveModel();
      expect(model).toBe("claude-3-opus");
    });

    it("should return undefined when provider config missing", () => {
      useProviderStore.setState({
        currentProvider: "anthropic",
        providerConfig: {
          provider: "anthropic",
          providers: {},
        },
      });

      const model = useProviderStore.getState().getActiveModel();
      expect(model).toBeUndefined();
    });

    it("should return undefined when model not in config", () => {
      const config: ProviderConfig = {
        provider: "copilot",
        providers: {
          copilot: {
            // No model field
          },
        },
      };
      useProviderStore.setState({
        currentProvider: "copilot",
        providerConfig: config,
      });

      const model = useProviderStore.getState().getActiveModel();
      expect(model).toBeUndefined();
    });

    it("should return undefined when model is empty string", () => {
      const config: ProviderConfig = {
        provider: "openai",
        providers: {
          openai: {
            api_key: "test",
            model: "",
          },
        },
      };
      useProviderStore.setState({
        currentProvider: "openai",
        providerConfig: config,
      });

      const model = useProviderStore.getState().getActiveModel();
      // Empty string is falsy, so returns undefined
      expect(model).toBeUndefined();
    });

    it("should return model for different providers", () => {
      const config: ProviderConfig = {
        provider: "copilot",
        providers: {
          copilot: {
            model: "gpt-4o",
          },
          anthropic: {
            api_key: "key",
            model: "claude-3-sonnet",
          },
          openai: {
            api_key: "key",
            model: "gpt-4-turbo",
          },
        },
      };
      useProviderStore.setState({ providerConfig: config });

      act(() => {
        useProviderStore.getState().setCurrentProvider("anthropic");
      });
      expect(useProviderStore.getState().getActiveModel()).toBe("claude-3-sonnet");

      act(() => {
        useProviderStore.getState().setCurrentProvider("openai");
      });
      expect(useProviderStore.getState().getActiveModel()).toBe("gpt-4-turbo");
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
          providers: { openai: { api_key: "k", model: "gpt-4o", fast_model: "gpt-4o-mini" } },
        },
      });
      expect(useProviderStore.getState().getFastModelRef()).toEqual({
        provider: "openai",
        model: "gpt-4o-mini",
      });
    });

    it("should fallback to active model when no fast_model", () => {
      useProviderStore.setState({
        currentProvider: "anthropic",
        providerConfig: {
          provider: "anthropic",
          providers: { anthropic: { api_key: "k", model: "claude-3" } },
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
          providers: { openai: { api_key: "k", model: "gpt-4o", vision_model: "gpt-4o-vision" } },
        },
      });
      expect(useProviderStore.getState().getVisionModelRef()).toEqual({
        provider: "openai",
        model: "gpt-4o-vision",
      });
    });
  });
});
