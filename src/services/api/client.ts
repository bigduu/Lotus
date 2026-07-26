/**
 * Unified HTTP API Client
 *
 * Provides a consistent interface for making HTTP requests to the backend API.
 * Eliminates duplicate fetch logic across services.
 *
 * Backend has two route prefixes:
 * - /v1/*       - Standard web_service routes (models, bamboo/*, workspace/*, mcp/*)
 * - /api/v1/*   - Agent server routes (chat, stream, todo, respond, sessions, metrics)
 */
import { getBackendBaseUrlSync } from "../../shared/utils/backendBaseUrl";

// === DEV-ONLY API REQUEST INSTRUMENTATION ===
// Enable with: localStorage.setItem('lotus_debug_api_requests', '1')

const AGENT_ENDPOINT_PATTERNS = [
  /\/api\/v1\/respond\/[^/]+\/pending/,
  /\/api\/v1\/sessions\/?$/,
  /\/api\/v1\/events\/[^/]+/,
];

function shouldLogApiRequest(): boolean {
  return (
    import.meta.env.DEV &&
    typeof localStorage !== "undefined" &&
    localStorage.getItem("lotus_debug_api_requests") === "1"
  );
}

function isAgentEndpoint(url: string): boolean {
  try {
    const pathname = new URL(
      url,
      typeof window !== "undefined" ? window.location.origin : "http://localhost",
    ).pathname;
    return AGENT_ENDPOINT_PATTERNS.some((pattern) => pattern.test(pathname));
  } catch {
    return false;
  }
}

let requestCounters: Record<string, number> = {};

function logApiRequest(method: string, url: string): void {
  if (!shouldLogApiRequest()) return;
  if (!isAgentEndpoint(url)) return;

  const key = `${method} ${new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost").pathname}`;
  requestCounters[key] = (requestCounters[key] || 0) + 1;

  // eslint-disable-next-line no-console -- dev-only debug trace
  console.debug(`[ApiClient] ${method} ${key} (total: ${requestCounters[key]})`);
}

// Expose for manual testing
if (import.meta.env.DEV && typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__lotusApiCounters = () => {
    // eslint-disable-next-line no-console -- dev-only debug trace
    console.table(requestCounters);
    return { ...requestCounters };
  };
  (window as unknown as Record<string, unknown>).__lotusResetApiCounters = () => {
    requestCounters = {};
  };
}

