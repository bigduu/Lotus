import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApiGet, mockApiCtor, mockBackendBaseUrl } = vi.hoisted(() => ({
  mockApiGet: vi.fn(),
  mockApiCtor: vi.fn(),
  mockBackendBaseUrl: vi.fn(() => "http://127.0.0.1:9562/v1"),
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

  class ApiClient {
    constructor(config?: { baseUrl?: string }) {
      mockApiCtor(config);
    }

    get = mockApiGet;
  }

  return { ApiClient, ApiError };
});

vi.mock("../../../shared/utils/backendBaseUrl", () => ({
  getBackendBaseUrlSync: mockBackendBaseUrl,
}));

import { ModelService, ProxyAuthRequiredError } from "../ModelService";

describe("ModelService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (ModelService as any).instance = undefined;
    mockBackendBaseUrl.mockReturnValue("http://127.0.0.1:9562/v1");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("fetches models from OpenAI-compatible models endpoint", async () => {
    mockApiGet.mockResolvedValueOnce({
      data: [{ id: "gpt-5" }, { id: "gpt-4.1" }],
    });

    const service = ModelService.getInstance();
    await expect(service.getModels()).resolves.toEqual(["gpt-5", "gpt-4.1"]);

    expect(mockApiCtor).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:9562/openai/v1",
    });
    expect(mockApiGet).toHaveBeenCalledWith("models");
  });

  it("keeps base url unchanged when already on /openai/v1", async () => {
    mockBackendBaseUrl.mockReturnValue("http://localhost:9562/openai/v1");
    mockApiGet.mockResolvedValueOnce({ data: [] });

    const service = ModelService.getInstance();
    await service.getModels();

    expect(mockApiCtor).toHaveBeenCalledWith({
      baseUrl: "http://localhost:9562/openai/v1",
    });
  });

  it("maps HTTP 428 API errors to ProxyAuthRequiredError", async () => {
    const { ApiError } = await import("../../api");
    mockApiGet.mockRejectedValueOnce(
      new ApiError("Proxy auth required", 428, "Precondition Required"),
    );

    const service = ModelService.getInstance();
    await expect(service.getModels()).rejects.toBeInstanceOf(
      ProxyAuthRequiredError,
    );
  });

  it("maps proxy_auth_required error code to ProxyAuthRequiredError", async () => {
    const { ApiError } = await import("../../api");
    mockApiGet.mockRejectedValueOnce(
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

    const service = ModelService.getInstance();
    await expect(service.getModels()).rejects.toMatchObject({
      message: "Proxy login needed",
      name: "ProxyAuthRequiredError",
    });
  });

  it("rethrows non-proxy errors", async () => {
    const error = new Error("boom");
    mockApiGet.mockRejectedValueOnce(error);

    const service = ModelService.getInstance();
    await expect(service.getModels()).rejects.toThrow("boom");
  });
});
