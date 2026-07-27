import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { configSectionsService } from "../../services/config/configSections";
import { useConfigSectionStore } from "../../shared/store/configSectionStore";
import ModelLimitsSettings from "./ModelLimitsSettings";

const { mockGetModelLimitDefaults, mockGetUsedModels, mockRemoveUsedModel } = vi.hoisted(() => ({
  mockGetModelLimitDefaults: vi.fn(),
  mockGetUsedModels: vi.fn(),
  mockRemoveUsedModel: vi.fn(),
}));

vi.mock("../../services/common/ServiceFactory", () => ({
  serviceFactory: {
    getModelLimitDefaults: mockGetModelLimitDefaults,
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
      max_context_tokens: 1000000,
      max_output_tokens: 64000,
      safety_margin: 10000,
      note: "",
    },
  ],
};

const modelLimitsEnvelope = (data: unknown[], revision = 3) => ({
  data,
  revision,
  loaded_at: "2026-07-23T00:00:00.000Z",
  source_path: "/tmp/model-limits.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

// antd Table + InputNumber rendering is heavy in jsdom; under full-suite
// parallel CPU load these interaction tests can exceed the 5s default timeout
// even though each passes comfortably in isolation. Give them headroom.
vi.setConfig({ testTimeout: 20000 });

describe("ModelLimitsSettings", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    localStorage.clear();
    useConfigSectionStore.getState().reset();

    mockGetModelLimitDefaults.mockResolvedValue(GLOBAL_DEFAULT_RESPONSE);
    mockGetUsedModels.mockReturnValue([]);
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(
      modelLimitsEnvelope([]) as never,
    );
    vi.spyOn(configSectionsService, "putSection").mockImplementation(
      async (_section, _revision, data) => modelLimitsEnvelope(data as unknown[], 4) as never,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("lists used models as default, unchanged rows using the global default", async () => {
    mockGetUsedModels.mockReturnValue(["gpt-4o"]);

    render(<ModelLimitsSettings />);

    expect(await screen.findByText("gpt-4o")).toBeInTheDocument();

    // The context cell shows the global default (1000000) and is read-only until customized.
    const contextInput = await screen.findByDisplayValue("1000000");
    expect(contextInput).toBeDisabled();
    expect(screen.getByText("Default · unchanged")).toBeInTheDocument();
  });

  it("shows existing overrides as customized, editable rows", async () => {
    vi.mocked(configSectionsService.getSection).mockResolvedValue(
      modelLimitsEnvelope([
        { model_pattern: "gpt-4o", max_context_tokens: 128000, max_output_tokens: 16384 },
      ]) as never,
    );

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

    const contextInput = await screen.findByDisplayValue("1000000");
    expect(contextInput).toBeEnabled();
    fireEvent.change(contextInput, { target: { value: "128000" } });
    fireEvent.blur(contextInput);
    // Value persists after edit+blur (no mid-typing clamp / reset).
    expect(await screen.findByDisplayValue("128000")).toBeInTheDocument();

    // The Save button's accessible name includes the icon ("save Save").
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(configSectionsService.putSection).toHaveBeenCalled();
    });

    const [section, revision, payload] = vi
      .mocked(configSectionsService.putSection)
      .mock.calls.at(-1) as [
      string,
      number,
      Array<{ model_pattern: string; max_context_tokens: number }>,
    ];
    expect(section).toBe("model-limits");
    expect(revision).toBe(3);
    expect(payload).toHaveLength(1);
    expect(payload[0].model_pattern).toBe("gpt-4o");
    expect(payload[0].max_context_tokens).toBe(128000);
  });

  it("reset all to default sends an empty model_limits list and reverts rows", async () => {
    vi.mocked(configSectionsService.getSection).mockResolvedValue(
      modelLimitsEnvelope([
        { model_pattern: "gpt-4o", max_context_tokens: 128000, max_output_tokens: 16384 },
      ]) as never,
    );

    render(<ModelLimitsSettings />);
    await screen.findByDisplayValue("128000");

    fireEvent.click(screen.getByRole("button", { name: /reset all to default/i }));

    await waitFor(() => {
      expect(configSectionsService.putSection).toHaveBeenCalledWith("model-limits", 3, []);
    });

    // The row reverts to the global default and becomes read-only again.
    const contextInput = await screen.findByDisplayValue("1000000");
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

  it("adopts a newer model-limit snapshot while the editor is clean", async () => {
    render(<ModelLimitsSettings />);
    await screen.findByText("Token Budget Model Limits");

    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          "model-limits": {
            ...state.sections["model-limits"],
            envelope: modelLimitsEnvelope(
              [
                {
                  model_pattern: "remote-model",
                  max_context_tokens: 256000,
                  max_output_tokens: 32000,
                },
              ],
              4,
            ) as never,
          },
        },
      }));
    });

    expect(await screen.findByText("remote-model")).toBeInTheDocument();
    expect(screen.queryByText(/changed on disk/i)).not.toBeInTheDocument();
  });

  it("preserves, compares, and reapplies a dirty model-limit draft", async () => {
    mockGetUsedModels.mockReturnValue(["gpt-4o"]);
    render(<ModelLimitsSettings />);
    await screen.findByText("gpt-4o");
    fireEvent.click(screen.getByRole("button", { name: /customize/i }));
    const contextInput = await screen.findByDisplayValue("1000000");
    fireEvent.change(contextInput, { target: { value: "128000" } });
    fireEvent.blur(contextInput);

    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          "model-limits": {
            ...state.sections["model-limits"],
            envelope: modelLimitsEnvelope(
              [
                {
                  model_pattern: "gpt-4o",
                  max_context_tokens: 256000,
                  max_output_tokens: 32000,
                },
              ],
              4,
            ) as never,
          },
        },
      }));
    });

    expect(await screen.findByText(/changed on disk/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("128000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const comparison = screen.getByTestId("model-limits-revision-comparison");
    expect(comparison).toHaveTextContent("128000");
    expect(comparison).toHaveTextContent("256000");

    fireEvent.click(screen.getByRole("button", { name: "Reapply" }));
    expect(screen.getByDisplayValue("128000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(configSectionsService.putSection).toHaveBeenCalled());
    expect(vi.mocked(configSectionsService.putSection).mock.calls.at(-1)?.[1]).toBe(4);
  });
});
