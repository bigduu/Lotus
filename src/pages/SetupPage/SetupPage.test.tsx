import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SetupPage } from "./SetupPage";

const OPEN_PROVIDER_FLAG = "bodhi_open_provider_on_entry";

// Mock fetch globally for HTTP API calls
global.fetch = vi.fn();

describe("SetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = url.toString();

      if (method === "POST" && path.includes("/bamboo/setup/complete")) {
        return {
          ok: true,
          headers: { get: () => "application/json" },
          json: async () => ({ success: true }),
        };
      }

      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({}),
      };
    });
  });

  it("renders welcome heading and description", () => {
    render(<SetupPage />);
    expect(screen.getByText("Welcome to Bodhi")).toBeInTheDocument();
  });

  it("marks setup complete when clicking Get Started without provider flag", async () => {
    render(<SetupPage />);

    fireEvent.click(screen.getByTestId("setup-get-started"));

    await waitFor(() => {
      expect(
        (fetch as any).mock.calls.some(
          (call: any[]) =>
            call[0].includes("/bamboo/setup/complete") &&
            ((call[1]?.method || "GET") as string).toUpperCase() === "POST",
        ),
      ).toBe(true);
    });

    expect(localStorage.getItem(OPEN_PROVIDER_FLAG)).toBeNull();
    expect(await screen.findByText("All Set!")).toBeInTheDocument();
  });

  it("sets provider flag when clicking Configure Provider", async () => {
    render(<SetupPage />);

    fireEvent.click(screen.getByTestId("setup-configure-provider"));

    await waitFor(() => {
      expect(localStorage.getItem(OPEN_PROVIDER_FLAG)).toBe("true");
    });

    expect(await screen.findByText("All Set!")).toBeInTheDocument();
  });

  it("shows error when marking setup completion fails", async () => {
    (fetch as any).mockImplementation(async (url: string, init?: RequestInit) => {
      const method = (init?.method || "GET").toUpperCase();
      const path = url.toString();

      if (method === "POST" && path.includes("/bamboo/setup/complete")) {
        return {
          ok: false,
          status: 400,
          statusText: "Bad Request",
          headers: { get: () => "text/plain" },
          text: async () => "setup failed",
        };
      }

      return {
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({}),
      };
    });

    render(<SetupPage />);

    fireEvent.click(screen.getByTestId("setup-get-started"));

    expect(
      await screen.findByText("Failed to complete setup. Please try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText("All Set!")).toBeNull();
  });
});
