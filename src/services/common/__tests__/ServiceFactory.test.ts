import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ServiceFactory } from "../ServiceFactory";
import { apiClient } from "../../api";
import { copyText } from "@shared/utils/clipboard";
import { clearBackendBaseUrlOverride, setBackendBaseUrl } from "@shared/utils/backendBaseUrl";

// Mock dependencies
vi.mock("../../api", () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@shared/utils/clipboard", () => ({
  copyText: vi.fn(),
}));

describe("ServiceFactory", () => {
  let serviceFactory: ServiceFactory;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const serviceFactoryClass = ServiceFactory as unknown as {
    instance?: ServiceFactory;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset singleton instance for deterministic tests.
    serviceFactoryClass.instance = undefined;
    serviceFactory = ServiceFactory.getInstance();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("Singleton Pattern", () => {
    it("should return the same instance", () => {
      const instance1 = ServiceFactory.getInstance();
      const instance2 = ServiceFactory.getInstance();
      expect(instance1).toBe(instance2);
    });

    it("should create new instance only once", () => {
      serviceFactoryClass.instance = undefined;

      const instance1 = ServiceFactory.getInstance();
      const instance2 = ServiceFactory.getInstance();

      expect(instance1).toBe(instance2);
    });
  });

  describe("copyToClipboard", () => {
    it("should call copyText with provided text", async () => {
      const testText = "test clipboard content";
      vi.mocked(copyText).mockResolvedValueOnce(undefined);

      await serviceFactory.copyToClipboard(testText);

      expect(copyText).toHaveBeenCalledWith(testText);
      expect(copyText).toHaveBeenCalledTimes(1);
    });

    it("should propagate copyText errors", async () => {
      const testText = "test";
      const error = new Error("Clipboard failed");
      vi.mocked(copyText).mockRejectedValueOnce(error);

      await expect(serviceFactory.copyToClipboard(testText)).rejects.toThrow("Clipboard failed");
    });
  });

  describe("Bamboo Config", () => {
    describe("getBambooConfig", () => {
      it("should fetch config successfully", async () => {
        const mockConfig = { model: "test-model", api_key: "test-key" };
        vi.mocked(apiClient.get).mockResolvedValueOnce(mockConfig);

        const result = await serviceFactory.getBambooConfig();

        expect(result).toEqual(mockConfig);
        expect(apiClient.get).toHaveBeenCalledWith("bamboo/config");
      });

      it("should return empty object on error", async () => {
        vi.mocked(apiClient.get).mockRejectedValueOnce(new Error("Network error"));

        const result = await serviceFactory.getBambooConfig();

        expect(result).toEqual({});
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Failed to fetch Bamboo config:",
          expect.any(Error),
        );
      });
    });

    describe("getBambooTools", () => {
      it("should fetch available tools successfully", async () => {
        const mockTools = { tools: ["bash", "read_file"] };
        vi.mocked(apiClient.get).mockResolvedValueOnce(mockTools);

        const result = await serviceFactory.getBambooTools();

        expect(result).toEqual(mockTools);
        expect(apiClient.get).toHaveBeenCalledWith("bamboo/tools");
      });

      it("should return empty tools list on error", async () => {
        vi.mocked(apiClient.get).mockRejectedValueOnce(new Error("Network error"));

        const result = await serviceFactory.getBambooTools();

        expect(result).toEqual({ tools: [] });
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Failed to fetch Bamboo tools:",
          expect.any(Error),
        );
      });
    });

    describe("getModelLimitDefaults", () => {
      it("should fetch backend model limit defaults", async () => {
        const mockDefaults = {
          model_limits: [
            {
              model_pattern: "gpt-5.4",
              max_context_tokens: 1050000,
              max_output_tokens: 32768,
              safety_margin: 1000,
            },
          ],
        };
        vi.mocked(apiClient.get).mockResolvedValueOnce(mockDefaults);

        const result = await serviceFactory.getModelLimitDefaults();

        expect(result).toEqual(mockDefaults);
        expect(apiClient.get).toHaveBeenCalledWith("bamboo/model-limits/defaults");
      });

      it("should return empty defaults on error", async () => {
        vi.mocked(apiClient.get).mockRejectedValueOnce(new Error("Network error"));

        const result = await serviceFactory.getModelLimitDefaults();

        expect(result).toEqual({ model_limits: [] });
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Failed to fetch model limit defaults:",
          expect.any(Error),
        );
      });
    });

    describe("setBambooConfig", () => {
      it("should post config successfully", async () => {
        const inputConfig = { model: "new-model" };
        const responseConfig = { model: "new-model", api_key: "saved" };
        vi.mocked(apiClient.post).mockResolvedValueOnce(responseConfig);

        const result = await serviceFactory.setBambooConfig(inputConfig);

        expect(result).toEqual(responseConfig);
        expect(apiClient.post).toHaveBeenCalledWith("bamboo/config", inputConfig);
      });
    });

    describe("validateBambooConfigPatch", () => {
      it("should validate config patch", async () => {
        const patch = { api_key: "test" };
        const mockResponse = { valid: true, errors: {} };
        vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

        const result = await serviceFactory.validateBambooConfigPatch(patch);

        expect(result).toEqual(mockResponse);
        expect(apiClient.post).toHaveBeenCalledWith("bamboo/config/validate", patch);
      });
    });

    describe("testLifecycleHook", () => {
      it("should post a lifecycle hook dry-run request", async () => {
        const payload = {
          event: "PreToolUse" as const,
          matcher: "^Bash$",
          command: "printf dry-run",
          timeout_ms: 2_000,
        };
        const mockResponse = {
          exit_code: 0,
          stdout: "dry-run",
          stderr: "",
          timed_out: false,
          stdout_truncated: false,
          stderr_truncated: false,
        };
        vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

        const result = await serviceFactory.testLifecycleHook(payload);

        expect(result).toEqual(mockResponse);
        expect(apiClient.post).toHaveBeenCalledWith("bamboo/hooks/test", payload);
      });
    });

    describe("resetBambooConfig", () => {
      it("should reset config", async () => {
        const mockResponse = { success: true };
        vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

        const result = await serviceFactory.resetBambooConfig();

        expect(result).toEqual(mockResponse);
        expect(apiClient.post).toHaveBeenCalledWith("bamboo/config/reset", {});
      });
    });
  });

  describe("Proxy Auth", () => {
    describe("setProxyAuth", () => {
      it("should set proxy auth credentials", async () => {
        const auth = { username: "user", password: "pass" };
        const mockResponse = { success: true };
        vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

        const result = await serviceFactory.setProxyAuth(auth);

        expect(result).toEqual(mockResponse);
        expect(apiClient.post).toHaveBeenCalledWith("bamboo/proxy-auth", auth);
      });
    });

    describe("getProxyAuthStatus", () => {
      it("should fetch proxy auth status", async () => {
        const mockStatus = { configured: true, username: "user" };
        vi.mocked(apiClient.get).mockResolvedValueOnce(mockStatus);

        const result = await serviceFactory.getProxyAuthStatus();

        expect(result).toEqual(mockStatus);
        expect(apiClient.get).toHaveBeenCalledWith("bamboo/proxy-auth/status");
      });

      it("should return default status on error", async () => {
        vi.mocked(apiClient.get).mockRejectedValueOnce(new Error("Auth error"));

        const result = await serviceFactory.getProxyAuthStatus();

        expect(result).toEqual({ configured: false, username: null });
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Failed to fetch proxy auth status:",
          expect.any(Error),
        );
      });
    });

    describe("clearProxyAuth", () => {
      it("should clear proxy auth", async () => {
        const mockResponse = { success: true };
        vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

        const result = await serviceFactory.clearProxyAuth();

        expect(result).toEqual(mockResponse);
        expect(apiClient.post).toHaveBeenCalledWith("bamboo/proxy-auth", {
          username: "",
          password: "",
        });
      });
    });
  });

  describe("Workflow Management", () => {
    describe("saveWorkflow", () => {
      it("should save workflow", async () => {
        const name = "test-workflow";
        const content = "workflow content";
        const mockResponse = { success: true, path: "/workflows/test.md" };
        vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

        const result = await serviceFactory.saveWorkflow(name, content);

        expect(result).toEqual(mockResponse);
        expect(apiClient.post).toHaveBeenCalledWith("bamboo/workflows", {
          name,
          content,
        });
      });
    });

    describe("deleteWorkflow", () => {
      it("should delete workflow", async () => {
        const name = "test-workflow";
        const mockResponse = { success: true };
        vi.mocked(apiClient.delete).mockResolvedValueOnce(mockResponse);

        const result = await serviceFactory.deleteWorkflow(name);

        expect(result).toEqual(mockResponse);
        expect(apiClient.delete).toHaveBeenCalledWith("bamboo/workflows/test-workflow");
      });

      it("should encode workflow name with special characters", async () => {
        const name = "test workflow #1";
        const mockResponse = { success: true };
        vi.mocked(apiClient.delete).mockResolvedValueOnce(mockResponse);

        await serviceFactory.deleteWorkflow(name);

        expect(apiClient.delete).toHaveBeenCalledWith("bamboo/workflows/test%20workflow%20%231");
      });
    });
  });

  describe("Keyword Masking", () => {
    describe("getKeywordMaskingConfig", () => {
      it("should fetch keyword masking config", async () => {
        const mockConfig = {
          entries: [{ pattern: "secret", match_type: "exact", enabled: true }],
        };
        vi.mocked(apiClient.get).mockResolvedValueOnce(mockConfig);

        const result = await serviceFactory.getKeywordMaskingConfig();

        expect(result).toEqual(mockConfig);
        expect(apiClient.get).toHaveBeenCalledWith("bamboo/keyword-masking");
      });

      it("should return empty entries on error", async () => {
        vi.mocked(apiClient.get).mockRejectedValueOnce(new Error("Config error"));

        const result = await serviceFactory.getKeywordMaskingConfig();

        expect(result).toEqual({ entries: [] });
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Failed to fetch keyword masking config:",
          expect.any(Error),
        );
      });
    });

    describe("updateKeywordMaskingConfig", () => {
      it("should update keyword masking config", async () => {
        const entries = [{ pattern: "password", match_type: "regex", enabled: true }];
        const mockResponse = { entries };
        vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

        const result = await serviceFactory.updateKeywordMaskingConfig(entries);

        expect(result).toEqual(mockResponse);
        expect(apiClient.post).toHaveBeenCalledWith("bamboo/keyword-masking", entries);
      });
    });

    describe("validateKeywordEntries", () => {
      it("should validate keyword entries", async () => {
        const entries = [{ pattern: "test", match_type: "exact", enabled: true }];
        const mockResponse = { valid: true };
        vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

        const result = await serviceFactory.validateKeywordEntries(entries);

        expect(result).toEqual(mockResponse);
        expect(apiClient.post).toHaveBeenCalledWith("bamboo/keyword-masking/validate", entries);
      });

      it("should return validation errors", async () => {
        const entries = [{ pattern: "invalid[", match_type: "regex", enabled: true }];
        const mockResponse = {
          valid: false,
          errors: [{ index: 0, message: "Invalid regex pattern" }],
        };
        vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

        const result = await serviceFactory.validateKeywordEntries(entries);

        expect(result).toEqual(mockResponse);
      });
    });
  });

  describe("Setup Status", () => {
    describe("getSetupStatus", () => {
      it("should fetch setup status", async () => {
        const mockStatus = {
          is_complete: true,
          has_proxy_config: true,
          has_proxy_env: false,
          message: "Setup complete",
        };
        vi.mocked(apiClient.get).mockResolvedValueOnce(mockStatus);

        const result = await serviceFactory.getSetupStatus();

        expect(result).toEqual(mockStatus);
        expect(apiClient.get).toHaveBeenCalledWith("bamboo/setup/status");
      });

      it("should propagate errors (not swallow them)", async () => {
        const error = new Error("Network error");
        vi.mocked(apiClient.get).mockRejectedValueOnce(error);

        await expect(serviceFactory.getSetupStatus()).rejects.toThrow("Network error");
      });
    });

    describe("markSetupComplete", () => {
      it("should mark setup as complete", async () => {
        const mockResponse = { success: true };
        vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

        const result = await serviceFactory.markSetupComplete();

        expect(result).toEqual(mockResponse);
        expect(apiClient.post).toHaveBeenCalledWith("bamboo/setup/complete", {});
      });
    });

    describe("resetSetupStatus", () => {
      it("should reset setup status", async () => {
        const mockResponse = { success: true };
        vi.mocked(apiClient.post).mockResolvedValueOnce(mockResponse);

        await serviceFactory.resetSetupStatus();

        expect(apiClient.post).toHaveBeenCalledWith("bamboo/setup/incomplete", {});
      });
    });
  });

  describe("getUtilityService", () => {
    it("should return utility service with all methods", () => {
      const utility = serviceFactory.getUtilityService();

      expect(utility).toHaveProperty("copyToClipboard");
      expect(utility).toHaveProperty("getBambooConfig");
      expect(utility).toHaveProperty("getBambooTools");
      expect(utility).toHaveProperty("getModelLimitDefaults");
      expect(utility).toHaveProperty("setBambooConfig");
      expect(utility).toHaveProperty("validateBambooConfigPatch");
      expect(utility).toHaveProperty("testLifecycleHook");
      expect(utility).toHaveProperty("setProxyAuth");
      expect(utility).toHaveProperty("getProxyAuthStatus");
      expect(utility).toHaveProperty("clearProxyAuth");
      expect(utility).toHaveProperty("resetBambooConfig");
      expect(utility).toHaveProperty("resetSetupStatus");
      expect(utility).toHaveProperty("saveWorkflow");
      expect(utility).toHaveProperty("deleteWorkflow");
      expect(utility).toHaveProperty("getKeywordMaskingConfig");
      expect(utility).toHaveProperty("updateKeywordMaskingConfig");
      expect(utility).toHaveProperty("validateKeywordEntries");
      expect(utility).toHaveProperty("getSetupStatus");
      expect(utility).toHaveProperty("markSetupComplete");
      expect(utility).toHaveProperty("getAccessStatus");
      expect(utility).toHaveProperty("verifyAccessPassword");
      expect(utility).toHaveProperty("updateAccessPassword");
    });

    it("should call underlying HttpUtilityService methods", async () => {
      const utility = serviceFactory.getUtilityService();
      const mockConfig = { model: "test" };
      vi.mocked(apiClient.get).mockResolvedValueOnce(mockConfig);

      const result = await utility.getBambooConfig();

      expect(result).toEqual(mockConfig);
    });
  });

  describe("Convenience Methods", () => {
    it("all convenience methods should delegate to utility service", async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ model: "test" });
      vi.mocked(apiClient.post).mockResolvedValue({ success: true });
      vi.mocked(apiClient.delete).mockResolvedValue({ success: true });
      vi.mocked(copyText).mockResolvedValue(undefined);

      // Test that convenience methods work the same as utility service methods
      await serviceFactory.copyToClipboard("test");
      expect(copyText).toHaveBeenCalled();

      await serviceFactory.getBambooConfig();
      expect(apiClient.get).toHaveBeenCalledWith("bamboo/config");

      await serviceFactory.getModelLimitDefaults();
      expect(apiClient.get).toHaveBeenCalledWith("bamboo/model-limits/defaults");

      await serviceFactory.setBambooConfig({});
      expect(apiClient.post).toHaveBeenCalled();

      await serviceFactory.setProxyAuth({ username: "u", password: "p" });
      expect(apiClient.post).toHaveBeenCalled();

      await serviceFactory.saveWorkflow("name", "content");
      expect(apiClient.post).toHaveBeenCalled();

      await serviceFactory.deleteWorkflow("name");
      expect(apiClient.delete).toHaveBeenCalled();
    });
  });
});