export interface ApiClientConfig {
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public statusText: string,
    public body?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export class ApiClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = config.baseUrl ?? this.resolveBaseUrl();
    this.defaultHeaders = config.defaultHeaders ?? {
      "Content-Type": "application/json",
    };
  }

  private resolveBaseUrl(): string {
    const normalized = getBackendBaseUrlSync().trim().replace(/\/+$/, "");

    // Default to /v1 (standard web_service routes)
    if (normalized.endsWith("/v1")) {
      return normalized;
    }

    return `${normalized}/v1`;
  }

  private buildUrl(path: string): string {
    const cleanPath = path.replace(/^\/+/, "");
    return `${this.baseUrl}/${cleanPath}`;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const body = await response.text().catch(() => undefined);
      throw this.createApiError(response.status, response.statusText, body);
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    // Check content type to determine how to parse response
    const contentType = response.headers?.get?.("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }

    // For non-JSON responses (like health check returning "OK")
    // Use text() if available, otherwise fall back to json() for test mocks
    if (typeof response.text === "function") {
      const text = await response.text();
      return text as T;
    }
    return response.json();
  }

  private createApiError(status: number, statusText: string, body?: string): ApiError {
    let errorMessage = statusText;
    if (body) {
      try {
        const errorData = JSON.parse(body);
        // Check for common error field names.
        //
        // Bamboo backend ResponseError shape:
        //   { "error": { "message": "...", "type": "...", "code": "..." } }
        // Some endpoints also return:
        //   { "success": false, "error": "..." }
        const nestedMessage =
          typeof errorData?.error === "object" ? (errorData.error?.message as unknown) : undefined;
        const directError = typeof errorData?.error === "string" ? errorData.error : undefined;

        errorMessage =
          directError ||
          (typeof nestedMessage === "string" ? nestedMessage : undefined) ||
          errorData.message ||
          errorData.detail ||
          statusText;
      } catch {
        // If not JSON, use the raw body as error message
        errorMessage = body || statusText;
      }
    }
    return new ApiError(errorMessage, status, statusText, body);
  }

  /**
   * Delay helper for retries with jitter.
   */
  private delay(baseMs: number, attempt: number): Promise<void> {
    // Full jitter: 0..base to avoid thundering herd on coordinated reconnect.
    const jitter = 0.5 + Math.random() * 0.5;
    const delayMs = Math.floor(baseMs * Math.pow(2, attempt) * jitter);
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  /**
   * Combine the internal per-request timeout signal with an optional
   * caller-supplied AbortSignal so that either one can abort the request.
   * Without this, a caller's own AbortController (e.g. cancel-on-unmount)
   * was silently overwritten by the internal timeout controller and had
   * no effect (#10).
   */
  private combineAbortSignals(timeoutSignal: AbortSignal, callerSignal?: AbortSignal): AbortSignal {
    if (!callerSignal) {
      return timeoutSignal;
    }

    if (typeof AbortSignal.any === "function") {
      return AbortSignal.any([timeoutSignal, callerSignal]);
    }

    // Fallback for environments without AbortSignal.any.
    const combined = new AbortController();
    const abortFrom = (signal: AbortSignal) => {
      if (!combined.signal.aborted) {
        combined.abort(signal.reason);
      }
    };
    if (timeoutSignal.aborted) {
      abortFrom(timeoutSignal);
    } else if (callerSignal.aborted) {
      abortFrom(callerSignal);
    } else {
      timeoutSignal.addEventListener("abort", () => abortFrom(timeoutSignal), { once: true });
      callerSignal.addEventListener("abort", () => abortFrom(callerSignal), { once: true });
    }
    return combined.signal;
  }

  /**
   * Fetch with retry logic for transient failures.
   *
   * Important: only safe (idempotent) methods retry by default. Non-idempotent
   * POST/PUT/PATCH/DELETE are NOT retried because the server may already have
   * executed the request when the response was lost. Pass `retryable: true` to
   * opt-in for specific endpoints that are safe to replay.
   */
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number = 1,
    retryable: boolean = false,
  ): Promise<Response> {
    let lastError: Error | null = null;
    let lastStatus: number | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch(url, options);
        lastStatus = response.status;

        // Only retry 5xx from safe/retryable endpoints, and never on the last attempt.
        if (retryable && response.status >= 500 && attempt < maxRetries - 1) {
          await this.delay(1000, attempt);
          continue;
        }

        return response;
      } catch (error) {
        const err = error as Error;

        // Abort errors (caller cancellation OR the internal timeout) are
        // never retryable: the request's signal is already aborted, so any
        // further attempt would fail immediately and only waste the
        // exponential backoff delay. Propagate immediately instead (#10).
        if (err.name === "AbortError") {
          // If we were retrying because of 5xx errors, surface the last 5xx
          // instead of a misleading timeout error.
          if (retryable && lastStatus != null && lastStatus >= 500) {
            throw this.createApiError(lastStatus, "Server error", undefined);
          }
          throw err;
        }

        lastError = err;

        // Only retry network errors for safe/retryable endpoints.
        if (retryable && attempt < maxRetries - 1) {
          await this.delay(1000, attempt);
        }
      }
    }

    // If we ended with 5xx on the last attempt, throw an ApiError rather than
    // the lower-level network error so callers can inspect status/message.
    if (retryable && lastStatus != null && lastStatus >= 500) {
      throw this.createApiError(lastStatus, "Server error", undefined);
    }

    throw lastError || new Error("Max retries exceeded");
  }

  /**
   * Core request dispatcher.
   */
  private async requestWithRetry<T>(
    method: string,
    path: string,
    {
      data,
      options,
      maxRetries = 1,
      retryable = false,
      timeoutMs = 30000,
      onResponse,
    }: {
      data?: unknown;
      options?: RequestInit;
      maxRetries?: number;
      retryable?: boolean;
      timeoutMs?: number;
      /** Inspect the raw response (e.g. read the ETag header) before parsing. */
      onResponse?: (response: Response) => void;
    } = {},
  ): Promise<T> {
    const url = this.buildUrl(path);
    logApiRequest(method, url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const signal = this.combineAbortSignals(controller.signal, options?.signal ?? undefined);

    try {
      const response = await this.fetchWithRetry(
        url,
        {
          ...options,
          method,
          headers: {
            ...this.defaultHeaders,
            ...options?.headers,
          },
          credentials: "include",
          body: data ? JSON.stringify(data) : undefined,
          signal,
        },
        maxRetries,
        retryable,
      );
      onResponse?.(response);
      return this.handleResponse<T>(response);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Make a GET request with timeout and retry.
   * GET is idempotent and retries automatically on 5xx/network errors.
   */
  async get<T>(path: string, options?: RequestInit): Promise<T> {
    return this.requestWithRetry<T>("GET", path, { options, maxRetries: 3, retryable: true });
  }

  /**
   * GET that also exposes the response ETag header. Flows using optimistic
   * concurrency (If-Match on a later write) read the version this way.
   */
  async getWithEtag<T>(
    path: string,
    options?: RequestInit,
  ): Promise<{ data: T; etag: string | null }> {
    let etag: string | null = null;
    const data = await this.requestWithRetry<T>("GET", path, {
      options,
      maxRetries: 3,
      retryable: true,
      onResponse: (response) => {
        etag = response.headers.get("etag");
      },
    });
    return { data, etag };
  }

  /**
   * Make a POST request with timeout. POST is non-idempotent and is NOT retried
   * by default to avoid double-execution (e.g. duplicate agent runs, double
   * LLM charges, duplicate approvals). Pass `retryable: true` in `options` only
   * for explicitly safe-to-replay endpoints.
   */
  async post<T>(path: string, data?: unknown, options?: RequestInit): Promise<T> {
    const retryable = options?.["retryable" as keyof RequestInit] === true;
    return this.requestWithRetry<T>("POST", path, {
      data,
      options,
      maxRetries: retryable ? 3 : 1,
      retryable,
    });
  }

  /**
   * Make a PUT request with timeout. PUT is non-idempotent and is NOT retried
   * by default.
   */
  async put<T>(path: string, data?: unknown, options?: RequestInit): Promise<T> {
    const retryable = options?.["retryable" as keyof RequestInit] === true;
    return this.requestWithRetry<T>("PUT", path, {
      data,
      options,
      maxRetries: retryable ? 3 : 1,
      retryable,
    });
  }

  /**
   * Make a PATCH request with timeout. PATCH is non-idempotent and is NOT retried
   * by default.
   */
  async patch<T>(path: string, data?: unknown, options?: RequestInit): Promise<T> {
    const retryable = options?.["retryable" as keyof RequestInit] === true;
    return this.requestWithRetry<T>("PATCH", path, {
      data,
      options,
      maxRetries: retryable ? 3 : 1,
      retryable,
    });
  }

  /**
   * Make a DELETE request with timeout. DELETE is non-idempotent and is NOT retried
   * by default.
   */
  async delete<T>(path: string, options?: RequestInit): Promise<T> {
    const retryable = options?.["retryable" as keyof RequestInit] === true;
    return this.requestWithRetry<T>("DELETE", path, {
      options,
      maxRetries: retryable ? 3 : 1,
      retryable,
    });
  }

  /**
   * Make a DELETE request that includes a JSON body. Standard `fetch` supports
   * body on DELETE, and some Bamboo endpoints (e.g. unbind workspace) require it.
   */
  async deleteWithBody<T>(path: string, data?: unknown, options?: RequestInit): Promise<T> {
    const retryable = options?.["retryable" as keyof RequestInit] === true;
    return this.requestWithRetry<T>("DELETE", path, {
      data,
      options,
      maxRetries: retryable ? 3 : 1,
      retryable,
    });
  }

  /**
   * Make a request with a custom method and timeout.
   * Custom methods are not retried by default; pass `retryable: true` to opt in.
   */
  async request<T>(method: string, path: string, options?: RequestInit): Promise<T> {
    const retryable = options?.["retryable" as keyof RequestInit] === true;
    return this.requestWithRetry<T>(method, path, {
      options,
      maxRetries: retryable ? 3 : 1,
      retryable,
    });
  }

  /**
   * Make a request and return raw Response for streaming.
   *
   * Uses a caller-configurable timeout (default 120s) and reuses the same error
   * body parsing as the standard JSON path so backend messages are surfaced.
   * Streaming endpoints are not retried by default.
   */
  async fetchRaw(path: string, options?: RequestInit & { timeoutMs?: number }): Promise<Response> {
    const url = this.buildUrl(path);
    const timeoutMs = options?.timeoutMs ?? 120000;
    logApiRequest("GET", url);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const signal = this.combineAbortSignals(controller.signal, options?.signal ?? undefined);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...this.defaultHeaders,
          ...options?.headers,
        },
        credentials: "include",
        signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => undefined);
        throw this.createApiError(response.status, response.statusText, body);
      }

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// Export singleton instance for standard API (/v1)
export const apiClient = new ApiClient();

/**
 * Agent API Client for /api/v1 routes
 *
 * Used for agent-specific endpoints:
 * - chat, stream, stop, history
 * - todo, respond, sessions
 * - metrics, health
 */
export const agentApiClient = new ApiClient({
  baseUrl: (() => {
    let normalized = getBackendBaseUrlSync().trim().replace(/\/+$/, "");
    // Remove /v1 suffix if present, then add /api/v1
    if (normalized.endsWith("/v1")) {
      normalized = normalized.slice(0, -3);
    }
    return `${normalized}/api/v1`;
  })(),
});
