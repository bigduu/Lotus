import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBootstrapCritical, mockBootstrapDeferred } = vi.hoisted(() => ({
  mockBootstrapCritical: vi.fn().mockResolvedValue(undefined),
  mockBootstrapDeferred: vi.fn().mockResolvedValue(undefined),
}));

// Mock fetch globally
global.fetch = vi.fn();

vi.mock("../MainLayout", () => ({
  MainLayout: () => <div>MainLayout</div>,
}));

vi.mock("../../pages/SetupPage", () => ({
  SetupPage: () => <div>SetupPage</div>,
}));

vi.mock("@shared/store/appStore", () => ({
  bootstrapCritical: mockBootstrapCritical,
  bootstrapDeferred: mockBootstrapDeferred,
}));

import App from "../App";

const mockSetupStatus = (status: {
  is_complete: boolean;
  has_proxy_config: boolean;
  has_proxy_env: boolean;
  message: string;
}) => {
  (fetch as any).mockImplementation(async () => ({
    ok: true,
    json: async () => status,
  }));
};

describe("App setup flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBootstrapCritical.mockResolvedValue(undefined);
    mockBootstrapDeferred.mockResolvedValue(undefined);
  });

  it("renders SetupPage when setup has not been completed", async () => {
    mockSetupStatus({
      is_complete: false,
      has_proxy_config: false,
      has_proxy_env: true,
      message:
        "Detected proxy environment variables: HTTP_PROXY. You may need to configure proxy settings.",
    });

    render(<App />);

    // findByText can resolve to a node that a settling re-render then
    // detaches (the loading → setup state transition remounts once) — wrap
    // the whole assertion in waitFor so a transient detach retries instead
    // of failing with a stale element.
    await waitFor(() => {
      expect(screen.getByText("SetupPage")).toBeInTheDocument();
    });
    expect(screen.queryByText("MainLayout")).toBeNull();
    expect(mockBootstrapCritical).not.toHaveBeenCalled();
  });

  it("renders MainLayout and initializes store when proxy config exists", async () => {
    mockSetupStatus({
      is_complete: true,
      has_proxy_config: true,
      has_proxy_env: true,
      message: "Setup already completed.",
    });

    render(<App />);

    expect(await screen.findByText("MainLayout")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockBootstrapCritical).toHaveBeenCalledTimes(1);
    });
  });

  it("renders MainLayout when backend marks setup complete", async () => {
    mockSetupStatus({
      is_complete: true,
      has_proxy_config: false,
      has_proxy_env: true,
      message: "Setup already completed.",
    });

    render(<App />);

    expect(await screen.findByText("MainLayout")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockBootstrapCritical).toHaveBeenCalledTimes(1);
    });
  });

  it("skips setup when backend reports no setup needed", async () => {
    mockSetupStatus({
      is_complete: true,
      has_proxy_config: false,
      has_proxy_env: false,
      message: "No proxy environment variables detected. You can proceed without proxy.",
    });

    render(<App />);

    expect(await screen.findByText("MainLayout")).toBeInTheDocument();
    await waitFor(() => {
      expect(mockBootstrapCritical).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a backend-unreachable message (instead of assuming setup is incomplete) when setup status check fails", async () => {
    // Return a non-5xx failure so ApiClient does not spend time on exponential retries.
    (fetch as any).mockImplementation(async () => ({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      headers: { get: () => "text/plain" },
      text: async () => "backend unavailable",
    }));

    render(<App />);

    expect(
      await screen.findByText(/Backend not reachable at/i, {}, { timeout: 10000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("MainLayout")).toBeNull();
    expect(screen.queryByText("SetupPage")).toBeNull();
  }, 20000);
});
