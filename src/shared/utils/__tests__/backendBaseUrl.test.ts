import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBackendUrl,
  clearBackendBaseUrlOverride,
  getBackendBaseUrlSync,
  getDefaultBackendBaseUrl,
  hasBackendBaseUrlOverride,
  normalizeBackendBaseUrl,
  setBackendBaseUrl,
  getBackendBaseUrl,
} from "../backendBaseUrl";

describe("backendBaseUrl", () => {
  let originalFetch: typeof fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    originalFetch = global.fetch;
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    delete (window as any).__BAMBOO_BACKEND_PORT__;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("normalizes by trimming and removing trailing slashes", () => {
    expect(normalizeBackendBaseUrl(" http://localhost:9562/v1/ ")).toBe("http://localhost:9562/v1");
  });

  it("removes multiple trailing slashes", () => {
    expect(normalizeBackendBaseUrl("http://localhost:9562/v1///")).toBe("http://localhost:9562/v1");
  });

  it("handles empty string", () => {
    expect(normalizeBackendBaseUrl("")).toBe("");
  });

  it("handles whitespace only", () => {
    expect(normalizeBackendBaseUrl("   ")).toBe("");
  });

  it("uses fallback default when no env and no override exists", () => {
    clearBackendBaseUrlOverride();
    expect(getDefaultBackendBaseUrl()).toBe("http://127.0.0.1:9562/v1");
    expect(getBackendBaseUrlSync()).toBe("http://127.0.0.1:9562/v1");
  });

  it("uses env default when set (and normalizes it)", () => {
    const processRef = (globalThis as any).process ?? { env: {} };
    const original = processRef.env.VITE_BACKEND_BASE_URL;
    processRef.env.VITE_BACKEND_BASE_URL = "http://example.com/v1/";
    (globalThis as any).process = processRef;

    try {
      expect(getDefaultBackendBaseUrl()).toBe("http://example.com/v1");
    } finally {
      processRef.env.VITE_BACKEND_BASE_URL = original;
    }
  });

  it("persists an override and uses it in preference to defaults", () => {
    expect(hasBackendBaseUrlOverride()).toBe(false);

    setBackendBaseUrl("http://localhost:9562/v1/");
    expect(hasBackendBaseUrlOverride()).toBe(true);
    expect(getBackendBaseUrlSync()).toBe("http://localhost:9562/v1");

    clearBackendBaseUrlOverride();
    expect(hasBackendBaseUrlOverride()).toBe(false);
  });

  it("builds backend URLs with a single slash separator", () => {
    setBackendBaseUrl("http://localhost:9562/v1/");
    expect(buildBackendUrl("/models")).toBe("http://localhost:9562/v1/models");
    expect(buildBackendUrl("workspace/validate")).toBe(
      "http://localhost:9562/v1/workspace/validate",
    );
  });

  it("handles multiple leading slashes in path", () => {
    setBackendBaseUrl("http://localhost:9562/v1");
    expect(buildBackendUrl("///models")).toBe("http://localhost:9562/v1/models");
  });

  it.skip("handles invalid stored URL gracefully", () => {
    localStorage.setItem("copilot_backend_base_url", "not-a-valid-url");
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = getBackendBaseUrlSync();

    // Should return a valid URL (either the default or fallback)
    expect(typeof result).toBe("string");
    expect(result).toMatch(/^http:/);

    consoleSpy.mockRestore();
  });

  describe("getBackendBaseUrl (async with health check)", () => {
    it("uses configured port from __BAMBOO_BACKEND_PORT__ when healthy", async () => {
      (window as any).__BAMBOO_BACKEND_PORT__ = 8080;

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const url = await getBackendBaseUrl();

      expect(url).toContain("8080");
      expect(mockFetch).toHaveBeenCalled();
    });

    it("uses stored URL when set", async () => {
      setBackendBaseUrl("http://custom:9000/v1");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
      });

      const url = await getBackendBaseUrl();

      expect(url).toBe("http://custom:9000/v1");
    });

    it("returns default URL when health checks fail", async () => {
      // All health checks fail - function should still return a URL
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const url = await getBackendBaseUrl();

      // Should return some URL (the default fallback)
      expect(typeof url).toBe("string");
      expect(url.length).toBeGreaterThan(0);
    });
  });
});
