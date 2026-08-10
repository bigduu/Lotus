import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DailyMetrics, MetricsSummary, ModelMetrics, SessionMetrics } from "@services/metrics";
import { createDeferred } from "./deferred";
import { useMetrics } from "../useMetrics";

const createSummary = (totalSessions: number): MetricsSummary => ({
  total_sessions: totalSessions,
  total_tokens: {
    prompt_tokens: totalSessions,
    completion_tokens: totalSessions,
    total_tokens: totalSessions * 2,
  },
  total_tool_calls: totalSessions,
  active_sessions: 0,
});

const createModelMetrics = (model: string, sessions = 1): ModelMetrics => ({
  model,
  sessions,
  rounds: sessions,
  tokens: {
    prompt_tokens: sessions,
    completion_tokens: sessions,
    total_tokens: sessions * 2,
  },
  tool_calls: sessions,
});

const createSessionMetrics = (model: string): SessionMetrics => ({
  session_id: `${model}-session`,
  model,
  started_at: "2026-02-10T10:00:00Z",
  completed_at: "2026-02-10T10:01:00Z",
  total_rounds: 1,
  total_token_usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  tool_call_count: 0,
  tool_breakdown: {},
  status: "completed",
  message_count: 2,
});

const createDailyMetrics = (sessions: number): DailyMetrics => ({
  date: "2026-02-10",
  total_sessions: sessions,
  total_rounds: sessions,
  total_token_usage: {
    prompt_tokens: sessions,
    completion_tokens: sessions,
    total_tokens: sessions * 2,
  },
  total_tool_calls: sessions,
  model_breakdown: {},
  tool_breakdown: {},
});

const createService = (getSummary: () => Promise<MetricsSummary>) => ({
  getSummary,
  getByModel: vi.fn().mockResolvedValue([]),
  getSessions: vi.fn().mockResolvedValue([]),
  getDaily: vi.fn().mockResolvedValue([]),
  getSessionDetail: vi.fn().mockResolvedValue(null),
});

