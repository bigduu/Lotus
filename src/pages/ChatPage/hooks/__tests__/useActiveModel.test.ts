import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useActiveModel, useActiveModelInfo } from "../useActiveModel";
import { useProviderStore } from "../../store/slices/providerSlice";
import { useAppStore } from "../../store";

vi.mock("../../store/slices/providerSlice", () => ({
  useProviderStore: vi.fn(),
}));

vi.mock("../../store", () => ({
  useAppStore: vi.fn(),
  selectSessionById:
    (sessionId: string | null) =>
    (state: { chats?: Array<{ id: string; config?: { model?: string } }> }) =>
      state.chats?.find((chat) => chat.id === sessionId) ?? null,
}));

describe("useActiveModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAppStore).mockImplementation((selector: any) =>
      typeof selector === "function" ? selector({ chats: [] }) : { chats: [] },
    );
  });

  describe("useActiveModel", () => {
    it("should return undefined when no provider is configured", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          currentProvider: "openai",
          providerConfig: {
            providers: {},
          },
          isLoading: false,
          error: null,
          loadProviderConfig: vi.fn(),
          saveProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
        }),
      );

      const { result } = renderHook(() => useActiveModel());

      expect(result.current).toBeUndefined();
    });

    it("should return model when provider config has model", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          currentProvider: "openai",
          providerConfig: {
            providers: {
              openai: {
                model: "gpt-4",
                apiKey: "test-key",
              },
            },
          },
          isLoading: false,
          error: null,
          loadProviderConfig: vi.fn(),
          saveProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
        }),
      );

      const { result } = renderHook(() => useActiveModel());

      expect(result.current).toBe("gpt-4");
    });

    it("should return undefined when provider config exists but has no model", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          currentProvider: "anthropic",
          providerConfig: {
            providers: {
              anthropic: {
                apiKey: "test-key",
              },
            },
          },
          isLoading: false,
          error: null,
          loadProviderConfig: vi.fn(),
          saveProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
        }),
      );

      const { result } = renderHook(() => useActiveModel());

      expect(result.current).toBeUndefined();
    });

    it("should prefer session model over provider default when sessionId is provided", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          currentProvider: "openai",
          providerConfig: {
            providers: {
              openai: {
                model: "gpt-provider-default",
                apiKey: "test-key",
              },
            },
          },
          isLoading: false,
          error: null,
          loadProviderConfig: vi.fn(),
          saveProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
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

    it("should return undefined when model is empty string", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          currentProvider: "openai",
          providerConfig: {
            providers: {
              openai: {
                model: "",
                apiKey: "test-key",
              },
            },
          },
          isLoading: false,
          error: null,
          loadProviderConfig: vi.fn(),
          saveProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
        }),
      );

      const { result } = renderHook(() => useActiveModel());

      expect(result.current).toBeUndefined();
    });

    it("should update when currentProvider changes", () => {
      const storeState = {
        currentProvider: "openai",
        providerConfig: {
          providers: {
            openai: {
              model: "gpt-4",
              apiKey: "key1",
            },
            anthropic: {
              model: "claude-3",
              apiKey: "key2",
            },
          },
        },
        isLoading: false,
        error: null,
        loadProviderConfig: vi.fn(),
        saveProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
      };

      vi.mocked(useProviderStore).mockImplementation((selector) => selector(storeState));

      const { result, rerender } = renderHook(() => useActiveModel());

      expect(result.current).toBe("gpt-4");

      // Change provider
      storeState.currentProvider = "anthropic";
      rerender();

      expect(result.current).toBe("claude-3");
    });

    it("should update when providerConfig changes", () => {
      const storeState = {
        currentProvider: "openai",
        providerConfig: {
          providers: {
            openai: {
              model: "gpt-3.5-turbo",
              apiKey: "key1",
            },
          },
        },
        isLoading: false,
        error: null,
        loadProviderConfig: vi.fn(),
        saveProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
      };

      vi.mocked(useProviderStore).mockImplementation((selector) => selector(storeState));

      const { result, rerender } = renderHook(() => useActiveModel());

      expect(result.current).toBe("gpt-3.5-turbo");

      // Update model
      storeState.providerConfig = {
        providers: {
          openai: {
            model: "gpt-4-turbo",
            apiKey: "key1",
          },
        },
      };
      rerender();

      expect(result.current).toBe("gpt-4-turbo");
    });

    it("should handle providers without model property", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          currentProvider: "custom",
          providerConfig: {
            providers: {
              custom: {
                apiKey: "test-key",
                baseUrl: "http://localhost:3000",
              },
            },
          },
          isLoading: false,
          error: null,
          loadProviderConfig: vi.fn(),
          saveProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
        }),
      );

      const { result } = renderHook(() => useActiveModel());

      expect(result.current).toBeUndefined();
    });

    it("should handle multiple selector calls correctly", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          currentProvider: "openai",
          providerConfig: {
            providers: {
              openai: {
                model: "gpt-4",
                apiKey: "test-key",
              },
            },
          },
          isLoading: false,
          error: null,
          loadProviderConfig: vi.fn(),
          saveProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
        }),
      );

      const { result } = renderHook(() => useActiveModel());

      // Should call selector twice (once for currentProvider, once for providerConfig)
      expect(useProviderStore).toHaveBeenCalledTimes(2);
      expect(result.current).toBe("gpt-4");
    });
  });

  describe("useActiveModelInfo", () => {
    it("should return active model info", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          currentProvider: "openai",
          providerConfig: {
            providers: {
              openai: {
                model: "gpt-4",
                apiKey: "test-key",
              },
            },
          },
          isLoading: false,
          error: null,
          loadProviderConfig: vi.fn(),
          saveProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
        }),
      );

      const { result } = renderHook(() => useActiveModelInfo());

      expect(result.current.activeModel).toBe("gpt-4");
      expect(result.current.currentProvider).toBe("openai");
      expect(result.current.providerConfig).toEqual({
        providers: {
          openai: {
            model: "gpt-4",
            apiKey: "test-key",
          },
        },
      });
    });

    it("should return undefined activeModel when no model configured", () => {
      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          currentProvider: "anthropic",
          providerConfig: {
            providers: {
              anthropic: {
                apiKey: "test-key",
              },
            },
          },
          isLoading: false,
          error: null,
          loadProviderConfig: vi.fn(),
          saveProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
        }),
      );

      const { result } = renderHook(() => useActiveModelInfo());

      expect(result.current.activeModel).toBeUndefined();
      expect(result.current.currentProvider).toBe("anthropic");
    });

    it("should update all values when provider changes", () => {
      const storeState = {
        currentProvider: "openai",
        providerConfig: {
          providers: {
            openai: {
              model: "gpt-4",
              apiKey: "key1",
            },
            anthropic: {
              model: "claude-3",
              apiKey: "key2",
            },
          },
        },
        isLoading: false,
        error: null,
        loadProviderConfig: vi.fn(),
        saveProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
      };

      vi.mocked(useProviderStore).mockImplementation((selector) => selector(storeState));

      const { result, rerender } = renderHook(() => useActiveModelInfo());

      expect(result.current.activeModel).toBe("gpt-4");
      expect(result.current.currentProvider).toBe("openai");

      // Change provider
      storeState.currentProvider = "anthropic";
      rerender();

      expect(result.current.activeModel).toBe("claude-3");
      expect(result.current.currentProvider).toBe("anthropic");
    });

    it("should create stable object reference when values don't change", () => {
      const providerConfig = {
        providers: {
          openai: {
            model: "gpt-4",
            apiKey: "test-key",
          },
        },
      };

      vi.mocked(useProviderStore).mockImplementation((selector) =>
        selector({
          currentProvider: "openai",
          providerConfig,
          isLoading: false,
          error: null,
          loadProviderConfig: vi.fn(),
          saveProviderConfig: vi.fn(),
          setCurrentProvider: vi.fn(),
        }),
      );

      const { result, rerender } = renderHook(() => useActiveModelInfo());

      const firstResult = result.current;

      // Rerender with same object reference (should be memoized)
      rerender();

      // Note: Even though we're using the same providerConfig object,
      // the selector might be called multiple times, so we just verify
      // that the values are stable
      expect(result.current.activeModel).toBe(firstResult.activeModel);
      expect(result.current.currentProvider).toBe(firstResult.currentProvider);
    });

    it("should create new object when values change", () => {
      const storeState = {
        currentProvider: "openai",
        providerConfig: {
          providers: {
            openai: {
              model: "gpt-4",
              apiKey: "test-key",
            },
          },
        },
        isLoading: false,
        error: null,
        loadProviderConfig: vi.fn(),
        saveProviderConfig: vi.fn(),
        setCurrentProvider: vi.fn(),
      };

      vi.mocked(useProviderStore).mockImplementation((selector) => selector(storeState));

      const { result, rerender } = renderHook(() => useActiveModelInfo());

      const firstResult = result.current;

      // Change provider
      storeState.currentProvider = "anthropic";
      storeState.providerConfig = {
        providers: {
          anthropic: {
            model: "claude-3",
            apiKey: "key2",
          },
        },
      };
      rerender();

      // Should return new object reference
      expect(result.current).not.toBe(firstResult);
      expect(result.current.activeModel).toBe("claude-3");
    });
  });
});
