import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MemoryMetricsCards from "../MemoryMetricsCards";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe("MemoryMetricsCards", () => {
  it("renders loading skeleton state", () => {
    const { container } = render(<MemoryMetricsCards summary={null} loading />);
    expect(container.querySelector(".ant-skeleton")).toBeTruthy();
  });

  it("renders memory summary values and falls back on invalid timestamp strings", () => {
    render(
      <MemoryMetricsCards
        loading={false}
        summary={{
          scope: "project",
          project_key: "proj-1",
          total_memories: 12,
          stale_candidate_count: 3,
          project_count: 2,
          by_type: { project: 8, reference: 4 },
          by_status: { active: 10, stale: 2 },
          by_scope: { project: 12 },
          last_reindex_at: "not-a-date",
          last_dream_at: "2026-04-05T03:00:00Z",
        }}
      />,
    );

    expect(screen.getByText("settings.unifiedMetricsCards.totalMemories")).toBeInTheDocument();
    expect(screen.getByText("settings.unifiedMetricsCards.staleCandidates")).toBeInTheDocument();
    expect(screen.getByText("settings.unifiedMetricsCards.memoryProjects")).toBeInTheDocument();
    expect(screen.getByText("settings.unifiedMetricsCards.lastReindex")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("not-a-date")).toBeInTheDocument();
  });
});
