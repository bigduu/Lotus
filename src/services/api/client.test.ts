import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClient, ApiError } from "./client";

/** Mirrors the DOMException fetch() throws when a request's signal aborts. */
const makeAbortError = (): DOMException =>
  new DOMException("The operation was aborted.", "AbortError");

/**
 * Mock `fetch` that never settles on its own — it rejects with an AbortError
 * as soon as (or if) the RequestInit signal it was given aborts, exactly
 * like the real `fetch`/undici implementation. Lets tests drive abort
 * timing (caller-initiated or internal-timeout-initiated) explicitly.
 */
const makeHangingAbortableFetch = () =>
  vi.fn((_url: string, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(makeAbortError());
        return;
      }
      signal.addEventListener("abort", () => reject(makeAbortError()), { once: true });
    });
  });

const makeJsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("ApiClient error parsing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("extracts nested { error: { message } } messages", async () => {
    const client = new ApiClient({ baseUrl: "http://example.test/v1" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeJsonResponse(400, {
          error: { message: "Anthropic configuration required", type: "api_error" },
        }),
      ),
    );

    await expect(client.get("bamboo/config")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "Anthropic configuration required",
    } satisfies Partial<ApiError>);
  });

  it('extracts direct { success:false, error:"..." } messages', async () => {
    const client = new ApiClient({ baseUrl: "http://example.test/v1" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        makeJsonResponse(400, {
          success: false,
          error: "Invalid configuration: OpenAI API key is required",
        }),
      ),
    );

    await expect(client.post("bamboo/settings/provider", {})).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "Invalid configuration: OpenAI API key is required",
    } satisfies Partial<ApiError>);
  });
});

describe("ApiClient fetchWithRetry abort semantics (#10)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("respects a caller-supplied AbortSignal and rejects immediately without retrying", async () => {
    const client = new ApiClient({ baseUrl: "http://example.test/v1" });
    const fetchMock = makeHangingAbortableFetch();
    vi.stubGlobal("fetch", fetchMock);

    const callerController = new AbortController();
    const promise = client.get("bamboo/config", { signal: callerController.signal });

    // Caller cancels (e.g. component unmounts) well before any timeout.
    callerController.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    // No retries were attempted after the caller's own abort.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite the caller's signal — request is untouched when the caller never aborts", async () => {
    const client = new ApiClient({ baseUrl: "http://example.test/v1" });
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const callerController = new AbortController();
    await expect(client.get("bamboo/config", { signal: callerController.signal })).resolves.toEqual(
      { ok: true },
    );

    // The signal actually reached fetch() (combined, not silently dropped).
    const passedInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(passedInit.signal).toBeDefined();
    expect(passedInit.signal?.aborted).toBe(false);
  });

  it("aborts immediately on internal 30s timeout without retrying", async () => {
    vi.useFakeTimers();
    const client = new ApiClient({ baseUrl: "http://example.test/v1" });
    const fetchMock = makeHangingAbortableFetch();
    vi.stubGlobal("fetch", fetchMock);

    const promise = client.get("bamboo/config");
    const assertion = expect(promise).rejects.toMatchObject({ name: "AbortError" });

    // Fire the internal 30s timeout controller.
    await vi.advanceTimersByTimeAsync(30000);

    await assertion;
    // Previously this wasted ~7s retrying a request that was already
    // doomed because the timeout signal was aborted; now it aborts once.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still retries genuine network errors with exponential backoff", async () => {
    vi.useFakeTimers();
    const client = new ApiClient({ baseUrl: "http://example.test/v1" });

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const promise = client.get("bamboo/config");
    const assertion = expect(promise).resolves.toEqual({ ok: true });

    // Drain the 1s + 2s exponential backoff delays between retries.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);

    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
