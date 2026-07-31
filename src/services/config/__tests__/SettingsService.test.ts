import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { SettingsService } from "../SettingsService";

describe("SettingsService", () => {
  let mockApiClient: {
    get: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
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

  it("reads the revisioned permission policy and uses CAS for mutations", async () => {
    const service = new SettingsService();
    const policy = {
      revision: 8,
      loaded_at: "2026-07-31T00:00:00Z",
      source_path: "/tmp/permissions.json",
      source_kind: "primary",
      status: "valid",
      policy: {
        ask_rules: ["Bash(git push *)"],
        durable_rules: [],
      },
    };
    mockApiClient.get.mockResolvedValue(policy);
    mockApiClient.put.mockResolvedValue({ rules: ["Bash(git push *)"], revision: 9 });
    mockApiClient.delete.mockResolvedValue({ ...policy, revision: 10 });

    await expect(service.getPermissionPolicy()).resolves.toEqual(policy);
    await expect(service.updatePermissionAskRules(["Bash(git push *)"], 8)).resolves.toEqual([
      "Bash(git push *)",
    ]);
    await expect(service.deletePermissionRule("remembered:global:req/1", 9)).resolves.toMatchObject(
      {
        revision: 10,
      },
    );

    expect(mockApiClient.get).toHaveBeenCalledWith("/bamboo/permission/policy");
    expect(mockApiClient.put).toHaveBeenCalledWith("/bamboo/permission/ask-rules", {
      rules: ["Bash(git push *)"],
      expected_revision: 8,
    });
    expect(mockApiClient.delete).toHaveBeenCalledWith(
      "/bamboo/permission/rules/remembered%3Aglobal%3Areq%2F1?expected_revision=9",
    );
  });
});
