import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { SettingsService, settingsService } from "../SettingsService";

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

  it("gets and saves provider config", async () => {
    const config = { provider: "openai", model: "gpt-5" };
    mockApiClient.get.mockResolvedValueOnce(config);
    mockApiClient.post.mockResolvedValueOnce(undefined);

    await expect(settingsService.getProviderConfig()).resolves.toEqual(config);
    await expect(settingsService.saveProviderConfig(config)).resolves.toBeUndefined();

    expect(mockApiClient.get).toHaveBeenCalledWith("/bamboo/settings/provider");
    expect(mockApiClient.post).toHaveBeenCalledWith("/bamboo/settings/provider", config);
  });

  it("calls Copilot auth endpoints", async () => {
    const service = new SettingsService();
    mockApiClient.post.mockResolvedValueOnce(undefined);
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

    await expect(service.reloadConfig()).resolves.toBeUndefined();
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

    expect(mockApiClient.post).toHaveBeenNthCalledWith(1, "/bamboo/settings/reload");
    expect(mockApiClient.post).toHaveBeenNthCalledWith(2, "/bamboo/copilot/auth/status");
    expect(mockApiClient.post).toHaveBeenNthCalledWith(3, "/bamboo/copilot/auth/start");
    expect(mockApiClient.post).toHaveBeenNthCalledWith(4, "/bamboo/copilot/auth/complete", {
      device_code: "dev",
      interval: 5,
      expires_in: 900,
    });
    expect(mockApiClient.post).toHaveBeenNthCalledWith(5, "/bamboo/copilot/authenticate");
    expect(mockApiClient.post).toHaveBeenNthCalledWith(6, "/bamboo/copilot/logout");
  });

  it("fetches provider models from backend", async () => {
    const service = new SettingsService();
    mockApiClient.post.mockResolvedValueOnce({ models: ["gpt-5", "gpt-4.1"] });

    await expect(service.fetchProviderModels("openai")).resolves.toEqual(["gpt-5", "gpt-4.1"]);
    expect(mockApiClient.post).toHaveBeenCalledWith("/bamboo/settings/provider/models", {
      provider: "openai",
    });
  });
});
