import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PluginInstallModal } from "../plugins/PluginInstallModal";
import type { PluginSource } from "@services/plugins";

describe("PluginInstallModal", () => {
  it("does not send any trust-override flags by default", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PluginInstallModal open mode="install" onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(await screen.findByPlaceholderText("https://example.com/plugin.zip"), {
      target: { value: "https://example.com/plugin.tar.gz" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const source = onSubmit.mock.calls[0][0] as PluginSource;
    expect(source).toEqual({ type: "url", url: "https://example.com/plugin.tar.gz" });
  });

  it("includes only the trust-override flags the user explicitly enabled", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PluginInstallModal open mode="install" onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(await screen.findByPlaceholderText("https://example.com/plugin.zip"), {
      target: { value: "https://example.com/plugin.tar.gz" },
    });

    // Expand the advanced trust-overrides panel.
    fireEvent.click(screen.getByText("Advanced trust overrides"));
    fireEvent.click(await screen.findByTestId("install-allow-unsigned"));

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const source = onSubmit.mock.calls[0][0] as PluginSource;
    expect(source).toEqual({
      type: "url",
      url: "https://example.com/plugin.tar.gz",
      allow_unsigned: true,
    });
  });

  it("sends insecure: true when the aggregate override is enabled", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<PluginInstallModal open mode="install" onCancel={vi.fn()} onSubmit={onSubmit} />);

    fireEvent.change(await screen.findByPlaceholderText("https://example.com/plugin.zip"), {
      target: { value: "https://example.com/plugin.tar.gz" },
    });

    fireEvent.click(screen.getByText("Advanced trust overrides"));
    fireEvent.click(await screen.findByTestId("install-insecure"));

    expect(
      await screen.findByText(/This install will skip one or more supply-chain checks/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Install" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const source = onSubmit.mock.calls[0][0] as PluginSource;
    expect(source).toEqual({
      type: "url",
      url: "https://example.com/plugin.tar.gz",
      insecure: true,
    });
  });

  it("prefills trust-override flags from the current source in update mode", async () => {
    const initialSource: PluginSource = {
      type: "url",
      url: "https://example.com/plugin.tar.gz",
      allow_untrusted_host: true,
      signed_by: "some-key",
    };
    render(
      <PluginInstallModal
        open
        mode="update"
        pluginLabel="my-plugin"
        initialSource={initialSource}
        onCancel={vi.fn()}
        onSubmit={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    fireEvent.click(await screen.findByText("Advanced trust overrides"));
    const toggle = await screen.findByTestId("install-allow-untrusted-host");
    expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
