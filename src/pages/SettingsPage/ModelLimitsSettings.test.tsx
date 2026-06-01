import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ModelLimitsSettings from "./ModelLimitsSettings";

const {
  mockGetBambooConfig,
  mockGetModelLimitDefaults,
  mockSetBambooConfig,
  mockGetUsedModels,
  mockRemoveUsedModel,
} = vi.hoisted(() => ({
  mockGetBambooConfig: vi.fn(),
  mockGetModelLimitDefaults: vi.fn(),
  mockSetBambooConfig: vi.fn(),
  mockGetUsedModels: vi.fn(),
  mockRemoveUsedModel: vi.fn(),
}));

vi.mock("../../services/common/ServiceFactory", () => ({
  serviceFactory: {
    getBambooConfig: mockGetBambooConfig,
    getModelLimitDefaults: mockGetModelLimitDefaults,
    setBambooConfig: mockSetBambooConfig,
  },
}));

vi.mock("../ChatPage/utils/usedModels", () => ({
  getUsedModels: mockGetUsedModels,
  removeUsedModel: mockRemoveUsedModel,
}));

const GLOBAL_DEFAULT_RESPONSE = {
  model_limits: [
    {
      vendor: "",
      model_pattern: "default",
      max_context_tokens: 200000,
      max_output_tokens: 64000,
      safety_margin: 2000,
      note: "",
    },
  ],
};

// antd Table + InputNumber rendering is heavy in jsdom; under full-suite
// parallel CPU load these interaction tests can exceed the 5s default timeout
// even though each passes comfortably in isolation. Give them headroom.
vi.setConfig({ testTimeout: 20000 });

describe("ModelLimitsSettings", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();

    mockSetBambooConfig.mockResolvedValue({});
    mockGetModelLimitDefaults.mockResolvedValue(GLOBAL_DEFAULT_RESPONSE);
    mockGetUsedModels.mockReturnValue([]);
    mockGetBambooConfig.mockResolvedValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists used models as default, unchanged rows using the global default", async () => {
    mockGetUsedModels.mockReturnValue(["gpt-4o"]);

    render(<ModelLimitsSettings />);

    expect(await screen.findByText("gpt-4o")).toBeInTheDocument();

    // The context cell shows the global default (200000) and is read-only until customized.
    const contextInput = await screen.findByDisplayValue("200000");
    expect(contextInput).toBeDisabled();
    expect(screen.getByText("Default · unchanged")).toBeInTheDocument();
  });

  it("shows existing overrides as customized, editable rows", async () => {
    mockGetBambooConfig.mockResolvedValue({
      model_limits: [
        { model_pattern: "gpt-4o", max_context_tokens: 128000, max_output_tokens: 16384 },
      ],
    });

    render(<ModelLimitsSettings />);

    expect(await screen.findByText("gpt-4o")).toBeInTheDocument();
    const contextInput = await screen.findByDisplayValue("128000");
    expect(contextInput).toBeEnabled();
    expect(screen.getByText("Customized")).toBeInTheDocument();
  });

  it("customizing a default model and saving persists only that override (diff-only)", async () => {
    mockGetUsedModels.mockReturnValue(["gpt-4o"]);

    render(<ModelLimitsSettings />);
    await screen.findByText("gpt-4o");

    fireEvent.click(screen.getByRole("button", { name: /customize/i }));

    const contextInput = await screen.findByDisplayValue("200000");
    expect(contextInput).toBeEnabled();
    fireEvent.change(contextInput, { target: { value: "128000" } });
    fireEvent.blur(contextInput);
    // Value persists after edit+blur (no mid-typing clamp / reset).
    expect(await screen.findByDisplayValue("128000")).toBeInTheDocument();

    // The Save button's accessible name includes the icon ("save Save").
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(mockSetBambooConfig).toHaveBeenCalled();
    });

    const payload = mockSetBambooConfig.mock.calls.at(-1)?.[0] as {
      model_limits: Array<{ model_pattern: string; max_context_tokens: number }>;
    };
    expect(payload.model_limits).toHaveLength(1);
    expect(payload.model_limits[0].model_pattern).toBe("gpt-4o");
    expect(payload.model_limits[0].max_context_tokens).toBe(128000);
  });

  it("reset all to default sends an empty model_limits list and reverts rows", async () => {
    mockGetBambooConfig.mockResolvedValue({
      model_limits: [
        { model_pattern: "gpt-4o", max_context_tokens: 128000, max_output_tokens: 16384 },
      ],
    });

    render(<ModelLimitsSettings />);
    await screen.findByDisplayValue("128000");

    fireEvent.click(screen.getByRole("button", { name: /reset all to default/i }));

    await waitFor(() => {
      expect(mockSetBambooConfig).toHaveBeenCalledWith({ model_limits: [] });
    });

    // The row reverts to the global default and becomes read-only again.
    const contextInput = await screen.findByDisplayValue("200000");
    expect(contextInput).toBeDisabled();
  });

  it("adds an editable custom model row", async () => {
    render(<ModelLimitsSettings />);

    fireEvent.click(await screen.findByRole("button", { name: /add model/i }));

    const patternInput = await screen.findByPlaceholderText("e.g. gpt-4o");
    expect(patternInput).toBeInTheDocument();
    expect(patternInput).toBeEnabled();
  });

  it("removes a mis-recorded discovered model from the list", async () => {
    mockGetUsedModels.mockReturnValue(["claude-haiku-4-5-20251001"]);

    render(<ModelLimitsSettings />);
    await screen.findByText("claude-haiku-4-5-20251001");

    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));

    expect(mockRemoveUsedModel).toHaveBeenCalledWith("claude-haiku-4-5-20251001");
    await waitFor(() => {
      expect(screen.queryByText("claude-haiku-4-5-20251001")).not.toBeInTheDocument();
    });
  });
});
