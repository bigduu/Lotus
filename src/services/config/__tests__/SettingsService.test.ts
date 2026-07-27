import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { SettingsService } from "../SettingsService";

describe("SettingsService", () => {
  let mockApiClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.resetAllMocks();
    const apiModule = await import("../../api");
    mockApiClient = apiModule.apiClient;
  });

  it("calls Copilot auth endpoints", async () => {
    const service = new SettingsService();
    mockApiClient.post.mockResolvedValueOnce({
      authenticated: true,
      message: "ok",
    });
    mockApiClient.post.mockResolvedValueOnce({
      device_code: "dev",
      user_code: "user",
      verification_uri: "https://example.com",
      expires_in: 900,
      interval: 5,
    });
    mockApiClient.post.mockResolvedValueOnce(undefined);
    mockApiClient.post.mockResolvedValueOnce(undefined);
    mockApiClient.post.mockResolvedValueOnce(undefined);

    await expect(service.getCopilotAuthStatus()).resolves.toMatchObject({
      authenticated: true,
    });
    await expect(service.startCopilotAuth()).resolves.toMatchObject({
      device_code: "dev",
      interval: 5,
    });
    await expect(
      service.completeCopilotAuth({
        device_code: "dev",
        interval: 5,
        expires_in: 900,
      }),
    ).resolves.toBeUndefined();
    await expect(service.authenticateCopilot()).resolves.toBeUndefined();
    await expect(service.logoutCopilot()).resolves.toBeUndefined();

    expect(mockApiClient.post).toHaveBeenNthCalledWith(1, "/bamboo/copilot/auth/status");
    expect(mockApiClient.post).toHaveBeenNthCalledWith(2, "/bamboo/copilot/auth/start");
    expect(mockApiClient.post).toHaveBeenNthCalledWith(3, "/bamboo/copilot/auth/complete", {
      device_code: "dev",
      interval: 5,
      expires_in: 900,
    });
    expect(mockApiClient.post).toHaveBeenNthCalledWith(4, "/bamboo/copilot/authenticate");
    expect(mockApiClient.post).toHaveBeenNthCalledWith(5, "/bamboo/copilot/logout");
  });
});
