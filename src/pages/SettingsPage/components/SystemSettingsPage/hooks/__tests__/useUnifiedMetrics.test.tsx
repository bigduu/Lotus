import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDeferred } from "./deferred";
import { useUnifiedMetrics } from "../useUnifiedMetrics";

const metricsServiceMock = vi.hoisted(() => ({
  getUnifiedSummary: vi.fn(),
  getUnifiedTimeline: vi.fn(),
  getByModel: vi.fn(),
  getSessions: vi.fn(),
  getForwardByEndpoint: vi.fn(),
  getForwardRequests: vi.fn(),
  getSessionDetail: vi.fn(),
}));

vi.mock("@services/metrics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@services/metrics")>();
  return {
    ...actual,
    metricsService: metricsServiceMock,
  };
});

const unifiedSummary = {
  chat: {
    total_sessions: 2,
    total_tokens: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    total_tool_calls: 2,
    active_sessions: 0,
  },
  forward: {
    total_requests: 1,
    successful_requests: 1,
    failed_requests: 0,
    total_tokens: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
  },
  combined: {
    total_requests: 3,
    total_tokens: 25,
    total_success: 3,
    total_errors: 0,
    success_rate: 100,
  },
  memory: {
    total_memories: 0,
    stale_candidate_count: 0,
    project_count: 0,
    by_type: {},
    by_status: {},
    by_scope: {},
  },
};

const modelMetric = (model: string) => ({
  model,
  sessions: 1,
  rounds: 1,
  tokens: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  tool_calls: 0,
});

describe("useUnifiedMetrics", () => {
  beforeEach(() => {
    Object.values(metricsServiceMock).forEach((mock) => mock.mockReset());
    metricsServiceMock.getUnifiedSummary.mockResolvedValue(unifiedSummary);
    metricsServiceMock.getUnifiedTimeline.mockResolvedValue([]);
    metricsServiceMock.getByModel.mockResolvedValue([
      modelMetric("gpt-5"),
      modelMetric("claude-4"),
    ]);
    metricsServiceMock.getSessions.mockResolvedValue([]);
    metricsServiceMock.getForwardByEndpoint.mockResolvedValue([]);
    metricsServiceMock.getForwardRequests.mockResolvedValue([]);
    metricsServiceMock.getSessionDetail.mockResolvedValue(null);
  });

  it("scopes unified and detailed requests together while preserving the all-model catalog", async () => {
    const { result, rerender } = renderHook(
      ({ model }: { model?: string }) =>
        useUnifiedMetrics({
          autoRefreshMs: 0,
          filters: { endDate: "2026-02-10", days: 7, granularity: "daily", model },
        }),
      { initialProps: { model: undefined } },
    );

    await waitFor(() => expect(metricsServiceMock.getUnifiedSummary).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.modelCatalog).toEqual(["gpt-5", "claude-4"]));

    metricsServiceMock.getByModel.mockResolvedValue([modelMetric("gpt-5")]);
    rerender({ model: "  gpt-5  " });
    await waitFor(() => expect(metricsServiceMock.getUnifiedSummary).toHaveBeenCalledTimes(2));

    const selectedRange = {
      startDate: "2026-02-04",
      endDate: "2026-02-10",
      model: "gpt-5",
    };
    expect(metricsServiceMock.getUnifiedSummary).toHaveBeenNthCalledWith(2, selectedRange);
    expect(metricsServiceMock.getUnifiedTimeline).toHaveBeenNthCalledWith(2, {
      days: 7,
      endDate: "2026-02-10",
      granularity: "daily",
      model: "gpt-5",
    });
    expect(metricsServiceMock.getByModel).toHaveBeenNthCalledWith(2, selectedRange);
    expect(metricsServiceMock.getSessions).toHaveBeenNthCalledWith(2, {
      ...selectedRange,
      limit: 200,
    });
    await waitFor(() => {
      expect(result.current.modelMetrics.map((item) => item.model)).toEqual(["gpt-5"]);
      expect(result.current.modelCatalog).toEqual(["gpt-5", "claude-4"]);
    });

    metricsServiceMock.getByModel.mockResolvedValue([
      modelMetric("gpt-5"),
      modelMetric("claude-4"),
    ]);
    rerender({ model: "" });
    await waitFor(() => expect(metricsServiceMock.getUnifiedSummary).toHaveBeenCalledTimes(3));

    expect(metricsServiceMock.getUnifiedSummary).toHaveBeenNthCalledWith(3, {
      startDate: "2026-02-04",
      endDate: "2026-02-10",
    });
    expect(metricsServiceMock.getUnifiedTimeline).toHaveBeenNthCalledWith(3, {
      days: 7,
      endDate: "2026-02-10",
      granularity: "daily",
    });
    expect(metricsServiceMock.getByModel).toHaveBeenNthCalledWith(3, {
      startDate: "2026-02-04",
      endDate: "2026-02-10",
    });
    expect(metricsServiceMock.getSessions).toHaveBeenNthCalledWith(3, {
      startDate: "2026-02-04",
      endDate: "2026-02-10",
      limit: 200,
    });
  });

  it("clears the previous filter generation while a replacement is pending", async () => {
    metricsServiceMock.getUnifiedTimeline.mockResolvedValue([
      {
        date: "2026-02-10",
        chat_tokens: 20,
        chat_sessions: 2,
        forward_tokens: 5,
        forward_requests: 1,
        total_tokens: 25,
      },
    ]);
    metricsServiceMock.getSessions.mockResolvedValue([
      {
        session_id: "all-model-session",
        model: "gpt-5",
        started_at: "2026-02-10T10:00:00Z",
        total_rounds: 1,
        total_token_usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        tool_call_count: 0,
        tool_breakdown: {},
        status: "completed",
        message_count: 2,
      },
    ]);

    const { result, rerender } = renderHook(
      ({ model }: { model?: string }) =>
        useUnifiedMetrics({ autoRefreshMs: 0, filters: { days: 30, model } }),
      { initialProps: { model: undefined } },
    );

    await waitFor(() => {
      expect(result.current.chatSummary?.total_sessions).toBe(2);
      expect(result.current.timeline).toHaveLength(1);
      expect(result.current.sessions).toHaveLength(1);
    });

    const selectedSummary = createDeferred<typeof unifiedSummary>();
    metricsServiceMock.getUnifiedSummary.mockImplementationOnce(() => selectedSummary.promise);
    rerender({ model: "gpt-5" });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true);
      expect(result.current.chatSummary).toBeNull();
      expect(result.current.timeline).toEqual([]);
      expect(result.current.modelMetrics).toEqual([]);
      expect(result.current.sessions).toEqual([]);
      expect(result.current.modelCatalog).toEqual(["gpt-5", "claude-4"]);
    });

    await act(async () => {
      selectedSummary.resolve(unifiedSummary);
      await selectedSummary.promise;
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });
});