// Device pairing / management (API v2 per-device tokens, epic #26 phase 1 —
// wire plumbing only, nothing calls these yet). These 5 endpoints live at
// the backend ORIGIN root (siblings of `/v1`), NOT under the `/v1`-rooted
// base `apiClient` uses — see `ServiceFactory.ts`'s `resolveV2Origin`/
// `v2Fetch`. They go through a raw `fetch` (not `apiClient`), so this suite
// mocks `global.fetch` directly rather than the `../../api` module mock used
// above.
describe("ServiceFactory — device pairing / management (API v2, epic #26 phase 1)", () => {
  let serviceFactory: ServiceFactory;
  let fetchMock: ReturnType<typeof vi.fn>;

  const jsonResponse = (data: unknown, ok = true, status = 200) => ({
    ok,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });

  beforeEach(() => {
    // Pin a known backend base so the expected ORIGIN is deterministic
    // regardless of the jsdom test document's own location.
    setBackendBaseUrl("http://127.0.0.1:9562/v1");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    serviceFactory = ServiceFactory.getInstance();
  });

  afterEach(() => {
    clearBackendBaseUrlOverride();
    vi.unstubAllGlobals();
  });

  it("pairDevice POSTs to the ORIGIN-rooted /v2/pair, NOT /v1/v2/pair", async () => {
    const mockResp = {
      device_id: "bamboo_abc123",
      device_token: "bd1_deadbeef",
      expires_hint: "rotate-on-demand",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(mockResp));

    const result = await serviceFactory.pairDevice({ root_password: "secret", label: "iPhone" });

    expect(result).toEqual(mockResp);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9562/v2/pair");
    expect(url).not.toContain("/v1/");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(JSON.parse(init.body as string)).toEqual({ root_password: "secret", label: "iPhone" });
  });

  it("createPairingCode POSTs to the ORIGIN-rooted /v2/pair/code with no body", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: "084213", ttl: 120 }));

    const result = await serviceFactory.createPairingCode();

    expect(result).toEqual({ code: "084213", ttl: 120 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9562/v2/pair/code");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
  });

  it("listDevices GETs the ORIGIN-rooted /v2/devices", async () => {
    const devices = [
      {
        device_id: "bamboo_abc123",
        label: "iPhone",
        created_at: "2026-07-01T00:00:00Z",
        last_used_at: null,
        revoked: false,
      },
    ];
    fetchMock.mockResolvedValueOnce(jsonResponse(devices));

    const result = await serviceFactory.listDevices();

    expect(result).toEqual(devices);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9562/v2/devices");
    expect(init.method).toBe("GET");
  });

  it("revokeDevice DELETEs the ORIGIN-rooted /v2/devices/{device_id}", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ device_id: "bamboo_abc123", revoked: true }));

    const result = await serviceFactory.revokeDevice("bamboo_abc123");

    expect(result).toEqual({ device_id: "bamboo_abc123", revoked: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9562/v2/devices/bamboo_abc123");
    expect(init.method).toBe("DELETE");
  });

  it("rotateDevice POSTs to the ORIGIN-rooted /v2/devices/{device_id}/rotate", async () => {
    const mockResp = {
      device_id: "bamboo_abc123",
      device_token: "bd1_freshtoken",
      expires_hint: "rotate-on-demand",
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(mockResp));

    const result = await serviceFactory.rotateDevice("bamboo_abc123");

    expect(result).toEqual(mockResp);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9562/v2/devices/bamboo_abc123/rotate");
    expect(init.method).toBe("POST");
  });

  it("URL-encodes the device id path segment", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ device_id: "a/b c", revoked: true }));

    await serviceFactory.revokeDevice("a/b c");

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9562/v2/devices/a%2Fb%20c");
  });

  it("rejects with request context on a non-ok response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ error: "access credential verification required" }, false, 401),
    );

    await expect(serviceFactory.listDevices()).rejects.toThrow(/401/);
  });
});
