import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MemoryTrendChart from "../MemoryTrendChart";

vi.mock("recharts", () => ({
  CartesianGrid: () => <div data-testid="memory-trend-cartesian-grid" />,
  Legend: () => <div data-testid="memory-trend-legend" />,
  Line: ({ dataKey }: { dataKey: string }) => <div data-testid={`memory-trend-line-${dataKey}`} />,
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="memory-trend-line-chart">{children}</div>
  ),
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="memory-trend-responsive-container">{children}</div>
  ),
  Tooltip: () => <div data-testid="memory-trend-tooltip" />,
  XAxis: () => <div data-testid="memory-trend-x-axis" />,
  YAxis: () => <div data-testid="memory-trend-y-axis" />,
}));

describe("MemoryTrendChart", () => {
  it("renders empty state when no memory trend data exists", () => {
    render(<MemoryTrendChart data={[]} loading={false} />);

    expect(screen.getByText("Memory Trend")).toBeInTheDocument();
    expect(screen.getByText("No memory trend available")).toBeInTheDocument();
  });

  it("renders chart scaffolding and description when data is provided", () => {
    render(
      <MemoryTrendChart
        loading={false}
        data={[
          {
            label: "2026-04-01",
            period_start: "2026-04-01",
            period_end: "2026-04-01",
            created_memories: 2,
            updated_memories: 1,
            total_memories: 8,
          },
        ]}
      />,
    );

    expect(
      screen.getByText(/Created memories, updated memories, and total durable memory over time/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("memory-trend-responsive-container")).toBeInTheDocument();
    expect(screen.getByTestId("memory-trend-line-chart")).toBeInTheDocument();
    expect(screen.getByTestId("memory-trend-line-total_memories")).toBeInTheDocument();
    expect(screen.getByTestId("memory-trend-line-created_memories")).toBeInTheDocument();
    expect(screen.getByTestId("memory-trend-line-updated_memories")).toBeInTheDocument();
  });

  it("renders a loading skeleton state", () => {
    const { container } = render(<MemoryTrendChart data={[]} loading />);

    expect(screen.getByText(/Memory Trend/i)).toBeInTheDocument();
    expect(container.querySelector(".ant-skeleton")).toBeTruthy();
  });
});
