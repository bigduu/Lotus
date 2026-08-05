import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentClient,
  SessionCreateRecoveryError,
  type CreateSessionRequest,
  type SessionSummary,
} from "../AgentService";
import { ApiError } from "@services/api";
import { mockFetchError, mockFetchResponse } from "@test/helpers";

const request: CreateSessionRequest = {
  title: "Recovered session",
  project_id: "project-1",
};

const session = (id: string): SessionSummary =>
  ({
    id,
    kind: "root",
    title: "Recovered session",
  }) as SessionSummary;

const abortError = (): Error => {
  const error = new Error("Fetch is aborted");
  error.name = "AbortError";
  return error;
};

const requestHeader = (
  fetchMock: ReturnType<typeof vi.fn>,
  call: number,
  name: string,
): string | null => {
  const options = fetchMock.mock.calls[call]?.[1] as RequestInit | undefined;
  return new Headers(options?.headers).get(name);
};

describe("AgentClient session-create recovery (#697)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const client = AgentClient.getInstance();

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends one non-empty Idempotency-Key on a normal create", async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ session: session("session-normal") }, { status: 201 }),
    );

    await expect(client.createSession(request)).resolves.toEqual({
      session: session("session-normal"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(requestHeader(fetchMock, 0, "Idempotency-Key")).toMatch(/^lotus-session-.+/);
  });

  it("uses a caller-persisted key for the operation's first POST", async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ session: session("session-preallocated") }, { status: 201 }),
    );

    await expect(
      client.createSession(request, {
        idempotencyKey: "lotus-session-preallocated",
        resumeExistingOperation: false,
      }),
    ).resolves.toEqual({ session: session("session-preallocated") });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
    expect(requestHeader(fetchMock, 0, "Idempotency-Key")).toBe("lotus-session-preallocated");
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify(request));
  });

  it("recovers a lost POST response from a succeeded operation lookup", async () => {
    fetchMock
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(
        mockFetchResponse({ status: "succeeded", session: session("session-committed") }),
      );

    await expect(client.createSession(request)).resolves.toEqual({
      session: session("session-committed"),
    });

    const key = requestHeader(fetchMock, 0, "Idempotency-Key");
    expect(key).toBeTruthy();
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      `/session-create-operations/${encodeURIComponent(key!)}`,
    );
  });

  it.each([408, 500, 503])(
    "treats an HTTP %i create response as ambiguous and recovers its committed session",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(mockFetchError("ambiguous create response", status))
        .mockResolvedValueOnce(
          mockFetchResponse({ status: "succeeded", session: session(`session-http-${status}`) }),
        );

      await expect(client.createSession(request)).resolves.toEqual({
        session: session(`session-http-${status}`),
      });

      const key = requestHeader(fetchMock, 0, "Idempotency-Key");
      expect(key).toBeTruthy();
      expect(fetchMock.mock.calls[1]?.[0]).toContain(
        `/session-create-operations/${encodeURIComponent(key!)}`,
      );
    },
  );

  it("polls a pending operation and returns it when it succeeds", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(mockFetchResponse({ status: "pending" }))
      .mockResolvedValueOnce(
        mockFetchResponse({ status: "succeeded", session: session("session-after-pending") }),
      );

    const result = client.createSession(request);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ session: session("session-after-pending") });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("surfaces persistent pending as recoverable rather than a definitive failure", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(mockFetchResponse({ status: "pending" }))
      .mockResolvedValueOnce(mockFetchResponse({ status: "pending" }))
      .mockResolvedValueOnce(mockFetchResponse({ status: "pending" }));

    const result = client.createSession(request).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const error = await result;

    expect(error).toBeInstanceOf(SessionCreateRecoveryError);
    expect(error).toMatchObject({ recoverable: true, operationStatus: "pending" });
    expect((error as Error).message).toContain("may already have succeeded");
    // Pending means Bamboo owns the in-flight operation: Lotus only polls and
    // never issues a second POST.
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });

  it("lets an explicit continuation replay one persistently pending operation", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockFetchResponse({ status: "pending" }))
      .mockResolvedValueOnce(mockFetchResponse({ status: "pending" }))
      .mockResolvedValueOnce(
        mockFetchResponse({ session: session("session-resumed-pending") }, { status: 201 }),
      );

    const result = client.createSession(request, {
      idempotencyKey: "lotus-session-pending-restart",
    });
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ session: session("session-resumed-pending") });
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["GET", "GET", "POST"]);
    expect(requestHeader(fetchMock, 2, "Idempotency-Key")).toBe("lotus-session-pending-restart");
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(JSON.stringify(request));
  });

  it("surfaces a durable failed operation with the backend safe error", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(
      mockFetchResponse({
        status: "failed",
        error: { code: "session_store_failed", message: "Unable to persist the session" },
      }),
    );

    await expect(client.createSession(request)).rejects.toMatchObject({
      name: "session_store_failed",
      message: "Unable to persist the session",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("replays a fresh explicitly-continued unknown operation with the exact key and payload", async () => {
    const operationCreatedAtMs = Date.now();
    fetchMock
      .mockResolvedValueOnce(mockFetchResponse({ status: "unknown" }))
      .mockResolvedValueOnce(
        mockFetchResponse({ session: session("session-replayed") }, { status: 200 }),
      );

    await expect(
      client.createSession(request, {
        idempotencyKey: "lotus-session-fresh-continuation",
        operationCreatedAtMs,
      }),
    ).resolves.toEqual({ session: session("session-replayed") });

    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["GET", "POST"]);
    expect(requestHeader(fetchMock, 1, "Idempotency-Key")).toBe("lotus-session-fresh-continuation");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify(request));
  });

  it("checks status again when an unknown-operation replay returns 5xx", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockFetchError("ambiguous create response", 500))
      .mockResolvedValueOnce(mockFetchResponse({ status: "unknown" }))
      .mockResolvedValueOnce(mockFetchError("post-commit failure", 500))
      .mockResolvedValueOnce(
        mockFetchResponse({ status: "succeeded", session: session("session-after-replay-500") }),
      );

    const result = client.createSession(request);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ session: session("session-after-replay-500") });
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual([
      "POST",
      "GET",
      "POST",
      "GET",
    ]);
    expect(requestHeader(fetchMock, 2, "Idempotency-Key")).toBe(
      requestHeader(fetchMock, 0, "Idempotency-Key"),
    );
  });

  it("resumes a UI retry by checking the existing key before any POST", async () => {
    fetchMock.mockResolvedValueOnce(
      mockFetchResponse({ status: "succeeded", session: session("session-ui-retry") }),
    );

    await expect(
      client.createSession(request, { idempotencyKey: "lotus-session-ui-retry" }),
    ).resolves.toEqual({ session: session("session-ui-retry") });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("GET");
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/session-create-operations/lotus-session-ui-retry",
    );
  });

  it("does not replay an expired recovery record as a new create", async () => {
    fetchMock.mockRejectedValueOnce(abortError()).mockResolvedValueOnce(
      mockFetchResponse({
        status: "expired",
        error: {
          code: "idempotency_key_expired",
          message: "Recovery record expired",
        },
      }),
    );

    const error = await client.createSession(request).catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "idempotency_key_expired",
      message: "Recovery record expired",
    });
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });

  it("keeps an initial AbortError with unknown status poll-only", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce(mockFetchResponse({ status: "unknown" }))
      .mockResolvedValueOnce(mockFetchResponse({ status: "unknown" }))
      .mockResolvedValueOnce(mockFetchResponse({ status: "unknown" }));

    const result = client.createSession(request).catch((caught: unknown) => caught);
    await vi.runAllTimersAsync();
    const error = await result;

    expect(error).toBeInstanceOf(SessionCreateRecoveryError);
    expect(error).toMatchObject({ operationStatus: "unknown" });
    expect(fetchMock.mock.calls.filter((call) => call[1]?.method === "POST")).toHaveLength(1);
  });

  it("does not POST-replay an unknown operation outside the 24-hour retention window", async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(mockFetchResponse({ status: "unknown" }))
      .mockResolvedValueOnce(mockFetchResponse({ status: "unknown" }))
      .mockResolvedValueOnce(mockFetchResponse({ status: "unknown" }));

    const result = client
      .createSession(request, {
        idempotencyKey: "lotus-session-expired-locally",
        operationCreatedAtMs: Date.now() - 24 * 60 * 60 * 1000 - 1,
      })
      .catch((caught: unknown) => caught);
    await vi.runAllTimersAsync();
    const error = await result;

    expect(error).toBeInstanceOf(SessionCreateRecoveryError);
    expect(fetchMock.mock.calls.every((call) => call[1]?.method === "GET")).toBe(true);
  });

  it("does not recover or replay a deterministic create conflict", async () => {
    fetchMock.mockResolvedValueOnce(mockFetchError("idempotency key conflict", 409));

    const result = client.createSession(request).catch((error: unknown) => error);
    const error = await result;

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, message: "idempotency key conflict" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("assigns distinct keys to two explicit create actions", async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockFetchResponse({ session: session("session-first") }, { status: 201 }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse({ session: session("session-second") }, { status: 201 }),
      );

    await client.createSession(request);
    await client.createSession(request);

    const firstKey = requestHeader(fetchMock, 0, "Idempotency-Key");
    const secondKey = requestHeader(fetchMock, 1, "Idempotency-Key");
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
  });
});
