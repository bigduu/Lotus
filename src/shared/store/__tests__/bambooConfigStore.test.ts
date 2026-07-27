import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBambooConfigStore } from "../bambooConfigStore";
import { serviceFactory } from "@services/common/ServiceFactory";

describe("useBambooConfigStore", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useBambooConfigStore.setState({
      config: null,
      isLoadingConfig: false,
      lastLoadedAt: null,
      error: null,
    });
  });

  it("dedupes concurrent loadConfig calls", async () => {
    const spy = vi.spyOn(serviceFactory, "getBambooConfig").mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { provider: "openai" } as any;
    });

    const store = useBambooConfigStore.getState();
    const [a, b] = await Promise.all([store.loadConfig(), store.loadConfig()]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(a.provider).toBe("openai");
    expect(b.provider).toBe("openai");
    expect(useBambooConfigStore.getState().config?.provider).toBe("openai");
  });

  it("returns cached config unless force is true", async () => {
    const spy = vi
      .spyOn(serviceFactory, "getBambooConfig")
      .mockResolvedValue({ provider: "anthropic" } as any);

    const store = useBambooConfigStore.getState();
    await store.loadConfig();
    await store.loadConfig();

    expect(spy).toHaveBeenCalledTimes(1);

    await store.loadConfig({ force: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("retains the last config snapshot when a forced diagnostic reload fails", async () => {
    useBambooConfigStore.setState({ config: { provider: "gemini" } as any });
    vi.spyOn(serviceFactory, "getBambooConfig").mockRejectedValue(new Error("offline"));

    await expect(useBambooConfigStore.getState().loadConfig({ force: true })).rejects.toThrow(
      "offline",
    );

    expect(useBambooConfigStore.getState().config?.provider).toBe("gemini");
    expect(useBambooConfigStore.getState().error).toBe("offline");
  });
});
