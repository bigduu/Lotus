import { renderHook } from "@testing-library/react";
import { useActiveModel, useActiveModelInfo } from "../useActiveModel";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";
import { useAppStore } from "@shared/store/appStore";

vi.mock("@shared/store/appStore/slices/providerSlice", () => ({
  useProviderStore: vi.fn(),
}));

vi.mock("@shared/store/appStore", () => ({
  useAppStore: vi.fn(),
  selectSessionById:
    (sessionId: string | null) =>
    (state: { chats?: Array<{ id: string; config?: { model?: string } }> }) =>
      state.chats?.find((chat) => chat.id === sessionId) ?? null,
}));

const baseStoreState = {
  currentProvider: "openai",
  providerConfig: {
    provider: "openai",
    providers: {},
  },
  isLoading: false,
  error: null,
  loadProviderConfig: vi.fn(),
  saveProviderConfig: vi.fn(),
  setCurrentProvider: vi.fn(),
};

describe("useActiveModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAppStore).mockImplementation((selector: any) =>
      typeof selector === "function" ? selector({ chats: [] }) : { chats: [] },
    );
  });

  describe("useActiveModel", () => {
    it("should return undefined when no provider defaults are configured", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          providerConfig: {
            provider: "openai",
            providers: {},
          },
        }),
      );

      const { result } = renderHook(() => useActiveModel());
      expect(result.current).toBeUndefined();
    });

    it("should return model when defaults.chat is configured", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          providerConfig: {
            provider: "openai",
            defaults: {
              chat: { provider: "openai", model: "gpt-4" },
            },
            providers: {
              openai: {
                api_key: "test-key",
              },
            },
          },
        }),
      );

      const { result } = renderHook(() => useActiveModel());
      expect(result.current).toBe("gpt-4");
    });

    it("should return undefined when defaults.chat is missing", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          currentProvider: "anthropic",
          providerConfig: {
            provider: "anthropic",
            providers: {
              anthropic: {
                api_key: "test-key",
              },
            },
          },
        }),
      );

      const { result } = renderHook(() => useActiveModel());
      expect(result.current).toBeUndefined();
    });

    it("should prefer session model_ref over session model and defaults.chat when sessionId is provided", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          providerConfig: {
            provider: "openai",
            defaults: {
              chat: { provider: "openai", model: "gpt-provider-default" },
            },
            providers: {
              openai: {
                api_key: "test-key",
              },
            },
          },
        }),
      );
      vi.mocked(useAppStore).mockImplementation((selector: any) =>
        typeof selector === "function"
          ? selector({
              chats: [
                {
                  id: "session-1",
                  config: {
                    model: "gpt-session-legacy",
                    model_ref: {
                      provider: "anthropic",
                      model: "claude-session-ref",
                    },
                  },
                },
              ],
            })
          : {
              chats: [
                {
                  id: "session-1",
                  config: {
                    model: "gpt-session-legacy",
                    model_ref: {
                      provider: "anthropic",
                      model: "claude-session-ref",
                    },
                  },
                },
              ],
            },
      );

      const { result } = renderHook(() => useActiveModel("session-1"));
      expect(result.current).toBe("claude-session-ref");
    });

    it("should fall back to defaults.chat when legacy session model is unknown", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          providerConfig: {
            provider: "openai",
            defaults: {
              chat: { provider: "openai", model: "gpt-provider-default" },
            },
            providers: {
              openai: {
                api_key: "test-key",
              },
            },
          },
        }),
      );
      vi.mocked(useAppStore).mockImplementation((selector: any) =>
        typeof selector === "function"
          ? selector({
              chats: [
                {
                  id: "session-1",
                  config: {
                    model: "unknown",
                  },
                },
              ],
            })
          : {
              chats: [
                {
                  id: "session-1",
                  config: {
                    model: "unknown",
                  },
                },
              ],
            },
      );

      const { result } = renderHook(() => useActiveModel("session-1"));
      expect(result.current).toBe("gpt-provider-default");
    });

    it("should prefer session model over defaults.chat when sessionId is provided", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          providerConfig: {
            provider: "openai",
            defaults: {
              chat: { provider: "openai", model: "gpt-provider-default" },
            },
            providers: {
              openai: {
                api_key: "test-key",
              },
            },
          },
        }),
      );
      vi.mocked(useAppStore).mockImplementation((selector: any) =>
        typeof selector === "function"
          ? selector({
              chats: [
                {
                  id: "session-1",
                  config: {
                    model: "gpt-session-specific",
                  },
                },
              ],
            })
          : {
              chats: [
                {
                  id: "session-1",
                  config: {
                    model: "gpt-session-specific",
                  },
                },
              ],
            },
      );

      const { result } = renderHook(() => useActiveModel("session-1"));
      expect(result.current).toBe("gpt-session-specific");
    });

    it("should return undefined when defaults.chat.model is empty string", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          providerConfig: {
            provider: "openai",
            defaults: {
              chat: { provider: "openai", model: "" },
            },
            providers: {
              openai: {
                api_key: "test-key",
              },
            },
          },
        }),
      );

      const { result } = renderHook(() => useActiveModel());
      expect(result.current).toBeUndefined();
    });

    it("should update when providerConfig defaults change", () => {
      const storeState = {
        ...baseStoreState,
        providerConfig: {
          provider: "openai",
          defaults: {
            chat: { provider: "openai", model: "gpt-3.5-turbo" },
          },
          providers: {
            openai: {
              api_key: "key1",
            },
          },
        },
      };

      vi.mocked(useProviderStore).mockImplementation((selector) => selector(storeState as any));

      const { result, rerender } = renderHook(() => useActiveModel());
      expect(result.current).toBe("gpt-3.5-turbo");

      storeState.providerConfig = {
        provider: "openai",
        defaults: {
          chat: { provider: "openai", model: "gpt-4-turbo" },
        },
        providers: {
          openai: {
            api_key: "key1",
          },
        },
      };
      rerender();

      expect(result.current).toBe("gpt-4-turbo");
    });

    it("should work when defaults.chat provider differs from currentProvider", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          currentProvider: "openai",
          providerConfig: {
            provider: "openai",
            defaults: {
              chat: { provider: "anthropic", model: "claude-3-sonnet" },
            },
            providers: {
              openai: {
                api_key: "key1",
              },
              anthropic: {
                api_key: "key2",
              },
            },
          },
        }),
      );

      const { result } = renderHook(() => useActiveModel());
      expect(result.current).toBe("claude-3-sonnet");
    });

    it("should handle multiple selector calls correctly", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          providerConfig: {
            provider: "openai",
            defaults: {
              chat: { provider: "openai", model: "gpt-4" },
            },
            providers: {
              openai: {
                api_key: "test-key",
              },
            },
          },
        }),
      );

      const { result } = renderHook(() => useActiveModel());
      expect(result.current).toBe("gpt-4");
      expect(useProviderStore).toHaveBeenCalledTimes(1);
    });
  });

  describe("useActiveModelInfo", () => {
    it("should return active model info", () => {
      const providerConfig = {
        provider: "openai",
        defaults: {
          chat: { provider: "openai", model: "gpt-4" },
        },
        providers: {
          openai: {
            api_key: "test-key",
          },
        },
      };
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          currentProvider: "openai",
          providerConfig,
        }),
      );

      const { result } = renderHook(() => useActiveModelInfo());
      expect(result.current.activeModel).toBe("gpt-4");
      expect(result.current.currentProvider).toBe("openai");
      expect(result.current.providerConfig).toEqual(providerConfig);
    });

    it("should return undefined activeModel when no defaults are configured", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          currentProvider: "anthropic",
          providerConfig: {
            provider: "anthropic",
            providers: {
              anthropic: {
                api_key: "test-key",
              },
            },
          },
        }),
      );

      const { result } = renderHook(() => useActiveModelInfo());
      expect(result.current.activeModel).toBeUndefined();
      expect(result.current.currentProvider).toBe("anthropic");
    });

    it("should update all values when currentProvider changes", () => {
      const storeState = {
        ...baseStoreState,
        currentProvider: "openai",
        providerConfig: {
          provider: "openai",
          defaults: {
            chat: { provider: "anthropic", model: "claude-3" },
          },
          providers: {
            openai: { api_key: "key1" },
            anthropic: { api_key: "key2" },
          },
        },
      };

      vi.mocked(useProviderStore).mockImplementation((selector) => selector(storeState as any));

      const { result, rerender } = renderHook(() => useActiveModelInfo());
      expect(result.current.activeModel).toBe("claude-3");
      expect(result.current.currentProvider).toBe("openai");

      storeState.currentProvider = "anthropic";
      rerender();

      expect(result.current.activeModel).toBe("claude-3");
      expect(result.current.currentProvider).toBe("anthropic");
    });

    it("should create stable object reference when values don't change", () => {
      const providerConfig = {
        provider: "openai",
        defaults: {
          chat: { provider: "openai", model: "gpt-4" },
        },
        providers: {
          openai: {
            api_key: "test-key",
          },
        },
      };

      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          ...baseStoreState,
          currentProvider: "openai",
          providerConfig,
        }),
      );

      const { result, rerender } = renderHook(() => useActiveModelInfo());
      const firstResult = result.current;
      rerender();

      expect(result.current.activeModel).toBe(firstResult.activeModel);
      expect(result.current.currentProvider).toBe(firstResult.currentProvider);
    });

    it("should create new object when values change", () => {
      const storeState = {
        ...baseStoreState,
        currentProvider: "openai",
        providerConfig: {
          provider: "openai",
          defaults: {
            chat: { provider: "openai", model: "gpt-4" },
          },
          providers: {
            openai: {
              api_key: "test-key",
            },
          },
        },
      };

      vi.mocked(useProviderStore).mockImplementation((selector) => selector(storeState as any));

      const { result, rerender } = renderHook(() => useActiveModelInfo());
      const firstResult = result.current;

      storeState.currentProvider = "anthropic";
      storeState.providerConfig = {
        provider: "openai",
        defaults: {
          chat: { provider: "anthropic", model: "claude-3" },
        },
        providers: {
          anthropic: {
            api_key: "key2",
          },
        },
      };
      rerender();

      expect(result.current).not.toBe(firstResult);
      expect(result.current.activeModel).toBe("claude-3");
    });
  });
});
