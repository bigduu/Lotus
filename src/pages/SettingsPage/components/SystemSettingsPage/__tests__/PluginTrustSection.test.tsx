import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configSectionsService } from "@services/config/configSections";
import { useConfigSectionStore } from "@shared/store/configSectionStore";
import PluginTrustSection from "../plugins/PluginTrustSection";

const CONFIGURED_TRUST = {
  trusted_hosts: ["github.com/bigduu/"],
  trusted_keys: [{ label: "nova (bigduu official)", algorithm: "ed25519", public_key: "deadbeef" }],
  enforcement: "strict" as const,
};

const toolsSkillsEnvelope = (pluginTrust = CONFIGURED_TRUST, revision = 5) => ({
  data: pluginTrust ? { tools: { disabled: ["shell"] }, plugin_trust: pluginTrust } : {},
  revision,
  loaded_at: "2026-07-23T00:00:00.000Z",
  source_path: "/tmp/tools-skills.json",
  source_kind: "file" as const,
  status: "healthy" as const,
  last_error: null,
});

describe("PluginTrustSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigSectionStore.getState().reset();
    vi.spyOn(configSectionsService, "getSection").mockResolvedValue(toolsSkillsEnvelope() as never);
    vi.spyOn(configSectionsService, "putSection").mockImplementation(
      async (_section, _revision, data) =>
        ({ ...toolsSkillsEnvelope(undefined, 6), data }) as never,
    );
  });

  afterEach(() => vi.restoreAllMocks());

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
    vi.mocked(configSectionsService.getSection).mockResolvedValue(
      toolsSkillsEnvelope(undefined) as never,
    );
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

    await waitFor(() => expect(configSectionsService.putSection).toHaveBeenCalledTimes(1));
    const [section, revision, patch] = vi.mocked(configSectionsService.putSection).mock.calls[0];
    expect(section).toBe("tools-skills");
    expect(revision).toBe(5);
    expect(patch.plugin_trust?.trusted_keys).toContainEqual({
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

    await waitFor(() => expect(configSectionsService.putSection).toHaveBeenCalledTimes(1));
    const [, , patch] = vi.mocked(configSectionsService.putSection).mock.calls[0];
    expect(patch.plugin_trust?.trusted_keys).toEqual([]);
  });

  it("saves an added trusted host", async () => {
    render(<PluginTrustSection />);
    const hostsSelect = await screen.findByTestId("trust-hosts");
    const input = hostsSelect.querySelector("input");
    expect(input).toBeTruthy();

    fireEvent.change(input as HTMLInputElement, { target: { value: "example.com," } });

    fireEvent.click(screen.getByTestId("trust-save-button"));

    await waitFor(() => expect(configSectionsService.putSection).toHaveBeenCalledTimes(1));
    const [, , patch] = vi.mocked(configSectionsService.putSection).mock.calls[0];
    expect(patch.plugin_trust?.trusted_hosts).toContain("example.com");
    expect(patch.plugin_trust?.trusted_hosts).toContain("github.com/bigduu/");
  });

  it("adopts a newer plugin-trust snapshot while the editor is clean", async () => {
    render(<PluginTrustSection />);
    const label = (await screen.findByTestId("trust-key-label-0")) as HTMLInputElement;

    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          "tools-skills": {
            ...state.sections["tools-skills"],
            envelope: toolsSkillsEnvelope(
              {
                ...CONFIGURED_TRUST,
                trusted_keys: [
                  {
                    ...CONFIGURED_TRUST.trusted_keys[0],
                    label: "remote publisher",
                  },
                ],
              },
              6,
            ),
          },
        },
      }));
    });

    await waitFor(() => expect(label).toHaveValue("remote publisher"));
    expect(screen.queryByText(/changed on disk/i)).not.toBeInTheDocument();
  });

  it("preserves, compares, and explicitly reapplies a dirty trust draft", async () => {
    render(<PluginTrustSection />);
    const label = (await screen.findByTestId("trust-key-label-0")) as HTMLInputElement;
    fireEvent.change(label, { target: { value: "local publisher" } });

    act(() => {
      useConfigSectionStore.setState((state) => ({
        sections: {
          ...state.sections,
          "tools-skills": {
            ...state.sections["tools-skills"],
            envelope: toolsSkillsEnvelope(
              {
                ...CONFIGURED_TRUST,
                trusted_keys: [
                  {
                    ...CONFIGURED_TRUST.trusted_keys[0],
                    label: "remote publisher",
                  },
                ],
              },
              6,
            ),
          },
        },
      }));
    });

    expect(await screen.findByText(/changed on disk/i)).toBeInTheDocument();
    expect(label).toHaveValue("local publisher");
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    const comparison = screen.getByTestId("plugin-trust-revision-comparison");
    expect(comparison).toHaveTextContent("local publisher");
    expect(comparison).toHaveTextContent("remote publisher");

    fireEvent.click(screen.getByRole("button", { name: "Reapply" }));
    expect(label).toHaveValue("local publisher");
    fireEvent.click(screen.getByTestId("trust-save-button"));
    await waitFor(() => expect(configSectionsService.putSection).toHaveBeenCalled());
    expect(vi.mocked(configSectionsService.putSection).mock.calls[0]?.[1]).toBe(6);
  });
});
