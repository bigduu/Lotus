import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { metricsService } from "@services/metrics";
import type { ForwardMetricsSummary } from "@services/metrics";
import { createDeferred } from "./deferred";
import { useForwardMetrics } from "../useForwardMetrics";

vi.mock("@services/metrics", () => ({
  metricsService: {
    getForwardSummary: vi.fn(),
    getForwardByEndpoint: vi.fn(),
    getForwardRequests: vi.fn(),
  },
}));

const createSummary = (totalRequests: number): ForwardMetricsSummary => ({
  total_requests: totalRequests,
  successful_requests: totalRequests,
  failed_requests: 0,
  total_tokens: {
    prompt_tokens: totalRequests,
    completion_tokens: totalRequests,
    total_tokens: totalRequests * 2,
  },
  avg_duration_ms: null,
});

describe("useForwardMetrics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(metricsService.getForwardSummary).mockResolvedValue({
      total_requests: 0,
      successful_requests: 0,
      failed_requests: 0,
      total_tokens: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      avg_duration_ms: null,
    });
    vi.mocked(metricsService.getForwardByEndpoint).mockResolvedValue([]);
    vi.mocked(metricsService.getForwardRequests).mockResolvedValue([]);
  });

  it("applies days range to forward metrics queries", async () => {
    renderHook(() =>
      useForwardMetrics({
        autoRefreshMs: 0,
        filters: {
          endDate: "2026-02-10",
          days: 7,
        },
      }),
    );

    await waitFor(() => {
      // Aggregate queries omit `limit` (it only bounds the raw request list).
      expect(metricsService.getForwardSummary).toHaveBeenCalledWith({
        startDate: "2026-02-04",
        endDate: "2026-02-10",
        endpoint: undefined,
        model: undefined,
      });
    });
    expect(metricsService.getForwardByEndpoint).toHaveBeenCalledWith({
      startDate: "2026-02-04",
      endDate: "2026-02-10",
      endpoint: undefined,
      model: undefined,
    });
    // The raw request list is the only call that carries `limit`.
    expect(metricsService.getForwardRequests).toHaveBeenCalledWith({
      startDate: "2026-02-04",
      endDate: "2026-02-10",
      endpoint: undefined,
      model: undefined,
      limit: 100,
    });
  });

  it("keeps the newest filter result when an older request resolves last", async () => {
    const older = createDeferred<ForwardMetricsSummary>();
    const newer = createDeferred<ForwardMetricsSummary>();
    vi.mocked(metricsService.getForwardSummary)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const { result, rerender } = renderHook(
      ({ endpoint }) =>
        useForwardMetrics({
          autoRefreshMs: 0,
          filters: { days: 30, endpoint },
        }),
      { initialProps: { endpoint: "older-endpoint" } },
    );

    await waitFor(() => expect(metricsService.getForwardSummary).toHaveBeenCalledTimes(1));
    rerender({ endpoint: "newer-endpoint" });
    await waitFor(() => expect(metricsService.getForwardSummary).toHaveBeenCalledTimes(2));

    await act(async () => {
      newer.resolve(createSummary(2));
      await newer.promise;
    });
    await waitFor(() => expect(result.current.summary?.total_requests).toBe(2));

    await act(async () => {
      older.resolve(createSummary(1));
      await older.promise;
    });

    expect(result.current.summary?.total_requests).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it("clears old filter data when the replacement request fails", async () => {
    const older = createDeferred<ForwardMetricsSummary>();
    const newer = createDeferred<ForwardMetricsSummary>();
    vi.mocked(metricsService.getForwardSummary)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const { result, rerender } = renderHook(
      ({ endpoint }) =>
        useForwardMetrics({
          autoRefreshMs: 0,
          filters: { days: 30, endpoint },
        }),
      { initialProps: { endpoint: "older-endpoint" } },
    );

    await act(async () => {
      older.resolve(createSummary(1));
      await older.promise;
    });
    await waitFor(() => expect(result.current.summary?.total_requests).toBe(1));

    rerender({ endpoint: "newer-endpoint" });
    await waitFor(() => {
      expect(metricsService.getForwardSummary).toHaveBeenCalledTimes(2);
      expect(result.current.summary).toBeNull();
      expect(result.current.isLoading).toBe(true);
    });

    await act(async () => {
      newer.reject(new Error("new filter failed"));
      await newer.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.error).toBe("new filter failed");
      expect(result.current.summary).toBeNull();
      expect(result.current.endpointMetrics).toEqual([]);
      expect(result.current.requests).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("lets an overlapping refresh own both loading flags", async () => {
    const initial = createDeferred<ForwardMetricsSummary>();
    const refresh = createDeferred<ForwardMetricsSummary>();
    vi.mocked(metricsService.getForwardSummary)
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => refresh.promise);
    const { result } = renderHook(() =>
      useForwardMetrics({ autoRefreshMs: 0, filters: { days: 30 } }),
    );

    await waitFor(() => {
      expect(metricsService.getForwardSummary).toHaveBeenCalledTimes(1);
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isRefreshing).toBe(false);
    });

    let refreshPromise = Promise.resolve();
    act(() => {
      refreshPromise = result.current.refresh();
    });

    await waitFor(() => {
      expect(metricsService.getForwardSummary).toHaveBeenCalledTimes(2);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isRefreshing).toBe(true);
    });

    await act(async () => {
      initial.resolve(createSummary(1));
      await initial.promise;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRefreshing).toBe(true);
    expect(result.current.summary).toBeNull();

    await act(async () => {
      refresh.resolve(createSummary(2));
      await refreshPromise;
    });

    expect(result.current.summary?.total_requests).toBe(2);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRefreshing).toBe(false);
  });
});
