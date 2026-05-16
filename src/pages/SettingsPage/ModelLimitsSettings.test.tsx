import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ModelLimitsSettings from "./ModelLimitsSettings";

const { mockGetBambooConfig, mockGetModelLimitDefaults, mockSetBambooConfig } = vi.hoisted(() => ({
  mockGetBambooConfig: vi.fn(),
  mockGetModelLimitDefaults: vi.fn(),
  mockSetBambooConfig: vi.fn(),
}));

vi.mock("../../services/common/ServiceFactory", () => ({
  serviceFactory: {
    getBambooConfig: mockGetBambooConfig,
    getModelLimitDefaults: mockGetModelLimitDefaults,
    setBambooConfig: mockSetBambooConfig,
  },
}));

describe("ModelLimitsSettings", () => {
  beforeEach(() => {
    // Guard against fake timer leakage from other test files during full-suite runs.
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();

    mockSetBambooConfig.mockResolvedValue({});
    mockGetModelLimitDefaults.mockResolvedValue({
      model_limits: [
        {
          vendor: "OpenAI",
          model_pattern: "gpt-5.4",
          max_context_tokens: 1050000,
          max_output_tokens: 32768,
          safety_margin: 1000,
          note: "",
        },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads backend defaults when config has no model_limits", async () => {
    mockGetBambooConfig.mockResolvedValue({});

    render(<ModelLimitsSettings />);

    await waitFor(() => {
      expect(mockGetModelLimitDefaults).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByDisplayValue("gpt-5.4")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("gpt-5.4-thinking")).not.toBeInTheDocument();
  });

  it("reset to defaults writes backend defaults", async () => {
    mockGetBambooConfig.mockResolvedValue({
      model_limits: [
        {
          vendor: "custom",
          model_pattern: "custom-model",
          max_context_tokens: 2048,
          max_output_tokens: 512,
          safety_margin: 100,
          note: "",
        },
      ],
    });

    render(<ModelLimitsSettings />);
    await screen.findByDisplayValue("custom-model");

    const resetButton = await screen.findByRole("button", {
      name: /reset to defaults|恢复默认/i,
    });
    await waitFor(() => {
      expect(resetButton).not.toBeDisabled();
    });

    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(mockSetBambooConfig).toHaveBeenCalled();
    });

    const lastCall = mockSetBambooConfig.mock.calls.at(-1)?.[0] as {
      model_limits: Array<{ model_pattern: string }>;
    };

    expect(lastCall.model_limits[0]?.model_pattern).toBe("gpt-5.4");
  });
});
