import { describe, expect, it, vi } from "vitest";

const { mockGet } = vi.hoisted(() => ({ mockGet: vi.fn() }));

vi.mock("../../api", () => ({
  agentApiClient: { get: mockGet, post: vi.fn(), delete: vi.fn() },
}));

import { PluginsService } from "../PluginsService";

describe("PluginsService normalizePlugin — service_ids / service_status (Lotus #52)", () => {
  it("carries through registered.service_ids from the wire response", async () => {
    mockGet.mockResolvedValue({
      plugins: [
        {
          id: "p1",
          version: "1.0.0",
          status: "installed",
          source: { type: "local_dir", path: "/x" },
          registered: { service_ids: ["svc-a", "svc-b"] },
        },
      ],
    });

    const plugins = await new PluginsService().getPlugins();
    expect(plugins[0].registered).toEqual({ service_ids: ["svc-a", "svc-b"] });
  });

  it("normalizes a full service_status entry, including optional pid/last_error", async () => {
    mockGet.mockResolvedValue({
      plugins: [
        {
          id: "p1",
          version: "1.0.0",
          status: "installed",
          source: { type: "local_dir", path: "/x" },
          service_status: [
            { id: "svc-a", state: "running", pid: 4242, restart_count: 1, last_error: "boom" },
          ],
        },
      ],
    });

    const plugins = await new PluginsService().getPlugins();
    expect(plugins[0].service_status).toEqual([
      { id: "svc-a", state: "running", pid: 4242, restart_count: 1, last_error: "boom" },
    ]);
  });

  it("leaves pid/last_error undefined when absent from the wire response", async () => {
    mockGet.mockResolvedValue({
      plugins: [
        {
          id: "p1",
          version: "1.0.0",
          status: "installed",
          source: { type: "local_dir", path: "/x" },
          service_status: [{ id: "svc-a", state: "stopped", restart_count: 0 }],
        },
      ],
    });

    const plugins = await new PluginsService().getPlugins();
    expect(plugins[0].service_status).toEqual([
      { id: "svc-a", state: "stopped", restart_count: 0, pid: undefined, last_error: undefined },
    ]);
  });

  it("leaves service_status undefined when absent from the wire response (no services)", async () => {
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
    expect(plugins[0].service_status).toBeUndefined();
  });

  it("falls back an unrecognized/malformed state string to 'stopped' defensively", async () => {
    mockGet.mockResolvedValue({
      plugins: [
        {
          id: "p1",
          version: "1.0.0",
          status: "installed",
          source: { type: "local_dir", path: "/x" },
          service_status: [{ id: "svc-a", state: "not-a-real-state", restart_count: 0 }],
        },
      ],
    });

    const plugins = await new PluginsService().getPlugins();
    expect(plugins[0].service_status?.[0].state).toBe("stopped");
  });

  it("drops a service_status entry with no id rather than rendering a blank row", async () => {
    mockGet.mockResolvedValue({
      plugins: [
        {
          id: "p1",
          version: "1.0.0",
          status: "installed",
          source: { type: "local_dir", path: "/x" },
          service_status: [{ state: "running", restart_count: 0 }],
        },
      ],
    });

    const plugins = await new PluginsService().getPlugins();
    expect(plugins[0].service_status).toBeUndefined();
  });
});
