const BACKEND_BASE_URL_KEY = "copilot_backend_base_url";

const FALLBACK_BACKEND_BASE_URL = "http://127.0.0.1:9562/v1";

const DEFAULT_PORT = 9562;

type LocationLike = Pick<Location, "protocol" | "hostname">;

export const normalizeBackendBaseUrl = (value: string): string => value.trim().replace(/\/+$/, "");

const getEnvBackendBaseUrl = (): string | null => {
  const processEnvUrl = (globalThis as unknown as { process?: { env?: Record<string, string> } })
    .process?.env?.VITE_BACKEND_BASE_URL;
  const envUrl = (import.meta.env.VITE_BACKEND_BASE_URL as string | undefined) ?? processEnvUrl;
  return envUrl ? normalizeBackendBaseUrl(envUrl) : null;
};

const getCurrentLocation = (): LocationLike | null => {
  const locationValue = globalThis.location as Partial<Location> | undefined;
  if (!locationValue) {
    return null;
  }

  const protocol = typeof locationValue.protocol === "string" ? locationValue.protocol : "";
  const hostname = typeof locationValue.hostname === "string" ? locationValue.hostname : "";
  if (!protocol || !hostname) {
    return null;
  }

  return { protocol, hostname };
};

const isLoopbackHostname = (hostname: string): boolean => {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
};

const isHttpsPage = (locationLike: LocationLike | null = getCurrentLocation()): boolean =>
  locationLike?.protocol.toLowerCase() === "https:";

const isInsecureHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(normalizeBackendBaseUrl(value));
    return parsed.protocol.toLowerCase() === "http:";
  } catch {
    return false;
  }
};

const isLoopbackBackendUrl = (value: string): boolean => {
  try {
    const parsed = new URL(normalizeBackendBaseUrl(value));
    return isLoopbackHostname(parsed.hostname);
  } catch {
    return false;
  }
};

const getSameOriginBackendBaseUrl = (
  locationLike: LocationLike | null = getCurrentLocation(),
): string | null => {
  if (!locationLike) {
    return null;
  }

  const protocol = locationLike.protocol.toLowerCase();
  const hostname = locationLike.hostname.trim();
  if (!hostname) {
    return null;
  }

  if (protocol === "https:") {
    return normalizeBackendBaseUrl(`https://${hostname}/v1`);
  }

  if (protocol === "http:") {
    return normalizeBackendBaseUrl(`http://${hostname}/v1`);
  }

  return null;
};

const shouldIgnoreStoredOverride = (
  storedValue: string,
  locationLike: LocationLike | null = getCurrentLocation(),
): boolean => {
  if (!locationLike) {
    return false;
  }

  const pageHostname = locationLike.hostname.trim();
  if (!pageHostname) {
    return false;
  }

  if (isHttpsPage(locationLike) && isInsecureHttpUrl(storedValue)) {
    return true;
  }

  if (isLoopbackHostname(pageHostname)) {
    return false;
  }

  return isLoopbackBackendUrl(storedValue);
};

const getHostDerivedBackendBaseUrl = (
  locationLike: LocationLike | null = getCurrentLocation(),
): string | null => {
  if (!locationLike) {
    return null;
  }

  const protocol = locationLike.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return null;
  }

  const hostname = locationLike.hostname.trim();
  if (!hostname) {
    return null;
  }

  if (protocol === "https:") {
    return getSameOriginBackendBaseUrl(locationLike);
  }

  if (isLoopbackHostname(hostname)) {
    return FALLBACK_BACKEND_BASE_URL;
  }

  return normalizeBackendBaseUrl(`http://${hostname}:${DEFAULT_PORT}/v1`);
};

export const getDefaultBackendBaseUrl = (): string => {
  const envUrl = getEnvBackendBaseUrl();
  if (envUrl) {
    return envUrl;
  }

  return getHostDerivedBackendBaseUrl() ?? FALLBACK_BACKEND_BASE_URL;
};

/**
 * Check if the backend server is healthy at the given URL
 */
const checkBackendHealth = async (baseUrl: string): Promise<boolean> => {
  try {
    // The UI stores a base like ".../v1". The health endpoint lives under "/api/v1/health".
    // Keep a legacy fallback to ".../health" for older deployments.
    const normalized = normalizeBackendBaseUrl(baseUrl);
    const origin = normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
    const healthUrls = [`${origin}/api/v1/health`, `${normalized}/health`];

    for (const healthUrl of healthUrls) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      try {
        const response = await fetch(healthUrl, {
          method: "GET",
          signal: controller.signal,
        });

        if (response.ok) return true;
      } finally {
        clearTimeout(timeoutId);
      }
    }

    return false;
  } catch {
    // Backend not available at this URL
    return false;
  }
};

/**
 * Discover backend URL with health check
 * Tries configured port first, then a same-origin or host-derived candidate, then loopback fallback
 */
