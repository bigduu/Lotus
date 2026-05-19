import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchCatalogModels } = vi.hoisted(() => ({
  fetchCatalogModels: vi.fn(),
}));

vi.mock("../../api", () => {
  class ApiError extends Error {
    status: number;
    statusText: string;
    body?: string;

    constructor(message: string, status: number, statusText: string, body?: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.statusText = statusText;
      this.body = body;
    }
  }

  return { ApiError };
});

vi.mock("../../config/SettingsService", () => ({
  settingsService: {
    fetchCatalogModels,
  },
}));

import { ApiError } from "../../api";
import { ModelService, ProxyAuthRequiredError } from "../ModelService";

describe("ModelService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (ModelService as unknown as { instance?: ModelService }).instance = undefined;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("fetches and deduplicates catalog models", async () => {
    fetchCatalogModels.mockResolvedValueOnce({
      fetched: [
        {
          provider: "openai-main",
          models: [
            { reference: { provider: "openai-main", model: "gpt-4.1" } },
            { reference: { provider: "openai-main", model: "gpt-4.1-mini" } },
          ],
        },
        {
          provider: "copilot-main",
          models: [
            { reference: { provider: "copilot-main", model: "gpt-4.1" } },
            { reference: { provider: "copilot-main", model: "gpt-5.4" } },
          ],
        },
      ],
    });

    await expect(ModelService.getInstance().getModels()).resolves.toEqual([
      "gpt-4.1",
      "gpt-4.1-mini",
      "gpt-5.4",
    ]);
  });

  it("passes through the requested provider identifier", async () => {
    fetchCatalogModels.mockResolvedValueOnce({ fetched: [] });

    await ModelService.getInstance().getModels("copilot-main");

    expect(fetchCatalogModels).toHaveBeenCalledWith("copilot-main");
  });

  it("maps HTTP 428 API errors to ProxyAuthRequiredError", async () => {
    fetchCatalogModels.mockRejectedValueOnce(
      new ApiError("Proxy auth required", 428, "Precondition Required"),
    );

    await expect(ModelService.getInstance().getModels()).rejects.toBeInstanceOf(
      ProxyAuthRequiredError,
    );
  });

  it("maps proxy_auth_required error code to ProxyAuthRequiredError", async () => {
    fetchCatalogModels.mockRejectedValueOnce(
      new ApiError(
        "Request failed",
        500,
        "Server Error",
        JSON.stringify({
          error: {
            code: "proxy_auth_required",
            message: "Proxy login needed",
          },
        }),
      ),
    );

    await expect(ModelService.getInstance().getModels()).rejects.toMatchObject({
      message: "Proxy login needed",
      name: "ProxyAuthRequiredError",
    });
  });

  it("rethrows non-proxy errors", async () => {
    fetchCatalogModels.mockRejectedValueOnce(new Error("boom"));

    await expect(ModelService.getInstance().getModels()).rejects.toThrow("boom");
  });
});