describe("useMetrics", () => {
  it("loads metrics datasets on mount and exposes refresh", async () => {
    const service = {
      getSummary: vi.fn().mockResolvedValue({
        total_sessions: 2,
        total_tokens: {
          prompt_tokens: 5,
          completion_tokens: 7,
          total_tokens: 12,
        },
        total_tool_calls: 3,
        active_sessions: 1,
      }),
      getByModel: vi.fn().mockResolvedValue([]),
      getSessions: vi.fn().mockResolvedValue([]),
      getDaily: vi.fn().mockResolvedValue([]),
      getMemorySummary: vi.fn().mockResolvedValue({
        total_memories: 6,
        stale_candidate_count: 1,
        project_count: 2,
        by_type: { project: 3, reference: 3 },
        by_status: { active: 5, stale: 1 },
        by_scope: { global: 2, project: 4 },
      }),
      getMemoryTimeline: vi.fn().mockResolvedValue([
        {
          label: "2026-04-01",
          period_start: "2026-04-01",
          period_end: "2026-04-01",
          created_memories: 1,
          updated_memories: 2,
          total_memories: 6,
        },
      ]),
      getSessionDetail: vi.fn().mockResolvedValue(null),
    };

    const { result } = renderHook(() =>
      useMetrics({
        service,
        autoRefreshMs: 0,
        filters: {
          days: 30,
          granularity: "daily",
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.summary?.total_sessions).toBe(2);
      expect(result.current.memorySummary?.total_memories).toBe(6);
      expect(result.current.memoryTimeline).toHaveLength(1);
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(service.getSummary).toHaveBeenCalledTimes(2);
  });

  it("applies days filter to summary and session queries", async () => {
    const service = {
      getSummary: vi.fn().mockResolvedValue({
        total_sessions: 1,
        total_tokens: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
        total_tool_calls: 0,
        active_sessions: 0,
      }),
      getByModel: vi.fn().mockResolvedValue([]),
      getSessions: vi.fn().mockResolvedValue([]),
      getDaily: vi.fn().mockResolvedValue([]),
      getSessionDetail: vi.fn().mockResolvedValue(null),
    };

    renderHook(() =>
      useMetrics({
        service,
        autoRefreshMs: 0,
        filters: {
          endDate: "2026-02-10",
          days: 7,
          granularity: "daily",
        },
      }),
    );

    await waitFor(() => {
      expect(service.getSummary).toHaveBeenCalledWith({
        startDate: "2026-02-04",
        endDate: "2026-02-10",
      });
    });

    expect(service.getSessions).toHaveBeenCalledWith({
      startDate: "2026-02-04",
      endDate: "2026-02-10",
      limit: 200,
    });
  });

  it("uses one normalized model for every dataset and omits it after clearing", async () => {
    const service = {
      getSummary: vi.fn().mockResolvedValue(createSummary(2)),
      getByModel: vi
        .fn()
        .mockImplementation((query?: { model?: string }) =>
          Promise.resolve(
            query?.model
              ? [createModelMetrics(query.model)]
              : [createModelMetrics("gpt-5"), createModelMetrics("claude-4")],
          ),
        ),
      getSessions: vi.fn().mockResolvedValue([]),
      getDaily: vi.fn().mockResolvedValue([]),
      getSessionDetail: vi.fn().mockResolvedValue(null),
    };
    const { result, rerender } = renderHook(
      ({ model }: { model?: string }) =>
        useMetrics({
          service,
          autoRefreshMs: 0,
          filters: { endDate: "2026-02-10", days: 7, granularity: "daily", model },
        }),
      { initialProps: { model: undefined } },
    );

    await waitFor(() => expect(service.getSummary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.modelCatalog).toEqual(["gpt-5", "claude-4"]));

    rerender({ model: "  gpt-5  " });
    await waitFor(() => expect(service.getSummary).toHaveBeenCalledTimes(2));

    const selectedRange = {
      startDate: "2026-02-04",
      endDate: "2026-02-10",
      model: "gpt-5",
    };
    expect(service.getSummary).toHaveBeenNthCalledWith(2, selectedRange);
    expect(service.getByModel).toHaveBeenNthCalledWith(2, selectedRange);
    expect(service.getSessions).toHaveBeenNthCalledWith(2, {
      ...selectedRange,
      limit: 200,
    });
    expect(service.getDaily).toHaveBeenNthCalledWith(2, {
      days: 7,
      endDate: "2026-02-10",
      granularity: "daily",
      model: "gpt-5",
    });
    await waitFor(() => {
      expect(result.current.modelMetrics.map((item) => item.model)).toEqual(["gpt-5"]);
      expect(result.current.modelCatalog).toEqual(["gpt-5", "claude-4"]);
    });

    rerender({ model: "" });
    await waitFor(() => expect(service.getSummary).toHaveBeenCalledTimes(3));

    const clearedRange = {
      startDate: "2026-02-04",
      endDate: "2026-02-10",
    };
    expect(service.getSummary).toHaveBeenNthCalledWith(3, clearedRange);
    expect(service.getByModel).toHaveBeenNthCalledWith(3, clearedRange);
    expect(service.getSessions).toHaveBeenNthCalledWith(3, {
      ...clearedRange,
      limit: 200,
    });
    expect(service.getDaily).toHaveBeenNthCalledWith(3, {
      days: 7,
      endDate: "2026-02-10",
      granularity: "daily",
    });
  });

  it("loads session detail on demand", async () => {
    const service = {
      getSummary: vi.fn().mockResolvedValue({
        total_sessions: 1,
        total_tokens: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
        total_tool_calls: 0,
        active_sessions: 0,
      }),
      getByModel: vi.fn().mockResolvedValue([]),
      getSessions: vi.fn().mockResolvedValue([]),
      getDaily: vi.fn().mockResolvedValue([]),
      getSessionDetail: vi.fn().mockResolvedValue({
        session: {
          session_id: "session-1",
          model: "gpt-4",
          started_at: "2026-02-10T10:00:00Z",
          completed_at: "2026-02-10T10:05:00Z",
          total_rounds: 1,
          total_token_usage: {
            prompt_tokens: 1,
            completion_tokens: 2,
            total_tokens: 3,
          },
          tool_call_count: 0,
          tool_breakdown: {},
          status: "completed",
          message_count: 2,
          duration_ms: 300000,
        },
        rounds: [],
      }),
    };

    const { result } = renderHook(() =>
      useMetrics({
        service,
        autoRefreshMs: 0,
        filters: {
          days: 30,
          granularity: "daily",
        },
      }),
    );

    await waitFor(() => {
      expect(result.current.summary?.total_sessions).toBe(1);
    });

    await act(async () => {
      await result.current.loadSessionDetail("session-1");
    });

    expect(service.getSessionDetail).toHaveBeenCalledWith("session-1");
    expect(result.current.sessionDetail?.session.session_id).toBe("session-1");
  });

  it("keeps the newest filter result when an older request resolves last", async () => {
    const older = createDeferred<MetricsSummary>();
    const newer = createDeferred<MetricsSummary>();
    const getSummary = vi
      .fn()
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const service = createService(getSummary);
    const { result, rerender } = renderHook(
      ({ model }) =>
        useMetrics({
          service,
          autoRefreshMs: 0,
          filters: { days: 30, granularity: "daily", model },
        }),
      { initialProps: { model: "older-model" } },
    );

    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(1));
    rerender({ model: "newer-model" });
    await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));

    await act(async () => {
      newer.resolve(createSummary(2));
      await newer.promise;
    });
    await waitFor(() => expect(result.current.summary?.total_sessions).toBe(2));

    await act(async () => {
      older.resolve(createSummary(1));
      await older.promise;
    });

    expect(result.current.summary?.total_sessions).toBe(2);
    expect(result.current.error).toBeNull();
  });

  it("clears old filter data when the replacement request fails", async () => {
    const older = createDeferred<MetricsSummary>();
    const newer = createDeferred<MetricsSummary>();
    const getSummary = vi
      .fn()
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const service = {
      getSummary,
      getByModel: vi
        .fn()
        .mockResolvedValueOnce([createModelMetrics("older-model")])
        .mockResolvedValueOnce([]),
      getSessions: vi
        .fn()
        .mockResolvedValueOnce([createSessionMetrics("older-model")])
        .mockResolvedValueOnce([]),
      getDaily: vi
        .fn()
        .mockResolvedValueOnce([createDailyMetrics(1)])
        .mockResolvedValueOnce([]),
      getSessionDetail: vi.fn().mockResolvedValue(null),
    };
    const { result, rerender } = renderHook(
      ({ model }) =>
        useMetrics({
          service,
          autoRefreshMs: 0,
          filters: { days: 30, granularity: "daily", model },
        }),
      { initialProps: { model: "older-model" } },
    );

    await act(async () => {
      older.resolve(createSummary(1));
      await older.promise;
    });
    await waitFor(() => {
      expect(result.current.summary?.total_sessions).toBe(1);
      expect(result.current.modelMetrics).toHaveLength(1);
      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.timeline).toHaveLength(1);
    });

    rerender({ model: "newer-model" });
    await waitFor(() => {
      expect(getSummary).toHaveBeenCalledTimes(2);
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
      expect(result.current.modelMetrics).toEqual([]);
      expect(result.current.sessions).toEqual([]);
      expect(result.current.timeline).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });
  });

  it("lets an overlapping refresh own both loading flags", async () => {
    const initial = createDeferred<MetricsSummary>();
    const refresh = createDeferred<MetricsSummary>();
    const getSummary = vi
      .fn()
      .mockImplementationOnce(() => initial.promise)
      .mockImplementationOnce(() => refresh.promise);
    const service = createService(getSummary);
    const { result } = renderHook(() =>
      useMetrics({
        service,
        autoRefreshMs: 0,
        filters: { days: 30, granularity: "daily" },
      }),
    );

    await waitFor(() => {
      expect(getSummary).toHaveBeenCalledTimes(1);
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isRefreshing).toBe(false);
    });

    let refreshPromise = Promise.resolve();
    act(() => {
      refreshPromise = result.current.refresh();
    });

    await waitFor(() => {
      expect(getSummary).toHaveBeenCalledTimes(2);
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

    expect(result.current.summary?.total_sessions).toBe(2);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isRefreshing).toBe(false);
  });
});
