import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockFetchError, mockFetchResponse } from "@test/helpers";
import { MetricsService } from "../MetricsService";

describe("MetricsService", () => {
  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it("calls summary endpoint with date range query params", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse({
        total_sessions: 4,
        total_tokens: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
        total_tool_calls: 6,
        active_sessions: 1,
      }),
    );

    const service = new MetricsService();
    const summary = await service.getSummary({
      startDate: "2026-02-01",
      endDate: "2026-02-10",
    });

    expect(summary.total_sessions).toBe(4);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9562/api/v1/metrics/summary?start_date=2026-02-01&end_date=2026-02-10",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("calls daily endpoint with granularity option", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(
      mockFetchResponse([
        {
          label: "2026-02-03..2026-02-09",
          period_start: "2026-02-03",
          period_end: "2026-02-09",
          total_sessions: 4,
          total_rounds: 5,
          total_token_usage: {
            prompt_tokens: 12,
            completion_tokens: 13,
            total_tokens: 25,
          },
          total_tool_calls: 6,
          model_breakdown: {},
          tool_breakdown: {},
        },
      ]),
    );

    const service = new MetricsService();
    const daily = await service.getDaily({
      days: 14,
      granularity: "weekly",
    });

    expect(daily).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:9562/api/v1/metrics/daily?days=14&granularity=weekly",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("calls sessions and forward metrics endpoints with query params", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchResponse([]))
      .mockResolvedValueOnce(
        mockFetchResponse({
          total_requests: 10,
          total_tokens: 100,
          by_endpoint: [],
          by_model: [],
        }),
      )
      .mockResolvedValueOnce(mockFetchResponse([]))
      .mockResolvedValueOnce(mockFetchResponse([]));

    const service = new MetricsService();
    await service.getSessions({
      startDate: "2026-02-01",
      endDate: "2026-02-10",
      model: "gpt-5",
      limit: 20,
    });
    await service.getForwardSummary({
      startDate: "2026-02-01",
      endDate: "2026-02-10",
      endpoint: "/v1/chat/completions",
      model: "gpt-5",
      limit: 5,
    });
    await service.getForwardByEndpoint({
      endpoint: "/v1/chat/completions",
      model: "gpt-5",
    });
    await service.getForwardRequests({
      endpoint: "/v1/chat/completions",
      model: "gpt-5",
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:9562/api/v1/metrics/sessions?start_date=2026-02-01&end_date=2026-02-10&model=gpt-5&limit=20",
      expect.objectContaining({ method: "GET" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:9562/api/v1/metrics/forward/summary?start_date=2026-02-01&end_date=2026-02-10&endpoint=%2Fv1%2Fchat%2Fcompletions&model=gpt-5&limit=5",
      expect.objectContaining({ method: "GET" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:9562/api/v1/metrics/forward/by-endpoint?endpoint=%2Fv1%2Fchat%2Fcompletions&model=gpt-5",
      expect.objectContaining({ method: "GET" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:9562/api/v1/metrics/forward/requests?endpoint=%2Fv1%2Fchat%2Fcompletions&model=gpt-5",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("returns null for missing session detail and rethrows other errors", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(mockFetchError("not found", 404))
      .mockResolvedValueOnce(mockFetchError("bad request", 400));

    const service = new MetricsService();

    await expect(service.getSessionDetail("session/id")).resolves.toBeNull();
    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:9562/api/v1/metrics/sessions/session%2Fid",
      expect.objectContaining({ method: "GET" }),
    );

    await expect(service.getSessionDetail("session-2")).rejects.toThrow(
      "bad request",
    );
  });

  it("calls v2 endpoints and omits empty query values", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce(
        mockFetchResponse({
          total_sessions: 0,
          total_cost: 0,
        }),
      )
      .mockResolvedValueOnce(mockFetchResponse([]));

    const service = new MetricsService();
    await service.getUnifiedSummary({
      startDate: "",
      endDate: undefined,
    });
    await service.getUnifiedTimeline({
      days: 7,
      endDate: "2026-02-10",
      granularity: "daily",
    });

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:9562/api/v1/metrics/v2/summary",
      expect.objectContaining({ method: "GET" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:9562/api/v1/metrics/v2/timeline?days=7&end_date=2026-02-10&granularity=daily",
      expect.objectContaining({ method: "GET" }),
    );
  });
});
