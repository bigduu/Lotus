import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  buildBambooCompatibleProviderBaseUrls,
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

  const stubLocation = (protocol: string, hostname: string, href?: string) => {
    vi.stubGlobal("location", {
      protocol,
      hostname,
      href: href ?? `${protocol}//${hostname}/`,
    } as Partial<Location>);
  };

  beforeEach(() => {
    localStorage.clear();
    originalFetch = global.fetch;
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    delete (window as any).__BAMBOO_BACKEND_PORT__;
    stubLocation("http:", "localhost", "http://localhost:1420/");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllGlobals();
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

  it("uses loopback fallback default when no env and no override exists", () => {
    clearBackendBaseUrlOverride();
    expect(getDefaultBackendBaseUrl()).toBe("http://127.0.0.1:9562/v1");
    expect(getBackendBaseUrlSync()).toBe("http://127.0.0.1:9562/v1");
  });

  it("derives default backend URL from current http page hostname", () => {
    stubLocation("http:", "mac.local", "http://mac.local:1420/chat");

    expect(getDefaultBackendBaseUrl()).toBe("http://mac.local:9562/v1");
    expect(getBackendBaseUrlSync()).toBe("http://mac.local:9562/v1");
  });

  it("derives default backend URL from current https page hostname as same-origin https /v1", () => {
    stubLocation("https:", "bodhi.bigduu.com", "https://bodhi.bigduu.com/");

    expect(getDefaultBackendBaseUrl()).toBe("https://bodhi.bigduu.com/v1");
    expect(getBackendBaseUrlSync()).toBe("https://bodhi.bigduu.com/v1");
  });

  it("falls back for non-http(s) protocols", () => {
    stubLocation("tauri:", "localhost", "tauri://localhost/");

    expect(getDefaultBackendBaseUrl()).toBe("http://127.0.0.1:9562/v1");
  });

  it("uses env default when set (and normalizes it)", () => {
    const processRef = (globalThis as any).process ?? { env: {} };
    const original = processRef.env.VITE_BACKEND_BASE_URL;
    processRef.env.VITE_BACKEND_BASE_URL = "http://example.com/v1/";
    (globalThis as any).process = processRef;

    try {
      expect(getDefaultBackendBaseUrl()).toBe("http://example.com/v1");
    } finally {
      if (original === undefined) {
        delete processRef.env.VITE_BACKEND_BASE_URL;
      } else {
        processRef.env.VITE_BACKEND_BASE_URL = original;
      }
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

  it("ignores an insecure http override when page is served over https", () => {
    stubLocation("https:", "bodhi.bigduu.com", "https://bodhi.bigduu.com/");
    setBackendBaseUrl("http://bodhi.bigduu.com:9562/v1");

    expect(getBackendBaseUrlSync()).toBe("https://bodhi.bigduu.com/v1");
    expect(hasBackendBaseUrlOverride()).toBe(false);
  });

  it("ignores a stored loopback override when page is served from a non-loopback host", () => {
    stubLocation("http:", "mac.local", "http://mac.local:9562/");
    setBackendBaseUrl("http://127.0.0.1:9562/v1");

    expect(getBackendBaseUrlSync()).toBe("http://mac.local:9562/v1");
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

    it("ignores a stored loopback override during async discovery when page is served remotely", async () => {
      stubLocation("http:", "mac.local", "http://mac.local:9562/");
      setBackendBaseUrl("http://127.0.0.1:9562/v1");
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const url = await getBackendBaseUrl();

      expect(url).toBe("http://mac.local:9562/v1");
      expect(hasBackendBaseUrlOverride()).toBe(false);
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "http://mac.local:9562/api/v1/health",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("prefers host-derived URL when current page host backend is healthy", async () => {
      stubLocation("http:", "mac.local", "http://mac.local:1420/");

      mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

      const url = await getBackendBaseUrl();

      expect(url).toBe("http://mac.local:9562/v1");
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "http://mac.local:9562/api/v1/health",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("falls back to loopback when host-derived health checks fail", async () => {
      stubLocation("http:", "mac.local", "http://mac.local:1420/");

      mockFetch
        .mockRejectedValueOnce(new Error("Host derived down"))
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const url = await getBackendBaseUrl();

      expect(url).toBe("http://127.0.0.1:9562/v1");
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "http://mac.local:9562/api/v1/health",
        expect.objectContaining({ method: "GET" }),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "http://127.0.0.1:9562/api/v1/health",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("returns host-derived URL as final fallback when both health checks fail", async () => {
      stubLocation("http:", "mac.local", "http://mac.local:1420/");
      const processRef = (globalThis as any).process ?? { env: {} };
      delete processRef.env.VITE_BACKEND_BASE_URL;
      (globalThis as any).process = processRef;
      mockFetch.mockRejectedValue(new Error("Connection refused"));

      const url = await getBackendBaseUrl();

      expect(url).toBe("http://mac.local:9562/v1");
    });
  });
});

describe("buildBambooCompatibleProviderBaseUrls", () => {
  it("builds local compatibility URLs from the backend API base", () => {
    expect(buildBambooCompatibleProviderBaseUrls("http://127.0.0.1:9562/v1/")).toEqual([
      { provider: "openai", url: "http://127.0.0.1:9562/openai/v1" },
      { provider: "anthropic", url: "http://127.0.0.1:9562/anthropic/v1" },
      { provider: "gemini", url: "http://127.0.0.1:9562/gemini/v1beta" },
    ]);
  });

  it("preserves an HTTPS reverse-proxy path prefix", () => {
    expect(buildBambooCompatibleProviderBaseUrls("https://example.com/bamboo/v1")).toEqual([
      { provider: "openai", url: "https://example.com/bamboo/openai/v1" },
      { provider: "anthropic", url: "https://example.com/bamboo/anthropic/v1" },
      { provider: "gemini", url: "https://example.com/bamboo/gemini/v1beta" },
    ]);
  });

  it("never exposes backend URL credentials in provider URLs", () => {
    const urls = buildBambooCompatibleProviderBaseUrls(
      "https://api-user:super-secret@example.com/bamboo/v1",
    );

    expect(urls.map(({ url }) => url)).toEqual([
      "https://example.com/bamboo/openai/v1",
      "https://example.com/bamboo/anthropic/v1",
      "https://example.com/bamboo/gemini/v1beta",
    ]);
    expect(JSON.stringify(urls)).not.toContain("api-user");
    expect(JSON.stringify(urls)).not.toContain("super-secret");
  });
});
