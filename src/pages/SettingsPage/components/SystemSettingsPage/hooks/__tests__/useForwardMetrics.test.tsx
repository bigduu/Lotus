import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { metricsService } from "@services/metrics";
import { useForwardMetrics } from "../useForwardMetrics";

vi.mock("@services/metrics", () => ({
  metricsService: {
    getForwardSummary: vi.fn(),
    getForwardByEndpoint: vi.fn(),
    getForwardRequests: vi.fn(),
  },
}));

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
});
