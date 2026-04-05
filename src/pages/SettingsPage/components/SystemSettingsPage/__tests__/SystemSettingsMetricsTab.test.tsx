import { fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { describe, expect, it, vi } from "vitest";

import SystemSettingsMetricsTab from "../SystemSettingsMetricsTab";

const mockUseMetrics = vi.fn();
const mockUseForwardMetrics = vi.fn();
const mockUseMetricsUsage = vi.fn();
const mockMemoryTrendChart = vi.fn(({ data }: { data: Array<unknown> }) => (
  <div data-testid="memory-trend-chart-mock">memory-trend-points:{data.length}</div>
));

vi.mock("../hooks/useMetrics", () => ({
  useMetrics: (...args: unknown[]) => mockUseMetrics(...args),
}));

vi.mock("../hooks/useForwardMetrics", () => ({
  useForwardMetrics: (...args: unknown[]) => mockUseForwardMetrics(...args),
}));

vi.mock("../hooks/useMetricsUsage", () => ({
  useMetricsUsage: (...args: unknown[]) => mockUseMetricsUsage(...args),
}));

vi.mock("../metrics/TokenChart", () => ({
  default: () => <div data-testid="token-chart-mock" />,
}));

vi.mock("../metrics/ModelDistribution", () => ({
  default: () => <div data-testid="model-distribution-mock" />,
}));

vi.mock("../metrics/MemoryTrendChart", () => ({
  default: (props: { data: Array<unknown>; loading: boolean }) => mockMemoryTrendChart(props),
}));

vi.mock("../metrics/MetricCards", () => ({
  default: () => <div data-testid="metric-cards-mock" />,
}));

vi.mock("../metrics/MemoryMetricsCards", () => ({
  default: () => <div data-testid="memory-metrics-cards-mock" />,
}));

vi.mock("../metrics/SyncMismatchBreakdownCard", () => ({
  default: () => <div data-testid="sync-mismatch-breakdown-card-mock" />,
}));

vi.mock("../metrics/ForwardMetricsCards", () => ({
  default: () => <div data-testid="forward-metrics-cards-mock" />,
}));

vi.mock("../metrics/ForwardEndpointDistribution", () => ({
  default: () => <div data-testid="forward-endpoint-distribution-mock" />,
}));

vi.mock("../metrics/ForwardRequestTable", () => ({
  default: () => <div data-testid="forward-request-table-mock" />,
}));

vi.mock("../metrics/SessionTable", () => ({
  default: () => <div data-testid="session-table-mock" />,
}));

vi.mock("../metrics/UsageBreakdownCards", () => ({
  default: () => <div data-testid="usage-breakdown-cards-mock" />,
}));

vi.mock("../metrics/TopUsageBarCard", () => ({
  default: () => <div data-testid="top-usage-bar-card-mock" />,
}));

describe("SystemSettingsMetricsTab", () => {
  it("mounts MemoryTrendChart in the Memory tab with memory timeline data", async () => {
    mockUseMetrics.mockReturnValue({
      summary: {
        total_sessions: 2,
        total_tokens: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
        total_tool_calls: 3,
        active_sessions: 1,
        sync_mismatch_breakdown: {},
      },
      modelMetrics: [],
      sessions: [],
      timeline: [],
      memorySummary: {
        total_memories: 6,
        stale_candidate_count: 1,
        project_count: 1,
        by_type: { project: 6 },
        by_status: { active: 6 },
        by_scope: { project: 6 },
      },
      memoryTimeline: [
        {
          label: "2026-04-01",
          period_start: "2026-04-01",
          period_end: "2026-04-01",
          created_memories: 2,
          updated_memories: 1,
          total_memories: 6,
        },
        {
          label: "2026-04-02",
          period_start: "2026-04-02",
          period_end: "2026-04-02",
          created_memories: 1,
          updated_memories: 2,
          total_memories: 7,
        },
      ],
      sessionDetail: null,
      isLoading: false,
      isRefreshing: false,
      isSessionDetailLoading: false,
      error: null,
      refresh: vi.fn(),
      loadSessionDetail: vi.fn(),
      clearSessionDetail: vi.fn(),
    });

    mockUseForwardMetrics.mockReturnValue({
      summary: {
        total_requests: 1,
        successful_requests: 1,
        failed_requests: 0,
        total_tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        avg_duration_ms: 100,
      },
      endpointMetrics: [],
      requests: [],
      isLoading: false,
      isRefreshing: false,
      error: null,
      refresh: vi.fn(),
    });

    mockUseMetricsUsage.mockReturnValue({
      data: {
        total_sessions: 0,
        total_tool_calls: 0,
        core_tool_calls: 0,
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
      },
      isLoading: false,
      isRefreshing: false,
      error: null,
      refresh: vi.fn(),
    });

    render(
      <AntdApp>
        <SystemSettingsMetricsTab />
      </AntdApp>,
    );

    fireEvent.click(screen.getByText("Memory"));

    expect(await screen.findByTestId("memory-trend-chart-mock")).toHaveTextContent(
      "memory-trend-points:2",
    );
    expect(mockMemoryTrendChart).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({ label: "2026-04-01" }),
          expect.objectContaining({ label: "2026-04-02" }),
        ]),
        loading: false,
      }),
    );
  });
});
