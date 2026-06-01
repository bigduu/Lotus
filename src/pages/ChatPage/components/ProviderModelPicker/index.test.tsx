import { render, screen, waitFor } from "@testing-library/react";
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
      selector(
        makeStore({
          catalog: {
            providers: [],
            models: [
              {
                reference: { provider: "openai", model: "gpt-4o" },
                display_name: "gpt-4o",
                provider_display_name: "OpenAI",
                capabilities: { supports_vision: false },
              },
            ],
          },
        }),
      ),
    );

    render(
      <ProviderModelPicker onChange={vi.fn()} value={{ provider: "openai", model: "gpt-4o" }} />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByTitle("Fetch all provider models")).not.toBeInTheDocument();
  });
  it("renders a higher-contrast button appearance when requested", () => {
    vi.mocked(useProviderStore).mockImplementation((selector: any) =>
      selector(
        makeStore({
          catalog: {
            providers: [],
            models: [
              {
                reference: { provider: "openai", model: "gpt-4o" },
                display_name: "gpt-4o",
                provider_display_name: "OpenAI",
                capabilities: { supports_vision: false },
              },
            ],
          },
        }),
      ),
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
