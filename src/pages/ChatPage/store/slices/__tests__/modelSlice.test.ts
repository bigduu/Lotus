import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetModels, mockGetSetupStatus, mockLoadConfig } = vi.hoisted(() => ({
  mockGetModels: vi.fn(),
  mockGetSetupStatus: vi.fn(),
  mockLoadConfig: vi.fn(),
}));

vi.mock("@services/chat/ModelService", () => {
  class ProxyAuthRequiredError extends Error {
    code = "proxy_auth_required";
  }

  return {
    modelService: {
      getModels: mockGetModels,
    },
    ProxyAuthRequiredError,
  };
});

vi.mock("@services/common/ServiceFactory", () => ({
  serviceFactory: {
    getSetupStatus: mockGetSetupStatus,
  },
}));

vi.mock("@shared/store/bambooConfigStore", () => ({
  useBambooConfigStore: {
    getState: () => ({
      loadConfig: mockLoadConfig,
    }),
  },
}));

import { createModelSlice, type ModelSlice } from "../modelSlice";
import { createSliceHarness } from "./sliceHarness";

describe("modelSlice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it("sets selected model directly", () => {
    const harness = createSliceHarness<ModelSlice>(createModelSlice as any);
    harness.getState().setSelectedModel("gpt-5");
    expect(harness.getState().selectedModel).toBe("gpt-5");
  });

  it("loads config model when available", async () => {
    mockLoadConfig.mockResolvedValueOnce({ model: "gpt-4.1" });
    const harness = createSliceHarness<ModelSlice>(createModelSlice as any);

    await harness.getState().loadConfigModel();
    expect(harness.getState().configModel).toBe("gpt-4.1");
  });

  it("skips fetching models when setup is incomplete", async () => {
    mockGetSetupStatus.mockResolvedValueOnce({ is_complete: false });
    const harness = createSliceHarness<ModelSlice>(createModelSlice as any);

    await harness.getState().fetchModels();

    expect(mockGetModels).not.toHaveBeenCalled();
    expect(harness.getState().models).toEqual([]);
    expect(harness.getState().selectedModel).toBeUndefined();
    expect(harness.getState().modelsError).toBe("Complete setup to access all models");
    expect(harness.getState().isLoadingModels).toBe(false);
  });

  it("fetches models and picks first when current selection is invalid", async () => {
    mockGetSetupStatus.mockResolvedValueOnce({ is_complete: true });
    mockGetModels.mockResolvedValueOnce(["gpt-5", "gpt-4.1"]);
    const harness = createSliceHarness<ModelSlice>(createModelSlice as any);

    await harness.getState().fetchModels();

    expect(harness.getState().models).toEqual(["gpt-5", "gpt-4.1"]);
    expect(harness.getState().selectedModel).toBe("gpt-5");
    expect(harness.getState().modelsError).toBeNull();
  });

  it("keeps current selection when still available and handles empty model list", async () => {
    const harness = createSliceHarness<ModelSlice>(createModelSlice as any);
    harness.getState().setSelectedModel("gpt-4.1");

    mockGetSetupStatus.mockResolvedValueOnce({ is_complete: true });
    mockGetModels.mockResolvedValueOnce(["gpt-5", "gpt-4.1"]);
    await harness.getState().fetchModels();
    expect(harness.getState().selectedModel).toBe("gpt-4.1");

    mockGetSetupStatus.mockResolvedValueOnce({ is_complete: true });
    mockGetModels.mockResolvedValueOnce([]);
    await harness.getState().fetchModels();
    expect(harness.getState().modelsError).toBe("No available model options");
  });

  it("handles setup-status check failure and continues fetching", async () => {
    mockGetSetupStatus.mockRejectedValueOnce(new Error("setup check failed"));
    mockGetModels.mockResolvedValueOnce(["gpt-5"]);
    const harness = createSliceHarness<ModelSlice>(createModelSlice as any);

    await harness.getState().fetchModels();

    expect(harness.getState().models).toEqual(["gpt-5"]);
    expect(harness.getState().selectedModel).toBe("gpt-5");
  });

  it("keeps existing models when proxy auth is required", async () => {
    const { ProxyAuthRequiredError } = await import("@services/chat/ModelService");
    mockGetSetupStatus.mockResolvedValueOnce({ is_complete: true });
    mockGetModels.mockRejectedValueOnce(new ProxyAuthRequiredError("Proxy login needed"));
    const harness = createSliceHarness<ModelSlice>(createModelSlice as any);
    harness.setState({
      models: ["existing-model"],
      selectedModel: "existing-model",
    } as Partial<ModelSlice>);

    await harness.getState().fetchModels();

    expect(harness.getState().models).toEqual(["existing-model"]);
    expect(harness.getState().selectedModel).toBe("existing-model");
    expect(harness.getState().modelsError).toBe("Proxy login needed");
  });

  it("clears models on non-proxy fetch errors", async () => {
    mockGetSetupStatus.mockResolvedValueOnce({ is_complete: true });
    mockGetModels.mockRejectedValueOnce(new Error("network down"));
    const harness = createSliceHarness<ModelSlice>(createModelSlice as any);
    harness.getState().setSelectedModel("persisted-model");

    await harness.getState().fetchModels();

    expect(harness.getState().models).toEqual([]);
    expect(harness.getState().selectedModel).toBe("persisted-model");
    expect(harness.getState().modelsError).toBe("network down");
  });
});
