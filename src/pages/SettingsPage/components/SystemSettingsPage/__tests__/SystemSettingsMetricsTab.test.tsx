import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SystemSettingsMetricsTab from "../SystemSettingsMetricsTab";

const mockUseMetrics = vi.fn();
const mockUseForwardMetrics = vi.fn();
const mockUseMetricsUsage = vi.fn();
const mockMetricCards = vi.fn(({ summary, sessions, showSyncMismatches = true }) => (
  <div data-testid="metric-cards-mock">
    cards:{summary?.total_sessions ?? 0}:{sessions[0]?.model ?? "none"}:
    {showSyncMismatches ? "sync-visible" : "sync-hidden"}
  </div>
));
const mockTokenChart = vi.fn(({ data }: { data: Array<{ totalTokens: number }> }) => (
  <div data-testid="token-chart-mock">tokens:{data[0]?.totalTokens ?? 0}</div>
));
const mockModelDistribution = vi.fn(({ data }: { data: Array<{ model: string }> }) => (
  <div data-testid="model-distribution-mock">models:{data.map((item) => item.model).join(",")}</div>
));
const mockSessionTable = vi.fn(({ sessions }: { sessions: Array<{ model: string }> }) => (
  <div data-testid="session-table-mock">
    sessions:{sessions.map((session) => session.model).join(",")}
  </div>
));
const mockSyncMismatchBreakdown = vi.fn(() => (
  <div data-testid="sync-mismatch-breakdown-card-mock" />
));
const mockMemoryTrendChart = vi.fn(({ data }: { data: Array<unknown> }) => (
  <div data-testid="memory-trend-chart-mock">memory-trend-points:{data.length}</div>
));

async function openModelSelectAndFindOption(optionText: string) {
  const combobox = screen.getAllByRole("combobox")[0];
  const select = combobox.closest(".ant-select");
  const trigger = select?.querySelector(".ant-select-selector") ?? combobox;
  fireEvent.mouseDown(trigger);

  return waitFor(() => {
    const option = Array.from(document.querySelectorAll(".ant-select-item-option-content")).find(
      (node) => node.textContent?.trim() === optionText,
    ) as HTMLElement | undefined;
    expect(option).toBeTruthy();
    return option as HTMLElement;
  });
}

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
  default: (props: { data: Array<{ totalTokens: number }> }) => mockTokenChart(props),
}));

vi.mock("../metrics/ModelDistribution", () => ({
  default: (props: { data: Array<{ model: string }> }) => mockModelDistribution(props),
}));

vi.mock("../metrics/MemoryTrendChart", () => ({
  default: (props: { data: Array<unknown>; loading: boolean }) => mockMemoryTrendChart(props),
}));

vi.mock("../metrics/MetricCards", () => ({
  default: (props: {
    summary: { total_sessions: number } | null;
    sessions: Array<{ model: string }>;
    showSyncMismatches?: boolean;
  }) => mockMetricCards(props),
}));

vi.mock("../metrics/MemoryMetricsCards", () => ({
  default: () => <div data-testid="memory-metrics-cards-mock" />,
}));

vi.mock("../metrics/SyncMismatchBreakdownCard", () => ({
  default: () => mockSyncMismatchBreakdown(),
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
  default: (props: { sessions: Array<{ model: string }> }) => mockSessionTable(props),
}));

vi.mock("../metrics/UsageBreakdownCards", () => ({
  default: () => <div data-testid="usage-breakdown-cards-mock" />,
}));

vi.mock("../metrics/TopUsageBarCard", () => ({
  default: () => <div data-testid="top-usage-bar-card-mock" />,
}));

