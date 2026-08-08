import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MetricsUsageBreakdownResponse } from "@services/metrics";
import { createDeferred } from "./deferred";

const mockGetUsageBreakdown = vi.fn();

vi.mock("@services/metrics", () => ({
  metricsService: {
    getUsageBreakdown: (...args: unknown[]) => mockGetUsageBreakdown(...args),
  },
}));

import { useMetricsUsage } from "../useMetricsUsage";

const createUsage = (totalSessions: number): MetricsUsageBreakdownResponse => ({
  total_sessions: totalSessions,
  total_tool_calls: totalSessions,
  core_tool_calls: totalSessions,
  skill_load_calls: 0,
  mcp_calls: 0,
  unique_skills: 0,
  unique_mcp_servers: 0,
  unique_mcp_tools: 0,
  sessions_with_skill_loads: 0,
  sessions_with_mcp_calls: 0,
  top_core_tools: [],
  top_skills: [],
  top_mcp_servers: [],
  top_mcp_tools: [],
});

describe("useMetricsUsage", () => {
  beforeEach(() => {
    mockGetUsageBreakdown.mockReset();
  });

  it("loads usage breakdown on mount and exposes refresh", async () => {
    mockGetUsageBreakdown.mockResolvedValue({
      total_sessions: 2,
      total_tool_calls: 8,
      core_tool_calls: 4,
      skill_load_calls: 2,
      mcp_calls: 2,
      unique_skills: 2,
      unique_mcp_servers: 1,
      unique_mcp_tools: 2,
      sessions_with_skill_loads: 2,
      sessions_with_mcp_calls: 1,
      top_core_tools: [],
      top_skills: [],
      top_mcp_servers: [],
      top_mcp_tools: [],
    });

    const { result } = renderHook(() =>
      useMetricsUsage({
        autoRefreshMs: 0,
        filters: {
          endDate: "2026-04-03",
          days: 7,
          model: "gpt-5",
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.data?.total_tool_calls).toBe(8);
    });

    expect(mockGetUsageBreakdown).toHaveBeenCalledWith({
      startDate: "2026-03-28",
      endDate: "2026-04-03",
      model: "gpt-5",
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(mockGetUsageBreakdown).toHaveBeenCalledTimes(2);
  });

  it("keeps the newest filter result when an older request resolves last", async () => {
    const older = createDeferred<MetricsUsageBreakdownResponse>();
    const newer = createDeferred<MetricsUsageBreakdownResponse>();
    mockGetUsageBreakdown
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const { result, rerender } = renderHook(
      ({ model }) =>
        useMetricsUsage({
          autoRefreshMs: 0,
          filters: { days: 30, model },
        }),
      { initialProps: { model: "older-model" } },
    );

    await waitFor(() => expect(mockGetUsageBreakdown).toHaveBeenCalledTimes(1));
    rerender({ model: "newer-model" });
    await waitFor(() => expect(mockGetUsageBreakdown).toHaveBeenCalledTimes(2));

    await act(async () => {
      newer.resolve(createUsage(2));
      await newer.promise;
    });
    await waitFor(() => expect(result.current.data?.total_sessions).toBe(2));

    await act(async () => {
      older.resolve(createUsage(1));
      await older.promise;
    });

    expect(result.current.data?.total_sessions).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it("clears old filter data when the replacement request fails", async () => {
    const older = createDeferred<MetricsUsageBreakdownResponse>();
    const newer = createDeferred<MetricsUsageBreakdownResponse>();
    mockGetUsageBreakdown
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const { result, rerender } = renderHook(
      ({ model }) =>
        useMetricsUsage({
          autoRefreshMs: 0,
          filters: { days: 30, model },
        }),
      { initialProps: { model: "older-model" } },
    );

    await act(async () => {
      older.resolve(createUsage(1));
      await older.promise;
    });
    await waitFor(() => expect(result.current.data?.total_sessions).toBe(1));

    rerender({ model: "newer-model" });
    await waitFor(() => {
      expect(mockGetUsageBreakdown).toHaveBeenCalledTimes(2);
      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(true);
    });

    await act(async () => {
      newer.reject(new Error("new filter failed"));
      await newer.promise.catch(() => undefined);
    });

    await waitFor(() => {
      expect(result.current.error).toBe("new filter failed");
      expect(result.current.data).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("lets an overlapping refresh own both loading flags", async () => {
    const initial = createDeferred<MetricsUsageBreakdownResponse>();
    const refresh = createDeferred<MetricsUsageBreakdownResponse>();
    mockGetUsageBreakdown
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => refresh.promise);
    const { result } = renderHook(() =>
      useMetricsUsage({ autoRefreshMs: 0, filters: { days: 30 } }),
    );

    await waitFor(() => {
      expect(mockGetUsageBreakdown).toHaveBeenCalledTimes(1);
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isRefreshing).toBe(false);
    });

    let refreshPromise = Promise.resolve();
    act(() => {
      refreshPromise = result.current.refresh();
    });

    await waitFor(() => {
      expect(mockGetUsageBreakdown).toHaveBeenCalledTimes(2);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isRefreshing).toBe(true);
    });

    await act(async () => {
      initial.resolve(createUsage(1));
      await initial.promise;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRefreshing).toBe(true);
    expect(result.current.data).toBeNull();

    await act(async () => {
      refresh.resolve(createUsage(2));
      await refreshPromise;
    });

    expect(result.current.data?.total_sessions).toBe(2);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRefreshing).toBe(false);
  });
});
