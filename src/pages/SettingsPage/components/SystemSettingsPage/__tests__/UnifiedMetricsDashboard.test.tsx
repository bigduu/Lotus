import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";

import UnifiedMetricsDashboard from "../UnifiedMetricsDashboard";

const mockUseUnifiedMetrics = vi.fn();
const mockUnifiedMetricsCards = vi.fn(({ showSyncMismatches = true }) => (
  <div data-testid="unified-metrics-cards-mock">
    {showSyncMismatches ? "sync-visible" : "sync-hidden"}
  </div>
));
const mockSyncMismatchBreakdown = vi.fn(() => (
  <div data-testid="unified-sync-mismatch-breakdown-mock" />
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

function clearModelSelect() {
  const select = screen.getAllByRole("combobox")[0].closest(".ant-select");
  const clear = select?.querySelector(".ant-select-clear");
  expect(clear).toBeTruthy();
  fireEvent.mouseDown(clear as HTMLElement);
}

vi.mock("../hooks/useUnifiedMetrics", () => ({
  useUnifiedMetrics: (...args: unknown[]) => mockUseUnifiedMetrics(...args),
}));

vi.mock("../metrics/UnifiedMetricsCards", () => ({
  default: (props: { showSyncMismatches?: boolean }) => mockUnifiedMetricsCards(props),
}));

vi.mock("../metrics/UnifiedTimelineChart", () => ({
  default: ({ data }: { data: Array<{ total_tokens: number }> }) => (
    <div data-testid="unified-timeline-mock">tokens:{data[0]?.total_tokens ?? 0}</div>
  ),
}));

vi.mock("../metrics/ModelDistribution", () => ({
  default: ({ data }: { data: Array<{ model: string }> }) => (
    <div data-testid="unified-model-distribution-mock">
      models:{data.map((item) => item.model).join(",")}
    </div>
  ),
}));

vi.mock("../metrics/SyncMismatchBreakdownCard", () => ({
  default: () => mockSyncMismatchBreakdown(),
}));

vi.mock("../metrics/ForwardEndpointDistribution", () => ({
  default: () => <div data-testid="forward-endpoint-distribution-mock" />,
}));

vi.mock("../metrics/SessionTable", () => ({
  default: () => <div data-testid="unified-session-table-mock" />,
}));

vi.mock("../metrics/ForwardRequestTable", () => ({
  default: () => <div data-testid="unified-forward-request-table-mock" />,
}));

describe("UnifiedMetricsDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the all-model selector catalog and hides unscoped sync mismatch metrics", async () => {
    mockUseUnifiedMetrics.mockImplementation(({ filters }: { filters: { model?: string } }) => {
      const filtered = filters.model === "gpt-5";
      return {
        chatSummary: {
          total_sessions: filtered ? 2 : 10,
          total_tokens: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
          total_tool_calls: 2,
          active_sessions: 0,
          total_sync_mismatches: filtered ? 0 : 3,
          sync_mismatch_breakdown: filtered ? {} : { missing_cursor: 3 },
        },
        forwardSummary: {
          total_requests: 0,
          successful_requests: 0,
          failed_requests: 0,
          total_tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        },
        combinedSummary: {
          total_requests: filtered ? 2 : 10,
          total_tokens: filtered ? 40 : 1000,
          total_success: filtered ? 2 : 10,
          total_errors: 0,
          success_rate: 100,
          total_sync_mismatches: filtered ? 0 : 3,
        },
        memorySummary: null,
        modelMetrics: filtered
          ? [
              {
                model: "gpt-5",
                sessions: 2,
                rounds: 4,
                tokens: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
                tool_calls: 2,
              },
            ]
          : [
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
            ],
        modelCatalog: ["gpt-5", "claude-4"],
        sessions: [],
        sessionDetail: null,
        endpointMetrics: [],
        forwardRequests: [],
        timeline: [
          {
            date: "2026-02-10",
            chat_tokens: filtered ? 40 : 1000,
            chat_sessions: filtered ? 2 : 10,
            forward_tokens: 0,
            forward_requests: 0,
            total_tokens: filtered ? 40 : 1000,
          },
        ],
        isLoading: false,
        isRefreshing: false,
        isSessionDetailLoading: false,
        error: null,
        refresh: vi.fn(),
        loadSessionDetail: vi.fn(),
        clearSessionDetail: vi.fn(),
      };
    });

    render(
      <AntdApp>
        <UnifiedMetricsDashboard />
      </AntdApp>,
    );

    expect(screen.getByTestId("unified-metrics-cards-mock")).toHaveTextContent("sync-visible");
    expect(screen.getByTestId("unified-sync-mismatch-breakdown-mock")).toBeInTheDocument();

    fireEvent.click(await openModelSelectAndFindOption("gpt-5"));

    await waitFor(() => {
      expect(mockUseUnifiedMetrics).toHaveBeenLastCalledWith(
        expect.objectContaining({ filters: expect.objectContaining({ model: "gpt-5" }) }),
      );
      expect(screen.getByTestId("unified-metrics-cards-mock")).toHaveTextContent("sync-hidden");
      expect(screen.getByTestId("unified-timeline-mock")).toHaveTextContent("tokens:40");
      expect(screen.getByTestId("unified-model-distribution-mock")).toHaveTextContent(
        "models:gpt-5",
      );
    });
    expect(
      screen.getByText("Memory metrics remain all-model and are not affected by the model filter."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("unified-sync-mismatch-breakdown-mock")).not.toBeInTheDocument();

    expect(await openModelSelectAndFindOption("claude-4")).toBeInTheDocument();

    clearModelSelect();
    await waitFor(() => {
      expect(mockUseUnifiedMetrics).toHaveBeenLastCalledWith(
        expect.objectContaining({ filters: expect.objectContaining({ model: undefined }) }),
      );
      expect(
        screen.queryByText(
          "Memory metrics remain all-model and are not affected by the model filter.",
        ),
      ).not.toBeInTheDocument();
    });
  });
});
