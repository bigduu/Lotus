import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useActiveModelRef } from "../useActiveModelRef";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";

/**
 * Covers the *resolution* half of the "wrong model recorded" fix: InputContainer
 * passes `activeModelRef?.model ?? currentChat?.config?.model_ref?.model` as the
 * model to record. These tests prove that a session configured with glm-5.1
 * resolves to glm-5.1 (not the stale legacy global selection). The recording
 * half is covered in useInputContainerSubmit.test.ts.
 */
describe("useActiveModelRef — model that gets recorded as used", () => {
  afterEach(() => {
    act(() => {
      useProviderStore.setState({ selectedModelRef: null });
    });
  });

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
