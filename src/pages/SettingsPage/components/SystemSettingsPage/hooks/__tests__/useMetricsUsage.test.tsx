import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetUsageBreakdown = vi.fn();

vi.mock("@services/metrics", () => ({
  metricsService: {
    getUsageBreakdown: (...args: unknown[]) => mockGetUsageBreakdown(...args),
  },
}));

import { useMetricsUsage } from "../useMetricsUsage";

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
});