describe("SystemSettingsMetricsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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
      modelCatalog: [],
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

  it("renders every chat dataset from the selected scope while retaining the model catalog", async () => {
    const allModelMetrics = [
      {
        model: "gpt-5",
        sessions: 2,
        rounds: 4,
        tokens: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
        tool_calls: 2,
      },
      {
        model: "claude-4",
        sessions: 8,
        rounds: 16,
        tokens: { prompt_tokens: 400, completion_tokens: 560, total_tokens: 960 },
        tool_calls: 8,
      },
    ];
    const session = (model: string, totalRounds: number) => ({
      session_id: `${model}-session`,
      model,
      started_at: "2026-02-10T10:00:00Z",
      total_rounds: totalRounds,
      total_token_usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      tool_call_count: 1,
      tool_breakdown: {},
      status: "completed",
      message_count: 2,
    });

    mockUseMetrics.mockImplementation(({ filters }: { filters: { model?: string } }) => {
      const filtered = filters.model === "gpt-5";
      return {
        summary: {
          total_sessions: filtered ? 2 : 10,
          total_tokens: {
            prompt_tokens: filtered ? 20 : 420,
            completion_tokens: filtered ? 20 : 580,
            total_tokens: filtered ? 40 : 1000,
          },
          total_tool_calls: filtered ? 2 : 10,
          active_sessions: 0,
          total_sync_mismatches: filtered ? 0 : 3,
          sync_mismatch_breakdown: filtered ? {} : { missing_cursor: 3 },
        },
        modelMetrics: filtered ? [allModelMetrics[0]] : allModelMetrics,
        modelCatalog: ["gpt-5", "claude-4"],
        sessions: filtered ? [session("gpt-5", 4)] : [session("gpt-5", 4), session("claude-4", 16)],
        timeline: [
          {
            date: "2026-02-10",
            total_sessions: filtered ? 2 : 10,
            total_rounds: filtered ? 4 : 20,
            total_token_usage: {
              prompt_tokens: filtered ? 20 : 420,
              completion_tokens: filtered ? 20 : 580,
              total_tokens: filtered ? 40 : 1000,
            },
            total_tool_calls: filtered ? 2 : 10,
            model_breakdown: {},
            tool_breakdown: {},
          },
        ],
        memorySummary: null,
        memoryTimeline: [],
        sessionDetail: null,
        isLoading: false,
        isRefreshing: false,
        isSessionDetailLoading: false,
        error: null,
        refresh: vi.fn(),
        loadSessionDetail: vi.fn(),
        clearSessionDetail: vi.fn(),
      };
    });
    mockUseForwardMetrics.mockReturnValue({
      summary: {
        total_requests: 0,
        successful_requests: 0,
        failed_requests: 0,
        total_tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      },
      endpointMetrics: [],
      requests: [],
      isLoading: false,
      isRefreshing: false,
      error: null,
      refresh: vi.fn(),
    });
    mockUseMetricsUsage.mockReturnValue({
      data: null,
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

    expect(screen.getByTestId("metric-cards-mock")).toHaveTextContent(
      "cards:10:gpt-5:sync-visible",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(await screen.findByTestId("sync-mismatch-breakdown-card-mock")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Overview" }));

    fireEvent.click(await openModelSelectAndFindOption("gpt-5"));

    await waitFor(() => {
      expect(mockUseMetrics).toHaveBeenLastCalledWith(
        expect.objectContaining({ filters: expect.objectContaining({ model: "gpt-5" }) }),
      );
      expect(screen.getByTestId("metric-cards-mock")).toHaveTextContent(
        "cards:2:gpt-5:sync-hidden",
      );
    });
    expect(screen.getByText("Avg Tokens / Session").parentElement).toHaveTextContent("20");

    fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
    expect(await screen.findByTestId("token-chart-mock")).toHaveTextContent("tokens:40");
    expect(screen.getByTestId("model-distribution-mock")).toHaveTextContent("models:gpt-5");
    expect(screen.queryByTestId("sync-mismatch-breakdown-card-mock")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Records" }));
    expect(await screen.findByTestId("session-table-mock")).toHaveTextContent("sessions:gpt-5");

    expect(await openModelSelectAndFindOption("claude-4")).toBeInTheDocument();
  });
});
