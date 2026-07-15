import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PluginTrustSection from "../plugins/PluginTrustSection";

const { mockGetBambooConfig, mockSetBambooConfig } = vi.hoisted(() => ({
  mockGetBambooConfig: vi.fn(),
  mockSetBambooConfig: vi.fn(),
}));

vi.mock("@services/common/ServiceFactory", () => ({
  serviceFactory: {
    getBambooConfig: mockGetBambooConfig,
    setBambooConfig: mockSetBambooConfig,
  },
}));

const CONFIGURED_TRUST = {
  trusted_hosts: ["github.com/bigduu/"],
  trusted_keys: [{ label: "nova (bigduu official)", algorithm: "ed25519", public_key: "deadbeef" }],
  enforcement: "strict" as const,
};

describe("PluginTrustSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetBambooConfig.mockResolvedValue({ plugin_trust: CONFIGURED_TRUST });
    mockSetBambooConfig.mockResolvedValue({ plugin_trust: CONFIGURED_TRUST });
  });

  it("loads trusted hosts and keys from the server response", async () => {
    render(<PluginTrustSection />);

    await screen.findByTestId("trust-hosts");
    expect(screen.getByText("github.com/bigduu/")).toBeInTheDocument();
    expect((await screen.findByTestId("trust-key-label-0")) as HTMLInputElement).toHaveValue(
      "nova (bigduu official)",
    );
    expect((await screen.findByTestId("trust-key-public-key-0")) as HTMLInputElement).toHaveValue(
      "deadbeef",
    );
  });

  it("defaults enforcement to strict when absent from the config", async () => {
    mockGetBambooConfig.mockResolvedValue({});
    render(<PluginTrustSection />);

    const segmented = await screen.findByTestId("trust-enforcement");
    expect(segmented.querySelector(".ant-segmented-item-selected")?.textContent).toContain(
      "Strict",
    );
  });

  it("shows a strong warning when enforcement is switched to Off", async () => {
    render(<PluginTrustSection />);
    await screen.findByTestId("trust-enforcement");

    fireEvent.click(screen.getByText("Off (insecure)"));

    expect(
      await screen.findByText(/All trust checks are disabled for URL installs/i),
    ).toBeInTheDocument();
  });

  it("adds a new trusted key row and includes it in the save payload", async () => {
    render(<PluginTrustSection />);
    await screen.findByTestId("trust-key-label-0");

    fireEvent.click(screen.getByTestId("trust-key-add"));
    const newLabel = await screen.findByTestId("trust-key-label-1");
    fireEvent.change(newLabel, { target: { value: "my-key" } });
    fireEvent.change(screen.getByTestId("trust-key-public-key-1"), {
      target: { value: "cafebabe" },
    });

    fireEvent.click(screen.getByTestId("trust-save-button"));

    await waitFor(() => expect(mockSetBambooConfig).toHaveBeenCalledTimes(1));
    const patch = mockSetBambooConfig.mock.calls[0][0];
    expect(patch.plugin_trust.trusted_keys).toContainEqual({
      label: "my-key",
      algorithm: "ed25519",
      public_key: "cafebabe",
    });
  });

  it("removes a trusted key row", async () => {
    render(<PluginTrustSection />);
    await screen.findByTestId("trust-key-remove-0");

    fireEvent.click(screen.getByTestId("trust-key-remove-0"));
    fireEvent.click(screen.getByTestId("trust-save-button"));

    await waitFor(() => expect(mockSetBambooConfig).toHaveBeenCalledTimes(1));
    const patch = mockSetBambooConfig.mock.calls[0][0];
    expect(patch.plugin_trust.trusted_keys).toEqual([]);
  });

  it("saves an added trusted host", async () => {
    render(<PluginTrustSection />);
    const hostsSelect = await screen.findByTestId("trust-hosts");
    const input = hostsSelect.querySelector("input");
    expect(input).toBeTruthy();

    fireEvent.change(input as HTMLInputElement, { target: { value: "example.com," } });

    fireEvent.click(screen.getByTestId("trust-save-button"));

    await waitFor(() => expect(mockSetBambooConfig).toHaveBeenCalledTimes(1));
    const patch = mockSetBambooConfig.mock.calls[0][0];
    expect(patch.plugin_trust.trusted_hosts).toContain("example.com");
    expect(patch.plugin_trust.trusted_hosts).toContain("github.com/bigduu/");
  });
});
