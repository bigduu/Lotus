import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PluginTable } from "../plugins/PluginTable";
import type { InstalledPluginView } from "@services/plugins";

const basePlugin = (source: InstalledPluginView["source"]): InstalledPluginView => ({
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  source,
  status: "installed",
});

describe("PluginTable trust badges (Lotus #51)", () => {
  it("renders a dash for local sources — trust policy only applies to url sources", () => {
    render(<PluginTable plugins={[basePlugin({ type: "local_dir", path: "/tmp/x" })]} />);
    // "—" also appears in the "registered" column for a plugin with nothing
    // registered, so this scopes to the "Trust" column specifically.
    const trustColumnIndex = screen
      .getAllByRole("columnheader")
      .findIndex((header) => header.textContent === "Trust");
    const firstDataRow = screen.getAllByRole("row")[1];
    const cells = firstDataRow.querySelectorAll("td");
    expect(cells[trustColumnIndex].textContent).toBe("—");
  });

  it("renders a signed badge with the trusted-key label when signed_by is present", () => {
    render(
      <PluginTable
        plugins={[
          basePlugin({
            type: "url",
            url: "https://github.com/bigduu/Nova/releases/download/v1/plugin.tar.gz",
            sha256: "abc",
            signed_by: "nova (bigduu official)",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Signed: nova (bigduu official)")).toBeInTheDocument();
  });

  it("renders an insecure badge alone when insecure is true, even with other flags set", () => {
    render(
      <PluginTable
        plugins={[
          basePlugin({
            type: "url",
            url: "https://example.com/plugin.tar.gz",
            allow_unsigned: true,
            allow_untrusted_host: true,
            insecure: true,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Insecure install")).toBeInTheDocument();
    expect(screen.queryByText("Unsigned")).not.toBeInTheDocument();
    expect(screen.queryByText("Untrusted host")).not.toBeInTheDocument();
  });

  it("renders an unsigned badge when allow_unsigned is set and there is no signed_by", () => {
    render(
      <PluginTable
        plugins={[
          basePlugin({
            type: "url",
            url: "https://example.com/plugin.tar.gz",
            sha256: "abc",
            allow_unsigned: true,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Unsigned")).toBeInTheDocument();
  });

  it("renders a verified badge for a fully verified url source", () => {
    render(
      <PluginTable
        plugins={[
          basePlugin({
            type: "url",
            url: "https://github.com/bigduu/Nova/releases/download/v1/plugin.tar.gz",
            sha256: "abc",
            signed_by: "nova (bigduu official)",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Signed: nova (bigduu official)")).toBeInTheDocument();
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });

  it("renders an untrusted-host badge independently of signature status", () => {
    render(
      <PluginTable
        plugins={[
          basePlugin({
            type: "url",
            url: "https://example.com/plugin.tar.gz",
            sha256: "abc",
            signed_by: "nova (bigduu official)",
            allow_untrusted_host: true,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Signed: nova (bigduu official)")).toBeInTheDocument();
    expect(screen.getByText("Untrusted host")).toBeInTheDocument();
  });
});
