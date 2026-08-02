import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderModelPicker } from "./index";
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice";

vi.mock("@shared/store/appStore/slices/providerSlice", () => ({
  useProviderStore: vi.fn(),
}));

describe("ProviderModelPicker", () => {
  const loadCatalog = vi.fn();

  const makeStore = (overrides?: Record<string, unknown>) => ({
    catalog: null,
    loadCatalog,
    getProviderDisplayLabel: (provider: string) => provider,
    ...overrides,
  });

  const modelCatalog = {
    providers: [],
    models: [
      {
        reference: { provider: "anthropic", model: "claude-opus-4-7" },
        display_name: "Claude Opus 4.7",
        provider_display_name: "Anthropic",
        capabilities: { supports_vision: true },
      },
      {
        reference: { provider: "anthropic", model: "claude-sonnet-4-6" },
        display_name: "Claude Sonnet 4.6",
        provider_display_name: "Anthropic",
        capabilities: { supports_vision: false },
      },
      {
        reference: { provider: "openai", model: "gpt-4o" },
        display_name: "GPT-4o",
        provider_display_name: "OpenAI",
        capabilities: { supports_vision: true },
      },
    ],
  };

  const renderWithCatalog = (onChange = vi.fn()) => {
    vi.mocked(useProviderStore).mockImplementation((selector: any) =>
      selector(makeStore({ catalog: modelCatalog })),
    );

    render(
      <ProviderModelPicker
        dataTestId="model-picker"
        onChange={onChange}
        value={{ provider: "anthropic", model: "claude-sonnet-4-6" }}
      />,
    );

    return onChange;
  };

  const openSearch = async () => {
    fireEvent.click(screen.getByTestId("model-picker"));
    return screen.findByTestId("provider-model-search");
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useProviderStore).mockImplementation((selector: any) => selector(makeStore()));
    (
      useProviderStore as unknown as { getState: () => { loadCatalog: () => Promise<void> | void } }
    ).getState = () => ({ loadCatalog });
  });

  it("loads catalog automatically when missing", async () => {
    render(<ProviderModelPicker onChange={vi.fn()} value={null} />);

    await waitFor(() => {
      expect(loadCatalog).toHaveBeenCalledTimes(1);
    });
  });

  it("does not render an extra refresh button", () => {
    vi.mocked(useProviderStore).mockImplementation((selector: any) =>
      selector(makeStore({ catalog: modelCatalog })),
    );

    render(
      <ProviderModelPicker onChange={vi.fn()} value={{ provider: "openai", model: "gpt-4o" }} />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByTitle("Fetch all provider models")).not.toBeInTheDocument();
  });

  it("supports fuzzy model search while preserving provider groups", async () => {
    renderWithCatalog();

    const search = await openSearch();
    fireEvent.change(search, { target: { value: "opus47" } });

    await waitFor(() => {
      expect(screen.getByText("Anthropic")).toBeInTheDocument();
      expect(screen.getByText("Claude Opus 4.7")).toBeInTheDocument();
      expect(screen.queryByText("Claude Sonnet 4.6")).not.toBeInTheDocument();
      expect(screen.queryByText("GPT-4o")).not.toBeInTheDocument();
    });
  });

  it("searches provider names case-insensitively", async () => {
    renderWithCatalog();

    const search = await openSearch();
    fireEvent.change(search, { target: { value: "OPENAI" } });

    await waitFor(() => {
      expect(screen.getByText("OpenAI")).toBeInTheDocument();
      expect(screen.getByText("GPT-4o")).toBeInTheDocument();
      expect(screen.queryByText("Anthropic")).not.toBeInTheDocument();
    });
  });

  it("shows an empty state when no models match", async () => {
    renderWithCatalog();

    const search = await openSearch();
    fireEvent.change(search, { target: { value: "definitely-no-match" } });

    expect(await screen.findByText("No models available")).toBeInTheDocument();
    expect(screen.queryByText("Claude Opus 4.7")).not.toBeInTheDocument();
    expect(screen.queryByText("GPT-4o")).not.toBeInTheDocument();
  });

  it("selects a filtered model and clears the query when reopened", async () => {
    const onChange = renderWithCatalog();

    const search = await openSearch();
    fireEvent.change(search, { target: { value: "opus47" } });
    fireEvent.click(await screen.findByText("Claude Opus 4.7"));

    expect(onChange).toHaveBeenCalledWith({
      provider: "anthropic",
      model: "claude-opus-4-7",
    });

    fireEvent.click(screen.getByTestId("model-picker"));
    await waitFor(() => expect(screen.getByTestId("provider-model-search")).toHaveValue(""));
    expect(await screen.findByText("Claude Sonnet 4.6")).toBeInTheDocument();
  });

  it("selects the first filtered result with the keyboard", async () => {
    const onChange = renderWithCatalog();

    const search = await openSearch();
    fireEvent.change(search, { target: { value: "opus47" } });
    const firstResult = await screen.findByText("Claude Opus 4.7");
    const firstResultItem = firstResult.closest("li") as HTMLElement;
    fireEvent.keyDown(search, { key: "ArrowDown" });

    expect(firstResultItem).toHaveFocus();
    fireEvent.keyDown(firstResultItem, {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({
      provider: "anthropic",
      model: "claude-opus-4-7",
    });
  });

  it("renders a higher-contrast button appearance when requested", () => {
    vi.mocked(useProviderStore).mockImplementation((selector: any) =>
      selector(makeStore({ catalog: modelCatalog })),
    );

    render(
      <ProviderModelPicker
        onChange={vi.fn()}
        value={{ provider: "openai", model: "gpt-4o" }}
        appearance="contrast"
      />,
    );

    const button = screen.getByRole("button");
    expect(button.className).toContain("ant-btn-default");
  });
});
