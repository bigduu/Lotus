import { describe, expect, it, vi } from "vitest";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("../../api", () => ({
  agentApiClient: { get: mockGet, post: vi.fn(), delete: vi.fn() },
}));

import { PluginsService } from "../PluginsService";

describe("PluginsService normalizeSource — url trust fields (Lotus #51)", () => {
  it("carries through all trust-override flags and signed_by from the wire response", async () => {
    mockGet.mockResolvedValue({
      plugins: [
        {
          id: "p1",
          version: "1.0.0",
          status: "installed",
          source: {
            type: "url",
            url: "https://github.com/bigduu/Nova/releases/download/v1/plugin.tar.gz",
            sha256: "abc123",
            allow_unverified: false,
            allow_untrusted_host: false,
            allow_unsigned: false,
            insecure: false,
            signed_by: "nova (bigduu official)",
          },
        },
      ],
    });

    const plugins = await new PluginsService().getPlugins();
    expect(plugins[0].source).toEqual({
      type: "url",
      url: "https://github.com/bigduu/Nova/releases/download/v1/plugin.tar.gz",
      sha256: "abc123",
      allow_unverified: false,
      allow_untrusted_host: false,
      allow_unsigned: false,
      insecure: false,
      signed_by: "nova (bigduu official)",
    });
  });

  it("leaves trust fields undefined when absent from the wire response (older/local rows)", async () => {
    mockGet.mockResolvedValue({
      plugins: [
        {
          id: "p1",
          version: "1.0.0",
          status: "installed",
          source: { type: "url", url: "https://example.com/plugin.tar.gz" },
        },
      ],
    });

    const plugins = await new PluginsService().getPlugins();
    const source = plugins[0].source as Record<string, unknown>;
    expect(source.allow_unverified).toBeUndefined();
    expect(source.allow_untrusted_host).toBeUndefined();
    expect(source.allow_unsigned).toBeUndefined();
    expect(source.insecure).toBeUndefined();
    expect(source.signed_by).toBeUndefined();
  });

  it("does not attach trust fields to non-url sources", async () => {
    mockGet.mockResolvedValue({
      plugins: [
        {
          id: "p1",
          version: "1.0.0",
          status: "installed",
          source: { type: "local_dir", path: "/x" },
        },
      ],
    });

    const plugins = await new PluginsService().getPlugins();
    expect(plugins[0].source).toEqual({ type: "local_dir", path: "/x" });
  });
});
