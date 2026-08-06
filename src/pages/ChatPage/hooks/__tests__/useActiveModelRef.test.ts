import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useActiveModelRef, useFastModelRef } from "../useActiveModelRef";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";

const initialProviderConfig = useProviderStore.getState().providerConfig;

afterEach(() => {
  act(() => {
    useProviderStore.setState({
      providerConfig: initialProviderConfig,
      selectedModelRef: null,
    });
  });
});

/**
 * Covers the *resolution* half of the "wrong model recorded" fix: InputContainer
 * passes `activeModelRef?.model ?? currentChat?.config?.model_ref?.model` as the
 * model to record. These tests prove that a session configured with glm-5.1
 * resolves to glm-5.1 (not the stale legacy global selection). The recording
 * half is covered in useInputContainerSubmit.test.ts.
 */
describe("useActiveModelRef — model that gets recorded as used", () => {
  it("resolves the session's model_ref (the value passed as usedModelName)", () => {
    const { result } = renderHook(() => useActiveModelRef({ provider: "zhipu", model: "glm-5.1" }));

    expect(result.current).toEqual({ provider: "zhipu", model: "glm-5.1" });
    expect(result.current?.model).toBe("glm-5.1");
  });

  it("session model_ref wins over the store-level selectedModelRef", () => {
    act(() => {
      useProviderStore.setState({
        selectedModelRef: { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
      });
    });

    const { result } = renderHook(() => useActiveModelRef({ provider: "zhipu", model: "glm-5.1" }));

    // The session's choice (glm-5.1), not the stale global ref (haiku).
    expect(result.current?.model).toBe("glm-5.1");
  });

  it("falls back to the store-level selectedModelRef when the session has none", () => {
    act(() => {
      useProviderStore.setState({
        selectedModelRef: { provider: "zhipu", model: "glm-5.1" },
      });
    });

    const { result } = renderHook(() => useActiveModelRef(null));

    expect(result.current?.model).toBe("glm-5.1");
  });
});

describe("useFastModelRef", () => {
  it("reacts when provider defaults load and switch", () => {
    act(() => {
      useProviderStore.setState((state) => ({
        providerConfig: {
          ...state.providerConfig,
          defaults: undefined,
        },
      }));
    });

    const { result } = renderHook(() => useFastModelRef());
    expect(result.current).toBeNull();

    act(() => {
      useProviderStore.setState((state) => ({
        providerConfig: {
          ...state.providerConfig,
          defaults: {
            chat: { provider: "instance-a", model: "chat-a" },
            fast: { provider: "instance-a", model: "fast-a" },
          },
        },
      }));
    });
    expect(result.current).toEqual({ provider: "instance-a", model: "fast-a" });

    act(() => {
      useProviderStore.setState((state) => ({
        providerConfig: {
          ...state.providerConfig,
          defaults: {
            chat: { provider: "instance-b", model: "chat-b" },
            fast: { provider: "instance-b", model: "fast-b" },
          },
        },
      }));
    });
    expect(result.current).toEqual({ provider: "instance-b", model: "fast-b" });
  });

  it("falls back to the reactive chat model ref when no fast ref is configured", () => {
    act(() => {
      useProviderStore.setState((state) => ({
        providerConfig: {
          ...state.providerConfig,
          defaults: {
            chat: { provider: "instance-chat", model: "chat-model" },
          },
        },
      }));
    });

    const { result } = renderHook(() => useFastModelRef());

    expect(result.current).toEqual({ provider: "instance-chat", model: "chat-model" });
  });
});