export const getBackendBaseUrl = async (): Promise<string> => {
  const locationLike = getCurrentLocation();

  // Check if port is provided via environment/config (for Tauri sidecar mode)
  const configPort = (window as unknown as Record<string, unknown>).__BAMBOO_BACKEND_PORT__;
  if (configPort) {
    const configuredUrl = normalizeBackendBaseUrl(`http://127.0.0.1:${configPort}/v1`);
    if (!isHttpsPage(locationLike) && (await checkBackendHealth(configuredUrl))) {
      return configuredUrl;
    }
    console.warn(
      `Backend not available at configured port ${configPort}, falling back to discovery`,
    );
  }

  // Check localStorage for user-configured URL
  const stored = localStorage.getItem(BACKEND_BASE_URL_KEY);
  if (stored) {
    const normalized = normalizeBackendBaseUrl(stored);
    if (shouldIgnoreStoredOverride(normalized, locationLike)) {
      console.warn(
        "Ignoring stored backend override because it is incompatible with the current page origin:",
        normalized,
      );
      localStorage.removeItem(BACKEND_BASE_URL_KEY);
    } else {
      // Validate the URL before returning
      try {
        new URL(normalized);
        if (await checkBackendHealth(normalized)) {
          return normalized;
        }
        console.warn("Backend not available at stored URL, trying discovery:", normalized);
      } catch {
        console.warn("Invalid stored backend URL, removing:", normalized);
        localStorage.removeItem(BACKEND_BASE_URL_KEY);
      }
    }
  }

  const envUrl = getEnvBackendBaseUrl();
  if (envUrl) {
    return envUrl;
  }

  const hostDerivedUrl = getHostDerivedBackendBaseUrl(locationLike);
  if (hostDerivedUrl) {
    if (await checkBackendHealth(hostDerivedUrl)) {
      return hostDerivedUrl;
    }
  }

  if (!isHttpsPage(locationLike)) {
    // Try loopback fallback with health check only on non-HTTPS pages.
    const defaultUrl = FALLBACK_BACKEND_BASE_URL;
    if (await checkBackendHealth(defaultUrl)) {
      return defaultUrl;
    }
  }

  return hostDerivedUrl ?? FALLBACK_BACKEND_BASE_URL;
};

/**
 * Synchronous version for backwards compatibility
 * Does not perform health check - uses localStorage or default
 */
export const getBackendBaseUrlSync = (): string => {
  const locationLike = getCurrentLocation();
  const stored = localStorage.getItem(BACKEND_BASE_URL_KEY);
  if (stored) {
    const normalized = normalizeBackendBaseUrl(stored);
    if (shouldIgnoreStoredOverride(normalized, locationLike)) {
      console.warn(
        "Ignoring stored backend override because it is incompatible with the current page origin:",
        normalized,
      );
      localStorage.removeItem(BACKEND_BASE_URL_KEY);
    } else {
      try {
        new URL(normalized);
        return normalized;
      } catch {
        console.warn("Invalid stored backend URL, using default:", normalized);
        localStorage.removeItem(BACKEND_BASE_URL_KEY);
      }
    }
  }
  return getDefaultBackendBaseUrl();
};

export const setBackendBaseUrl = (value: string): void => {
  localStorage.setItem(BACKEND_BASE_URL_KEY, normalizeBackendBaseUrl(value));
};

export const clearBackendBaseUrlOverride = (): void => {
  localStorage.removeItem(BACKEND_BASE_URL_KEY);
};

export const hasBackendBaseUrlOverride = (): boolean =>
  localStorage.getItem(BACKEND_BASE_URL_KEY) !== null;

export const buildBackendUrl = (path: string): string => {
  const baseUrl = getBackendBaseUrlSync().replace(/\/+$/, "");
  const cleanPath = path.replace(/^\/+/, "");
  return `${baseUrl}/${cleanPath}`;
};

/**
 * Derive the unified v2 WebSocket stream URL (`ws(s)://host[:port]/v2/stream`)
 * from the current backend base.
 *
 * Reuses the same host/port the HTTP `/v1` base points at, swapping the scheme
 * to `ws:` for `http:` bases and `wss:` for `https:` bases, and replacing the
 * `/v1` suffix with the `/v2/stream` path. This is the opt-in (flag-gated)
 * transport for the feed + agent event channels.
 */
export const getV2StreamUrl = (): string => {
  const base = getBackendBaseUrlSync().trim().replace(/\/+$/, "");
  // The stored base looks like "http://host:port/v1"; strip the "/v1" suffix to
  // get the origin, then append the v2 path.
  const origin = base.endsWith("/v1") ? base.slice(0, -3) : base;
  const parsed = new URL(origin);
  const wsProtocol = parsed.protocol.toLowerCase() === "https:" ? "wss:" : "ws:";
  parsed.protocol = wsProtocol;
  // `host` preserves an explicit port; the URL constructor drops a default port
  // for the original scheme, which is the desired behavior here.
  return `${wsProtocol}//${parsed.host}/v2/stream`;
};

// Global type for Tauri sidecar port injection
declare global {
  interface Window {
    __BAMBOO_BACKEND_PORT__?: number;
  }
}
