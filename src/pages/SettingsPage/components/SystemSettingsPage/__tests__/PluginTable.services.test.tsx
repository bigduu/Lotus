import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PluginTable } from "../plugins/PluginTable";
import type { InstalledPluginView } from "@services/plugins";

const basePlugin = (overrides: Partial<InstalledPluginView> = {}): InstalledPluginView => ({
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",
  source: { type: "local_dir", path: "/tmp/x" },
  status: "installed",
  ...overrides,
});

const getColumnIndex = (label: string): number =>
  screen.getAllByRole("columnheader").findIndex((header) => header.textContent === label);

describe("PluginTable service status (Lotus #52)", () => {
  it("renders a services chip in the Registered column when service_ids is present", () => {
    render(
      <PluginTable
        plugins={[
          basePlugin({
            registered: { mcp_server_ids: ["srv-1"], service_ids: ["svc-a", "svc-b"] },
          }),
        ]}
      />,
    );
    expect(screen.getByText("2 services")).toBeInTheDocument();
  });

  it("renders a dash in the Service Status column when service_status is absent", () => {
    render(<PluginTable plugins={[basePlugin()]} />);
    const columnIndex = getColumnIndex("Service Status");
    const firstDataRow = screen.getAllByRole("row")[1];
    const cells = firstDataRow.querySelectorAll("td");
    expect(cells[columnIndex].textContent).toBe("—");
  });

  it("renders a state tag per service, colored/labeled by its live ServiceState", () => {
    render(
      <PluginTable
        plugins={[
          basePlugin({
            service_status: [
              { id: "svc-a", state: "running", pid: 4242, restart_count: 0 },
              { id: "svc-b", state: "crashed", restart_count: 3, last_error: "exit code 1" },
            ],
          }),
        ]}
      />,
    );
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Crashed")).toBeInTheDocument();
  });

  it("surfaces pid, restart_count, and last_error via a tooltip rather than inline text", () => {
    render(
      <PluginTable
        plugins={[
          basePlugin({
            service_status: [
              {
                id: "svc-a",
                state: "degraded",
                pid: 777,
                restart_count: 2,
                last_error: "health check timed out",
              },
            ],
          }),
        ]}
      />,
    );
    // The tag itself only shows the state label — details are tooltip-only.
    expect(screen.getByText("Degraded")).toBeInTheDocument();
    expect(screen.queryByText("777", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/health check timed out/)).not.toBeInTheDocument();
  });

  it("does not render start/stop/restart action buttons — status visibility only", () => {
    render(
      <PluginTable
        plugins={[
          basePlugin({
            service_status: [{ id: "svc-a", state: "running", pid: 1, restart_count: 0 }],
          }),
        ]}
      />,
    );
    expect(screen.queryByRole("button", { name: /start/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /restart/i })).not.toBeInTheDocument();
  });
});
